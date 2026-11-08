import { STATUS_CODES, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  clientMessageSchema,
  SomeCodeError,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
  type StoredEvent,
} from '@somecode/protocol';
import type { SessionManager } from '../sessions/manager.ts';
import { originAllowed, tokenMatches } from './auth.ts';
import { describeIssues, toWireError } from './errors.ts';

/** A client that lets this much pile up unread is disconnected instead of buffered further. */
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 1024 * 1024;
const CLOSE_TRY_AGAIN_LATER = 1013;

export type WsDeps = { manager: SessionManager; token: string; origin: () => string };

type Sink = {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export function sendJson(ws: Sink, msg: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
  if (ws.bufferedAmount > MAX_BUFFERED_BYTES) ws.close(CLOSE_TRY_AGAIN_LATER, 'client too slow');
}

/** Answers a refused upgrade with a plain HTTP error response, then drops the socket. */
function refuse(socket: Duplex, status: number, code: ErrorCode, message: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  const body = JSON.stringify({ error: { code, message } });
  socket.once('finish', () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8');
}

function parseMessage(data: RawData, isBinary: boolean): ClientMessage {
  if (isBinary) throw new SomeCodeError('bad_request', 'binary messages are not supported');
  let raw: unknown;
  try {
    raw = JSON.parse(rawText(data));
  } catch {
    throw new SomeCodeError('bad_request', 'message must be valid JSON');
  }
  const parsed = clientMessageSchema.safeParse(raw);
  if (!parsed.success) throw new SomeCodeError('bad_request', describeIssues(parsed.error));
  return parsed.data;
}

function handleConnection(ws: WebSocket, manager: SessionManager): void {
  const unsubscribers = new Map<string, () => void>();
  const send = (msg: ServerMessage): void => sendJson(ws, msg);
  const fail = (err: unknown): void => send({ type: 'error', ...toWireError(err) });

  /** `subscribed` goes out first, then the replay, then live events: in seq order, exactly once. */
  const subscribe = (sessionId: string, afterSeq: number): void => {
    // The manager delivers the replay synchronously, before we know lastSeq; hold it until then.
    let held: StoredEvent[] | null = [];
    const sub = manager.subscribe(sessionId, afterSeq, (stored) => {
      if (held) held.push(stored);
      else send({ type: 'event', stored });
    });
    // A re-subscribe replaces the earlier subscription (only once the new one succeeded).
    unsubscribers.get(sessionId)?.();
    unsubscribers.set(sessionId, sub.unsubscribe);
    if (sub.snapshot) send({ type: 'snapshot', sessionId, history: sub.snapshot });
    send({ type: 'subscribed', sessionId, lastSeq: sub.lastSeq });
    for (let i = 0; i < held.length; i++) send({ type: 'event', stored: held[i]! });
    held = null;
  };

  const dispatch = (msg: ClientMessage): Promise<void> | void => {
    switch (msg.type) {
      case 'subscribe':
        return subscribe(msg.sessionId, msg.afterSeq);
      case 'unsubscribe':
        unsubscribers.get(msg.sessionId)?.();
        unsubscribers.delete(msg.sessionId);
        return;
      case 'prompt':
        return manager.prompt(msg.sessionId, msg.text, msg.images);
      case 'cancel':
        return manager.cancel(msg.sessionId);
      case 'permission_response':
        return manager.respondPermission(msg.sessionId, msg.requestId, msg.optionId, msg.answer);
      case 'set_config':
        if (typeof msg.value !== 'string') {
          throw new SomeCodeError('bad_request', 'value: config values must be strings');
        }
        return manager.setConfig(msg.sessionId, msg.configId, msg.value);
    }
  };

  ws.on('message', (data, isBinary) => {
    try {
      const pending = dispatch(parseMessage(data, isBinary));
      if (pending) pending.catch(fail);
    } catch (err) {
      fail(err);
    }
  });
  ws.on('close', () => {
    for (const unsubscribe of unsubscribers.values()) unsubscribe();
    unsubscribers.clear();
  });
  // A socket error is always followed by 'close'; without a listener it would be thrown.
  ws.on('error', () => {});
}

/** Accepts authenticated upgrades on `/ws` and serves the session protocol over them. */
export function attachWebSocket(server: Server, deps: WsDeps): { close(): void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      refuse(socket, 400, 'bad_request', 'invalid request target');
      return;
    }
    if (url.pathname !== '/ws') {
      refuse(socket, 404, 'not_found', 'not found');
      return;
    }
    // Same order as REST: a foreign Origin is refused regardless of the token.
    if (!originAllowed(req.headers.origin, deps.origin())) {
      refuse(socket, 403, 'forbidden', 'origin not allowed');
      return;
    }
    if (!tokenMatches(deps.token, url.searchParams.get('token'))) {
      refuse(socket, 401, 'unauthorized', 'missing or invalid token');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, deps.manager));
  });

  return {
    close() {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
