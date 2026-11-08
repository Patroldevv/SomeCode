import { clearActiveSession } from './activeSession.ts';
import type { Connection } from './connection.ts';
import type { SessionsStore } from './sessionsStore.ts';
import { applyEvent, HISTORY_WINDOW_BYTES, type SessionHistoryPage, type StoredEvent } from '@somecode/protocol';

type OlderRequest = { promise: Promise<void>; events: StoredEvent[]; bytes: number; overflow: boolean; cancelled: boolean };

export type SessionClientOptions = {
  store: SessionsStore;
  /**
   * The session restored from the previous page load, until the server confirms it (`subscribed`) or denies
   * it. A box, so it survives the connection being recreated (StrictMode, token change).
   */
  restoring: { current: string | null };
  /** Subscribed at once (the connection sends it when the socket opens). */
  active: string | null;
  /** Banner-worthy error codes (server errors carry no sessionId). */
  onError: (code: string) => void;
  /** The restored session does not exist on this server; it has already been forgotten and cleared. */
  onRestoreFailed: (sessionId: string) => void;
  loadHistory?: (sessionId: string, beforeSeq?: number) => Promise<SessionHistoryPage>;
};

export type SessionClient = {
  /** Subscribes to `sessionId` from the store's own lastSeq (0 after a reload), so switching back resumes. */
  activate(sessionId: string): void;
  loadOlder(sessionId: string): Promise<void>;
  showRecent(sessionId: string): void;
  dispose(): void;
};

/**
 * Wires a connection to the sessions store: events go to `store.apply`, and the restore-or-forget logic of
 * a reloaded page lives here. React-free, so it runs against the fake socket in node tests.
 */
export function bindSessionClient(conn: Connection, opts: SessionClientOptions): SessionClient {
  const { store, restoring } = opts;
  let active = opts.active;
  let disposed = false;
  const olderRequests = new Map<string, OlderRequest>();
  const subscribe = (sessionId: string): void => {
    if (active !== null && active !== sessionId) conn.forget(active);
    active = sessionId;
    store.activate(sessionId);
    // Never a guessed afterSeq: the server would drop live events up to it.
    conn.send({ type: 'subscribe', sessionId, afterSeq: store.get(sessionId).lastSeq });
  };

  const off = conn.onMessage((m) => {
    if (m.type === 'event') {
      store.apply(m.stored.sessionId, m.stored);
      const request = olderRequests.get(m.stored.sessionId);
      if (request && !request.overflow && (m.stored.event.type === 'tool_call_update' || m.stored.event.type === 'permission_resolved')) {
        request.bytes += JSON.stringify(m.stored).length * 2;
        if (request.bytes > HISTORY_WINDOW_BYTES || request.events.length >= 200) {
          request.overflow = true;
          request.events = [];
        } else request.events.push(m.stored);
      }
    } else if (m.type === 'snapshot') {
      store.setSnapshot(m.sessionId,m.history);
      const request = olderRequests.get(m.sessionId);
      if (request) request.overflow = true;
    } else if (m.type === 'subscribed') {
      if (m.sessionId === restoring.current) restoring.current = null;
    } else if (m.type === 'error') {
      const stale = restoring.current;
      if (m.code === 'not_found' && stale !== null) {
        // The remembered session does not exist on this server: quietly start from an empty page.
        restoring.current = null;
        clearActiveSession();
        conn.forget(stale);
        opts.onRestoreFailed(stale);
        return;
      }
      opts.onError(m.code);
    }
  });

  if (opts.active !== null) subscribe(opts.active);

  return {
    activate(sessionId) {
      if (restoring.current !== sessionId) restoring.current = null;
      subscribe(sessionId);
    },
    loadOlder(sessionId) {
      const pending = olderRequests.get(sessionId);
      if (pending) return pending.promise;
      const beforeSeq = store.get(sessionId).olderBeforeSeq;
      if (!opts.loadHistory || beforeSeq === null || beforeSeq === undefined || disposed) return Promise.resolve();
      store.setHistoryLoading(sessionId,true);
      const initialSeq = store.get(sessionId).lastSeq;
      const record: OlderRequest = {promise:Promise.resolve(),events:[],bytes:0,overflow:false,cancelled:false};
      olderRequests.set(sessionId,record);
      const loadHistory = opts.loadHistory;
      const request = (async () => {
        for (;;) {
          record.events = []; record.bytes = 0; record.overflow = false;
          const history = await loadHistory(sessionId,beforeSeq);
          if (disposed || record.cancelled || (store.get(sessionId).lastSeq === 0 && initialSeq > 0)) return;
          // Re-query when a bounded patch buffer overflowed; never silently skip late updates.
          if (record.overflow) continue;
          let state = history.state;
          for (const stored of record.events) state = applyEvent(state,stored);
          store.setOlderHistory(sessionId,{...history,state});
          return;
        }
      })().finally(() => {
        if (olderRequests.get(sessionId) === record) {
          olderRequests.delete(sessionId);
          if (!disposed && store.get(sessionId).lastSeq > 0) store.setHistoryLoading(sessionId,false);
        }
      });
      record.promise = request;
      return request;
    },
    showRecent: (sessionId) => {
      const request = olderRequests.get(sessionId);
      if (request) request.cancelled = true;
      olderRequests.delete(sessionId);
      store.clearOlderHistory(sessionId);
    },
    dispose: () => {
      disposed = true;
      off();
      for (const [sessionId,request] of olderRequests) {
        request.cancelled = true;
        store.setHistoryLoading(sessionId,false);
      }
      olderRequests.clear();
    },
  };
}
