import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createConnection, type Connection, type ConnectionOptions, type ConnectionState } from '../lib/connection.ts';
import { bindSessionClient, type SessionClient } from '../lib/sessionClient.ts';
import type { SessionsStore } from '../lib/sessionsStore.ts';

export type UseConnectionOptions = {
  token: string;
  store: SessionsStore;
  /** The session remembered from before a reload: subscribed at once, quietly dropped if the server denies it. */
  restoredId: string | null;
  onError: (code: string) => void;
  onRestoreFailed: (sessionId: string) => void;
  /** Test seam: a fake socket instead of the browser WebSocket. */
  createSocket?: ConnectionOptions['createSocket'];
};

/**
 * Owns the WebSocket connection for the page's lifetime (created in an effect, closed on cleanup, so
 * StrictMode's double mount just opens a second one). The logic itself lives in `bindSessionClient`.
 * `activate` subscribes to a session from the store's own lastSeq.
 */
export function useConnection(opts: UseConnectionOptions): {
  conn: Connection | null;
  state: ConnectionState;
  activate: (sessionId: string) => void;
} {
  const { token, store } = opts;
  const [conn, setConn] = useState<Connection | null>(null);
  const [state, setState] = useState<ConnectionState>('connecting');
  const restoring = useRef(opts.restoredId);
  /** The session to (re)subscribe whenever the connection is (re)created. */
  const active = useRef(opts.restoredId);
  const client = useRef<SessionClient | null>(null);
  const latest = useRef(opts);
  useLayoutEffect(() => {
    latest.current = opts;
  });

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const c = createConnection({
      url: `${protocol}//${location.host}/ws`,
      token,
      ...(latest.current.createSocket ? { createSocket: latest.current.createSocket } : {}),
    });
    const offState = c.onState(setState);
    const bound = bindSessionClient(c, {
      store,
      restoring,
      active: active.current,
      onError: (code) => latest.current.onError(code),
      onRestoreFailed: (sessionId) => {
        if (active.current === sessionId) active.current = null;
        latest.current.onRestoreFailed(sessionId);
      },
    });
    client.current = bound;
    setConn(c);
    return () => {
      bound.dispose();
      offState();
      c.close();
      client.current = null;
      setConn(null);
    };
  }, [token, store]);

  const activate = useCallback((sessionId: string) => {
    active.current = sessionId;
    client.current?.activate(sessionId);
  }, []);

  return { conn, state, activate };
}
