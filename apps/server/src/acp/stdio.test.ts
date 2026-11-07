import type { SessionNotification } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { UnknownUpdates } from './stdio.ts';

const notification = (update: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update }, ...extra });

describe('UnknownUpdates', () => {
  it('passes known update tags and unrelated lines through unchanged', () => {
    const u = new UnknownUpdates();
    for (const line of [
      notification({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } }),
      notification({ sessionUpdate: 'notice', text: 'x' }),
      '{"jsonrpc":"2.0","id":1,"result":{"stopReason":"end_turn"}}',
      '{"jsonrpc":"2.0","method":"session/request_permission","id":2,"params":{}}',
      notification({ sessionUpdate: 'brand_new_thing' }, { id: 3 }), // a request, not a notification
      '{"method":"session/update", broken json',
      notification('not an object'),
    ]) {
      expect(u.rewrite(line)).toBe(line);
    }
  });

  it('swaps an unknown tag for a valid placeholder and hands the original back once', () => {
    const u = new UnknownUpdates();
    const raw = { sessionUpdate: 'brand_new_thing', detail: { answer: 42 } };
    const placeholder = JSON.parse(u.rewrite(notification(raw))) as { method: string; params: SessionNotification };
    expect(placeholder.method).toBe('session/update');
    expect(placeholder.params.sessionId).toBe('s1');
    expect(placeholder.params.update).toEqual({ sessionUpdate: 'session_info_update' });
    expect(u.take(placeholder.params)).toEqual({ sessionUpdate: 'brand_new_thing', raw });
    expect(u.take(placeholder.params)).toBeUndefined();
  });

  it('reports a missing or non-string tag as invalid and ignores real notifications in take', () => {
    const u = new UnknownUpdates();
    const placeholder = JSON.parse(u.rewrite(notification({ content: 1 }))) as { params: SessionNotification };
    expect(u.take(placeholder.params)).toEqual({ sessionUpdate: 'invalid', raw: { content: 1 } });
    expect(u.take({ sessionId: 's1', update: { sessionUpdate: 'session_info_update' } })).toBeUndefined();
  });
});
