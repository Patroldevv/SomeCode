import { describe, expect, it, vi } from 'vitest';
import type { NormalizedEvent, StoredEvent } from '@somecode/protocol';
import { createSessionsStore, type Schedule } from './sessionsStore.ts';

/** A hand-driven frame scheduler: `frame()` runs what is pending, like the browser's next animation frame. */
function manualFrames() {
  let queue: (() => void)[] = [];
  let scheduled = 0;
  let cancelled = 0;
  const schedule: Schedule = (callback) => {
    scheduled += 1;
    queue.push(callback);
    return () => {
      cancelled += 1;
      queue = queue.filter((c) => c !== callback);
    };
  };
  return {
    schedule,
    frame: () => {
      const run = queue;
      queue = [];
      for (const callback of run) callback();
    },
    get pending() {
      return queue.length;
    },
    get scheduled() {
      return scheduled;
    },
    get cancelled() {
      return cancelled;
    },
  };
}

const ev = (seq: number, event: NormalizedEvent, sessionId = 's1'): StoredEvent => ({ seq, sessionId, ts: 0, event });
const msg = (seq: number, text: string, sessionId = 's1'): StoredEvent =>
  ev(seq, { type: 'agent_message', text }, sessionId);

describe('createSessionsStore', () => {
  it('keeps the older cursor at the durable seq when a confirmed prompt retains its optimistic key', () => {
    const store = createSessionsStore({maxItems:2});
    store.apply('s',ev(1,{type:'user_message',text:'one'},'s'));
    store.apply('s',ev(2,{type:'agent_message',text:'reply'},'s'));
    store.addLocalUser('s','two');
    store.apply('s',ev(3,{type:'user_message',text:'two'},'s'));
    store.apply('s',ev(4,{type:'agent_message',text:'later'},'s'));
    expect(store.get('s').items.map((item)=>item.key)).toEqual(['local-1','4']);
    expect(store.get('s').olderBeforeSeq).toBe(3);
  });
  it('does not duplicate an optimistic prompt already confirmed inside a snapshot', () => {
    const store = createSessionsStore();
    store.addLocalUser('s','hello');
    store.setSnapshot('s',{state:{...store.get('s'),lastSeq:10,items:[{kind:'user',key:'7',text:'hello'}]},beforeSeq:null});
    expect(store.get('s').items).toHaveLength(1);
    expect(store.get('s').items[0]).toMatchObject({kind:'user',text:'hello'});
  });
  it('evicts inactive session states and rebuilds evicted sessions from seq zero', () => {
    const store = createSessionsStore({maxSessions:2});
    store.apply('a',msg(1,'a','a'));
    store.apply('b',msg(1,'b','b'));
    store.apply('c',msg(1,'c','c'));
    expect(store.get('a').lastSeq).toBe(0);
    expect(store.get('b').lastSeq).toBe(1);
    expect(store.get('c').lastSeq).toBe(1);
  });
  it('bounds the recent window and exposes an older cursor without moving the live cursor backwards', () => {
    const store = createSessionsStore({maxItems:2});
    for (let n=1;n<=4;n++) store.apply('a',ev(n,{type:'user_message',text:String(n)},'a'));
    expect(store.get('a').items.map((i)=>i.key)).toEqual(['3','4']);
    expect(store.get('a').olderBeforeSeq).toBe(3);
    store.setOlderHistory('a',{state:{...store.get('a'),items:[{kind:'user',key:'1',text:'one'},{kind:'user',key:'2',text:'two'}],lastSeq:2},beforeSeq:null});
    expect(store.get('a').olderItems?.map((i)=>i.key)).toEqual(['1','2']);
    expect(store.get('a').items.map((i)=>i.key)).toEqual(['3','4']);
    expect(store.get('a').lastSeq).toBe(4);
  });
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
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    store.apply('a', msg(1, 'x', 'a'));
    store.apply('b', msg(1, 'y', 'b'));
    const a1 = store.get('a');
    expect(store.get('a')).toBe(a1);

    const listener = vi.fn();
    store.subscribe(listener);
    store.apply('b', msg(2, 'z', 'b'));
    expect(store.get('a')).toBe(a1);
    frames.frame();
    expect(listener).toHaveBeenCalledTimes(1);

    store.apply('a', msg(1, 'dup', 'a'));
    expect(store.get('a')).toBe(a1);
    // A duplicate seq changes nothing, so it does not even schedule a frame.
    expect(frames.pending).toBe(0);
    frames.frame();
    expect(listener).toHaveBeenCalledTimes(1);

    store.apply('a', msg(2, 'more', 'a'));
    expect(store.get('a')).not.toBe(a1);
  });

  it('subscribe is notified once per effective change and stops after unsubscribe', () => {
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.apply('a', msg(1, 'x', 'a'));
    expect(listener).toHaveBeenCalledTimes(0); // deferred to the next frame
    frames.frame();
    expect(listener).toHaveBeenCalledTimes(1);
    store.addLocalUser('a', 'hi');
    expect(listener).toHaveBeenCalledTimes(2); // a user action: synchronous
    store.reset('a');
    frames.frame();
    expect(listener).toHaveBeenCalledTimes(3);
    store.setDraft('a', 'typing');
    expect(listener).toHaveBeenCalledTimes(4);
    store.setDraft('a', 'typing');
    expect(listener).toHaveBeenCalledTimes(4);

    unsubscribe();
    store.apply('a', msg(1, 'y', 'a'));
    store.addLocalUser('a', 'again');
    frames.frame();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('N rapid applies notify once per frame, while get() is current immediately', () => {
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    const listener = vi.fn();
    store.subscribe(listener);
    for (let seq = 1; seq <= 100; seq++) {
      store.apply('a', msg(seq, `chunk ${seq} `, 'a'));
      expect(store.get('a').lastSeq).toBe(seq);
    }
    expect(listener).not.toHaveBeenCalled();
    expect(frames.scheduled).toBe(1);
    frames.frame();
    expect(listener).toHaveBeenCalledOnce();
    frames.frame();
    expect(listener).toHaveBeenCalledOnce();
    store.apply('a', msg(101, 'more', 'a'));
    frames.frame();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('flush() delivers a pending notification now and cancels its frame', () => {
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    const listener = vi.fn();
    store.subscribe(listener);
    store.flush();
    expect(listener).not.toHaveBeenCalled(); // nothing pending: no-op
    store.apply('a', msg(1, 'x', 'a'));
    store.apply('a', msg(2, 'y', 'a'));
    store.flush();
    expect(listener).toHaveBeenCalledOnce();
    expect(frames.pending).toBe(0);
    frames.frame();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('drafts and local user items notify synchronously and carry pending event changes with them', () => {
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    const seen: string[] = [];
    store.subscribe(() => seen.push(`${store.getDraft('a')}|${store.get('a').lastSeq}`));
    store.apply('a', msg(1, 'x', 'a'));
    store.setDraft('a', 't');
    expect(seen).toEqual(['t|1']);
    expect(frames.pending).toBe(0); // the synchronous notification delivered the event change too
    store.setDraft('a', 'ty');
    expect(seen).toEqual(['t|1', 'ty|1']);
    store.addLocalUser('a', 'hello');
    expect(seen).toHaveLength(3);
    frames.frame();
    expect(seen).toHaveLength(3);
  });

  it('the last unsubscribe cancels a pending frame; without listeners nothing is scheduled', () => {
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    const one = vi.fn();
    const two = vi.fn();
    const offOne = store.subscribe(one);
    const offTwo = store.subscribe(two);
    store.apply('a', msg(1, 'x', 'a'));
    expect(frames.pending).toBe(1);
    offOne();
    expect(frames.pending).toBe(1); // still someone to notify
    offTwo();
    expect(frames.pending).toBe(0);
    expect(frames.cancelled).toBe(1);
    store.apply('a', msg(2, 'y', 'a'));
    expect(frames.scheduled).toBe(1);
    frames.frame();
    expect(one).not.toHaveBeenCalled();
    expect(two).not.toHaveBeenCalled();
    expect(store.get('a').lastSeq).toBe(2);
  });

  it('the default scheduler uses requestAnimationFrame, or a 16 ms timer without it', () => {
    vi.useFakeTimers();
    try {
      // node: no requestAnimationFrame, so the fallback timer runs it.
      const store = createSessionsStore();
      const listener = vi.fn();
      const off = store.subscribe(listener);
      store.apply('a', msg(1, 'x', 'a'));
      vi.advanceTimersByTime(15);
      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledOnce();
      off();

      const raf = vi.fn((callback: FrameRequestCallback) => setTimeout(() => callback(0), 5) as unknown as number);
      const caf = vi.fn((id: number) => clearTimeout(id));
      vi.stubGlobal('requestAnimationFrame', raf);
      vi.stubGlobal('cancelAnimationFrame', caf);
      const rafStore = createSessionsStore();
      const rafListener = vi.fn();
      const offRaf = rafStore.subscribe(rafListener);
      rafStore.apply('a', msg(1, 'x', 'a'));
      expect(raf).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(5);
      expect(rafListener).toHaveBeenCalledOnce();
      rafStore.apply('a', msg(2, 'y', 'a'));
      offRaf();
      expect(caf).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
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

  it('rewindTo removes items from target userKey forward and emits', () => {
    const store = createSessionsStore();
    store.apply('s', ev(1, { type: 'user_message', text: 'first' }, 's'));
    store.apply('s', ev(2, { type: 'agent_message', text: 'first reply' }, 's'));
    store.apply('s', ev(3, { type: 'user_message', text: 'second' }, 's'));
    store.apply('s', ev(4, { type: 'agent_message', text: 'second reply' }, 's'));

    expect(store.get('s').items).toHaveLength(4);

    const listener = vi.fn();
    store.subscribe(listener);

    // Rewind to '3'
    store.rewindTo('s', '3');
    expect(store.get('s').items).toHaveLength(2);
    expect(store.get('s').items.map((i) => (i as any).text)).toEqual(['first', 'first reply']);
    expect(listener).toHaveBeenCalled();
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
