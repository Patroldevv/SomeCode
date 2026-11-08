import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { client, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import type { ClientConnection, StopReason } from '@agentclientprotocol/sdk';
import { SomeCodeError, type ConfigOption, type ErrorCode, type NormalizedEvent } from '@somecode/protocol';
import type { AgentDriver } from '../agents/types.ts';
import { PermissionBroker } from '../permissions/broker.ts';
import { normalizeConfigOptions, normalizePermission, normalizeUpdate } from './normalize.ts';
import { jsonLines, UnknownUpdates } from './stdio.ts';

export type { StopReason };

type StartOptions = {
  driver: AgentDriver;
  cwd: string;
  onEvent: (e: NormalizedEvent) => void;
  /** Aborting it while the agent is still starting stops the agent and rejects as `disconnected`. */
  signal?: AbortSignal;
  /** Budget for `initialize` + `session/new`; default `SOMECODE_AGENT_START_TIMEOUT_MS` or 30 s. */
  timeoutMs?: number;
};
type State = 'starting' | 'ready' | 'running' | 'disconnected';

/** JSON-RPC error codes from the agent that map to a specific SomeCode error. */
const RPC_ERROR_CODES: Record<number, ErrorCode> = { [-32000]: 'auth_required', [-32602]: 'bad_request' };
const KILL_GRACE_MS = 2000;
const DEFAULT_START_TIMEOUT_MS = 30_000;

function startTimeoutMs(opts: StartOptions): number {
  const fromEnv = Number(process.env.SOMECODE_AGENT_START_TIMEOUT_MS);
  return opts.timeoutMs ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_START_TIMEOUT_MS);
}

type ModeState = { currentModeId: string; availableModes: Array<{ id: string; name: string; description?: string | null }> };

/** An agent that only reports `modes` gets a synthesized `mode` option so the UI can treat it like any other. */
function modeOption(modes: ModeState): ConfigOption {
  return {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    currentValue: modes.currentModeId,
    choices: modes.availableModes.map((m) => ({
      value: m.id,
      name: m.name,
      ...(m.description ? { description: m.description } : {}),
    })),
  };
}

function toSomeCodeError(err: unknown, what: string): SomeCodeError {
  if (err instanceof SomeCodeError) return err;
  const code = (err instanceof RequestError && RPC_ERROR_CODES[err.code]) || 'internal';
  return new SomeCodeError(code, `${what}: ${err instanceof Error ? err.message : String(err)}`);
}

/** Resolves once the child has spawned; maps spawn failures to `agent_not_installed`. */
function spawned(child: ChildProcess, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', (err: NodeJS.ErrnoException) => {
      const code = err.code === 'ENOENT' || err.code === 'EACCES' ? 'agent_not_installed' : 'internal';
      reject(new SomeCodeError(code, `cannot start agent "${command}": ${err.message}`));
    });
  });
}

/** One ACP agent process and the single ACP session it hosts. */
export class AcpSession {
  readonly #child: ChildProcess;
  readonly #conn: ClientConnection;
  readonly #emit: (e: NormalizedEvent) => void;
  readonly #broker = new PermissionBroker();
  readonly #pendingPermissions = new Set<string>();
  readonly #exited: Promise<void>;
  #sessionId = '';
  #state: State = 'starting';
  #stopReason: string | null = null;
  /** The options the agent reported, and the synthesized `mode` option when it only reports `modes`. */
  #agentOptions: ConfigOption[] = [];
  #modeFromModes: ConfigOption | null = null;

  static async start(opts: StartOptions): Promise<AcpSession> {
    const launch = opts.driver.launch();
    if (!existsSync(opts.cwd)) throw new SomeCodeError('bad_request', `cwd does not exist: ${opts.cwd}`);
    if (opts.signal?.aborted) throw new SomeCodeError('disconnected', 'agent start was aborted');
    const child = spawn(launch.command, launch.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    await spawned(child, launch.command);
    const session = new AcpSession(child, opts.driver.id, opts.onEvent);
    // Aborting the start (server shutdown) stops the agent, so the handshake fails as disconnected.
    const abort = () => session.#kill('closed');
    opts.signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      session.#kill('start_timeout');
    }, startTimeoutMs(opts));
    try {
      if (opts.signal?.aborted) abort();
      await session.#open(opts.cwd);
    } catch (err) {
      const error = timedOut
        ? new SomeCodeError('disconnected', 'agent did not start in time')
        : session.#conn.signal.aborted
          ? new SomeCodeError('disconnected', `agent exited during startup: ${String(err)}`)
          : toSomeCodeError(err, 'agent startup failed');
      await session.#shutdown(error.code === 'auth_required' ? 'auth_required' : 'startup_failed');
      throw error;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
    }
    return session;
  }

  private constructor(child: ChildProcess, label: string, onEvent: (e: NormalizedEvent) => void) {
    this.#child = child;
    this.#emit = onEvent;
    // Errors after spawn (EPIPE on a dead agent's stdin, kill failures) surface via exit/close.
    child.on('error', () => {});
    child.stdin!.on('error', () => {});
    this.#exited = new Promise((resolve) => {
      child.once('exit', (code, signal) => {
        const reason = this.#stopReason ?? (code === 0 && !signal ? 'exited' : 'crashed');
        this.#disconnect(reason);
        resolve();
      });
    });
    const unknownUpdates = new UnknownUpdates();
    const input = (Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>).pipeThrough(
      jsonLines(label, (line) => unknownUpdates.rewrite(line)),
    );
    const output = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
    this.#conn = client({ name: 'somecode' })
      .onNotification(methods.client.session.update, ({ params }) => {
        const intercepted = unknownUpdates.take(params);
        if (params.sessionId !== this.#sessionId) return;
        if (!intercepted && params.update.sessionUpdate === 'current_mode_update' && this.#modeFromModes) {
          this.#modeFromModes = { ...this.#modeFromModes, currentValue: params.update.currentModeId };
          this.#publishOptions(this.#agentOptions);
          return;
        }
        const event = intercepted ? { type: 'unsupported' as const, ...intercepted } : normalizeUpdate(params.update);
        if (event?.type === 'config_options') this.#publishOptions(event.options);
        else if (event) this.#emit(event);
      })
      .onRequest(methods.client.session.requestPermission, async ({ params, signal }) => {
        const { requestId, decision } = this.#broker.request();
        this.#pendingPermissions.add(requestId);
        this.#emit(normalizePermission(requestId, params));
        // The agent may withdraw the request ($/cancel_request) or the connection may drop.
        const withdraw = () => this.respondPermission(requestId, null);
        if (signal.aborted) withdraw();
        else signal.addEventListener('abort', withdraw, { once: true });
        const optionId = await decision;
        return optionId === null
          ? { outcome: { outcome: 'cancelled' as const } }
          : { outcome: { outcome: 'selected' as const, optionId } };
      })
      .connect(ndJsonStream(output, input));
    // A dead connection makes the agent useless. Give it a moment to exit on its own (so a
    // crash keeps its exit code as the reason), then stop it; the exit handler reports.
    void this.#conn.closed.then(() => {
      if (this.#hasExited()) return;
      const timer = setTimeout(() => this.#kill('connection_closed'), KILL_GRACE_MS);
      child.once('exit', () => clearTimeout(timer));
    });
  }

  get acpSessionId(): string {
    return this.#sessionId;
  }

  async #open(cwd: string): Promise<void> {
    const init = await this.#conn.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'somecode', version: '0.0.0' },
    });
    if (init.protocolVersion !== PROTOCOL_VERSION) {
      throw new SomeCodeError('internal', `unsupported ACP protocol version ${init.protocolVersion}`);
    }
    const res = await this.#conn.agent.request(methods.agent.session.new, { cwd, mcpServers: [] });
    this.#sessionId = res.sessionId;
    const reported = res.configOptions ? normalizeConfigOptions(res.configOptions).options : [];
    const providesMode = reported.some((o) => o.id === 'mode' || o.category === 'mode');
    this.#modeFromModes = res.modes && !providesMode ? modeOption(res.modes) : null;
    if (reported.length > 0 || this.#modeFromModes) this.#publishOptions(reported);
    this.#state = 'ready';
    this.#emit({ type: 'status', status: 'ready' });
  }

  async prompt(text: string): Promise<StopReason> {
    this.#assertConnected();
    if (this.#state === 'running') throw new SomeCodeError('turn_in_progress', 'a prompt turn is already running');
    this.#state = 'running';
    this.#emit({ type: 'status', status: 'running' });
    // The SDK dispatches updates through async handler chains but resolves responses directly
    // and does not document their relative order; one macrotask guarantees that every update
    // received before the response (or error) is emitted before `turn_end`.
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    try {
      const { stopReason } = await this.#conn.agent.request(methods.agent.session.prompt, {
        sessionId: this.#sessionId,
        prompt: [{ type: 'text', text }],
      });
      await settle();
      this.#emit({ type: 'turn_end', stopReason });
      return stopReason;
    } catch (err) {
      const failure = this.#failure(err, 'prompt failed');
      // The agent answered the prompt with an error: make the outcome visible to every client.
      // A lost connection is reported by status:disconnected instead.
      await settle();
      if (failure.code !== 'disconnected' && this.#isConnected()) {
        this.#emit({
          type: 'turn_end',
          stopReason: 'error',
          error: { code: failure.code, message: failure.message },
        });
      }
      throw failure;
    } finally {
      if (this.#state === 'running' && !this.#conn.signal.aborted) {
        this.#state = 'ready';
        this.#emit({ type: 'status', status: 'ready' });
      }
    }
  }

  async cancel(): Promise<void> {
    if (this.#state !== 'running' || !this.#isConnected()) return;
    // ACP: the client answers its pending permission requests with `cancelled` on cancel.
    this.#cancelPermissions();
    await this.#conn.agent
      .notify(methods.agent.session.cancel, { sessionId: this.#sessionId })
      .catch(() => {}); // a closed connection is reported through the disconnect path
  }

  /** Emits the agent's options (plus the synthesized mode option, if any) as one `config_options` event. */
  #publishOptions(list: ConfigOption[]): void {
    this.#agentOptions = list;
    const options = this.#modeFromModes ? [...list, this.#modeFromModes] : list;
    this.#emit({ type: 'config_options', options });
  }

  async setConfig(configId: string, value: string): Promise<void> {
    this.#assertConnected();
    if (this.#state === 'running') throw new SomeCodeError('turn_in_progress', 'cannot change options while a turn runs');
    try {
      if (configId === 'mode' && this.#modeFromModes) {
        await this.#conn.agent.request(methods.agent.session.setMode, { sessionId: this.#sessionId, modeId: value });
        // The agent may also announce `current_mode_update`; publishing twice is harmless.
        if (this.#modeFromModes) this.#modeFromModes = { ...this.#modeFromModes, currentValue: value };
        this.#publishOptions(this.#agentOptions);
        return;
      }
      const res = await this.#conn.agent.request(methods.agent.session.setConfigOption, {
        sessionId: this.#sessionId,
        configId,
        value,
      });
      this.#publishOptions(normalizeConfigOptions(res.configOptions).options);
    } catch (err) {
      throw this.#failure(err, `set_config_option ${configId} failed`);
    }
  }

  /** Settles a pending permission request; emits `permission_resolved` synchronously. */
  respondPermission(requestId: string, optionId: string | null): boolean {
    if (!this.#pendingPermissions.delete(requestId)) return false;
    this.#emit(
      optionId === null
        ? { type: 'permission_resolved', requestId, outcome: 'cancelled' }
        : { type: 'permission_resolved', requestId, outcome: 'selected', optionId },
    );
    return this.#broker.respond(requestId, optionId);
  }

  close(): Promise<void> {
    return this.#shutdown('closed');
  }

  async #shutdown(reason: string): Promise<void> {
    this.#cancelPermissions();
    this.#kill(reason);
    await this.#exited;
  }

  #cancelPermissions(): void {
    for (const requestId of [...this.#pendingPermissions]) this.respondPermission(requestId, null);
    this.#broker.cancelAll();
  }

  /** Stops the agent process (SIGTERM, then SIGKILL after a grace period). */
  #kill(reason: string): void {
    if (this.#hasExited()) return;
    this.#stopReason ??= reason;
    const child = this.#child;
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    child.once('exit', () => clearTimeout(timer));
  }

  #hasExited(): boolean {
    return this.#child.exitCode !== null || this.#child.signalCode !== null;
  }

  #disconnect(reason: string): void {
    if (this.#state === 'disconnected') return;
    this.#state = 'disconnected';
    this.#cancelPermissions();
    this.#conn.close(new SomeCodeError('disconnected', `agent ${reason}`));
    this.#emit({ type: 'status', status: 'disconnected', reason });
  }

  #isConnected(): boolean {
    return this.#state !== 'disconnected' && !this.#conn.signal.aborted;
  }

  #assertConnected(): void {
    if (!this.#isConnected()) throw new SomeCodeError('disconnected', 'agent is not connected');
  }

  #failure(err: unknown, what: string): SomeCodeError {
    if (this.#isConnected()) return toSomeCodeError(err, what);
    return new SomeCodeError('disconnected', `${what}: agent disconnected`);
  }
}
