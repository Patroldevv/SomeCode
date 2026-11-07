import { resolve } from 'node:path';
import WebSocket from 'ws';
import type { ServerMessage, StoredEvent } from '@somecode/protocol';

export type SmokeOptions = {
  /** Base URL of a running SomeCode server, e.g. `http://127.0.0.1:4321`. */
  url: string;
  token: string;
  agentId: string;
  projectDir: string;
  prompt: string;
  /** Overall deadline for the whole run. Default 120 000 ms. */
  timeoutMs?: number;
  /** Called with every session event as it arrives (replay included). */
  onEvent?: (stored: StoredEvent) => void;
};

export type SmokeResult = {
  ok: boolean;
  /** Set when the turn ended. */
  stopReason?: string;
  /** Set when `ok` is false: why the run failed. Never contains the token. */
  reason?: string;
  events: StoredEvent[];
};

export const DEFAULT_TIMEOUT_MS = 120_000;

class SmokeFailure extends Error {}

async function api<T>(base: string, token: string, path: string, body: unknown, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(new URL(path, base), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new SmokeFailure('timed out');
    throw new SmokeFailure(`POST ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const e = json?.error;
    throw new SmokeFailure(
      `POST ${path} -> ${res.status}${e ? ` ${e.code}: ${e.message}` : ''}`,
    );
  }
  return json as T;
}

/**
 * Drives one scripted turn against a running server: creates a project and a session over REST,
 * subscribes over the WebSocket from seq 0, sends the prompt and resolves when the turn ends
 * (`ok: true`), the agent disconnects, the server reports an error, or the deadline passes.
 */
export async function runSmoke(opts: SmokeOptions): Promise<SmokeResult> {
  const events: StoredEvent[] = [];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  let ws: WebSocket | undefined;
  try {
    const projectDir = resolve(opts.projectDir);
    const project = await api<{ id: string }>(
      opts.url,
      opts.token,
      '/api/projects',
      { name: `smoke ${projectDir}`, path: projectDir },
      abort.signal,
    );
    const session = await api<{ id: string }>(
      opts.url,
      opts.token,
      '/api/sessions',
      { projectId: project.id, agentId: opts.agentId },
      abort.signal,
    );

    const wsUrl = new URL('/ws', opts.url);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl.searchParams.set('token', opts.token);
    const socket = (ws = new WebSocket(wsUrl));

    return await new Promise<SmokeResult>((resolveRun) => {
      let settled = false;
      const finish = (result: Omit<SmokeResult, 'events'>) => {
        if (settled) return;
        settled = true;
        resolveRun({ ...result, events });
      };
      const send = (msg: unknown) => socket.send(JSON.stringify(msg));

      abort.signal.addEventListener('abort', () => finish({ ok: false, reason: 'timed out' }), { once: true });
      socket.on('open', () => send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 }));
      // 'unexpected-response' carries the HTTP status of a refused upgrade; 'error' follows it.
      socket.on('unexpected-response', (_req, res) => {
        finish({ ok: false, reason: `websocket refused: HTTP ${res.statusCode}` });
        res.resume();
      });
      socket.on('error', (err) => finish({ ok: false, reason: `websocket error: ${err.message}` }));
      socket.on('close', () => finish({ ok: false, reason: 'connection closed before the turn ended' }));
      socket.on('message', (data) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(data.toString('utf8')) as ServerMessage;
        } catch {
          finish({ ok: false, reason: 'server sent invalid JSON' });
          return;
        }
        if (settled) return;
        if (msg.type === 'subscribed') {
          send({ type: 'prompt', sessionId: session.id, text: opts.prompt });
        } else if (msg.type === 'error') {
          finish({ ok: false, reason: `${msg.code}: ${msg.message}` });
        } else if (msg.type === 'event' && msg.stored.sessionId === session.id) {
          events.push(msg.stored);
          opts.onEvent?.(msg.stored);
          const e = msg.stored.event;
          if (e.type === 'turn_end') finish({ ok: true, stopReason: e.stopReason });
          else if (e.type === 'status' && e.status === 'disconnected') {
            finish({ ok: false, reason: e.reason ?? 'agent disconnected' });
          }
        }
      });
    });
  } catch (err) {
    if (err instanceof SmokeFailure) return { ok: false, reason: err.message, events };
    throw err;
  } finally {
    clearTimeout(timer);
    ws?.terminate();
  }
}
