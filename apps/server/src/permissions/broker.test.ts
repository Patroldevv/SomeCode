import { describe, expect, it } from 'vitest';
import { PermissionBroker } from './broker.ts';

describe('PermissionBroker', () => {
  it('resolves decision with the chosen optionId', async () => {
    const broker = new PermissionBroker();
    const { requestId, decision } = broker.request();
    expect(broker.respond(requestId, 'allow')).toBe(true);
    await expect(decision).resolves.toBe('allow');
  });

  it('returns false when responding twice to the same request', async () => {
    const broker = new PermissionBroker();
    const { requestId, decision } = broker.request();
    expect(broker.respond(requestId, 'allow')).toBe(true);
    expect(broker.respond(requestId, 'reject')).toBe(false);
    await expect(decision).resolves.toBe('allow');
  });

  it('returns false for an unknown requestId', () => {
    const broker = new PermissionBroker();
    expect(broker.respond('nope', 'allow')).toBe(false);
  });

  it('resolves null when respond is called with null (cancel)', async () => {
    const broker = new PermissionBroker();
    const { requestId, decision } = broker.request();
    expect(broker.respond(requestId, null)).toBe(true);
    await expect(decision).resolves.toBeNull();
  });

  it('cancelAll resolves all pending requests with null and returns the count', async () => {
    const broker = new PermissionBroker();
    const a = broker.request();
    const b = broker.request();
    expect(a.requestId).not.toBe(b.requestId);
    expect(broker.cancelAll()).toBe(2);
    await expect(a.decision).resolves.toBeNull();
    await expect(b.decision).resolves.toBeNull();
    expect(broker.respond(a.requestId, 'allow')).toBe(false);
    expect(broker.cancelAll()).toBe(0);
  });
});
