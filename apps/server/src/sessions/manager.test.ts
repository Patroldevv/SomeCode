import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SomeCodeError, type StoredEvent } from '@somecode/protocol';
import { createRegistry } from '../agents/registry.ts';
import type { AgentDriver } from '../agents/types.ts';
import { openStore, type Store } from '../store/store.ts';
import { fakeDriver } from '../../test-support/fake-driver.ts';
import { SessionManager } from './manager.ts';

let store: Store;
let dir: string;
let projectId: string;
let manager: SessionManager;

function setup(...drivers: AgentDriver[]): void {
  manager = new SessionManager({ store, registry: createRegistry(drivers) });
}

const types = (sessionId: string) => store.eventsSince(sessionId, 0).map((e) => e.event.type);
const statuses = (sessionId: string) =>
  store
    .eventsSince(sessionId, 0)
    .flatMap((e) => (e.event.type === 'status' ? [e.event.status] : []));
const waitForType = (sessionId: string, type: string, count = 1) =>
  vi.waitFor(() => {
    if (types(sessionId).filter((t) => t === type).length < count) throw new Error(`no ${type} yet`);
  });
const waitForStatus = (sessionId: string, status: string, count = 1) =>
  vi.waitFor(() => {
    if (statuses(sessionId).filter((s) => s === status).length < count) throw new Error(`no ${status} yet`);
  });

beforeEach(() => {
  store = openStore(':memory:');
  dir = mkdtempSync(join(tmpdir(), 'somecode-manager-'));
  projectId = store.addProject({ name: 'p', path: dir }).id;
});

afterEach(async () => {
  await manager?.closeAll();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function rejection(p: Promise<unknown> | (() => unknown)): Promise<SomeCodeError> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (err) {
    expect(err).toBeInstanceOf(SomeCodeError);
    return err as SomeCodeError;
  }
  throw new Error('expected rejection');
}

describe('createSession', () => {
  it('returns the SessionRow and records the acpSessionId', async () => {
    setup(fakeDriver('basic'));
    const row = await manager.createSession(projectId, 'fake');
    expect(row).toMatchObject({ projectId, agentId: 'fake', acpSessionId: 'fake-session-1' });
    expect(store.getSession(row.id)).toEqual(row);
    expect(statuses(row.id)).toEqual(['ready']);
  });

  it('maps unknown project and unknown agent to not_found', async () => {
    setup(fakeDriver('basic'));
    expect((await rejection(manager.createSession('nope', 'fake'))).code).toBe('not_found');
    expect((await rejection(manager.createSession(projectId, 'nope'))).code).toBe('not_found');
    expect(store.listSessions(projectId)).toEqual([]);
  });

  it('maps a known agent that is not installed to agent_not_installed, without a session row', async () => {
    setup({ ...fakeDriver('basic'), detect: async () => ({ installed: false }) });
    expect((await rejection(manager.createSession(projectId, 'fake'))).code).toBe('agent_not_installed');
    expect(store.listSessions(projectId)).toEqual([]);
  });

  it('rejects a project whose path is gone or is not a directory with bad_request', async () => {
    setup(fakeDriver('basic'));
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'x');
    const asFile = store.addProject({ name: 'f', path: file }).id;
    const gone = store.addProject({ name: 'g', path: join(dir, 'missing') }).id;
    expect((await rejection(manager.createSession(asFile, 'fake'))).code).toBe('bad_request');
    expect((await rejection(manager.createSession(gone, 'fake'))).code).toBe('bad_request');
    expect(store.listSessions(asFile)).toEqual([]);
    expect(store.listSessions(gone)).toEqual([]);
  });

  it('records a spawn failure as status:disconnected and rethrows the error', async () => {
    setup({
      ...fakeDriver('basic'),
      launch: () => ({ command: join(dir, 'no-such-binary'), args: [] }),
    });
    expect((await rejection(manager.createSession(projectId, 'fake'))).code).toBe('agent_not_installed');
    const [row] = store.listSessions(projectId);
    expect(statuses(row!.id)).toEqual(['disconnected']);
  });
});

describe('prompt', () => {
  it('journals a full turn with running -> ready and gapless seq', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    expect(manager.prompt(id, 'hello')).toBeUndefined();
    await waitForStatus(id, 'ready', 2);
    expect(types(id)).toEqual([
      'config_options',
      'status',
      'user_message',
      'status',
      'agent_thought',
      'agent_message',
      'tool_call',
      'tool_call_update',
      'turn_end',
      'status',
    ]);
    expect(statuses(id)).toEqual(['ready', 'running', 'ready']);
    const seqs = store.eventsSince(id, 0).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('prompt journals user_message before status:running', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'hello');
    await waitForStatus(id, 'ready', 2);
    const stored = store.eventsSince(id, 0);
    const at = stored.findIndex((e) => e.event.type === 'status' && e.event.status === 'running');
    expect(at).toBeGreaterThan(0);
    expect(stored[at - 1]!.event).toEqual({ type: 'user_message', text: 'hello' });
    expect(stored.map((e) => e.seq)).toEqual(stored.map((_, i) => i + 1));
  });

  it('rejected prompt journals nothing', async () => {
    setup(fakeDriver('slow'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'one');
    await waitForType(id, 'agent_thought');
    const last = store.lastSeq(id);
    expect((await rejection(() => manager.prompt(id, 'two'))).code).toBe('turn_in_progress');
    expect(store.lastSeq(id)).toBe(last);
    expect(types(id).filter((t) => t === 'user_message')).toHaveLength(1);
    await manager.cancel(id);
    await waitForStatus(id, 'ready', 2);

    const unknown = store.createSession({ projectId, agentId: 'fake' });
    expect((await rejection(() => manager.prompt(unknown.id, 'hi'))).code).toBe('disconnected');
    expect(store.lastSeq(unknown.id)).toBe(0);
    expect((await rejection(() => manager.prompt('nope', 'hi'))).code).toBe('not_found');
  });

  it('rejected prompt on a disconnected session journals nothing', async () => {
    setup(fakeDriver('crash'));
    const { id } = await manager.createSession(projectId, 'fake');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      manager.prompt(id, 'boom');
      await waitForStatus(id, 'disconnected');
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith(expect.stringContaining('prompt failed')));
    } finally {
      stderr.mockRestore();
    }
    const last = store.lastSeq(id);
    expect((await rejection(() => manager.prompt(id, 'again'))).code).toBe('disconnected');
    expect(store.lastSeq(id)).toBe(last);
  });

  it('subscribers see user_message in order', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: StoredEvent[] = [];
    manager.subscribe(id, store.lastSeq(id), (e) => got.push(e));
    manager.prompt(id, 'hello');
    await waitForStatus(id, 'ready', 2);
    expect(got.slice(0, 2).map((e) => e.event)).toEqual([
      { type: 'user_message', text: 'hello' },
      { type: 'status', status: 'running' },
    ]);
    expect(got.map((e) => e.seq)).toEqual(store.eventsSince(id, 2).map((e) => e.seq));
  });

  it('rejects a second prompt during a turn, then accepts one after cancel', async () => {
    setup(fakeDriver('slow'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'one');
    await waitForType(id, 'agent_thought');
    expect((await rejection(() => manager.prompt(id, 'two'))).code).toBe('turn_in_progress');
    expect(types(id)).not.toContain('turn_end');
    expect(statuses(id)).toEqual(['ready', 'running']);

    await manager.cancel(id);
    await waitForStatus(id, 'ready', 2);
    expect(store.eventsSince(id, 0).find((e) => e.event.type === 'turn_end')?.event).toEqual({
      type: 'turn_end',
      stopReason: 'cancelled',
    });

    manager.prompt(id, 'three');
    await waitForStatus(id, 'running', 2);
    await manager.cancel(id);
    await waitForStatus(id, 'ready', 3);
  });

  it('keeps turn_in_progress when a listener re-prompts on status:ready', async () => {
    setup(fakeDriver('slow'));
    const { id } = await manager.createSession(projectId, 'fake');
    let reprompted = false;
    manager.subscribe(id, store.lastSeq(id), (e) => {
      if (e.event.type === 'status' && e.event.status === 'ready' && !reprompted) {
        reprompted = true;
        manager.prompt(id, 'second');
      }
    });
    manager.prompt(id, 'first');
    await waitForType(id, 'agent_thought');
    await manager.cancel(id);
    await waitForStatus(id, 'running', 2);
    // Let the finished first turn's promise settle; it must not clear the second turn's busy flag.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await rejection(() => manager.prompt(id, 'third'))).code).toBe('turn_in_progress');
    await manager.cancel(id);
    await waitForStatus(id, 'ready', 3);
  });

  it('journals an agent error as turn_end{error} before status:ready, then accepts a new prompt', async () => {
    setup(fakeDriver('prompt_auth_error'));
    const { id } = await manager.createSession(projectId, 'fake');
    const from = store.lastSeq(id);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      manager.prompt(id, 'hello');
      await waitForStatus(id, 'ready', 2);
      expect(store.eventsSince(id, from).map((e) => e.event)).toEqual([
        { type: 'user_message', text: 'hello' },
        { type: 'status', status: 'running' },
        { type: 'agent_thought', text: 'Thinking about it' },
        { type: 'turn_end', stopReason: 'error', error: { code: 'auth_required', message: expect.any(String) } },
        { type: 'status', status: 'ready' },
      ]);
      // busy is cleared: a later prompt is accepted (and journaled) instead of turn_in_progress.
      await vi.waitFor(() => expect(() => manager.prompt(id, 'again')).not.toThrow());
      await waitForStatus(id, 'ready', 3);
      expect(types(id).filter((t) => t === 'turn_end')).toHaveLength(2);
    } finally {
      stderr.mockRestore();
    }
    const seqs = store.eventsSince(id, 0).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('journals an unknown ACP update type as unsupported, in order', async () => {
    setup(fakeDriver('unknown_update'));
    const { id } = await manager.createSession(projectId, 'fake');
    const from = store.lastSeq(id);
    manager.prompt(id, 'hello');
    await waitForStatus(id, 'ready', 2);
    expect(store.eventsSince(id, from).map((e) => e.event)).toEqual([
      { type: 'user_message', text: 'hello' },
      { type: 'status', status: 'running' },
      { type: 'agent_thought', text: 'Thinking about it' },
      { type: 'agent_message', text: 'before' },
      { type: 'unsupported', sessionUpdate: 'brand_new_thing', raw: { sessionUpdate: 'brand_new_thing', detail: { answer: 42 } } },
      { type: 'agent_message', text: 'after' },
      { type: 'turn_end', stopReason: 'end_turn' },
      { type: 'status', status: 'ready' },
    ]);
  });

  it('rejects an unknown session with not_found', async () => {
    setup(fakeDriver('basic'));
    expect((await rejection(() => manager.prompt('nope', 'hi'))).code).toBe('not_found');
  });

  it('rejects prompts after the agent crashed with disconnected', async () => {
    setup(fakeDriver('crash'));
    const { id } = await manager.createSession(projectId, 'fake');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      manager.prompt(id, 'boom');
      await waitForStatus(id, 'disconnected');
      // The failed background prompt is logged, not thrown.
      await vi.waitFor(() => expect(stderr).toHaveBeenCalledWith(expect.stringContaining('prompt failed')));
    } finally {
      stderr.mockRestore();
    }
    expect(statuses(id).at(-1)).toBe('disconnected');
    expect((await rejection(() => manager.prompt(id, 'again'))).code).toBe('disconnected');
  });

  it('rejects prompts for a stored session with no live agent with disconnected', async () => {
    setup(fakeDriver('basic'));
    const row = store.createSession({ projectId, agentId: 'fake' });
    expect((await rejection(() => manager.prompt(row.id, 'hi'))).code).toBe('disconnected');
  });
});

describe('cancel, respondPermission, setConfig', () => {
  it('answers a permission request and finishes the turn', async () => {
    setup(fakeDriver('permission'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'edit');
    await waitForType(id, 'permission_request');
    const request = store.eventsSince(id, 0).find((e) => e.event.type === 'permission_request')!.event;
    if (request.type !== 'permission_request') throw new Error('unreachable');
    manager.respondPermission(id, request.requestId, 'allow');
    await waitForType(id, 'turn_end');
    expect(types(id)).toContain('permission_resolved');
    expect((await rejection(() => manager.respondPermission(id, request.requestId, 'allow'))).code).toBe(
      'not_found',
    );
    expect((await rejection(() => manager.respondPermission('nope', 'r', null))).code).toBe('not_found');
    await manager.closeAll();
    expect((await rejection(() => manager.respondPermission(id, 'r', null))).code).toBe('disconnected');
  });

  it('forwards setConfig and validates the session', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    await manager.setConfig(id, 'model', 'smart');
    const last = store.eventsSince(id, 0).at(-1)!.event;
    expect(last).toMatchObject({ type: 'config_options', options: [{ id: 'model', currentValue: 'smart' }] });
    expect((await rejection(manager.setConfig('nope', 'model', 'fast'))).code).toBe('not_found');
    expect((await rejection(manager.cancel('nope'))).code).toBe('not_found');
  });
});

describe('setConfig failures', () => {
  it('refuses while a turn runs, rejects unknown options and journals nothing for either', async () => {
    setup(fakeDriver('slow'));
    const { id } = await manager.createSession(projectId, 'fake');
    manager.prompt(id, 'go');
    await waitForType(id, 'agent_thought');
    const last = store.lastSeq(id);
    expect((await rejection(manager.setConfig(id, 'model', 'smart'))).code).toBe('turn_in_progress');
    await manager.cancel(id);
    await waitForStatus(id, 'ready', 2);
    const before = store.lastSeq(id);
    expect((await rejection(manager.setConfig(id, 'no-such-option', 'x'))).code).toBe('bad_request');
    expect(store.lastSeq(id)).toBe(before);
    expect(before).toBeGreaterThan(last - 1);
  });
});

describe('subscribe', () => {
  it('replays history then delivers live events, without duplicates, even when one arrives mid-replay', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: StoredEvent[] = [];
    let started = false;
    const sub = manager.subscribe(id, 0, (e) => {
      got.push(e);
      if (!started) {
        started = true;
        manager.prompt(id, 'during replay'); // emits a live event while the replay is running
      }
    });
    await waitForStatus(id, 'ready', 2);
    const stored = store.eventsSince(id, 0);
    expect(got.map((e) => e.seq)).toEqual(stored.map((e) => e.seq));
    expect(got.map((e) => e.event)).toEqual(stored.map((e) => e.event));
    expect(got.map((e) => e.seq)).toEqual(got.map((_, i) => i + 1));
    expect(sub.lastSeq).toBe(2); // config_options + status:ready existed at subscribe time
    sub.unsubscribe();
  });

  it('keeps order for all subscribers when a listener triggers events synchronously', async () => {
    setup(fakeDriver('permission'));
    const { id } = await manager.createSession(projectId, 'fake');
    const from = store.lastSeq(id);
    const seen: number[] = [];
    let reprompted = false;
    manager.subscribe(id, from, (e) => {
      if (e.event.type === 'permission_request') manager.respondPermission(id, e.event.requestId, 'allow');
      if (e.event.type === 'status' && e.event.status === 'ready' && !reprompted) {
        reprompted = true;
        manager.prompt(id, 'again'); // emits status:running synchronously
      }
    });
    manager.subscribe(id, from, (e) => seen.push(e.seq));
    manager.prompt(id, 'first');
    await waitForStatus(id, 'ready', 3);
    expect(seen).toEqual(store.eventsSince(id, from).map((e) => e.seq));
    expect(types(id)).toContain('permission_resolved');
    expect(seen.length).toBeGreaterThan(10);
  });

  it('replays only events after afterSeq', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: number[] = [];
    const sub = manager.subscribe(id, 1, (e) => got.push(e.seq));
    expect(got).toEqual([2]);
    expect(sub.lastSeq).toBe(2);
  });

  it('delivers no history when afterSeq is beyond the last seq and reports the real lastSeq', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: number[] = [];
    const sub = manager.subscribe(id, 999, (e) => got.push(e.seq));
    expect(got).toEqual([]);
    expect(sub.lastSeq).toBe(store.lastSeq(id));
    expect(sub.lastSeq).toBe(2);
  });

  it('stops delivering after unsubscribe', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: number[] = [];
    const sub = manager.subscribe(id, 0, (e) => got.push(e.seq));
    const before = got.length;
    sub.unsubscribe();
    manager.prompt(id, 'hi');
    await waitForStatus(id, 'ready', 2);
    expect(got).toHaveLength(before);
  });

  it('isolates a throwing listener from other listeners and from journaling', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const got: number[] = [];
      manager.subscribe(id, 0, () => {
        throw new Error('listener bug');
      });
      manager.subscribe(id, 0, (e) => got.push(e.seq));
      manager.prompt(id, 'hi');
      await waitForStatus(id, 'ready', 2);
      expect(got).toEqual(store.eventsSince(id, 0).map((e) => e.seq));
      expect(stderr).toHaveBeenCalled();
      await manager.closeAll(); // the throwing listener is still registered until now
    } finally {
      stderr.mockRestore();
    }
  });

  it('rejects unknown sessions and invalid afterSeq', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    expect((await rejection(() => manager.subscribe('nope', 0, () => {}))).code).toBe('not_found');
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect((await rejection(() => manager.subscribe(id, bad, () => {}))).code).toBe('bad_request');
    }
  });
});

/** PIDs of processes whose command line contains `tag` (no shell, so pgrep never matches itself). */
function pids(tag: string): string[] {
  return spawnSync('pgrep', ['-f', tag], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
}

describe('closeAll during startup', () => {
  it('stops an agent that is still starting, rejects its createSession, and writes nothing afterwards', async () => {
    const tag = `somecode-test-${randomUUID()}`;
    const base = fakeDriver('slow_start');
    const driver: AgentDriver = {
      ...base,
      launch: () => {
        const l = base.launch();
        return { ...l, args: [...l.args, tag] }; // marks this test's agent process
      },
    };
    let closed = false;
    const lateWrites: string[] = [];
    const guarded: Store = {
      ...store,
      appendEvent: (sessionId, event) => {
        if (closed) lateWrites.push(`appendEvent ${event.type}`);
        return store.appendEvent(sessionId, event);
      },
      setAcpSessionId: (id, acpId) => {
        if (closed) lateWrites.push('setAcpSessionId');
        store.setAcpSessionId(id, acpId);
      },
    };
    manager = new SessionManager({ store: guarded, registry: createRegistry([driver]) });

    const creating = rejection(manager.createSession(projectId, 'fake'));
    await vi.waitFor(() => expect(pids(tag)).toHaveLength(1)); // the agent runs, stuck in initialize
    const t0 = Date.now();
    await manager.closeAll();
    closed = true;
    expect(Date.now() - t0).toBeLessThan(3000); // did not wait for the 30 s initialize
    expect(pids(tag)).toEqual([]);
    expect((await creating).code).toBe('disconnected');

    const [row] = store.listSessions(projectId);
    expect(row!.acpSessionId).toBeNull();
    expect(statuses(row!.id)).toEqual(['disconnected']);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lateWrites).toEqual([]);

    // After closeAll, new sessions are refused without spawning or writing anything.
    expect((await rejection(manager.createSession(projectId, 'fake'))).code).toBe('disconnected');
    expect(store.listSessions(projectId)).toHaveLength(1);
    expect(pids(tag)).toEqual([]);
  });
});

describe('closeAll', () => {
  it('closes live agents and clears listeners', async () => {
    setup(fakeDriver('basic'));
    const { id } = await manager.createSession(projectId, 'fake');
    const got: number[] = [];
    manager.subscribe(id, 0, (e) => got.push(e.seq));
    await manager.closeAll();
    expect(statuses(id).at(-1)).toBe('disconnected');
    const delivered = got.length;
    expect((await rejection(() => manager.prompt(id, 'hi'))).code).toBe('disconnected');
    expect(got).toHaveLength(delivered);
  });
});
