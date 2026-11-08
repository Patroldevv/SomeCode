import { statSync } from 'node:fs';
import { recordRateLimit } from '../limits.ts';
import { approvalDecision, approvalOption, parseApproval, plainModeFor, trimModeOption, type ApprovalLevel } from '../permissions/approval.ts';
import { DEFAULT_SETTINGS, defaultApprovalLevel, type ServerSettings } from '../settings.ts';
import { agentGuide } from '../agentGuide.ts';
import { SomeCodeError, type ConfigOption, type FormAnswer, type ImageAttachment, type SessionHistoryPage, type NormalizedEvent, type StoredEvent } from '@somecode/protocol';
import { AcpSession } from '../acp/session.ts';
import type { AgentRegistry } from '../agents/registry.ts';
import type { AgentDriver } from '../agents/types.ts';
import { MAX_EVENT_PAGE, type SessionRow, type Store } from '../store/store.ts';
import { AntigravitySubagentWatcher } from '../subagents/antigravityWatcher.ts';

type Listener = (e: StoredEvent) => void;

type Entry = {
  /** Null until the agent has started, and for sessions with no live agent in this process. */
  session: AcpSession | null;
  /** Startup/resume owns this entry even before it has a live process. */
  pending: boolean;
  listeners: Set<Listener>;
  busy: boolean;
  disconnected: boolean;
  /** Identifies the running turn so a finished turn cannot clear the flag of its successor. */
  turn: symbol | null;
  /** Stored events awaiting broadcast; `draining` is set while a broadcast loop is running. */
  queue: StoredEvent[];
  draining: boolean;
  subagentWatchers: Map<string, AntigravitySubagentWatcher>;
  /** The agent has been told about the app (once per connection). */
  guided?: boolean;
  pendingSubagents: Map<string, { role: string; prompt?: string; startedAt: number }>;
};

function log(message: string, err: unknown): void {
  process.stderr.write(`[somecode] ${message}: ${err instanceof Error ? err.message : String(err)}\n`);
}

const shuttingDown = (): SomeCodeError => new SomeCodeError('disconnected', 'SomeCode is shutting down');

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Owns the live agent sessions: persists every event, fans it out, and replays history safely. */
export class SessionManager {
  readonly #store: Store;
  readonly #registry: AgentRegistry;
  readonly #entries = new Map<string, Entry>();
  /** Aborted by closeAll(): stops agents that are still starting and refuses new sessions. */
  readonly #shutdown = new AbortController();
  /** createSession() agent starts in flight; closeAll() waits for them. */
  readonly #starting = new Set<Promise<unknown>>();
  readonly #resuming = new Map<string, Promise<SessionRow>>();

  readonly #settings: () => ServerSettings;
  /** The access level of each session, and the options its agent last reported (before our additions). */
  readonly #approvals = new Map<string, ApprovalLevel>();
  readonly #agentOptions = new Map<string, ConfigOption[]>();

  constructor(deps: { store: Store; registry: AgentRegistry; settings?: () => ServerSettings }) {
    this.#store = deps.store;
    this.#registry = deps.registry;
    this.#settings = deps.settings ?? (() => DEFAULT_SETTINGS);
  }

  async createSession(projectId: string, agentId: string): Promise<SessionRow> {
    if (this.#shutdown.signal.aborted) throw shuttingDown();
    const project = this.#store.getProject(projectId);
    if (!project) throw new SomeCodeError('not_found', `unknown project: ${projectId}`);
    const driver = this.#registry.get(agentId);
    if (!driver) throw new SomeCodeError('not_found', `unknown agent: ${agentId}`);
    if (!isDirectory(project.path)) {
      throw new SomeCodeError('bad_request', `project path is not an existing directory: ${project.path}`);
    }
    if (!(await driver.detect()).installed) {
      throw new SomeCodeError('agent_not_installed', `agent "${agentId}" is not installed`);
    }
    if (this.#shutdown.signal.aborted) throw shuttingDown();

    // The row comes first so that every event the agent emits (even during startup) has a home.
    const row = this.#store.createSession({ projectId, agentId });
    const entry = this.#entry(row.id);
    entry.pending = true;
    const starting = this.#startAgent(row.id, entry, driver, project.path);
    this.#starting.add(starting);
    try {
      entry.session = await starting;
    } finally {
      entry.pending = false;
      this.#starting.delete(starting);
    }
    this.#store.setAcpSessionId(row.id, entry.session.acpSessionId);
    return this.#store.getSession(row.id)!;
  }

  /** Explicit, single-flight restoration of the existing ACP id, including after server restart. */
  resumeSession(sessionId: string): Promise<SessionRow> {
    if (this.#shutdown.signal.aborted) return Promise.reject(shuttingDown());
    const pending = this.#resuming.get(sessionId);
    if (pending) return pending;
    const row = this.#store.getSession(sessionId);
    if (!row) return Promise.reject(new SomeCodeError('not_found', `unknown session: ${sessionId}`));
    const entry = this.#entry(sessionId);
    if (entry.session && !entry.disconnected) return Promise.resolve(row);
    entry.pending = true;
    const resume = (async () => {
      if (!row.acpSessionId) throw new SomeCodeError('bad_request', 'session has no saved ACP id to resume');
      const project = this.#store.getProject(row.projectId);
      const driver = this.#registry.get(row.agentId);
      if (!project || !driver) throw new SomeCodeError('not_found', 'session project or agent is unavailable');
      if (!isDirectory(project.path)) throw new SomeCodeError('bad_request', 'session directory is unavailable');
      if (!(await driver.detect()).installed) throw new SomeCodeError('agent_not_installed', 'session agent is not installed');
      if (this.#shutdown.signal.aborted) throw shuttingDown();
      await entry.session?.close();
      entry.session = null;
      entry.disconnected = false;
      entry.busy = false;
      entry.turn = null;
      entry.session = await this.#startAgent(sessionId, entry, driver, project.path, row.acpSessionId);
      // A previous process's broker cannot answer these requests. Cancel their durable cards too.
      let permissionCursor = 0;
      for (;;) {
        const pendingPermissions = this.#store.pendingPermissions(sessionId, permissionCursor);
        if (pendingPermissions.length === 0) break;
        for (const permission of pendingPermissions) {
          this.#onEvent(sessionId, entry, { type: 'permission_resolved', requestId: permission.requestId, outcome: 'cancelled' });
          permissionCursor = permission.seq;
        }
      }
      return this.#store.getSession(sessionId)!;
    })();
    this.#resuming.set(sessionId, resume);
    this.#starting.add(resume);
    const clear = () => {
      entry.pending = false;
      this.#resuming.delete(sessionId);
      this.#starting.delete(resume);
    };
    void resume.then(clear, clear);
    return resume;
  }

  async #startAgent(sessionId: string, entry: Entry, driver: AgentDriver, cwd: string, acpSessionId?: string): Promise<AcpSession> {
    const signal = this.#shutdown.signal;
    let session: AcpSession;
    try {
      session = await AcpSession.start({ driver, cwd, signal, ...(acpSessionId ? { acpSessionId } : {}), onRateLimit: (info) => recordRateLimit(this.#store, driver.id, info), autoApprove: (mode, req) => approvalDecision({ level: this.#approval(sessionId), mode, planAuto: this.#settings().planAutoApprove, cwd }, req), onEvent: (event) => this.#onEvent(sessionId, entry, event) });
    } catch (err) {
      // A failure before the agent ever ran (e.g. spawn error) emits no status of its own.
      if (!entry.disconnected) {
        this.#onEvent(sessionId, entry, {
          type: 'status',
          status: 'disconnected',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      throw signal.aborted ? shuttingDown() : err;
    }
    if (signal.aborted) {
      // closeAll() ran just as the start finished; this session is not in its list yet.
      await session.close();
      throw shuttingDown();
    }
    // An agent with no options of its own still gets the access-level picker.
    if (!this.#agentOptions.has(sessionId)) this.#onEvent(sessionId, entry, { type: 'config_options', options: [] });
    void this.#leavePermissiveMode(sessionId, session);
    return session;
  }

  /** Starts a turn and returns immediately; progress and the outcome arrive as events. */
  prompt(sessionId: string, text: string, images?: ImageAttachment[]): void {
    const entry = this.#known(sessionId);
    const session = entry.session;
    if (!session || entry.disconnected) throw new SomeCodeError('disconnected', 'agent is not connected');
    if (entry.busy) throw new SomeCodeError('turn_in_progress', 'a prompt turn is already running');
    const turn = Symbol('turn');
    entry.turn = turn;
    entry.busy = true;
    // The turn is accepted: record the user's message first so it precedes status:running.
    this.#onEvent(sessionId, entry, {
      type: 'user_message',
      text,
      ...(images && images.length > 0 ? { images } : {}),
    });
    // The first turn of a chat also carries the guide to the app (not journaled, so it never shows in the chat).
    const preamble = !entry.guided && this.#settings().agentGuide ? agentGuide() : undefined;
    entry.guided = true;
    session
      .prompt(text, images, preamble)
      .catch((err: unknown) => log(`prompt failed for session ${sessionId}`, err))
      .finally(() => {
        if (entry.turn === turn) entry.busy = false;
      });
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#known(sessionId).session?.cancel();
  }

  respondPermission(sessionId: string, requestId: string, optionId: string | null, answer?: FormAnswer): void {
    const entry = this.#known(sessionId);
    const session = entry.session;
    if (!session || entry.disconnected) throw new SomeCodeError('disconnected', 'agent is not connected');
    if (!session.respondPermission(requestId, optionId, answer)) {
      throw new SomeCodeError('not_found', `no pending permission request: ${requestId}`);
    }
  }

  /** The access level of a session: what the user set for it, else the default for new chats. */
  #approval(sessionId: string): ApprovalLevel {
    const known = this.#approvals.get(sessionId);
    if (known) return known;
    const level = parseApproval(this.#store.getSetting(`approval:${sessionId}`)) ?? defaultApprovalLevel(this.#settings());
    this.#approvals.set(sessionId, level);
    return level;
  }

  /** Access levels replace the agent's own "accept edits"/"bypass" modes: a session never stays in one. */
  async #leavePermissiveMode(sessionId: string, session: AcpSession): Promise<void> {
    const mode = this.#agentOptions.get(sessionId)?.map(plainModeFor).find((m) => m !== null);
    if (!mode) return;
    try {
      await session.setConfig('mode', mode);
    } catch (err) {
      log(`cannot move session ${sessionId} out of a permissive mode`, err);
    }
  }

  async setConfig(sessionId: string, configId: string, value: string): Promise<void> {
    if (configId === 'approval') {
      const entry = this.#known(sessionId);
      const level = parseApproval(value);
      if (!level) throw new SomeCodeError('bad_request', `unknown access level: ${value}`);
      this.#approvals.set(sessionId, level);
      this.#store.setSetting(`approval:${sessionId}`, level);
      this.#onEvent(sessionId, entry, { type: 'config_options', options: this.#agentOptions.get(sessionId) ?? [] });
      return;
    }
    const session = this.#known(sessionId).session;
    if (!session) throw new SomeCodeError('disconnected', 'agent is not connected');
    await session.setConfig(configId, value);
  }

  history(sessionId: string, beforeSeq?: number, limit?: number): SessionHistoryPage {
    if (!this.#store.getSession(sessionId)) throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
    const entry = this.#entries.get(sessionId);
    const history = this.#store.history(sessionId, beforeSeq, limit);
    // A persisted ready status describes the previous process, not a currently running agent.
    if (!entry?.session || entry.disconnected) history.state.status = 'disconnected';
    return history;
  }

  /**
   * Delivers every stored event after `afterSeq` in order, then live events, each exactly once.
   * The listener is registered before history is read; live events arriving meanwhile are
   * held back and merged by seq.
   */
  subscribe(
    sessionId: string,
    afterSeq: number,
    listener: (e: StoredEvent) => void,
  ): { lastSeq: number; snapshot?: SessionHistoryPage; unsubscribe(): void } {
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      throw new SomeCodeError('bad_request', 'afterSeq must be an integer >= 0');
    }
    const entry = this.#known(sessionId);
    let active = true;
    let replaying = true;
    let lastDelivered = afterSeq;
    const held: StoredEvent[] = [];
    const deliver = (e: StoredEvent): void => {
      if (!active || e.seq <= lastDelivered) return;
      lastDelivered = e.seq;
      try {
        listener(e);
      } catch (err) {
        log(`listener for session ${sessionId} threw`, err);
      }
    };
    const wrapper: Listener = (e) => {
      if (replaying) held.push(e);
      else deliver(e);
    };
    entry.listeners.add(wrapper);

    const lastSeq = this.#store.lastSeq(sessionId);
    const noLiveAgent = !entry.session || entry.disconnected;
    const history = noLiveAgent || lastSeq - afterSeq > MAX_EVENT_PAGE ? [] : this.#store.eventsSince(sessionId, afterSeq);
    const needsSnapshot = noLiveAgent || lastSeq - afterSeq > MAX_EVENT_PAGE || (afterSeq < lastSeq && history.at(-1)?.seq !== lastSeq);
    const snapshot = needsSnapshot ? this.history(sessionId) : undefined;
    if (snapshot) lastDelivered = snapshot.state.lastSeq;
    for (const e of history) deliver(e);
    // `held` can grow while draining (a listener may trigger new events), so index, not iterate.
    for (let i = 0; i < held.length; i++) deliver(held[i]!);
    replaying = false;

    return {
      lastSeq,
      ...(snapshot ? { snapshot } : {}),
      unsubscribe: () => {
        active = false;
        entry.listeners.delete(wrapper);
        if (!entry.session && !entry.pending && entry.listeners.size === 0 && this.#entries.get(sessionId) === entry) {
          this.#entries.delete(sessionId);
        }
      },
    };
  }

  /** Stops every agent, including ones still starting; later createSession() calls are refused. */
  async closeAll(): Promise<void> {
    this.#shutdown.abort();
    await Promise.allSettled([...this.#starting]);
    const entries = [...this.#entries.values()];
    await Promise.allSettled(entries.map((entry) => entry.session?.close()));
    for (const entry of entries) {
      for (const watcher of entry.subagentWatchers.values()) watcher.stop();
      entry.subagentWatchers.clear();
      entry.pendingSubagents.clear();
      entry.listeners.clear();
    }
  }

  #entry(sessionId: string): Entry {
    let entry = this.#entries.get(sessionId);
    if (!entry) {
      entry = {
        session: null,
        pending: false,
        listeners: new Set(),
        busy: false,
        disconnected: false,
        turn: null,
        queue: [],
        draining: false,
        subagentWatchers: new Map(),
        pendingSubagents: new Map(),
      };
      this.#entries.set(sessionId, entry);
    }
    return entry;
  }

  /** The entry for an existing session; unknown ids never reach the store's foreign keys. */
  /** Renames a session; the new name replaces the one taken from its first message. */
  renameSession(sessionId: string, title: string): void {
    const clean = title.trim().replace(/\s+/gu, ' ').slice(0, 120);
    if (clean === '') throw new SomeCodeError('bad_request', 'title must not be empty');
    if (!this.#store.renameSession(sessionId, clean)) throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
  }

  /** Stops the session's agent and removes the session for good. */
  async deleteSession(sessionId: string): Promise<void> {
    if (!this.#store.getSession(sessionId)) throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
    const entry = this.#entries.get(sessionId);
    this.#entries.delete(sessionId);
    this.#approvals.delete(sessionId);
    this.#agentOptions.delete(sessionId);
    if (entry) {
      entry.listeners.clear();
      for (const watcher of entry.subagentWatchers.values()) watcher.stop();
      entry.subagentWatchers.clear();
      entry.pendingSubagents.clear();
      await entry.session?.close().catch(() => {});
    }
    this.#store.deleteSession(sessionId);
  }

  async deleteProject(projectId: string, sessionIds: string[]): Promise<void> {
    for (const id of sessionIds) await this.deleteSession(id);
    if (!this.#store.deleteProject(projectId)) throw new SomeCodeError('not_found', `unknown project: ${projectId}`);
  }

  #known(sessionId: string): Entry {
    if (!this.#store.getSession(sessionId)) {
      throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
    }
    return this.#entry(sessionId);
  }

  /** Journals the event, then broadcasts the stored form. Must never throw into the ACP layer. */
  #onEvent(sessionId: string, entry: Entry, event: NormalizedEvent): void {
    if (event.type === 'config_options') {
      // What the agent reports, minus its self-approving modes, plus the access level we enforce ourselves.
      this.#agentOptions.set(sessionId, event.options);
      event = {
        type: 'config_options',
        options: [...event.options.filter((o) => o.id !== 'approval').map(trimModeOption), approvalOption(this.#approval(sessionId))],
      };
    }
    if (event.type === 'status') {
      if (event.status === 'disconnected') entry.disconnected = true;
      if (event.status !== 'running') entry.busy = false;
    }
    this.#trackSubagents(sessionId, entry, event);
    let stored: StoredEvent;
    try {
      stored = this.#store.appendEvent(sessionId, event);
    } catch (err) {
      log(`cannot persist ${event.type} event for session ${sessionId}`, err);
      return;
    }
    // A listener may synchronously cause further events (prompt, respondPermission). Those are
    // queued and drained by the outermost loop so every listener sees events in seq order.
    entry.queue.push(stored);
    if (entry.draining) return;
    entry.draining = true;
    try {
      let next: StoredEvent | undefined;
      while ((next = entry.queue.shift())) {
        for (const listener of [...entry.listeners]) {
          try {
            listener(next);
          } catch (err) {
            log(`listener for session ${sessionId} threw`, err);
          }
        }
      }
    } finally {
      entry.draining = false;
    }
  }

  #trackSubagents(sessionId: string, entry: Entry, event: NormalizedEvent): void {
    if (event.type === 'tool_call') {
      const isSubagent =
        event.title.toLowerCase().includes('invoke_subagent') ||
        event.title.toLowerCase().includes('subagent') ||
        (typeof event.rawInput === 'object' && event.rawInput !== null && 'Role' in event.rawInput && 'Prompt' in event.rawInput);
      if (isSubagent && !entry.pendingSubagents.has(event.id)) {
        const input = typeof event.rawInput === 'object' && event.rawInput !== null ? (event.rawInput as Record<string, unknown>) : {};
        const role = typeof input['Role'] === 'string' ? input['Role'] : typeof input['role'] === 'string' ? input['role'] : 'Subagent';
        const prompt = typeof input['Prompt'] === 'string' ? input['Prompt'] : typeof input['prompt'] === 'string' ? input['prompt'] : undefined;
        entry.pendingSubagents.set(event.id, { role, prompt, startedAt: Date.now() });

        const row = this.#store.getSession(sessionId);
        const watcher = new AntigravitySubagentWatcher(
          {
            sessionId,
            parentToolCallId: event.id,
            role,
            prompt,
            acpSessionId: row?.acpSessionId ?? undefined,
            startedAt: Date.now(),
          },
          (childEvent) => this.#onEvent(sessionId, entry, childEvent),
          { signal: this.#shutdown.signal },
        );
        entry.subagentWatchers.set(event.id, watcher);
        watcher.start();
      }
    } else if (event.type === 'tool_call_update') {
      const pending = entry.pendingSubagents.get(event.id);
      const watcher = entry.subagentWatchers.get(event.id);
      if (pending && watcher && event.patch.rawOutput) {
        const outStr = typeof event.patch.rawOutput === 'string' ? event.patch.rawOutput : JSON.stringify(event.patch.rawOutput);
        const m = outStr.match(/"conversationId"\s*:\s*"([0-9a-f-]{36})"/i) || outStr.match(/conversation:\/\/([0-9a-f-]{36})/i);
        if (m?.[1]) {
          watcher.setConversationId(m[1]);
        }
      }
    } else if (event.type === 'agent_message') {
      const m = event.text.match(/conversation:\/\/([0-9a-f-]{36})/i);
      if (m?.[1]) {
        for (const watcher of entry.subagentWatchers.values()) {
          watcher.setConversationId(m[1]);
        }
      }
    } else if (event.type === 'status' && event.status === 'disconnected') {
      for (const watcher of entry.subagentWatchers.values()) {
        watcher.stop();
      }
      entry.subagentWatchers.clear();
      entry.pendingSubagents.clear();
    }
  }
}
