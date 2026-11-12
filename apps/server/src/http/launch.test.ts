import { describe, expect, it } from 'vitest';
import { createLaunchCodes } from './launch.ts';

describe('launch codes', () => {
  it('work a few times, only for what was issued, and expire', () => {
    let now = 1000;
    const codes = createLaunchCodes(() => now, 60_000, 2);
    const a = codes.issue();
    expect(codes.redeem('nope')).toBe(false);
    expect(codes.redeem(a)).toBe(true);
    expect(codes.redeem(a)).toBe(true);
    expect(codes.redeem(a)).toBe(false);
    const b = codes.issue();
    now += 61_000;
    expect(codes.redeem(b)).toBe(false);
  });
});
