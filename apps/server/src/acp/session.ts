import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import { client, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import type { ClientConnection, McpServer, RequestPermissionRequest, StopReason } from '@agentclientprotocol/sdk';
import { SomeCodeError, type ConfigOption, type ErrorCode, type FormAnswer, type FormField, type ImageAttachment, type NormalizedEvent } from '@somecode/protocol';
import type { AgentDriver } from '../agents/types.ts';
import { PermissionBroker } from '../permissions/broker.ts';
import { normalizeConfigOptions, normalizeForm, normalizePermission, normalizeUpdate, sanitizeAnswer, sanitizePlanSteps, subagentOf } from './normalize.ts';
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
  /** Restore this durable session; never fall back to session/new. */
  acpSessionId?: string;
  /** Told about each rate-limit report the agent forwards (Claude's `_claude/rateLimit`), as the agent sent it. */
  onRateLimit?: (info: unknown) => void;
  /** The option to pick for a permission request without asking the user, or null to ask (see `planModeApproval`). */
  autoApprove?: (mode: string | null, req: RequestPermissionRequest) => string | null;
  /** Extra environment variables passed to the agent process (e.g. SOMECODE_URL, SOMECODE_TOKEN). */
  env?: NodeJS.ProcessEnv;
  /** MCP servers the agent starts for this session (ACP `mcpServers`): tools SomeCode offers it. */
  mcpServers?: McpServerConfig[];
};

export type McpServerConfig = McpServer;
type State = 'starting' | 'ready' | 'running' | 'disconnected';

/** JSON-RPC error codes from the agent that map to a specific SomeCode error. */
const RPC_ERROR_CODES: Record<number, ErrorCode> = { [-32000]: 'auth_required', [-32602]: 'bad_request' };
const KILL_GRACE_MS = 2000;
const DEFAULT_START_TIMEOUT_MS = 30_000;

function startTimeoutMs(opts: StartOptions): number {
  const fromEnv = Number(process.env.SOMECODE_AGENT_START_TIMEOUT_MS);
  return opts.timeoutMs ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_START_TIMEOUT_MS);
}

/** What the agent announced in `initialize` (diagnostics and the handshake check). */
export type AgentInfo = {
  agentInfo?: { name: string; version?: string };
  authMethods: Array<{ id: string; name: string }>;
  loadSession: boolean;
};

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
  readonly #driverId: string;
  readonly #child: ChildProcess;
  readonly #conn: ClientConnection;
  readonly #emit: (e: NormalizedEvent) => void;
  readonly #broker = new PermissionBroker();
  readonly #pendingPermissions = new Set<string>();
  /** Open questions (form requests) by request id: what each one asks, and the validated answer once given. */
  readonly #forms = new Map<string, FormField[]>();
  readonly #answers = new Map<string, FormAnswer>();
  /** Open research plans (request ids): the user may edit the steps before starting. */
  readonly #plans = new Set<string>();
  readonly #exited: Promise<void>;
  #sessionId = '';
  #loading = false;
  #state: State = 'starting';
  #stopReason: string | null = null;
  /** The options the agent reported, and the synthesized `mode` option when it only reports `modes`. */
  #agentOptions: ConfigOption[] = [];
  #modeFromModes: ConfigOption | null = null;
  #info: AgentInfo = { authMethods: [], loadSession: false };
  #autoApprove: StartOptions['autoApprove'];
  #onRateLimit: StartOptions['onRateLimit'];
  /** The latest context-window figures, and what was last announced (so a turn only reports a change). */
  #usage: { used: number; size: number } | null = null;
  #usageSent: { used: number; size: number } | null = null;

  static async start(opts: StartOptions): Promise<AcpSession> {
    const launch = opts.driver.launch();
    if (!existsSync(opts.cwd)) throw new SomeCodeError('bad_request', `cwd does not exist: ${opts.cwd}`);
    if (opts.signal?.aborted) throw new SomeCodeError('disconnected', 'agent start was aborted');
    const child = spawn(launch.command, launch.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    await spawned(child, launch.command);
    const session = new AcpSession(child, opts.driver.id, opts.onEvent);
    session.#autoApprove = opts.autoApprove;
    session.#onRateLimit = opts.onRateLimit;
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
      await session.#open(opts.cwd, opts.acpSessionId, opts.mcpServers);
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
    this.#driverId = label;
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
        if (params.sessionId !== this.#sessionId) {
          const isChild = subagentOf(params.update) !== undefined;
          if (!isChild) return;
        }
        // session/load replays the agent's transcript. Our journal already owns that history.
        if (this.#loading) return;
        // The manager journals every prompt itself before the turn starts. Some agents also echo the prompt back as
        // a user_message_chunk during the turn, which would show the message twice.
        if (!intercepted && params.update.sessionUpdate === 'user_message_chunk') return;
        if (!intercepted && params.update.sessionUpdate === 'usage_update') {
          this.#noteUsage(params.update);
          return;
        }
        // A sub-agent's own chatter (messages, thoughts) is not part of this conversation: only its tool calls are
        // kept, tagged with the sub-agent that made them.
        const updateKind = params.update.sessionUpdate;
        if (!intercepted && updateKind !== 'tool_call' && updateKind !== 'tool_call_update' && subagentOf(params.update)) return;
        if (!intercepted && params.update.sessionUpdate === 'current_mode_update') {
          const next = params.update.currentModeId;
          if (this.#modeFromModes) {
            this.#modeFromModes = { ...this.#modeFromModes, currentValue: next };
            this.#publishOptions(this.#agentOptions);
          } else if (this.#agentOptions.some((o) => this.#isModeOption(o) && o.currentValue !== next)) {
            // The agent reports its mode as a regular option: keep that option in step with an announced change.
            this.#publishOptions(this.#agentOptions.map((o) => (this.#isModeOption(o) ? { ...o, currentValue: next } : o)));
          }
          return;
        }
        const event = intercepted ? { type: 'unsupported' as const, ...intercepted } : normalizeUpdate(params.update);
        if (event?.type === 'config_options') this.#publishOptions(event.options);
        else if (event) this.#emit(event);
      })
      .onRequest(methods.client.session.requestPermission, async ({ params, signal }) => {
        if (this.#loading) return { outcome: { outcome: 'cancelled' as const } };
        const auto = this.#autoApprove?.(this.#currentMode(), params);
        if (auto) return { outcome: { outcome: 'selected' as const, optionId: auto } };
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
      .onRequest(methods.client.elicitation.create, async ({ params, signal }) => {
        if (this.#loading || params.mode !== 'form') return { action: 'decline' as const };
        const scoped = params as { sessionId?: string; toolCallId?: string };
        if (scoped.sessionId !== undefined && scoped.sessionId !== this.#sessionId) return { action: 'decline' as const };
        const fields = normalizeForm((params as { requestedSchema?: unknown }).requestedSchema);
        if (!fields) return { action: 'decline' as const };
        const { requestId, decision } = this.#broker.request();
        this.#pendingPermissions.add(requestId);
        this.#forms.set(requestId, fields);
        this.#emit({
          type: 'permission_request',
          requestId,
          toolCallId: scoped.toolCallId ?? requestId,
          title: params.message,
          options: [{ id: 'submit', name: 'Submit', kind: 'allow_once' }],
          form: { fields },
        });
        const withdraw = () => this.respondPermission(requestId, null);
        if (signal.aborted) withdraw();
        else signal.addEventListener('abort', withdraw, { once: true });
        const optionId = await decision;
        const answer = this.#answers.get(requestId);
        this.#forms.delete(requestId);
        this.#answers.delete(requestId);
        return optionId === null ? { action: 'cancel' as const } : { action: 'accept' as const, content: answer ?? {} };
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

  get info(): AgentInfo {
    return this.#info;
  }

  async #open(cwd: string, acpSessionId?: string, mcpServers: McpServerConfig[] = []): Promise<void> {
    const init = await this.#conn.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      // `elicitation.form`: the agent may ask the user questions (OpenCode's question tool, plan hand-offs).
      clientCapabilities: { elicitation: { form: {} } },
      clientInfo: { name: 'somecode', version: '0.0.0' },
    });
    if (init.protocolVersion !== PROTOCOL_VERSION) {
      throw new SomeCodeError('internal', `unsupported ACP protocol version ${init.protocolVersion}`);
    }
    this.#info = {
      ...(init.agentInfo
        ? { agentInfo: { name: init.agentInfo.name, ...(init.agentInfo.version ? { version: init.agentInfo.version } : {}) } }
        : {}),
      authMethods: (init.authMethods ?? []).map((m) => ({ id: m.id, name: m.name })),
      loadSession: init.agentCapabilities?.loadSession === true,
    };
    if (acpSessionId && !this.#info.loadSession) {
      throw new SomeCodeError('bad_request', 'this agent does not support loading saved sessions');
    }
    this.#loading = acpSessionId !== undefined;
    this.#sessionId = acpSessionId ?? '';
    const res = acpSessionId
      ? await this.#conn.agent.request(methods.agent.session.load, { cwd, mcpServers, sessionId: acpSessionId })
      : await this.#conn.agent.request(methods.agent.session.new, { cwd, mcpServers });
    if ('sessionId' in res && typeof res.sessionId === 'string') this.#sessionId = res.sessionId;
    // Drain notification handlers scheduled before the load response before accepting live updates.
    if (this.#loading) await new Promise((resolve) => setImmediate(resolve));
    this.#loading = false;
    const reported = res.configOptions ? normalizeConfigOptions(res.configOptions).options : [];
    const providesMode = reported.some((o) => o.id === 'mode' || o.category === 'mode');
    this.#modeFromModes = res.modes && !providesMode ? modeOption(res.modes) : null;
    const providesEffort = reported.some((o) => o.category === 'thought_level' || o.id === 'thought_level' || o.id === 'effort');
    if (!providesEffort && this.#driverId === 'opencode') {
      reported.push({
        id: 'thought_level',
        name: 'Effort',
        category: 'thought_level',
        currentValue: 'medium',
        choices: [
          { value: 'low', name: 'Low' },
          { value: 'medium', name: 'Medium' },
          { value: 'high', name: 'High' },
        ],
      });
    }
    if (reported.length > 0 || this.#modeFromModes) this.#publishOptions(reported);
    this.#state = 'ready';
    this.#emit({ type: 'status', status: 'ready' });
  }

  async prompt(text: string, images?: ImageAttachment[], preamble?: string): Promise<StopReason> {
    this.#assertConnected();
    if (this.#state === 'running') throw new SomeCodeError('turn_in_progress', 'a prompt turn is already running');
    this.#state = 'running';
    this.#emit({ type: 'status', status: 'running' });
    // The SDK dispatches updates through async handler chains but resolves responses directly
    // and does not document their relative order; one macrotask guarantees that every update
    // received before the response (or error) is emitted before `turn_end`.
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    try {
      const promptBlocks: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
      if (preamble) promptBlocks.push({ type: 'text', text: preamble });
      if (images && images.length > 0) {
        for (const img of images) {
          promptBlocks.push({
            type: 'image',
            data: img.data,
            mimeType: img.mimeType,
          });
        }
      }
      let promptText = text;
      if (this.#driverId === 'opencode') {
        const effort = this.#agentOptions.find((o) => o.id === 'thought_level')?.currentValue;
        if (effort && effort !== 'medium') {
          promptText = `[Reasoning Effort: ${effort.toUpperCase()}]\n${promptText}`;
        }
      }
      if (promptText || !promptBlocks.some((b) => b.type !== 'text' || b.text !== preamble)) {
        promptBlocks.push({ type: 'text', text: promptText });
      }

      const response = (await this.#conn.agent.request(methods.agent.session.prompt, {
        sessionId: this.#sessionId,
        prompt: promptBlocks as unknown as Array<{ type: 'text'; text: string }>,
      })) as { stopReason: StopReason };
      const stopReason = response.stopReason;
      await settle();
      this.#flushUsage();
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

  /** Remembers the context-window figures (announced when the turn ends) and forwards any rate-limit report. */
  #noteUsage(update: { used?: unknown; size?: unknown; _meta?: unknown }): void {
    if (typeof update.used === 'number' && typeof update.size === 'number' && update.size > 0) {
      this.#usage = { used: update.used, size: update.size };
    }
    const meta = update._meta;
    if (typeof meta === 'object' && meta !== null && '_claude/rateLimit' in meta) {
      this.#onRateLimit?.((meta as Record<string, unknown>)['_claude/rateLimit']);
    }
  }

  #flushUsage(): void {
    const usage = this.#usage;
    if (usage && (this.#usageSent?.used !== usage.used || this.#usageSent?.size !== usage.size)) {
      this.#usageSent = usage;
      this.#emit({ type: 'usage', used: usage.used, size: usage.size });
    }
  }

  /** The session's current mode id, from whichever way the agent reports it. */
  #currentMode(): string | null {
    return (this.#modeFromModes ?? this.#agentOptions.find((o) => this.#isModeOption(o)))?.currentValue ?? null;
  }

  #isModeOption(o: ConfigOption): boolean {
    return o.id === 'mode' || o.category === 'mode';
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
      if (configId === 'thought_level' && this.#driverId === 'opencode') {
        this.#agentOptions = this.#agentOptions.map((o) => (o.id === 'thought_level' ? { ...o, currentValue: value } : o));
        this.#publishOptions(this.#agentOptions);
        return;
      }
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
  respondPermission(requestId: string, optionId: string | null, answer?: FormAnswer): boolean {
    if (!this.#pendingPermissions.has(requestId)) return false;
    // A question's answer is checked against what it asked before anything is settled; a bad one throws and the
    // question stays open.
    const fields = this.#forms.get(requestId);
    let clean = fields && optionId !== null ? sanitizeAnswer(fields, answer ?? {}) : undefined;
    if (this.#plans.has(requestId) && optionId === 'start') clean = { steps: sanitizePlanSteps(answer?.['steps']) };
    this.#pendingPermissions.delete(requestId);
    if (clean) this.#answers.set(requestId, clean);
    this.#emit(
      optionId === null
        ? { type: 'permission_resolved', requestId, outcome: 'cancelled' }
        : { type: 'permission_resolved', requestId, outcome: 'selected', optionId, ...(clean ? { answer: clean } : {}) },
    );
    return this.#broker.respond(requestId, optionId);
  }

  /**
   * Puts a research plan in front of the user and waits: they may edit the steps, start or cancel. Resolves with the
   * steps to follow, or null when they cancelled (or the chat was stopped).
   */
  async askPlan(title: string, steps: string[]): Promise<{ requestId: string; result: Promise<string[] | null> }> {
    const { requestId, decision } = this.#broker.request();
    this.#pendingPermissions.add(requestId);
    this.#plans.add(requestId);
    this.#emit({
      type: 'permission_request',
      requestId,
      toolCallId: requestId,
      title,
      options: [{ id: 'start', name: 'Start', kind: 'allow_once' }, { id: 'cancel', name: 'Cancel', kind: 'reject_once' }],
      plan: { steps },
    });
    const result = decision.then((optionId) => {
      const answer = this.#answers.get(requestId);
      this.#plans.delete(requestId);
      this.#answers.delete(requestId);
      const edited = answer?.['steps'];
      return optionId === 'start' && Array.isArray(edited) ? (edited as string[]) : null;
    });
    return { requestId, result };
  }

  /**
   * Puts something to the user to approve or refuse (`detail` is markdown) and waits. Resolves true on approval; a
   * refusal, a cancelled turn or a closed chat is false.
   */
  async askApproval(title: string, detail: string): Promise<{ requestId: string; result: Promise<boolean> }> {
    const { requestId, decision } = this.#broker.request();
    this.#pendingPermissions.add(requestId);
    this.#emit({
      type: 'permission_request',
      requestId,
      toolCallId: requestId,
      title,
      detail,
      options: [{ id: 'approve', name: 'Approve', kind: 'allow_once' }, { id: 'refuse', name: 'Refuse', kind: 'reject_once' }],
    });
    return { requestId, result: decision.then((optionId) => optionId === 'approve') };
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
