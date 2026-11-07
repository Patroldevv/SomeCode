import { statSync } from 'node:fs';
import { SomeCodeError, type NormalizedEvent, type StoredEvent } from '@somecode/protocol';
import { AcpSession } from '../acp/session.ts';
import type { AgentRegistry } from '../agents/registry.ts';
import type { SessionRow, Store } from '../store/store.ts';

type Listener = (e: StoredEvent) => void;

type Entry = {
  /** Null until the agent has started, and for sessions with no live agent in this process. */
  session: AcpSession | null;
  listeners: Set<Listener>;
  busy: boolean;
  disconnected: boolean;
  /** Identifies the running turn so a finished turn cannot clear the flag of its successor. */
  turn: symbol | null;
  /** Stored events awaiting broadcast; `draining` is set while a broadcast loop is running. */
  queue: StoredEvent[];
  draining: boolean;
};

function log(message: string, err: unknown): void {
  process.stderr.write(`[somecode] ${message}: ${err instanceof Error ? err.message : String(err)}\n`);
}

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

  constructor(deps: { store: Store; registry: AgentRegistry }) {
    this.#store = deps.store;
    this.#registry = deps.registry;
  }

  async createSession(projectId: string, agentId: string): Promise<SessionRow> {
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

    // The row comes first so that every event the agent emits (even during startup) has a home.
    const row = this.#store.createSession({ projectId, agentId });
    const entry = this.#entry(row.id);
    try {
      entry.session = await AcpSession.start({
        driver,
        cwd: project.path,
        onEvent: (event) => this.#onEvent(row.id, entry, event),
      });
    } catch (err) {
      // A failure before the agent ever ran (e.g. spawn error) emits no status of its own.
      if (!entry.disconnected) {
        this.#onEvent(row.id, entry, {
          type: 'status',
          status: 'disconnected',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
    this.#store.setAcpSessionId(row.id, entry.session.acpSessionId);
    return this.#store.getSession(row.id)!;
  }

  /** Starts a turn and returns immediately; progress and the outcome arrive as events. */
  prompt(sessionId: string, text: string): void {
    const entry = this.#known(sessionId);
    const session = entry.session;
    if (!session || entry.disconnected) throw new SomeCodeError('disconnected', 'agent is not connected');
    if (entry.busy) throw new SomeCodeError('turn_in_progress', 'a prompt turn is already running');
    const turn = Symbol('turn');
    entry.turn = turn;
    entry.busy = true;
    // The turn is accepted: record the user's message first so it precedes status:running.
    this.#onEvent(sessionId, entry, { type: 'user_message', text });
    session
      .prompt(text)
      .catch((err: unknown) => log(`prompt failed for session ${sessionId}`, err))
      .finally(() => {
        if (entry.turn === turn) entry.busy = false;
      });
  }

  async cancel(sessionId: string): Promise<void> {
    await this.#known(sessionId).session?.cancel();
  }

  respondPermission(sessionId: string, requestId: string, optionId: string | null): void {
    const entry = this.#known(sessionId);
    const session = entry.session;
    if (!session || entry.disconnected) throw new SomeCodeError('disconnected', 'agent is not connected');
    if (!session.respondPermission(requestId, optionId)) {
      throw new SomeCodeError('not_found', `no pending permission request: ${requestId}`);
    }
  }

  async setConfig(sessionId: string, configId: string, value: string): Promise<void> {
    const session = this.#known(sessionId).session;
    if (!session) throw new SomeCodeError('disconnected', 'agent is not connected');
    await session.setConfig(configId, value);
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
  ): { lastSeq: number; unsubscribe(): void } {
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

    const history = this.#store.eventsSince(sessionId, afterSeq);
    const lastSeq = this.#store.lastSeq(sessionId);
    for (const e of history) deliver(e);
    // `held` can grow while draining (a listener may trigger new events), so index, not iterate.
    for (let i = 0; i < held.length; i++) deliver(held[i]!);
    replaying = false;

    return {
      lastSeq,
      unsubscribe: () => {
        active = false;
        entry.listeners.delete(wrapper);
      },
    };
  }

  async closeAll(): Promise<void> {
    const entries = [...this.#entries.values()];
    await Promise.allSettled(entries.map((entry) => entry.session?.close()));
    for (const entry of entries) entry.listeners.clear();
  }

  #entry(sessionId: string): Entry {
    let entry = this.#entries.get(sessionId);
    if (!entry) {
      entry = {
        session: null,
        listeners: new Set(),
        busy: false,
        disconnected: false,
        turn: null,
        queue: [],
        draining: false,
      };
      this.#entries.set(sessionId, entry);
    }
    return entry;
  }

  /** The entry for an existing session; unknown ids never reach the store's foreign keys. */
  #known(sessionId: string): Entry {
    if (!this.#store.getSession(sessionId)) {
      throw new SomeCodeError('not_found', `unknown session: ${sessionId}`);
    }
    return this.#entry(sessionId);
  }

  /** Journals the event, then broadcasts the stored form. Must never throw into the ACP layer. */
  #onEvent(sessionId: string, entry: Entry, event: NormalizedEvent): void {
    if (event.type === 'status') {
      if (event.status === 'disconnected') entry.disconnected = true;
      if (event.status !== 'running') entry.busy = false;
    }
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
}
