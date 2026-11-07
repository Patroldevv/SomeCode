import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '@somecode/protocol';
import { MAX_EVENT_BYTES, openStore, type Store } from './store.ts';

const msg = (text: string): NormalizedEvent => ({ type: 'agent_message', text });

describe('store', () => {
  const stores: Store[] = [];
  const dirs: string[] = [];
  const open = (path: string) => {
    const s = openStore(path);
    stores.push(s);
    return s;
  };
  afterEach(() => {
    for (const s of stores.splice(0)) {
      try {
        s.close();
      } catch {
        // already closed by the test
      }
    }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('assigns gapless per-session seq starting at 1', () => {
    const store = open(':memory:');
    const p = store.addProject({ name: 'p', path: '/tmp/p' });
    const a = store.createSession({ projectId: p.id, agentId: 'claude' });
    const b = store.createSession({ projectId: p.id, agentId: 'claude' });
    expect([1, 2, 3].map(() => store.appendEvent(a.id, msg('x')).seq)).toEqual([1, 2, 3]);
    expect(store.appendEvent(b.id, msg('y')).seq).toBe(1);
    expect(store.appendEvent(a.id, msg('z')).seq).toBe(4);
    expect(store.lastSeq(a.id)).toBe(4);
    expect(store.lastSeq(b.id)).toBe(1);
  });

  it('eventsSince returns only events after the given seq', () => {
    const store = open(':memory:');
    const p = store.addProject({ name: 'p', path: '/tmp/p' });
    const s = store.createSession({ projectId: p.id, agentId: 'claude' });
    for (let i = 0; i < 3; i++) store.appendEvent(s.id, msg(`m${i}`));
    expect(store.eventsSince(s.id, 1).map((e) => e.seq)).toEqual([2, 3]);
    expect(store.eventsSince(s.id, 99)).toEqual([]);
    const all = store.eventsSince(s.id, 0);
    expect(all[0]).toMatchObject({ seq: 1, sessionId: s.id, event: msg('m0') });
    expect(typeof all[0]!.ts).toBe('number');
  });

  it('persists projects, sessions and events across reopen and continues seq', () => {
    const dir = mkdtempSync(join(tmpdir(), 'somecode-store-'));
    dirs.push(dir);
    const file = join(dir, 'test.db');
    const first = open(file);
    const p = first.addProject({ name: 'proj', path: '/tmp/proj' });
    const s = first.createSession({ projectId: p.id, agentId: 'codex' });
    first.setAcpSessionId(s.id, 'acp-1');
    first.appendEvent(s.id, msg('a'));
    first.appendEvent(s.id, msg('b'));
    first.close();

    const second = open(file);
    expect(second.listProjects()).toEqual([p]);
    expect(second.getProject(p.id)).toEqual(p);
    expect(second.getSession(s.id)).toMatchObject({ id: s.id, acpSessionId: 'acp-1', title: null });
    expect(second.listSessions(p.id).map((x) => x.id)).toEqual([s.id]);
    expect(second.eventsSince(s.id, 0).map((e) => e.seq)).toEqual([1, 2]);
    expect(second.appendEvent(s.id, msg('c')).seq).toBe(3);
  });

  it('returns undefined for unknown ids', () => {
    const store = open(':memory:');
    expect(store.getProject('nope')).toBeUndefined();
    expect(store.getSession('nope')).toBeUndefined();
    expect(store.lastSeq('nope')).toBe(0);
  });

  it('truncates oversized rawOutput and text content', () => {
    const store = open(':memory:');
    const p = store.addProject({ name: 'p', path: '/tmp/p' });
    const s = store.createSession({ projectId: p.id, agentId: 'claude' });
    const big = 'x'.repeat(5 * 1024 * 1024);
    const stored = store.appendEvent(s.id, {
      type: 'tool_call_update',
      id: 't1',
      patch: {
        status: 'completed',
        rawOutput: big,
        content: [{ type: 'text', text: big }],
      },
    });
    expect(JSON.stringify(stored.event).length).toBeLessThan(MAX_EVENT_BYTES);
    const roundTripped = store.eventsSince(s.id, 0)[0]!;
    expect(roundTripped.event).toEqual(stored.event);
    if (roundTripped.event.type !== 'tool_call_update') throw new Error('wrong type');
    const patch = roundTripped.event.patch;
    expect(patch.status).toBe('completed');
    expect(patch.rawOutput).toEqual({ truncated: true, bytes: Buffer.byteLength(JSON.stringify(big)) });
    const content = patch.content as { type: string; text: string }[];
    expect(content[0]!.text.endsWith('…[truncated]')).toBe(true);
    expect(content[0]!.text.length).toBeLessThanOrEqual(64 * 1024 + '…[truncated]'.length);
  });

  it('truncates plain message text and tool_call rawInput/content', () => {
    const store = open(':memory:');
    const p = store.addProject({ name: 'p', path: '/tmp/p' });
    const s = store.createSession({ projectId: p.id, agentId: 'claude' });
    const big = 'y'.repeat(200 * 1024);
    const m = store.appendEvent(s.id, msg(big));
    expect((m.event as { text: string }).text.endsWith('…[truncated]')).toBe(true);
    const t = store.appendEvent(s.id, {
      type: 'tool_call',
      id: 't2',
      title: 'Edit',
      kind: 'edit',
      status: 'pending',
      content: [{ type: 'diff', path: '/a', oldText: null, newText: 'n' }],
      rawInput: { blob: 'z'.repeat(5 * 1024 * 1024) },
    });
    if (t.event.type !== 'tool_call') throw new Error('wrong type');
    expect(t.event.rawInput).toMatchObject({ truncated: true });
    expect(t.event.content).toEqual([{ type: 'diff', path: '/a', oldText: null, newText: 'n' }]);
  });

  it('leaves small events untouched', () => {
    const store = open(':memory:');
    const p = store.addProject({ name: 'p', path: '/tmp/p' });
    const s = store.createSession({ projectId: p.id, agentId: 'claude' });
    const ev: NormalizedEvent = {
      type: 'tool_call_update',
      id: 't',
      patch: { rawOutput: { ok: true }, content: [{ type: 'text', text: 'hi' }] },
    };
    expect(store.appendEvent(s.id, ev).event).toEqual(ev);
  });
});
