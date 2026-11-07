import { describe, expect, it } from 'vitest';
import type { NormalizedEvent, StoredEvent } from '@somecode/protocol';
import { addLocalUserMessage, applyEvent, initialState, type SessionState } from './sessionState.ts';

const ev = (seq: number, event: NormalizedEvent): StoredEvent => ({ seq, sessionId: 's1', ts: 0, event });
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
    expect(state.items[0]).toEqual({ kind: 'agent', text: 'Hello' });
    expect(state.items[2]).toEqual({ kind: 'agent', text: 'Done' });
    expect(state.lastSeq).toBe(4);
  });

  it('merges agent_thought chunks into one thought item', () => {
    const state = run([
      ev(1, { type: 'agent_thought', text: 'Let me ' }),
      ev(2, { type: 'agent_thought', text: 'think' }),
    ]);
    expect(state.items).toEqual([{ kind: 'thought', text: 'Let me think' }]);
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
    expect(again.items).toEqual([{ kind: 'agent', text: 'ab' }]);
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
    expect(state.items).toEqual([{ kind: 'unsupported', sessionUpdate: 'x' }]);
    expect(state.lastSeq).toBe(3);
  });

  it('turns a turn_end with an error into an error item, and a normal turn_end into nothing', () => {
    const state = run([
      ev(1, { type: 'turn_end', stopReason: 'end_turn' }),
      ev(2, { type: 'turn_end', stopReason: 'error', error: { code: 'auth_required', message: 'raw detail' } }),
    ]);
    expect(state.items).toEqual([{ kind: 'error', code: 'auth_required' }]);
    expect(state.lastSeq).toBe(2);
  });

  it('merges a server user_message echo into the optimistic local item', () => {
    let state = addLocalUserMessage(initialState(), 'hi');
    state = applyEvent(state, ev(1, { type: 'user_message', text: 'hi' }));
    expect(state.items).toEqual([{ kind: 'user', text: 'hi' }]);
    state = applyEvent(state, ev(2, { type: 'user_message', text: 'other' }));
    expect(state.items).toHaveLength(2);
  });
});
