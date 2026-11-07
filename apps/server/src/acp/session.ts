import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { client, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import type { ClientConnection, StopReason } from '@agentclientprotocol/sdk';
import { SomeCodeError, type ErrorCode, type NormalizedEvent } from '@somecode/protocol';
import type { AgentDriver } from '../agents/types.ts';
import { PermissionBroker } from '../permissions/broker.ts';
import { normalizeConfigOptions, normalizePermission, normalizeUpdate } from './normalize.ts';

export type { StopReason };

type StartOptions = { driver: AgentDriver; cwd: string; onEvent: (e: NormalizedEvent) => void };
type State = 'starting' | 'ready' | 'running' | 'disconnected';

/** JSON-RPC error codes from the agent that map to a specific SomeCode error. */
const RPC_ERROR_CODES: Record<number, ErrorCode> = { [-32000]: 'auth_required', [-32602]: 'bad_request' };
const KILL_GRACE_MS = 2000;

/**
 * Passes only complete stdout lines that look like JSON objects to the ACP stream, so stray
 * agent output (banners, logs) never reaches the JSON-RPC layer. Dropped lines go to stderr.
 */
function jsonLines(label: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  const emit = (line: string, out: TransformStreamDefaultController<Uint8Array>) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) out.enqueue(encoder.encode(`${trimmed}\n`));
    else if (trimmed) {
      process.stderr.write(`[somecode] ${label}: ignored non-JSON stdout line: ${trimmed.slice(0, 200)}\n`);
    }
  };
  return new TransformStream({
    transform(chunk, out) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        emit(buffer.slice(0, nl), out);
        buffer = buffer.slice(nl + 1);
      }
    },
    flush(out) {
      emit(buffer + decoder.decode(), out);
    },
  });
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

  static async start(opts: StartOptions): Promise<AcpSession> {
    const launch = opts.driver.launch();
    if (!existsSync(opts.cwd)) throw new SomeCodeError('bad_request', `cwd does not exist: ${opts.cwd}`);
    const child = spawn(launch.command, launch.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    await spawned(child, launch.command);
    const session = new AcpSession(child, opts.driver.id, opts.onEvent);
    try {
      await session.#open(opts.cwd);
    } catch (err) {
      const error = session.#conn.signal.aborted
        ? new SomeCodeError('disconnected', `agent exited during startup: ${String(err)}`)
        : toSomeCodeError(err, 'agent startup failed');
      await session.#shutdown(error.code === 'auth_required' ? 'auth_required' : 'startup_failed');
      throw error;
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
    const input = (Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>).pipeThrough(jsonLines(label));
    const output = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
    this.#conn = client({ name: 'somecode' })
      .onNotification(methods.client.session.update, ({ params }) => {
        if (params.sessionId !== this.#sessionId) return;
        const event = normalizeUpdate(params.update);
        if (event) this.#emit(event);
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
    if (res.configOptions) this.#emit(normalizeConfigOptions(res.configOptions));
    this.#state = 'ready';
    this.#emit({ type: 'status', status: 'ready' });
  }

  async prompt(text: string): Promise<StopReason> {
    this.#assertConnected();
    if (this.#state === 'running') throw new SomeCodeError('turn_in_progress', 'a prompt turn is already running');
    this.#state = 'running';
    this.#emit({ type: 'status', status: 'running' });
    try {
      const { stopReason } = await this.#conn.agent.request(methods.agent.session.prompt, {
        sessionId: this.#sessionId,
        prompt: [{ type: 'text', text }],
      });
      // The SDK dispatches updates through async handler chains but resolves responses
      // directly and does not document their relative order; one macrotask guarantees that
      // every update received before the response is emitted before `turn_end`.
      await new Promise((resolve) => setImmediate(resolve));
      this.#emit({ type: 'turn_end', stopReason });
      return stopReason;
    } catch (err) {
      throw this.#failure(err, 'prompt failed');
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

  async setConfig(configId: string, value: string): Promise<void> {
    this.#assertConnected();
    try {
      const res = await this.#conn.agent.request(methods.agent.session.setConfigOption, {
        sessionId: this.#sessionId,
        configId,
        value,
      });
      this.#emit(normalizeConfigOptions(res.configOptions));
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
