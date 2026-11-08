import { describe, expect, it } from 'vitest';
import { parseRateLimit, readLimits, recordRateLimit } from './limits.ts';

const memory = () => {
  const map = new Map<string, string>();
  return { getSetting: (k: string) => map.get(k) ?? null, setSetting: (k: string, v: string) => void map.set(k, v) };
};

describe('rate limits', () => {
  it('reads fractions and percentages, seconds and milliseconds', () => {
    expect(parseRateLimit({ rateLimitType: 'five_hour', utilization: 0.24, resetsAt: 1900000000, status: 'allowed' }, 5)).toEqual({ type: 'five_hour', used: 0.24, resetsAt: 1900000000000, status: 'allowed', updatedAt: 5 });
    expect(parseRateLimit({ rateLimitType: 'seven_day', utilization: 47, resetsAt: 1900100000000 }, 5)).toMatchObject({ used: 0.47, resetsAt: 1900100000000, status: 'allowed' });
  });

  it('ignores reports that name no window and reports without figures', () => {
    expect(parseRateLimit({ utilization: 0.5 })).toBeNull();
    expect(parseRateLimit('x')).toBeNull();
    expect(parseRateLimit({ rateLimitType: 'five_hour' })).toMatchObject({ used: null, resetsAt: null });
  });

  it('keeps the newest report per window, and keeps earlier figures a bare report lacks', () => {
    const store = memory();
    recordRateLimit(store, 'claude', { rateLimitType: 'five_hour', utilization: 0.2, resetsAt: 1900000000 }, 1);
    recordRateLimit(store, 'claude', { rateLimitType: 'seven_day', utilization: 0.5, resetsAt: 1900100000 }, 2);
    recordRateLimit(store, 'claude', { rateLimitType: 'five_hour', utilization: 0.3 }, 3);
    recordRateLimit(store, 'claude', { nope: 1 }, 4);
    const limits = readLimits(store, 'claude');
    expect(limits.map((l) => [l.type, l.used, l.resetsAt])).toEqual([['five_hour', 0.3, 1900000000000], ['seven_day', 0.5, 1900100000000]]);
    expect(readLimits(store, 'other')).toEqual([]);
  });
});
