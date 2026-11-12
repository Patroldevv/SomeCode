import { describe, expect, it, vi } from 'vitest';
import { openStore } from '../store/store.ts';
import { createScheduler } from './scheduler.ts';

function setup(now: { t: number }, start = vi.fn(async () => 'session-1')) {
  const store = openStore(':memory:');
  const p = store.addProject({ name: 'p', path: '/tmp/p' });
  const scheduler = createScheduler({ store, start, now: () => now.t });
  const add = (spec: Parameters<typeof store.addTask>[0]['spec'], nextRun: number) => store.addTask({ projectId: p.id, agentId: 'claude', title: 'T', prompt: 'Do it', spec, nextRun });
  return { store, scheduler, add, start };
}

describe('scheduler', () => {
  it('starts what is due, moves a repeating task on and ends a once-task', async () => {
    const now = { t: 10_000 };
    const { store, scheduler, add, start } = setup(now);
    const every = add({ kind: 'every', minutes: 10 }, 5_000);
    const once = add({ kind: 'once', at: 9_000 }, 9_000);
    const later = add({ kind: 'every', minutes: 10 }, 99_999_999);
    expect(await scheduler.tick()).toBe(2);
    expect(start).toHaveBeenCalledTimes(2);
    expect(store.getTask(every.id)).toMatchObject({ runs: 1, lastSessionId: 'session-1', nextRun: 10_000 + 600_000, enabled: true });
    expect(store.getTask(once.id)).toMatchObject({ runs: 1, enabled: false, nextRun: null });
    expect(store.getTask(later.id)?.runs).toBe(0);
    expect(await scheduler.tick()).toBe(0);
  });

  it('runs a task that was missed while closed only once, not once per missed time', async () => {
    const now = { t: 10 * 3_600_000 };
    const { store, scheduler, add, start } = setup(now);
    const t = add({ kind: 'every', minutes: 10 }, 1_000);
    await scheduler.tick();
    await scheduler.tick();
    expect(start).toHaveBeenCalledTimes(1);
    expect(store.getTask(t.id)!.nextRun).toBe(now.t + 600_000);
  });

  it('does not start the same task twice at once, and survives a start that fails', async () => {
    const now = { t: 10_000 };
    let release!: (id: string) => void;
    const slow = vi.fn(() => new Promise<string>((r) => (release = r)));
    const { scheduler, add } = setup(now, slow);
    const t = add({ kind: 'every', minutes: 10 }, 1_000);
    const first = scheduler.runNow(t.id);
    expect(await scheduler.runNow(t.id)).toBeNull();
    release('s');
    expect(await first).toBe('s');

    const failing = setup(now, vi.fn(async () => { throw new Error('agent missing'); }));
    const f = failing.add({ kind: 'once', at: 1_000 }, 1_000);
    expect(await failing.scheduler.tick()).toBe(1);
    // It is not run again and again: its time was moved on before the start, and no run is counted.
    expect(failing.store.getTask(f.id)).toMatchObject({ runs: 0, nextRun: null });
    expect(await failing.scheduler.tick()).toBe(0);
  });

  it('"run now" keeps the next time of a repeating task', async () => {
    const now = { t: 10_000 };
    const { store, scheduler, add } = setup(now);
    const t = add({ kind: 'daily', at: '09:00' }, 50_000_000);
    await scheduler.runNow(t.id);
    expect(store.getTask(t.id)).toMatchObject({ runs: 1, nextRun: 50_000_000, enabled: true });
  });
});
