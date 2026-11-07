import { describe, expect, it } from 'vitest';
import { clearActiveSession, loadActiveSession, saveActiveSession, type StorageLike } from './activeSession.ts';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('active session persistence', () => {
  it('saves, loads and clears the active session id', () => {
    const storage = memoryStorage();
    const get = () => storage;
    expect(loadActiveSession(get)).toBeNull();
    saveActiveSession('s-1', get);
    expect(loadActiveSession(get)).toBe('s-1');
    saveActiveSession('s-2', get);
    expect(loadActiveSession(get)).toBe('s-2');
    clearActiveSession(get);
    expect(loadActiveSession(get)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('treats an empty stored value as no session', () => {
    const storage = memoryStorage();
    storage.data.set('somecode.activeSession', '');
    expect(loadActiveSession(() => storage)).toBeNull();
  });

  it('never throws when storage is unavailable or its methods throw', () => {
    const unavailable = () => {
      throw new Error('sessionStorage is not available');
    };
    for (const get of [() => throwing, unavailable]) {
      expect(loadActiveSession(get)).toBeNull();
      expect(() => saveActiveSession('s-1', get)).not.toThrow();
      expect(() => clearActiveSession(get)).not.toThrow();
    }
  });
});
