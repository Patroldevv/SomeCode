import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createRegistry } from '../agents/registry.ts';
import type { AgentDriver } from '../agents/types.ts';
import { startServer } from '../server.ts';
import { openStore, type Store } from '../store/store.ts';
import { fakeDriver } from '../../test-support/fake-driver.ts';
import { runSmoke } from './smoke.ts';

const TOKEN = 'smoke-token-0123456789abcdef';

let store: Store;
let dir: string;
let stderr: MockInstance;
let server: { port: number; url: string; close(): Promise<void> } | undefined;

beforeEach(() => {
  // The session manager logs failed turns to stderr; a crashing or killed agent is expected here.
  stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  store = openStore(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'somecode-smoke-'));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  store.close();
  stderr.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

async function start(drivers: AgentDriver[]) {
  server = await startServer({ store, registry: createRegistry(drivers), token: TOKEN, port: 0 });
  return server;
}

describe('runSmoke', () => {
  it('completes a basic turn and reports the stop reason', async () => {
    const { url } = await start([fakeDriver('basic')]);
    const seen: string[] = [];
    const result = await runSmoke({
      url,
      token: TOKEN,
      agentId: 'fake',
      projectDir: dir,
      prompt: 'say hi',
      timeoutMs: 20_000,
      onEvent: (s) => seen.push(s.event.type),
    });
    expect(result).toMatchObject({ ok: true, stopReason: 'end_turn' });
    const types = result.events.map((s) => s.event.type);
    expect(types).toContain('agent_message');
    expect(types.at(-1)).toBe('turn_end');
    expect(seen).toEqual(types);
  });

  it('fails with the disconnect reason when the agent crashes', async () => {
    const { url } = await start([fakeDriver('crash')]);
    const result = await runSmoke({
      url,
      token: TOKEN,
      agentId: 'fake',
      projectDir: dir,
      prompt: 'say hi',
      timeoutMs: 20_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.stopReason).toBeUndefined();
    expect(result.events.some((s) => s.event.type === 'status' && s.event.status === 'disconnected')).toBe(true);
  });

  it('fails with the error code when the agent rejects the prompt', async () => {
    const { url } = await start([fakeDriver('prompt_auth_error')]);
    const result = await runSmoke({
      url,
      token: TOKEN,
      agentId: 'fake',
      projectDir: dir,
      prompt: 'say hi',
      timeoutMs: 20_000,
    });
    expect(result).toMatchObject({ ok: false, stopReason: 'error' });
    expect(result.reason).toContain('auth_required');
    expect(result.events.at(-1)!.event).toMatchObject({ type: 'turn_end', error: { code: 'auth_required' } });
  });

  it('times out when the turn never ends', async () => {
    const { url } = await start([fakeDriver('slow')]);
    const result = await runSmoke({
      url,
      token: TOKEN,
      agentId: 'fake',
      projectDir: dir,
      prompt: 'wait',
      timeoutMs: 800,
    });
    expect(result).toMatchObject({ ok: false, reason: 'timed out' });
  });

  it('reports a rejected token without leaking it', async () => {
    const { url } = await start([fakeDriver('basic')]);
    const result = await runSmoke({
      url,
      token: 'wrong-token',
      agentId: 'fake',
      projectDir: dir,
      prompt: 'x',
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('401');
    expect(result.reason).not.toContain('wrong-token');
  });

  it('reports an unknown agent', async () => {
    const { url } = await start([fakeDriver('basic')]);
    const result = await runSmoke({
      url,
      token: TOKEN,
      agentId: 'nope',
      projectDir: dir,
      prompt: 'x',
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('unknown agent');
  });
});
