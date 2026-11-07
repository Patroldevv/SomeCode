import { describe, expect, it } from 'vitest';
import { isNearBottom } from './scroll.ts';

describe('isNearBottom', () => {
  it('is true at (or past) the bottom', () => {
    expect(isNearBottom({ scrollTop: 920, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
  });

  it('is false well above the bottom', () => {
    expect(isNearBottom({ scrollTop: 500, clientHeight: 100, scrollHeight: 1000 })).toBe(false);
  });

  it('is true exactly at the threshold and false just past it', () => {
    expect(isNearBottom({ scrollTop: 820, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
    expect(isNearBottom({ scrollTop: 819, clientHeight: 100, scrollHeight: 1000 })).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(isNearBottom({ scrollTop: 880, clientHeight: 100, scrollHeight: 1000 }, 10)).toBe(false);
    expect(isNearBottom({ scrollTop: 890, clientHeight: 100, scrollHeight: 1000 }, 10)).toBe(true);
  });

  it('is true for a list shorter than its container', () => {
    expect(isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(true);
    expect(isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 }, 0)).toBe(true);
  });
});
