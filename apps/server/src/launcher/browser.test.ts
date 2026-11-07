import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pickBrowserCommand } from './browser.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'somecode-browser-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function install(name: string, mode = 0o755, where = dir): void {
  mkdirSync(where, { recursive: true });
  const file = join(where, name);
  writeFileSync(file, '#!/bin/sh\n');
  chmodSync(file, mode);
}

describe('pickBrowserCommand', () => {
  it('uses the only installed browser in app mode', () => {
    install('google-chrome');
    expect(pickBrowserCommand('http://x', dir)).toEqual({
      command: 'google-chrome',
      args: ['--app=http://x'],
    });
  });

  it('prefers chromium over google-chrome', () => {
    install('google-chrome');
    install('chromium');
    expect(pickBrowserCommand('http://x', dir).command).toBe('chromium');
  });

  it('follows the documented search order', () => {
    install('microsoft-edge-stable');
    install('brave');
    expect(pickBrowserCommand('http://x', dir).command).toBe('brave');
    install('google-chrome-stable');
    expect(pickBrowserCommand('http://x', dir).command).toBe('google-chrome-stable');
    install('chromium-browser');
    expect(pickBrowserCommand('http://x', dir).command).toBe('chromium-browser');
  });

  it('falls back to xdg-open with the plain url when no browser is found', () => {
    expect(pickBrowserCommand('http://x', dir)).toEqual({ command: 'xdg-open', args: ['http://x'] });
    expect(pickBrowserCommand('http://x', '')).toEqual({ command: 'xdg-open', args: ['http://x'] });
  });

  it('ignores files without the execute bit', () => {
    install('chromium', 0o644);
    install('google-chrome');
    expect(pickBrowserCommand('http://x', dir).command).toBe('google-chrome');
  });

  it('ignores directories that carry a browser name', () => {
    mkdirSync(join(dir, 'chromium'));
    expect(pickBrowserCommand('http://x', dir).command).toBe('xdg-open');
  });

  it('searches every PATH entry, and browser preference beats PATH position', () => {
    const first = join(dir, 'first');
    const second = join(dir, 'second');
    install('brave', 0o755, first);
    install('google-chrome', 0o755, second);
    expect(pickBrowserCommand('http://x', [join(dir, 'missing'), first].join(delimiter)).command).toBe('brave');
    // google-chrome ranks above brave even though brave's directory comes first on PATH.
    expect(pickBrowserCommand('http://x', [first, second].join(delimiter)).command).toBe('google-chrome');
  });

  it('does not treat empty PATH entries as the current directory', () => {
    const original = process.cwd();
    install('chromium');
    process.chdir(dir);
    try {
      expect(pickBrowserCommand('http://x', '').command).toBe('xdg-open');
      expect(pickBrowserCommand('http://x', `${delimiter}${delimiter}`).command).toBe('xdg-open');
    } finally {
      process.chdir(original);
    }
  });
});
