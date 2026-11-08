import { afterEach, describe, expect, it } from 'vitest';
import { fakeDriver } from '../../test-support/fake-driver.ts';
import { runHandshake } from './handshake.ts';

const cwd = process.cwd();

afterEach(async () => {
  // runHandshake closes its session; nothing may be left running between tests.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

describe('runHandshake', () => {
  it('reports the agent identity, sign-in methods and options after initialize + session/new, without prompting', async () => {
    const result = await runHandshake(fakeDriver('basic'), cwd, 10_000);
    expect(result).toMatchObject({
      ok: true,
      agentInfo: { name: 'fake-agent', version: '1.0.0' },
      authMethods: [{ id: 'fake-login', name: 'Fake login' }],
      loadSession: true,
    });
    expect(result.options?.map((o) => [o.id, o.currentValue])).toEqual([['model', 'fast']]);
    expect(result.error).toBeUndefined();
  });

  it('lists modes for an agent that only reports modes', async () => {
    const result = await runHandshake(fakeDriver('modes_only'), cwd, 10_000);
    expect(result.ok).toBe(true);
    expect(result.options?.map((o) => o.id)).toEqual(['mode']);
  });

  it('reports auth_required when session/new says the user must sign in', async () => {
    const result = await runHandshake(fakeDriver('new_auth_error'), cwd, 10_000);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('auth_required');
  });

  it('fails cleanly when the agent never answers within the budget', async () => {
    const t0 = Date.now();
    const result = await runHandshake(fakeDriver('slow_start'), cwd, 300);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('disconnected');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('reports agent_not_installed for a missing command', async () => {
    const driver = { ...fakeDriver('basic'), launch: () => ({ command: 'definitely-not-installed-xyz', args: [] }) };
    const result = await runHandshake(driver, cwd, 5_000);
    expect(result).toMatchObject({ ok: false, error: { code: 'agent_not_installed' } });
  });
});
