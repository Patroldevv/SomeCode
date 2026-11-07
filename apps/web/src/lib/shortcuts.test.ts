import { describe, expect, it } from 'vitest';
import { matchesShortcut } from './shortcuts.ts';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});

describe('matchesShortcut', () => {
  it('matches ctrl+b with Ctrl+B', () => {
    expect(matchesShortcut(key('b', { ctrlKey: true }), 'ctrl+b')).toBe(true);
  });

  it('also matches ctrl+b with Meta+B (macOS Command)', () => {
    expect(matchesShortcut(key('b', { metaKey: true }), 'ctrl+b')).toBe(true);
  });

  it('is case-insensitive on the key (Caps Lock)', () => {
    expect(matchesShortcut(key('B', { ctrlKey: true }), 'ctrl+b')).toBe(true);
    expect(matchesShortcut(key('b', { ctrlKey: true }), 'Ctrl+B')).toBe(true);
  });

  it('rejects extra modifiers', () => {
    expect(matchesShortcut(key('B', { ctrlKey: true, shiftKey: true }), 'ctrl+b')).toBe(false);
    expect(matchesShortcut(key('b', { ctrlKey: true, altKey: true }), 'ctrl+b')).toBe(false);
  });

  it('rejects a missing modifier or another key', () => {
    expect(matchesShortcut(key('b'), 'ctrl+b')).toBe(false);
    expect(matchesShortcut(key('j', { ctrlKey: true }), 'ctrl+b')).toBe(false);
  });

  it('matches a combo that asks for shift only with shift', () => {
    expect(matchesShortcut(key('B', { ctrlKey: true, shiftKey: true }), 'ctrl+shift+b')).toBe(true);
    expect(matchesShortcut(key('b', { ctrlKey: true }), 'ctrl+shift+b')).toBe(false);
  });

  it('a combo without ctrl rejects Ctrl and Meta', () => {
    expect(matchesShortcut(key('Escape'), 'escape')).toBe(true);
    expect(matchesShortcut(key('Escape', { metaKey: true }), 'escape')).toBe(false);
  });
});
