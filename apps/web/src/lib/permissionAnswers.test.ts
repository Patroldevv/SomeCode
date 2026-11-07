import { describe, expect, it } from 'vitest';
import type { ClientMessage } from '@somecode/protocol';
import { planAnswer } from './permissionAnswers.ts';

/** Mimics the card's click handler: plan the answer, send it, remember it on success. */
function clicker(sendOk = true) {
  const sent: ClientMessage[] = [];
  let answered: ReadonlySet<string> = new Set();
  const click = (requestId: string, optionId: string) => {
    const plan = planAnswer(answered, 's1', requestId, optionId);
    if (!plan) return;
    sent.push(plan.message);
    if (sendOk) answered = plan.answered;
  };
  return { sent, click, answered: () => answered };
}

describe('planAnswer', () => {
  it('sends one permission_response with the chosen agent option', () => {
    const plan = planAnswer(new Set(), 's1', 'r1', 'allow');
    expect(plan?.message).toEqual({ type: 'permission_response', sessionId: 's1', requestId: 'r1', optionId: 'allow' });
    expect([...plan!.answered]).toEqual(['r1']);
  });

  it('does not send a second answer for the same request (double click, or another option)', () => {
    const c = clicker();
    c.click('r1', 'allow');
    c.click('r1', 'allow');
    c.click('r1', 'reject');
    expect(c.sent).toHaveLength(1);
    c.click('r2', 'reject');
    expect(c.sent.map((m) => (m.type === 'permission_response' ? m.requestId : ''))).toEqual(['r1', 'r2']);
  });

  it('never sends null (which would cancel the whole turn) and does not mutate its input', () => {
    const before: ReadonlySet<string> = new Set(['r0']);
    const plan = planAnswer(before, 's1', 'r1', 'reject');
    expect(plan?.message).toMatchObject({ optionId: 'reject' });
    expect([...before]).toEqual(['r0']);
    expect(planAnswer(before, 's1', 'r0', 'allow')).toBeNull();
  });

  it('allows a retry when the first send failed (the answer was not remembered)', () => {
    const c = clicker(false);
    c.click('r1', 'allow');
    c.click('r1', 'allow');
    expect(c.sent).toHaveLength(2);
    expect(c.answered().size).toBe(0);
  });
});
