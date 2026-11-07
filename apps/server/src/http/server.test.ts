import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { ServerMessage, StoredEvent } from '@somecode/protocol';
import { createRegistry } from '../agents/registry.ts';
import type { AgentDriver } from '../agents/types.ts';
import { openStore, type Store } from '../store/store.ts';
import { fakeDriver } from '../../test-support/fake-driver.ts';
import { startServer } from '../server.ts';
import { sendJson, MAX_BUFFERED_BYTES } from './ws.ts';

const TOKEN = 'test-token-0123456789abcdef';

let store: Store;
let dir: string;
let server: { port: number; url: string; close(): Promise<void> } | undefined;
const clients: WebSocket[] = [];

beforeEach(() => {
  store = openStore(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'somecode-http-'));
});

afterEach(async () => {
  for (const ws of clients.splice(0)) ws.terminate();
  await server?.close();
  server = undefined;
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function start(drivers: AgentDriver[] = [fakeDriver('basic')], staticDir?: string) {
  server = await startServer({ store, registry: createRegistry(drivers), token: TOKEN, port: 0, staticDir });
  return server;
}

type ApiResult = { status: number; body: any; headers: Record<string, string | string[] | undefined> };

/** Raw HTTP request (the path is sent verbatim and any header, including Origin, can be set). */
function raw(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<ApiResult & { text: string }>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port: server!.port, path, method: opts.method ?? 'GET', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            body = undefined;
          }
          resolve({ status: res.statusCode!, body, text, headers: res.headers });
        });
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

function api(path: string, opts: { method?: string; body?: unknown; token?: string | null; origin?: string } = {}) {
  const headers: Record<string, string> = {};
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (opts.origin) headers.origin = opts.origin;
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  return raw(path, { method: opts.method, headers, body });
}

class Client {
  readonly ws: WebSocket;
  readonly #queue: ServerMessage[] = [];
  #wake: (() => void) | null = null;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      this.#queue.push(JSON.parse(String(data)) as ServerMessage);
      this.#wake?.();
    });
    ws.on('close', () => this.#wake?.());
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  async next(timeoutMs = 5000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    while (this.#queue.length === 0) {
      if (this.ws.readyState !== WebSocket.OPEN) throw new Error('socket closed while waiting');
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for a message');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.#wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.#wake = null;
    }
    return this.#queue.shift()!;
  }

  /** Reads messages until one matches, returning everything read (including the match). */
  async until(pred: (m: ServerMessage) => boolean): Promise<ServerMessage[]> {
    const out: ServerMessage[] = [];
    for (;;) {
      const m = await this.next();
      out.push(m);
      if (pred(m)) return out;
    }
  }
}

function connect(query = `token=${TOKEN}`, origin?: string): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${server!.port}/ws?${query}`, origin ? { origin } : {});
  clients.push(ws);
  const client = new Client(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`unexpected response ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

/** Resolves with the HTTP status the server answered a refused upgrade with. */
function refusedUpgrade(query: string, origin?: string): Promise<number> {
  const ws = new WebSocket(`ws://127.0.0.1:${server!.port}/ws?${query}`, origin ? { origin } : {});
  clients.push(ws);
  return new Promise((resolve, reject) => {
    ws.once('open', () => reject(new Error('upgrade unexpectedly accepted')));
    ws.once('unexpected-response', (_req, res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    ws.once('error', () => {});
  });
}

const events = (msgs: ServerMessage[]): StoredEvent[] =>
  msgs.flatMap((m) => (m.type === 'event' ? [m.stored] : []));
const isEvent = (type: string) => (m: ServerMessage) => m.type === 'event' && m.stored.event.type === type;

/** Subscribes and reads `subscribed` plus the whole replay, checking order and completeness. */
async function subscribeAll(client: Client, sessionId: string, afterSeq = 0): Promise<StoredEvent[]> {
  client.send({ type: 'subscribe', sessionId, afterSeq });
  const lastSeq = store.lastSeq(sessionId);
  expect(await client.next()).toEqual({ type: 'subscribed', sessionId, lastSeq });
  const replay: StoredEvent[] = [];
  while (replay.length < lastSeq - afterSeq) replay.push(...events([await client.next()]));
  expect(replay.map((e) => e.seq)).toEqual(replay.map((_, i) => afterSeq + 1 + i));
  expect(replay.every((e) => e.sessionId === sessionId)).toBe(true);
  return replay;
}

async function createSession(): Promise<string> {
  const project = await api('/api/projects', { method: 'POST', body: { name: 'p', path: dir } });
  expect(project.status).toBe(201);
  const session = await api('/api/sessions', {
    method: 'POST',
    body: { projectId: project.body.id, agentId: 'fake' },
  });
  expect(session.status).toBe(201);
  return session.body.id as string;
}

describe('authentication and origin (a)', () => {
  it('rejects REST calls without or with a wrong token with 401', async () => {
    await start();
    for (const token of [null, '', 'wrong', `${TOKEN.slice(0, -1)}x`, `${TOKEN}x`]) {
      const res = await api('/api/projects', { token });
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'unauthorized', message: expect.any(String) } });
    }
    expect((await raw('/api/projects', { headers: { authorization: TOKEN } })).status).toBe(401);
    expect((await raw('/api/projects', { headers: { authorization: `Basic ${TOKEN}` } })).status).toBe(401);
    // Unknown API routes do not reveal themselves before authentication.
    expect((await api('/api/nope', { token: null })).status).toBe(401);
    // Percent-encoding or dot segments do not route around the check.
    expect((await api('/%61pi/projects', { token: null })).status).toBe(401);
    expect((await api('/x/../api/projects', { token: null })).status).toBe(401);
    expect((await api('/api', { token: null })).status).toBe(401);
  });

  it('accepts a correct token with no Origin or the exact server origin', async () => {
    const { port } = await start();
    expect((await api('/api/projects')).status).toBe(200);
    const same = await api('/api/projects', { origin: `http://127.0.0.1:${port}` });
    expect(same.status).toBe(200);
    expect(same.body).toEqual([]);
    expect((await api('/api/nope')).status).toBe(404);
  });

  it('rejects a foreign Origin with 403, regardless of the token', async () => {
    const { port } = await start();
    for (const origin of ['http://evil.example', `http://localhost:${port}`, `http://127.0.0.1:${port + 1}`, 'null']) {
      for (const token of [TOKEN, null]) {
        const res = await api('/api/projects', { origin, token });
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('forbidden');
      }
    }
  });

  it('refuses WebSocket upgrades with a missing or wrong token (401) or a foreign Origin (403)', async () => {
    const { port } = await start();
    expect(await refusedUpgrade('')).toBe(401);
    expect(await refusedUpgrade('token=wrong')).toBe(401);
    expect(await refusedUpgrade(`token=${TOKEN}x`)).toBe(401);
    expect(await refusedUpgrade(`token=${TOKEN}`, 'http://evil.example')).toBe(403);
    expect(await refusedUpgrade('token=wrong', 'http://evil.example')).toBe(403);
    const ok = await connect(`token=${TOKEN}`, `http://127.0.0.1:${port}`);
    expect(ok.ws.readyState).toBe(WebSocket.OPEN);
    expect((await connect()).ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('REST (b)', () => {
  function spyDriver(): { driver: AgentDriver; launch: ReturnType<typeof vi.fn> } {
    const base = fakeDriver('basic');
    const launch = vi.fn(base.launch);
    return { driver: { ...base, launch }, launch };
  }

  it('rejects missing, file and relative project paths with 400 without creating anything', async () => {
    const { driver, launch } = spyDriver();
    await start([driver]);
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'x');
    for (const path of [join(dir, 'missing'), file, 'relative/dir', '', `${dir}\0`]) {
      const res = await api('/api/projects', { method: 'POST', body: { name: 'p', path } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
    for (const body of ['{not json', { name: 'p' }, { path: dir }, { name: '', path: dir }, [1]]) {
      const res = await api('/api/projects', { method: 'POST', body });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
    expect((await api('/api/projects')).body).toEqual([]);
    expect(launch).not.toHaveBeenCalled();
  });

  it('creates a project for an existing directory with its resolved path', async () => {
    await start();
    mkdirSync(join(dir, 'sub'));
    const res = await api('/api/projects', { method: 'POST', body: { name: 'p', path: `${dir}/sub/../sub/` } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'p', path: join(dir, 'sub') });
    expect((await api('/api/projects')).body).toEqual([res.body]);
    expect((await api(`/api/projects/${res.body.id}/sessions`)).body).toEqual([]);
  });

  it('maps session and listing errors to their HTTP status', async () => {
    await start([fakeDriver('basic'), { ...fakeDriver('basic', 'absent'), detect: async () => ({ installed: false }) }]);
    const project = (await api('/api/projects', { method: 'POST', body: { name: 'p', path: dir } })).body;
    const post = (body: unknown) => api('/api/sessions', { method: 'POST', body });
    expect((await post({ projectId: 'nope', agentId: 'fake' })).status).toBe(404);
    expect((await post({ projectId: project.id, agentId: 'nope' })).status).toBe(404);
    const absent = await post({ projectId: project.id, agentId: 'absent' });
    expect(absent.status).toBe(422);
    expect(absent.body.error.code).toBe('agent_not_installed');
    expect((await post({ projectId: project.id })).status).toBe(400);
    expect((await api('/api/projects/nope/sessions')).status).toBe(404);
    expect((await api('/api/sessions/nope/events')).status).toBe(404);
  });

  it('validates afterSeq on the events listing', async () => {
    await start();
    const sessionId = await createSession();
    for (const bad of ['-1', '1.5', 'abc', '', '1e3', '0x1', '99999999999999999999']) {
      const res = await api(`/api/sessions/${sessionId}/events?afterSeq=${bad}`);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
    }
    const all = (await api(`/api/sessions/${sessionId}/events`)).body as StoredEvent[];
    const last = store.lastSeq(sessionId);
    expect(all).toEqual(store.eventsSince(sessionId, 0));
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
    expect(all.map((e) => e.event)).toContainEqual({ type: 'status', status: 'ready' });
    expect((await api(`/api/sessions/${sessionId}/events?afterSeq=1`)).body).toEqual(all.slice(1));
    expect((await api(`/api/sessions/${sessionId}/events?afterSeq=${last}`)).body).toEqual([]);
  });

  it('lists agents, reporting a driver whose detect() rejects as not installed', async () => {
    await start([
      fakeDriver('basic'),
      { ...fakeDriver('basic', 'broken'), detect: () => Promise.reject(new Error('boom')) },
    ]);
    const res = await api('/api/agents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'fake', label: 'Fake agent', installed: true, version: '0' },
      { id: 'broken', label: 'Fake agent', installed: false },
    ]);
  });
});

describe('WebSocket sessions', () => {
  it('(c) subscribes, then streams a prompt turn in seq order up to turn_end', async () => {
    await start();
    const sessionId = await createSession();
    const client = await connect();
    const replay = await subscribeAll(client, sessionId);
    expect(replay.map((e) => e.event)).toContainEqual({ type: 'status', status: 'ready' });
    client.send({ type: 'prompt', sessionId, text: 'hello' });
    const turn = events(await client.until(isEvent('turn_end')));
    expect(turn.map((e) => e.seq)).toEqual(turn.map((_, i) => replay.length + 1 + i));
    expect(turn.map((e) => e.event.type)).toContain('agent_message');
    expect(turn.at(-1)!.event).toEqual({ type: 'turn_end', stopReason: 'end_turn' });
  });

  it('(d) answers a permission request over the socket and the turn completes', async () => {
    await start([fakeDriver('permission')]);
    const sessionId = await createSession();
    const client = await connect();
    client.send({ type: 'subscribe', sessionId, afterSeq: 0 });
    client.send({ type: 'prompt', sessionId, text: 'edit it' });
    const before = events(await client.until(isEvent('permission_request')));
    const request = before.at(-1)!.event;
    if (request.type !== 'permission_request') throw new Error('unreachable');
    client.send({ type: 'permission_response', sessionId, requestId: request.requestId, optionId: 'allow' });
    const after = events(await client.until(isEvent('turn_end')));
    expect(after.map((e) => e.event.type)).toContain('permission_resolved');
    expect(after.at(-1)!.event).toEqual({ type: 'turn_end', stopReason: 'end_turn' });
  });

  it('(e) replays only the missing events on reconnect and validates afterSeq', async () => {
    await start();
    const sessionId = await createSession();
    const first = await connect();
    first.send({ type: 'subscribe', sessionId, afterSeq: 0 });
    first.send({ type: 'prompt', sessionId, text: 'one' });
    await first.until(isEvent('turn_end'));
    // The turn is over (and a new prompt accepted) once the agent reports ready again.
    const lastSeen = events(await first.until(isEvent('status'))).at(-1)!.seq;
    first.ws.close();

    const other = await connect();
    other.send({ type: 'prompt', sessionId, text: 'two' });
    await vi.waitFor(async () => {
      const all = (await api(`/api/sessions/${sessionId}/events`)).body as StoredEvent[];
      const ends = all.filter((e) => e.event.type === 'turn_end').length;
      const last = all.at(-1)!.event;
      if (ends < 2 || last.type !== 'status' || last.status !== 'ready') throw new Error('turn not done');
    });
    const lastSeq = store.lastSeq(sessionId);

    const again = await connect();
    const replay = await subscribeAll(again, sessionId, lastSeen);
    expect(replay.map((e) => e.event.type)).toContain('turn_end');
    expect(replay).toEqual(store.eventsSince(sessionId, lastSeen));

    const beyond = await connect();
    beyond.send({ type: 'subscribe', sessionId, afterSeq: 999999 });
    expect(await beyond.next()).toEqual({ type: 'subscribed', sessionId, lastSeq });
    for (const afterSeq of [-1, 1.5, '3', null]) {
      beyond.send({ type: 'subscribe', sessionId, afterSeq });
      expect(await beyond.next()).toMatchObject({ type: 'error', code: 'bad_request' });
    }
    expect(beyond.ws.readyState).toBe(WebSocket.OPEN);
    beyond.send({ type: 'subscribe', sessionId, afterSeq: lastSeq });
    expect(await beyond.next()).toEqual({ type: 'subscribed', sessionId, lastSeq });
  });

  it('(f) answers invalid JSON, schema-invalid and unknown-session messages with errors and stays open', async () => {
    await start();
    const client = await connect();
    for (const msg of ['{oops', '42', JSON.stringify({ type: 'nope' }), JSON.stringify({ type: 'prompt', sessionId: 's' })]) {
      client.send(msg);
      expect(await client.next()).toMatchObject({ type: 'error', code: 'bad_request' });
    }
    client.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    expect(await client.next()).toMatchObject({ type: 'error', code: 'bad_request' });
    client.send({ type: 'prompt', sessionId: 'nope', text: 'x' });
    expect(await client.next()).toMatchObject({ type: 'error', code: 'not_found' });
    client.send({ type: 'subscribe', sessionId: 'nope', afterSeq: 0 });
    expect(await client.next()).toMatchObject({ type: 'error', code: 'not_found' });
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('(g) rejects a second prompt while a turn runs with turn_in_progress', async () => {
    await start([fakeDriver('slow')]);
    const sessionId = await createSession();
    const client = await connect();
    client.send({ type: 'subscribe', sessionId, afterSeq: 0 });
    client.send({ type: 'prompt', sessionId, text: 'one' });
    await client.until(isEvent('agent_thought'));
    client.send({ type: 'prompt', sessionId, text: 'two' });
    expect(await client.next()).toMatchObject({ type: 'error', code: 'turn_in_progress' });
    client.send({ type: 'cancel', sessionId });
    const rest = events(await client.until(isEvent('turn_end')));
    expect(rest.at(-1)!.event).toEqual({ type: 'turn_end', stopReason: 'cancelled' });
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('subscribes one connection to several sessions', async () => {
    await start();
    const a = await createSession();
    const b = await createSession();
    const client = await connect();
    await subscribeAll(client, a);
    await subscribeAll(client, b);
    client.send({ type: 'prompt', sessionId: b, text: 'hi' });
    const turn = events(await client.until(isEvent('turn_end')));
    expect(turn.every((e) => e.sessionId === b)).toBe(true);
  });
});

describe('backpressure', () => {
  it('closes the socket with 1013 once the send buffer is over the limit', () => {
    const sent: string[] = [];
    const closed: number[] = [];
    const stub = {
      readyState: WebSocket.OPEN as number,
      bufferedAmount: 0,
      send: (s: string) => sent.push(s),
      close: (code: number) => closed.push(code),
    };
    sendJson(stub, { type: 'error', code: 'bad_request', message: 'x' });
    expect(sent).toHaveLength(1);
    expect(closed).toEqual([]);
    stub.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    sendJson(stub, { type: 'error', code: 'bad_request', message: 'y' });
    expect(closed).toEqual([1013]);
    stub.readyState = WebSocket.CLOSING;
    sendJson(stub, { type: 'error', code: 'bad_request', message: 'z' });
    expect(sent).toHaveLength(2);
  });
});

describe('static files', () => {
  let web: string;
  beforeEach(() => {
    web = join(dir, 'web');
    mkdirSync(join(web, 'assets'), { recursive: true });
    writeFileSync(join(web, 'index.html'), '<!doctype html><title>SomeCode</title>');
    writeFileSync(join(web, 'assets', 'app.js'), 'console.log(1)');
    writeFileSync(join(dir, 'secret.txt'), 'TOP-SECRET');
  });

  it('serves files and the SPA fallback without a token, but never /api', async () => {
    await start([fakeDriver('basic')], web);
    const index = await raw('/');
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toMatch(/^text\/html/);
    expect(index.text).toContain('SomeCode');
    const js = await raw('/assets/app.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/^text\/javascript/);
    expect(js.text).toBe('console.log(1)');
    expect((await raw('/sessions/123')).text).toContain('SomeCode');
    expect((await raw('/api/projects')).status).toBe(401);
    expect((await raw('/', { headers: { origin: 'http://evil.example' } })).status).toBe(403);
  });

  it('does not escape the static directory', async () => {
    await start([fakeDriver('basic')], web);
    for (const path of [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/..%2fsecret.txt',
      '/%2e%2e%2fsecret.txt',
      '/..%252fsecret.txt',
      '/assets/..%5c..%5csecret.txt',
      '/%00',
      '/%zz',
    ]) {
      const res = await raw(path);
      expect(res.text, path).not.toContain('TOP-SECRET');
    }
  });
});

describe('close()', () => {
  it('lets the process exit with a live agent and a connected client', async () => {
    const serverModule = fileURLToPath(new URL('../server.ts', import.meta.url));
    const storeModule = fileURLToPath(new URL('../store/store.ts', import.meta.url));
    const registryModule = fileURLToPath(new URL('../agents/registry.ts', import.meta.url));
    const driverModule = fileURLToPath(new URL('../../test-support/fake-driver.ts', import.meta.url));
    const script = `
      import WebSocket from 'ws';
      import { startServer } from ${JSON.stringify(serverModule)};
      import { openStore } from ${JSON.stringify(storeModule)};
      import { createRegistry } from ${JSON.stringify(registryModule)};
      import { fakeDriver } from ${JSON.stringify(driverModule)};
      const store = openStore(':memory:');
      const srv = await startServer({ store, registry: createRegistry([fakeDriver('slow')]), token: 't0ken' });
      const h = { authorization: 'Bearer t0ken', 'content-type': 'application/json' };
      const project = await (await fetch(srv.url + '/api/projects', { method: 'POST', headers: h, body: JSON.stringify({ name: 'p', path: ${JSON.stringify(dir)} }) })).json();
      const session = await (await fetch(srv.url + '/api/sessions', { method: 'POST', headers: h, body: JSON.stringify({ projectId: project.id, agentId: 'fake' }) })).json();
      const ws = new WebSocket(srv.url.replace('http', 'ws') + '/ws?token=t0ken');
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'subscribe', sessionId: session.id, afterSeq: 0 }));
      ws.send(JSON.stringify({ type: 'prompt', sessionId: session.id, text: 'x' }));
      await new Promise((r) => setTimeout(r, 200));
      const closed = new Promise((r) => ws.once('close', r));
      await srv.close();
      await closed;
      store.close();
      process.stdout.write('closed\\n');
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += String(d)));
    child.stderr.on('data', (d: Buffer) => (err += String(d)));
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 10_000);
      child.on('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    // Killing the agent mid-turn makes the manager log the aborted prompt; nothing else may appear.
    expect({ code, out }).toEqual({ code: 0, out: 'closed\n' });
    expect(err).toMatch(/^(\[somecode\] prompt failed for session [^\n]*: agent disconnected\n)?$/);
  }, 15_000);
});
