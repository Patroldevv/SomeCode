import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backoffDelay, createConnection, type ConnectionState, type SocketLike } from './connection.ts';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const stored = (seq: number) => ({
  type: 'event' as const,
  stored: { seq, sessionId: 's1', ts: 0, event: { type: 'agent_message' as const, text: 'x' } },
});

describe('createConnection', () => {
  beforeEach(() => {
    FakeSocket.all = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('caps the backoff at 10s', () => {
    expect([0, 1, 2, 3, 4, 5].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });

  it('reconnects with backoff and resubscribes from the last seen seq', () => {
    const states: ConnectionState[] = [];
    const conn = createConnection({ url: 'ws://h/ws', token: 'a b', createSocket: (u) => new FakeSocket(u) });
    conn.onState((s) => states.push(s));
    const first = FakeSocket.all[0]!;
    expect(first.url).toBe('ws://h/ws?token=a%20b');
    first.open();
    expect(conn.send({ type: 'subscribe', sessionId: 's1', afterSeq: 0 })).toBe(true);
    first.receive({ type: 'subscribed', sessionId: 's1', lastSeq: 0 });
    first.receive(stored(1));
    first.receive(stored(2));

    first.drop();
    expect(states.at(-1)).toBe('reconnecting');
    expect(conn.send({ type: 'prompt', sessionId: 's1', text: 'hi' })).toBe(false);
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);

    // A failed attempt doubles the delay.
    FakeSocket.all[1]!.drop();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);

    const third = FakeSocket.all[2]!;
    third.open();
    expect(states.at(-1)).toBe('open');
    expect(third.sent).toEqual([{ type: 'subscribe', sessionId: 's1', afterSeq: 2 }]);

    // Success resets the backoff.
    third.drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it('does not reconnect after close()', () => {
    const conn = createConnection({ url: 'ws://h/ws', token: 't', createSocket: (u) => new FakeSocket(u) });
    FakeSocket.all[0]!.open();
    conn.close();
    FakeSocket.all[0]!.drop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
