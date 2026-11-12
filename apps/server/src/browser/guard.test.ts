import { describe, expect, it } from 'vitest';
import { parseBrowserMode, requestAllowed, urlAllowed } from './guard.ts';

describe('browser guard', () => {
  it('opens only this computer in local mode, anything http(s) in any mode, nothing when off', () => {
    expect(urlAllowed('http://localhost:5173/x', 'local')).toMatchObject({ ok: true });
    expect(urlAllowed('http://127.0.0.1:8080', 'local')).toMatchObject({ ok: true });
    expect(urlAllowed('http://[::1]:3000', 'local')).toMatchObject({ ok: true });
    expect(urlAllowed('http://app.localhost', 'local')).toMatchObject({ ok: true });
    expect(urlAllowed('https://example.com', 'local')).toMatchObject({ ok: false });
    expect(urlAllowed('http://localhost.evil.com', 'local')).toMatchObject({ ok: false });
    expect(urlAllowed('https://example.com', 'any')).toMatchObject({ ok: true });
    expect(urlAllowed('http://localhost', 'off')).toMatchObject({ ok: false });
  });
  it('refuses file:, javascript: and non-addresses in every mode', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://gpu', 'nonsense']) {
      expect(urlAllowed(bad, 'any')).toMatchObject({ ok: false });
    }
  });
  it('limits what a page loads the same way, but lets inline data through', () => {
    expect(requestAllowed('http://localhost:3000/app.js', 'local')).toBe(true);
    expect(requestAllowed('https://cdn.example.com/x.js', 'local')).toBe(false);
    expect(requestAllowed('data:image/png;base64,AAAA', 'local')).toBe(true);
    expect(requestAllowed('https://cdn.example.com/x.js', 'any')).toBe(true);
  });
  it('treats anything unknown as off', () => {
    expect(parseBrowserMode(undefined)).toBe('off');
    expect(parseBrowserMode('local')).toBe('local');
    expect(parseBrowserMode('everything')).toBe('off');
  });
});
