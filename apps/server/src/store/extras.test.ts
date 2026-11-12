import { afterEach, describe, expect, it } from 'vitest';
import { openStore, type Store } from './store.ts';

describe('store: memory, scheduled tasks and history search', () => {
  const stores: Store[] = [];
  const open = () => {
    const s = openStore(':memory:');
    stores.push(s);
    return s;
  };
  afterEach(() => stores.splice(0).forEach((s) => s.close()));

  it('keeps project memory per project, in order, and deletes one note', () => {
    const store = open();
    const a = store.addProject({ name: 'a', path: '/tmp/a' });
    const b = store.addProject({ name: 'b', path: '/tmp/b' });
    const one = store.addMemory(a.id, 'Use pnpm, not npm');
    store.addMemory(a.id, 'Tests live next to the code');
    store.addMemory(b.id, 'Other project');
    expect(store.listMemories(a.id).map((m) => m.text)).toEqual(['Use pnpm, not npm', 'Tests live next to the code']);
    expect(store.deleteMemory(one.id)).toBe(true);
    expect(store.deleteMemory(one.id)).toBe(false);
    expect(store.listMemories(a.id)).toHaveLength(1);
    store.deleteProject(a.id);
    expect(store.listMemories(a.id)).toEqual([]);
    expect(store.listMemories(b.id)).toHaveLength(1);
  });

  it('lists due tasks, records a run, ends a once-task and removes tasks with their project', () => {
    const store = open();
    const p = store.addProject({ name: 'p', path: '/tmp/p' });
    const every = store.addTask({ projectId: p.id, agentId: 'claude', title: 'Tests', prompt: 'Run the tests', spec: { kind: 'every', minutes: 30 }, nextRun: 1000 });
    const once = store.addTask({ projectId: p.id, agentId: 'claude', title: 'Report', prompt: 'Write it', spec: { kind: 'once', at: 5000 }, nextRun: 5000 });
    expect(store.dueTasks(999)).toEqual([]);
    expect(store.dueTasks(1000).map((t) => t.id)).toEqual([every.id]);
    expect(store.dueTasks(6000).map((t) => t.id)).toEqual([every.id, once.id]);
    store.recordTaskRun(every.id, { at: 1000, sessionId: 's1', nextRun: 1000 + 30 * 60_000 });
    store.recordTaskRun(once.id, { at: 6000, sessionId: 's2', nextRun: null });
    expect(store.getTask(every.id)).toMatchObject({ runs: 1, lastSessionId: 's1', enabled: true, nextRun: 1000 + 30 * 60_000 });
    expect(store.getTask(once.id)).toMatchObject({ runs: 1, enabled: false, nextRun: null });
    expect(store.dueTasks(10 ** 12).map((t) => t.id)).toEqual([every.id]);
    expect(store.updateTask(every.id, { enabled: false })).toBe(true);
    expect(store.dueTasks(10 ** 12)).toEqual([]);
    store.deleteProject(p.id);
    expect(store.listTasks()).toEqual([]);
  });

  it('finds past messages that contain every word, newest chat first, with a snippet around the match', () => {
    const store = open();
    const p = store.addProject({ name: 'shop', path: '/tmp/shop' });
    const q = store.addProject({ name: 'blog', path: '/tmp/blog' });
    const s1 = store.createSession({ projectId: p.id, agentId: 'claude' });
    const s2 = store.createSession({ projectId: q.id, agentId: 'agy' });
    store.appendEvent(s1.id, { type: 'user_message', text: 'How do we handle the payment webhook retries?' });
    store.appendEvent(s1.id, { type: 'agent_message', text: 'Retries use exponential backoff, capped at 6 attempts.' });
    store.appendEvent(s2.id, { type: 'agent_message', text: 'The payment page is a static file.' });
    const hits = store.searchHistory('payment retries');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ sessionId: s1.id, kind: 'user', projectName: 'shop', agentId: 'claude' });
    expect(hits[0]!.snippet).toContain('payment webhook retries');
    expect(store.searchHistory('payment').map((h) => h.projectName)).toEqual(['blog', 'shop']);
    expect(store.searchHistory('payment', { projectId: p.id }).map((h) => h.projectName)).toEqual(['shop']);
    expect(store.searchHistory('100%_')).toEqual([]);
    expect(store.searchHistory('a')).toEqual([]);
  });

  it('reads a chat back as plain text, in pieces', () => {
    const store = open();
    const p = store.addProject({ name: 'p', path: '/tmp/p' });
    const s = store.createSession({ projectId: p.id, agentId: 'claude' });
    store.appendEvent(s.id, { type: 'user_message', text: 'Fix the login bug' });
    store.appendEvent(s.id, { type: 'agent_message', text: 'Found it in auth.ts.' });
    const all = store.transcript(s.id);
    expect(all.text).toBe('User: Fix the login bug\nAgent: Found it in auth.ts.');
    expect(all.truncated).toBe(false);
    for (let i = 0; i < 40; i++) store.appendEvent(s.id, { type: 'user_message', text: `message number ${i} `.repeat(20) });
    const part = store.transcript(s.id, { maxChars: 1500 });
    expect(part.truncated).toBe(true);
    const rest = store.transcript(s.id, { afterSeq: part.lastSeq, maxChars: 1500 });
    expect(rest.text.length).toBeGreaterThan(0);
    expect(rest.lastSeq).toBeGreaterThan(part.lastSeq);
  });
});
