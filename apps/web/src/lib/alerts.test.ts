import { initialState, type Item, type SessionState } from '@somecode/protocol';
import { describe, expect, it } from 'vitest';
import { attentionBetween, attentionSnapshot, lowLimits } from './alerts.ts';
import type { AgentUsage } from './api.ts';

const state = (over: Partial<SessionState> & { items?: Item[] }): SessionState => ({ ...initialState(), lastSeq: 5, ...over });
const permission = (key: string, resolved = false): Item => ({ kind: 'permission', key, requestId: key, toolCallId: 't', title: 'ok?', options: [], resolved });

describe('attentionBetween', () => {
  it('says nothing for the first look at a chat or for a replayed history', () => {
    expect(attentionBetween(undefined, attentionSnapshot(state({ status: 'running' })))).toBeNull();
    expect(attentionBetween(attentionSnapshot(initialState()), attentionSnapshot(state({ items: [permission('1')] })))).toBeNull();
  });

  it('reports a finished turn, a new question and a failure', () => {
    const running = attentionSnapshot(state({ status: 'running' }));
    expect(attentionBetween(running, attentionSnapshot(state({ status: 'ready' })))).toBe('done');
    expect(attentionBetween(running, attentionSnapshot(state({ status: 'running', items: [permission('7')] })))).toBe('ask');
    expect(attentionBetween(running, attentionSnapshot(state({ status: 'ready', items: [{ kind: 'error', key: '9', code: 'internal' }] })))).toBe('error');
  });

  it('does not call a turn that stopped on a question "done", nor repeat a question', () => {
    const running = attentionSnapshot(state({ status: 'running' }));
    const asking = attentionSnapshot(state({ status: 'ready', items: [permission('7')] }));
    expect(attentionBetween(running, asking)).toBe('ask');
    expect(attentionBetween(asking, asking)).toBeNull();
    expect(attentionBetween(asking, attentionSnapshot(state({ items: [permission('7', true)] })))).toBeNull();
  });
});

describe('lowLimits', () => {
  const now = 1_000_000;
  const usage = (used: number, resetsAt: number | null = now + 3_600_000): AgentUsage[] => [
    { id: 'claude', label: 'Claude', limits: [{ type: 'five_hour', used, resetsAt, status: 'allowed', updatedAt: now }] },
  ];

  it('announces a window at 10 % or less once, and again after it renewed and dropped again', () => {
    const seen = new Set<string>();
    expect(lowLimits(usage(0.5), seen, now)).toEqual([]);
    expect(lowLimits(usage(0.91), seen, now)).toMatchObject([{ agent: 'Claude', left: 9 }]);
    expect(lowLimits(usage(0.95), seen, now)).toEqual([]);
    expect(lowLimits(usage(0.2), seen, now)).toEqual([]);
    expect(lowLimits(usage(0.93), seen, now)).toMatchObject([{ left: 7 }]);
  });

  it('ignores unknown figures and windows that have already renewed', () => {
    expect(lowLimits([{ id: 'a', label: 'A', limits: [{ type: 'x', used: null, resetsAt: null, status: '', updatedAt: 0 }] }], new Set(), now)).toEqual([]);
    expect(lowLimits(usage(0.99, now - 1), new Set(), now)).toEqual([]);
  });
});
