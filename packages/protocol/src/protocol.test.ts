import { describe, expect, it } from 'vitest';
import { clientMessageSchema, normalizedEventSchema, SomeCodeError } from './index.ts';

describe('protocol', () => {
  it('parses a valid agent_thought event', () => {
    expect(normalizedEventSchema.parse({ type: 'agent_thought', text: 'x' })).toEqual({
      type: 'agent_thought',
      text: 'x',
    });
  });

  it('rejects an incomplete tool_call event', () => {
    expect(normalizedEventSchema.safeParse({ type: 'tool_call' }).success).toBe(false);
  });

  it('validates afterSeq as a non-negative integer', () => {
    const msg = (afterSeq: number) => ({ type: 'subscribe', sessionId: 's', afterSeq });
    expect(clientMessageSchema.safeParse(msg(-1)).success).toBe(false);
    expect(clientMessageSchema.safeParse(msg(1.5)).success).toBe(false);
    expect(clientMessageSchema.safeParse(msg(0)).success).toBe(true);
  });

  it('SomeCodeError carries its code', () => {
    const err = new SomeCodeError('not_found', 'x');
    expect(err.code).toBe('not_found');
    expect(err).toBeInstanceOf(Error);
  });
});
