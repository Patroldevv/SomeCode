import { clearActiveSession } from './activeSession.ts';
import type { Connection } from './connection.ts';
import type { SessionsStore } from './sessionsStore.ts';

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
};

export type SessionClient = {
  /** Subscribes to `sessionId` from the store's own lastSeq (0 after a reload), so switching back resumes. */
  activate(sessionId: string): void;
  dispose(): void;
};

/**
 * Wires a connection to the sessions store: events go to `store.apply`, and the restore-or-forget logic of
 * a reloaded page lives here. React-free, so it runs against the fake socket in node tests.
 */
export function bindSessionClient(conn: Connection, opts: SessionClientOptions): SessionClient {
  const { store, restoring } = opts;
  const subscribe = (sessionId: string): void => {
    // Never a guessed afterSeq: the server would drop live events up to it.
    conn.send({ type: 'subscribe', sessionId, afterSeq: store.get(sessionId).lastSeq });
  };

  const off = conn.onMessage((m) => {
    if (m.type === 'event') {
      store.apply(m.stored.sessionId, m.stored);
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
    dispose: off,
  };
}
