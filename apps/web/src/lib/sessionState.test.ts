import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, StoredEvent } from '@somecode/protocol';
import {
  addLocalUserMessage,
  applyEvent,
  initialState,
  type Item,
  type SessionState,
  type ThoughtItem,
  type ToolContentView,
  type ToolItem,
} from './sessionState.ts';

const ev = (seq: number, event: NormalizedEvent, ts = 0): StoredEvent => ({ seq, sessionId: 's1', ts, event });
const run = (events: StoredEvent[], from: SessionState = initialState()): SessionState =>
  events.reduce(applyEvent, from);

const tool = (id: string, title = 'Read file'): NormalizedEvent => ({
  type: 'tool_call',
  id,
  title,
  kind: 'read',
  status: 'pending',
  content: [],
});

describe('applyEvent', () => {
  it('merges consecutive agent_message chunks and starts a new item after a tool_call', () => {
    const state = run([
      ev(1, { type: 'agent_message', text: 'Hel' }),
      ev(2, { type: 'agent_message', text: 'lo' }),
      ev(3, tool('t1')),
      ev(4, { type: 'agent_message', text: 'Done' }),
    ]);
    expect(state.items.map((i) => i.kind)).toEqual(['agent', 'tool', 'agent']);
    expect(state.items[0]).toEqual({ kind: 'agent', key: '1', text: 'Hello' });
    expect(state.items[2]).toEqual({ kind: 'agent', key: '4', text: 'Done' });
    expect(state.lastSeq).toBe(4);
  });

  it('merges agent_thought chunks into one thought item', () => {
    const state = run([
      ev(1, { type: 'agent_thought', text: 'Let me ' }),
      ev(2, { type: 'agent_thought', text: 'think' }),
    ]);
    expect(state.items).toEqual([{ kind: 'thought', key: '1', text: 'Let me think', startedAt: 0 }]);
  });

  it('patches only the matching tool item on tool_call_update', () => {
    const before = run([ev(1, tool('t1', 'A')), ev(2, tool('t2', 'B'))]);
    const after = applyEvent(
      before,
      ev(3, { type: 'tool_call_update', id: 't1', patch: { status: 'completed', title: 'A!' } }),
    );
    expect(after.items[0]).toMatchObject({ kind: 'tool', id: 't1', title: 'A!', status: 'completed' });
    expect(after.items[1]).toBe(before.items[1]);
    expect(before.items[0]).toMatchObject({ status: 'pending', title: 'A' });
  });

  it('ignores events with seq <= lastSeq (replay duplicates)', () => {
    const state = run([ev(1, { type: 'agent_message', text: 'a' }), ev(2, { type: 'agent_message', text: 'b' })]);
    const again = run([ev(2, { type: 'agent_message', text: 'b' }), ev(1, { type: 'agent_message', text: 'a' })], state);
    expect(again).toEqual(state);
    expect(again.items).toEqual([{ kind: 'agent', key: '1', text: 'ab' }]);
  });

  it('updates status from status events', () => {
    const state = run([ev(1, { type: 'status', status: 'running' })]);
    expect(state.status).toBe('running');
    expect(applyEvent(state, ev(2, { type: 'status', status: 'ready' })).status).toBe('ready');
  });

  it('marks the matching permission item resolved on permission_resolved', () => {
    const request = (requestId: string): NormalizedEvent => ({
      type: 'permission_request',
      requestId,
      toolCallId: 't1',
      title: 'Run ls?',
      options: [{ id: 'o1', name: 'Allow once', kind: 'allow_once' }],
    });
    const state = run([
      ev(1, request('r1')),
      ev(2, request('r2')),
      ev(3, { type: 'permission_resolved', requestId: 'r1', outcome: 'selected', optionId: 'o1' }),
    ]);
    expect(state.items[0]).toMatchObject({ kind: 'permission', requestId: 'r1', resolved: true });
    expect(state.items[1]).toMatchObject({ kind: 'permission', requestId: 'r2', resolved: false });
    expect((state.items[0] as { options: unknown[] }).options).toHaveLength(1);
  });

  it('does not mutate the input state', () => {
    const before = run([ev(1, { type: 'agent_message', text: 'a' })]);
    const snapshot = structuredClone(before);
    applyEvent(before, ev(2, { type: 'agent_message', text: 'b' }));
    expect(before).toEqual(snapshot);
  });

  it('keeps unsupported events as items and skips non-visual ones', () => {
    const state = run([
      ev(1, { type: 'unsupported', sessionUpdate: 'x', raw: {} }),
      ev(2, { type: 'turn_end', stopReason: 'end_turn' }),
      ev(3, { type: 'config_options', options: [] }),
    ]);
    expect(state.items).toEqual([{ kind: 'unsupported', key: '1', sessionUpdate: 'x' }]);
    expect(state.lastSeq).toBe(3);
  });

  it('turns a turn_end with an error into an error item, and a normal turn_end into nothing', () => {
    const state = run([
      ev(1, { type: 'turn_end', stopReason: 'end_turn' }),
      ev(2, { type: 'turn_end', stopReason: 'error', error: { code: 'auth_required', message: 'raw detail' } }),
    ]);
    expect(state.items).toEqual([{ kind: 'error', key: '2', code: 'auth_required' }]);
    expect(state.lastSeq).toBe(2);
  });

  it('does not duplicate the user message when a replay from 0 brings it after the optimistic item', () => {
    // Live state: the prompt was shown optimistically before its user_message (seq 3) arrived.
    let state = run([ev(1, { type: 'status', status: 'ready' }), ev(2, { type: 'agent_message', text: 'a' })]);
    state = addLocalUserMessage(state, 'hi');
    const journal = [
      ev(1, { type: 'status', status: 'ready' }),
      ev(2, { type: 'agent_message', text: 'a' }),
      ev(3, { type: 'user_message', text: 'hi' }),
      ev(4, { type: 'status', status: 'running' }),
    ];
    // A re-subscribe from afterSeq 0 replays everything; seq 1-2 are dropped, seq 3 confirms the local item.
    state = run(journal, state);
    state = run(journal, state); // and a second identical replay changes nothing
    expect(state.items).toEqual([
      { kind: 'agent', key: '2', text: 'a' },
      { kind: 'user', key: 'local-1', text: 'hi' },
    ]);
    expect(state.lastSeq).toBe(4);
    // After a reload (fresh state) the replay rebuilds the same transcript.
    // Same content; only the confirmed prompt's key differs (it keeps `local-1` live, `3` after a reload).
    const reloaded = run(journal).items;
    const withoutKey = (items: Item[]) => items.map(({ key: _key, ...rest }) => rest);
    expect(withoutKey(reloaded)).toEqual(withoutKey(state.items));
    expect(reloaded.map((i) => i.key)).toEqual(['2', '3']);
  });

  it('merges a server user_message echo into the optimistic local item', () => {
    let state = addLocalUserMessage(initialState(), 'hi');
    state = applyEvent(state, ev(1, { type: 'user_message', text: 'hi' }));
    expect(state.items).toEqual([{ kind: 'user', key: 'local-1', text: 'hi' }]);
    state = applyEvent(state, ev(2, { type: 'user_message', text: 'other' }));
    expect(state.items).toHaveLength(2);
  });

  it("keys are the creating event's seq and stay stable when chunks append", () => {
    const state = run([
      ev(5, { type: 'agent_message', text: 'Hel' }),
      ev(6, { type: 'agent_message', text: 'lo' }),
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.key).toBe('5');
    expect(state.items[0]).toMatchObject({ text: 'Hello' });
  });

  it('replaying the same events twice yields identical items and keys', () => {
    const events = [
      ev(1, { type: 'user_message', text: 'hi' }),
      ev(2, { type: 'agent_thought', text: 'hm' }, 100),
      ev(3, { type: 'agent_message', text: 'a' }, 200),
      ev(4, tool('t1')),
      ev(5, { type: 'tool_call_update', id: 't1', patch: { status: 'completed' } }),
      ev(6, { type: 'turn_end', stopReason: 'end_turn' }),
    ];
    expect(run(events).items).toEqual(run(events).items);
    expect(run(events).items.map((i) => i.key)).toEqual(['1', '2', '3', '4']);
  });

  it('thought records startedAt from the first chunk and endedAt from the next non-thought event', () => {
    let state = run([
      ev(1, { type: 'agent_thought', text: 'a' }, 1000),
      ev(2, { type: 'agent_thought', text: 'b' }, 2000),
    ]);
    expect(state.items[0]).toMatchObject({ kind: 'thought', text: 'ab', startedAt: 1000 });
    expect((state.items[0] as ThoughtItem).endedAt).toBeUndefined();
    // status:running does not close it.
    state = applyEvent(state, ev(3, { type: 'status', status: 'running' }, 3000));
    expect((state.items[0] as ThoughtItem).endedAt).toBeUndefined();
    state = applyEvent(state, ev(4, { type: 'agent_message', text: 'x' }, 7000));
    expect(state.items[0]).toMatchObject({ startedAt: 1000, endedAt: 7000 });
    expect(state.items).toHaveLength(2);

    const closers: NormalizedEvent[] = [
      tool('t1'),
      { type: 'turn_end', stopReason: 'end_turn' },
      { type: 'status', status: 'disconnected' },
    ];
    for (const closer of closers) {
      const s = run([ev(1, { type: 'agent_thought', text: 'a' }, 1000), ev(2, closer, 7000)]);
      expect(s.items[0], closer.type).toMatchObject({ startedAt: 1000, endedAt: 7000 });
    }
  });

  it('a thought arriving after turn_end starts a new item', () => {
    const state = run([
      ev(1, { type: 'agent_thought', text: 'a' }, 1000),
      ev(2, { type: 'turn_end', stopReason: 'end_turn' }, 2000),
      ev(3, { type: 'agent_thought', text: 'b' }, 3000),
    ]);
    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({ key: '1', text: 'a', startedAt: 1000, endedAt: 2000 });
    expect(state.items[1]).toMatchObject({ key: '3', text: 'b', startedAt: 3000 });
    expect((state.items[1] as ThoughtItem).endedAt).toBeUndefined();
  });

  it('tool_call_update for an unknown id is ignored', () => {
    const before = run([ev(1, tool('t1'))]);
    const after = applyEvent(before, ev(2, { type: 'tool_call_update', id: 'nope', patch: { status: 'completed' } }));
    expect(after.items).toBe(before.items);
    expect(after).toEqual({ ...before, lastSeq: 2 });
  });

  it('tool_call content is converted to typed views', () => {
    const state = run([
      ev(1, {
        type: 'tool_call',
        id: 't1',
        title: 'Edit',
        kind: 'edit',
        status: 'pending',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'diff', path: 'a.ts', oldText: null, newText: 'new' },
          { type: 'terminal', terminalId: 'term1' },
        ],
      }),
      // A diff whose oldText is missing at runtime (undefined) becomes null.
      ev(2, {
        type: 'tool_call',
        id: 't2',
        title: 'Edit',
        kind: 'edit',
        status: 'pending',
        content: [{ type: 'diff', path: 'b.ts', oldText: undefined, newText: 'n' } as never],
      }),
    ]);
    const first = state.items[0] as ToolItem;
    expect(first.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'diff', path: 'a.ts', oldText: null, newText: 'new' },
      { type: 'terminal', terminalId: 'term1' },
    ] satisfies ToolContentView[]);
    expect((state.items[1] as ToolItem).content).toEqual([{ type: 'diff', path: 'b.ts', oldText: null, newText: 'n' }]);
  });

  it('tool_call_update carries rawOutput and replaces content only when provided', () => {
    const before = run([
      ev(1, { ...(tool('t1') as Extract<NormalizedEvent, { type: 'tool_call' }>), content: [{ type: 'text', text: 'keep' }] }),
    ]);
    const noContent = applyEvent(
      before,
      ev(2, { type: 'tool_call_update', id: 't1', patch: { rawOutput: { code: 0 }, status: 'completed' } }),
    );
    expect(noContent.items[0]).toMatchObject({
      rawOutput: { code: 0 },
      status: 'completed',
      content: [{ type: 'text', text: 'keep' }],
    });
    const withContent = applyEvent(
      noContent,
      ev(3, {
        type: 'tool_call_update',
        id: 't1',
        patch: { content: [{ type: 'terminal', terminalId: 'x' }, { type: 'weird' }] },
      }),
    );
    expect((withContent.items[0] as ToolItem).content).toEqual([{ type: 'terminal', terminalId: 'x' }]);
    expect((withContent.items[0] as ToolItem).rawOutput).toEqual({ code: 0 });
  });

  it('plan replaces the previous plan and user_message clears it', () => {
    const entries = (content: string) => [{ content, status: 'pending', priority: 'high' }];
    let state = run([ev(1, { type: 'plan', entries: entries('one') })]);
    expect(state.plan).toEqual(entries('one'));
    expect(state.items).toEqual([]);
    state = applyEvent(state, ev(2, { type: 'plan', entries: entries('two') }));
    expect(state.plan).toEqual(entries('two'));
    state = applyEvent(state, ev(3, { type: 'user_message', text: 'next' }));
    expect(state.plan).toBeNull();
  });

  describe('a prompt the server truncated (over 64 KiB) is confirmed, not shown twice', () => {
    const MARK = '…[truncated]';
    const long = 'ab'.repeat(35 * 1024); // 70 KiB
    const echoed = long.slice(0, 64 * 1024) + MARK;

    it('confirms the local item and keeps the full local text', () => {
      let state = addLocalUserMessage(initialState(), long);
      state = applyEvent(state, ev(1, { type: 'user_message', text: echoed }));
      expect(state.items).toEqual([{ kind: 'user', key: 'local-1', text: long }]);
    });

    it('confirms the OLDEST matching local item', () => {
      let state = addLocalUserMessage(initialState(), long);
      state = addLocalUserMessage(state, `${long}!`);
      state = applyEvent(state, ev(1, { type: 'user_message', text: echoed }));
      expect(state.items).toEqual([
        { kind: 'user', key: 'local-1', text: long },
        { kind: 'user', key: 'local-2', text: `${long}!`, local: true },
      ]);
      state = applyEvent(state, ev(2, { type: 'user_message', text: echoed }));
      expect(state.items).toEqual([
        { kind: 'user', key: 'local-1', text: long },
        { kind: 'user', key: 'local-2', text: `${long}!` },
      ]);
    });

    it('a replay of the echo alone (no local item) shows the truncated text once', () => {
      const state = run([ev(1, { type: 'user_message', text: echoed })]);
      expect(state.items).toEqual([{ kind: 'user', key: '1', text: echoed }]);
    });

    it('a local item that does not start with the echoed prefix is not confirmed', () => {
      let state = addLocalUserMessage(initialState(), `x${long}`);
      state = applyEvent(state, ev(1, { type: 'user_message', text: echoed }));
      expect(state.items).toHaveLength(2);
      expect(state.items[0]).toMatchObject({ local: true });
    });

    it('an exact echo still wins over a prefix match', () => {
      let state = addLocalUserMessage(initialState(), long);
      state = addLocalUserMessage(state, echoed); // the user literally typed the marker
      state = applyEvent(state, ev(1, { type: 'user_message', text: echoed }));
      expect(state.items).toEqual([
        { kind: 'user', key: 'local-1', text: long, local: true },
        { kind: 'user', key: 'local-2', text: echoed },
      ]);
    });
  });

  it('local optimistic item keeps its key when confirmed', () => {
    let state = addLocalUserMessage(initialState(), 'hi');
    state = addLocalUserMessage(state, 'again');
    expect(state.items.map((i) => i.key)).toEqual(['local-1', 'local-2']);
    expect(state.localSeq).toBe(2);
    state = applyEvent(state, ev(9, { type: 'user_message', text: 'again' }));
    expect(state.items[1]).toEqual({ kind: 'user', key: 'local-2', text: 'again' });
    // An unrelated server message gets its own seq key.
    state = applyEvent(state, ev(10, { type: 'user_message', text: 'other' }));
    expect(state.items[2]?.key).toBe('10');
  });
});
