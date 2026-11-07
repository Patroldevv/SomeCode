import { describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent, StoredEvent } from '@somecode/protocol';
import { createSessionsStore } from './sessionsStore.ts';

const ev = (seq: number, event: NormalizedEvent, sessionId = 's1'): StoredEvent => ({ seq, sessionId, ts: 0, event });
const msg = (seq: number, text: string, sessionId = 's1'): StoredEvent =>
  ev(seq, { type: 'agent_message', text }, sessionId);

describe('createSessionsStore', () => {
  it('sessions are independent', () => {
    const store = createSessionsStore();
    store.apply('a', msg(1, 'hello', 'a'));
    store.addLocalUser('b', 'hi');
    expect(store.get('a').items.map((i) => i.kind)).toEqual(['agent']);
    expect(store.get('a').lastSeq).toBe(1);
    expect(store.get('b').items.map((i) => i.kind)).toEqual(['user']);
    expect(store.get('b').lastSeq).toBe(0);
  });

  it('get returns the same reference until that session changes', () => {
    const store = createSessionsStore();
    store.apply('a', msg(1, 'x', 'a'));
    store.apply('b', msg(1, 'y', 'b'));
    const a1 = store.get('a');
    expect(store.get('a')).toBe(a1);

    const listener = vi.fn();
    store.subscribe(listener);
    store.apply('b', msg(2, 'z', 'b'));
    expect(store.get('a')).toBe(a1);
    expect(listener).toHaveBeenCalledTimes(1);

    store.apply('a', msg(1, 'dup', 'a'));
    expect(store.get('a')).toBe(a1);
    expect(listener).toHaveBeenCalledTimes(1);

    store.apply('a', msg(2, 'more', 'a'));
    expect(store.get('a')).not.toBe(a1);
  });

  it('subscribe is notified once per effective change and stops after unsubscribe', () => {
    const store = createSessionsStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.apply('a', msg(1, 'x', 'a'));
    expect(listener).toHaveBeenCalledTimes(1);
    store.addLocalUser('a', 'hi');
    expect(listener).toHaveBeenCalledTimes(2);
    store.reset('a');
    expect(listener).toHaveBeenCalledTimes(3);
    store.setDraft('a', 'typing');
    expect(listener).toHaveBeenCalledTimes(4);
    store.setDraft('a', 'typing');
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    store.apply('a', msg(1, 'y', 'a'));
    store.addLocalUser('a', 'again');
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('reset forgets one session only', () => {
    const store = createSessionsStore();
    store.apply('a', msg(1, 'x', 'a'));
    store.apply('b', msg(1, 'y', 'b'));
    const b = store.get('b');
    store.reset('a');
    expect(store.get('a').lastSeq).toBe(0);
    expect(store.get('a').items).toEqual([]);
    expect(store.get('b')).toBe(b);
    // After a reset the session replays from the start.
    store.apply('a', msg(1, 'again', 'a'));
    expect(store.get('a').items).toHaveLength(1);
  });

  it('drafts are kept per session and survive apply', () => {
    const store = createSessionsStore();
    expect(store.getDraft('a')).toBe('');
    store.setDraft('a', 'draft a');
    store.setDraft('b', 'draft b');
    store.apply('a', msg(1, 'x', 'a'));
    expect(store.getDraft('a')).toBe('draft a');
    expect(store.getDraft('b')).toBe('draft b');
    store.reset('a');
    expect(store.getDraft('a')).toBe('draft a');
  });

  it('get for an unknown id returns a stable empty state', () => {
    const store = createSessionsStore();
    const empty = store.get('nope');
    expect(store.get('nope')).toBe(empty);
    expect(store.get('other')).toBe(empty);
    expect(empty.items).toEqual([]);
    expect(empty.lastSeq).toBe(0);
    store.apply('nope', msg(1, 'x', 'nope'));
    expect(store.get('nope')).not.toBe(empty);
  });
});
