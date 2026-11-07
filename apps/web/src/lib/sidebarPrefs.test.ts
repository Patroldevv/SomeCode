import { describe, expect, it } from 'vitest';
import type { StorageLike } from './activeSession.ts';
import { loadSidebarOpen, saveSidebarOpen } from './sidebarPrefs.ts';

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing = (): StorageLike => {
  throw new Error('SecurityError: storage blocked');
};

describe('sidebarPrefs', () => {
  it('defaults to open', () => {
    const s = memory();
    expect(loadSidebarOpen(() => s)).toBe(true);
  });

  it('reads back a saved value', () => {
    const s = memory();
    saveSidebarOpen(false, () => s);
    expect(loadSidebarOpen(() => s)).toBe(false);
    saveSidebarOpen(true, () => s);
    expect(loadSidebarOpen(() => s)).toBe(true);
  });

  it('treats an unknown stored value as the default', () => {
    const s = memory();
    s.setItem('somecode.sidebarOpen', 'garbage');
    expect(loadSidebarOpen(() => s)).toBe(true);
  });

  it('returns the default when storage throws, and saving is a silent no-op', () => {
    expect(loadSidebarOpen(throwing)).toBe(true);
    expect(() => saveSidebarOpen(false, throwing)).not.toThrow();
    const failingWrite: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(loadSidebarOpen(() => failingWrite)).toBe(true);
    expect(() => saveSidebarOpen(false, () => failingWrite)).not.toThrow();
  });
});
