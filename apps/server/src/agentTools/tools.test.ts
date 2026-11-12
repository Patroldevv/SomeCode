import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { createRegistry } from '../agents/registry.ts';
import { startServer } from '../server.ts';
import { openStore, type Store } from '../store/store.ts';
import { fakeDriver } from '../../test-support/fake-driver.ts';
import { readVerify } from '../verify/config.ts';

const MCP = fileURLToPath(new URL('../../../../bin/somecode-mcp.ts', import.meta.url));
const TOKEN = 'tools-test-token-0123456789';

let store: Store;
let dir: string;
let server: Awaited<ReturnType<typeof startServer>>;

beforeEach(async () => {
  store = openStore(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'somecode-tools-'));
  server = await startServer({ store, registry: createRegistry([fakeDriver('basic')]), token: TOKEN, port: 0 });
});
afterEach(async () => {
  await server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Talks to the MCP server over stdio like an agent would: initialize, then one call per request. */
async function mcp(calls: { name: string; arguments?: Record<string, unknown> }[], sessionId: string): Promise<{ text: string; isError: boolean }[]> {
  const child = spawn(process.execPath, [MCP], {
    cwd: dir,
    env: { ...process.env, SOMECODE_URL: server.url, SOMECODE_TOKEN: TOKEN, SOMECODE_TOOLS: '1', SOMECODE_SESSION_ID: sessionId, SOMECODE_BROWSER: 'off' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const answers = new Map<number, any>();
  let buffer = '';
  child.stdout.on('data', (d) => {
    buffer += String(d);
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) {
        const m = JSON.parse(line);
        if (m.id !== undefined) answers.set(m.id, m);
      }
    }
  });
  const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const waitFor = async (id: number) => {
    for (let i = 0; i < 300 && !answers.has(id); i++) await new Promise((r) => setTimeout(r, 20));
    if (!answers.has(id)) throw new Error(`no answer to ${id}`);
    return answers.get(id);
  };
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    await waitFor(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const out: { text: string; isError: boolean }[] = [];
    for (const [i, call] of calls.entries()) {
      send({ jsonrpc: '2.0', id: 10 + i, method: 'tools/call', params: call });
      const res = await waitFor(10 + i);
      out.push({ text: res.result?.content?.[0]?.text ?? JSON.stringify(res.error), isError: res.result?.isError === true });
    }
    return out;
  } finally {
    child.kill();
  }
}

describe('SomeCode MCP: history, memory and scheduling tools', () => {
  it('lets an agent keep project notes, search past chats, read one back and schedule and cancel a task', async () => {
    const project = store.addProject({ name: 'shop', path: dir });
    const past = store.createSession({ projectId: project.id, agentId: 'fake' });
    store.appendEvent(past.id, { type: 'user_message', text: 'Why do webhook retries use exponential backoff?' });
    store.appendEvent(past.id, { type: 'agent_message', text: 'Because the payment provider rate-limits bursts.' });
    const here = store.createSession({ projectId: project.id, agentId: 'fake' });

    const results = await mcp(
      [
        { name: 'memory_add', arguments: { note: 'Use pnpm, not npm' } },
        { name: 'memory_add', arguments: { note: 'use PNPM, not npm' } },
        { name: 'memory_list' },
        { name: 'history_search', arguments: { query: 'webhook backoff' } },
        { name: 'history_read', arguments: { sessionId: past.id } },
        { name: 'schedule_create', arguments: { title: 'Nightly tests', prompt: 'Run the test suite and report failures', daily_at: '03:00' } },
        { name: 'schedule_create', arguments: { title: 'Bad', prompt: 'Run it please', every_minutes: 5, daily_at: '03:00' } },
        { name: 'schedule_list' },
      ],
      here.id,
    );
    expect(results[0]).toMatchObject({ isError: false, text: expect.stringMatching(/^Saved/) });
    expect(results[1]!.text).toBe('That note already exists.');
    expect(results[2]!.text).toMatch(/\[[0-9a-f-]+\] Use pnpm, not npm/);
    expect(results[3]!.text).toContain(`chat ${past.id}`);
    expect(results[3]!.text).toContain('exponential backoff');
    expect(results[4]!.text).toBe('User: Why do webhook retries use exponential backoff?\nAgent: Because the payment provider rate-limits bursts.');
    expect(results[5]!.text).toMatch(/Scheduled "Nightly tests" \(every day at 03:00\)/);
    expect(results[6]).toMatchObject({ isError: true, text: expect.stringContaining('exactly one') });
    expect(results[7]!.text).toContain('Nightly tests (shop) · every day at 03:00');

    const task = store.listTasks()[0]!;
    expect(task).toMatchObject({ projectId: project.id, agentId: 'fake', spec: { kind: 'daily', at: '03:00' } });
    const [cancel, empty, forgotten] = await mcp(
      [{ name: 'schedule_cancel', arguments: { id: task.id } }, { name: 'schedule_list' }, { name: 'memory_forget', arguments: { id: store.listMemories(project.id)[0]!.id } }],
      here.id,
    );
    expect(cancel!.text).toBe('Cancelled.');
    expect(empty!.text).toBe('Nothing scheduled.');
    expect(forgotten!.text).toBe('Removed.');
    expect(store.listMemories(project.id)).toEqual([]);
  }, 60_000);

  it('says what is wrong when the chat belongs to no project', async () => {
    const [res] = await mcp([{ name: 'memory_list' }], 'not-a-session');
    expect(res).toMatchObject({ isError: true, text: expect.stringContaining('no project') });
  }, 30_000);
});

describe('SomeCode MCP: project checks', () => {
  async function liveSession(): Promise<{ projectId: string; sessionId: string }> {
    const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
    const project = (await (await fetch(`${server.url}/api/projects`, { method: 'POST', headers, body: JSON.stringify({ name: 'shop', path: dir }) })).json()) as { id: string };
    const session = (await (await fetch(`${server.url}/api/sessions`, { method: 'POST', headers, body: JSON.stringify({ projectId: project.id, agentId: 'fake' }) })).json()) as { id: string };
    return { projectId: project.id, sessionId: session.id };
  }

  /** The user: waits for the approval card of the chat and answers it over the socket, like the page does. */
  async function answerWhenAsked(sessionId: string, optionId: string): Promise<void> {
    await vi.waitFor(() => {
      if (!store.eventsSince(sessionId, 0).some((e) => e.event.type === 'permission_request')) throw new Error('not asked yet');
    }, { timeout: 15_000 });
    const asked = store.eventsSince(sessionId, 0).find((e) => e.event.type === 'permission_request')!.event;
    if (asked.type !== 'permission_request') throw new Error('unreachable');
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?token=${TOKEN}`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.send(JSON.stringify({ type: 'permission_response', sessionId, requestId: asked.requestId, optionId }));
    await new Promise((r) => setTimeout(r, 200));
    ws.close();
  }

  it('shows an agent the checks and what the folder suggests, and saves a proposal only after the user approved it in the chat', async () => {
    const { projectId, sessionId } = await liveSession();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' } }));
    const [before] = await mcp([{ name: 'checks_get' }], sessionId);
    expect(before!.text).toContain('Checks are on');
    expect(before!.text).toContain('No checks are set.');
    expect(before!.text).toContain('Lint: npm run lint');

    const proposal = mcp([{ name: 'checks_propose', arguments: { checks: [{ name: 'Lint', command: 'npm run lint' }], reason: 'The project has a lint script.' } }], sessionId);
    await answerWhenAsked(sessionId, 'approve');
    const [approved] = await proposal;
    expect(approved).toMatchObject({ isError: false, text: expect.stringContaining('approved') });
    expect(readVerify(store, projectId).checks).toEqual([{ name: 'Lint', command: 'npm run lint' }]);
  }, 60_000);

  it('tells the agent when the user refused, and saves nothing', async () => {
    const { projectId, sessionId } = await liveSession();
    const proposal = mcp([{ name: 'checks_propose', arguments: { checks: [{ name: 'Wipe', command: 'rm -rf build' }] } }], sessionId);
    await answerWhenAsked(sessionId, 'refuse');
    const [refused] = await proposal;
    expect(refused!.text).toContain('refused');
    expect(readVerify(store, projectId).checks).toEqual([]);
  }, 60_000);
});
