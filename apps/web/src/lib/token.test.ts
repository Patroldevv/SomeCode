import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadToken } from './token.ts';

/** A minimal browser for node: location (hash/path/search), history.replaceState and sessionStorage. */
function browser(url: string, stored: Record<string, string> = {}) {
  const u = new URL(url);
  const location = { hash: u.hash, pathname: u.pathname, search: u.search };
  const replaceState = vi.fn((_state: unknown, _title: string, next: string) => {
    const n = new URL(next, u.origin);
    Object.assign(location, { hash: n.hash, pathname: n.pathname, search: n.search });
  });
  const storage = new Map(Object.entries(stored));
  vi.stubGlobal('location', location);
  vi.stubGlobal('history', { replaceState });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  });
  return { location, replaceState, storage };
}

afterEach(() => vi.unstubAllGlobals());

describe('loadToken', () => {
  it('takes the hash token, stores it for the tab and strips it from the address bar', () => {
    const b = browser('http://127.0.0.1:5174/app?x=1#token=abc');
    expect(loadToken()).toBe('abc');
    expect(b.storage.get('somecode.token')).toBe('abc');
    expect(b.replaceState).toHaveBeenCalledExactlyOnceWith(null, '', '/app?x=1');
    expect(b.location.hash).toBe('');
  });

  it('falls back to the stored token on reload (no hash)', () => {
    const b = browser('http://127.0.0.1:5174/', { 'somecode.token': 'kept' });
    expect(loadToken()).toBe('kept');
    expect(b.replaceState).not.toHaveBeenCalled();
  });

  it('without either it returns null', () => {
    browser('http://127.0.0.1:5174/#other=1');
    expect(loadToken()).toBeNull();
  });
});
