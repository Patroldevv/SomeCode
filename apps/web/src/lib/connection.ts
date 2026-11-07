import type { ClientMessage, ServerMessage } from '@somecode/protocol';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

/** The slice of the browser WebSocket this client needs (so tests can inject a fake). */
export type SocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type ConnectionOptions = {
  /** Full ws:// or wss:// URL of the endpoint, without the token. */
  url: string;
  token: string;
  createSocket?: (url: string) => SocketLike;
};

export type Connection = {
  /** False when the message could not be sent right now (socket not open). Subscribes are remembered. */
  send(message: ClientMessage): boolean;
  /** Stops re-subscribing to a session on reconnect (e.g. the server said it does not exist). */
  forget(sessionId: string): void;
  onMessage(cb: (message: ServerMessage) => void): () => void;
  onState(cb: (state: ConnectionState) => void): () => void;
  close(): void;
};

const OPEN = 1;
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 10_000;

export const backoffDelay = (attempt: number): number => Math.min(BACKOFF_MIN_MS * 2 ** attempt, BACKOFF_MAX_MS);

export function createConnection(opts: ConnectionOptions): Connection {
  const target = `${opts.url}?token=${encodeURIComponent(opts.token)}`;
  const createSocket = opts.createSocket ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
  const messageListeners = new Set<(m: ServerMessage) => void>();
  const stateListeners = new Set<(s: ConnectionState) => void>();
  /** Active subscriptions with the last seq seen for each; re-sent after every reconnect. */
  const subscriptions = new Map<string, number>();

  let socket: SocketLike | null = null;
  let state: ConnectionState = 'connecting';
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const setState = (next: ConnectionState): void => {
    if (state === next) return;
    state = next;
    for (const cb of [...stateListeners]) cb(next);
  };

  const transmit = (message: ClientMessage): boolean => {
    if (!socket || socket.readyState !== OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  const connect = (): void => {
    timer = null;
    const ws = createSocket(target);
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      setState('open');
      // Always resume from our own last seq, never a guessed one.
      for (const [sessionId, afterSeq] of subscriptions) transmit({ type: 'subscribe', sessionId, afterSeq });
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let message: ServerMessage;
      try {
        message = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === 'event') {
        const { sessionId, seq } = message.stored;
        const known = subscriptions.get(sessionId);
        if (known !== undefined && seq > known) subscriptions.set(sessionId, seq);
      }
      for (const cb of [...messageListeners]) cb(message);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      if (closed) return;
      setState('reconnecting');
      timer = setTimeout(connect, backoffDelay(attempt));
      attempt += 1;
    };
  };

  connect();

  return {
    send(message) {
      if (message.type === 'subscribe') subscriptions.set(message.sessionId, message.afterSeq);
      return transmit(message);
    },
    forget(sessionId) {
      subscriptions.delete(sessionId);
    },
    onMessage(cb) {
      messageListeners.add(cb);
      return () => messageListeners.delete(cb);
    },
    onState(cb) {
      stateListeners.add(cb);
      cb(state);
      return () => stateListeners.delete(cb);
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const ws = socket;
      socket = null;
      ws?.close();
      setState('closed');
    },
  };
}
