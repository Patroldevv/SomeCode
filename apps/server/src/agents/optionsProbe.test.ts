import { describe, expect, it, vi } from 'vitest';
import { fakeDriver } from '../../test-support/fake-driver.ts';
import { createOptionsProbe } from './optionsProbe.ts';

const driver = fakeDriver('basic');
const option = { id: 'model', name: 'Model', currentValue: 'fast', choices: [{ value: 'fast', name: 'Fast' }] };

describe('options probe', () => {
  it('runs one handshake for concurrent asks and remembers the answer', async () => {
    const handshake = vi.fn(async () => ({ ok: true, options: [option] }));
    const probe = createOptionsProbe(handshake);
    const [a, b] = await Promise.all([probe.options(driver, '/tmp'), probe.options(driver, '/tmp')]);
    expect(a).toEqual([option]);
    expect(b).toEqual([option]);
    await probe.options(driver, '/tmp');
    expect(handshake).toHaveBeenCalledTimes(1);
  });

  it('gives no options on failure and tries again after a short while', async () => {
    let clock = 0;
    const handshake = vi.fn(async () => ({ ok: false, error: { code: 'auth_required', message: 'x' } }));
    const probe = createOptionsProbe(handshake, () => clock);
    expect(await probe.options(driver, '/tmp')).toEqual([]);
    await probe.options(driver, '/tmp');
    expect(handshake).toHaveBeenCalledTimes(1);
    clock = 30_000;
    await probe.options(driver, '/tmp');
    expect(handshake).toHaveBeenCalledTimes(2);
  });

  it('survives a handshake that throws', async () => {
    const probe = createOptionsProbe(async () => {
      throw new Error('boom');
    });
    expect(await probe.options(driver, '/tmp')).toEqual([]);
  });
});
