import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataDir } from './config.ts';

describe('dataDir', () => {
  it('prefers SOMECODE_DATA_DIR', () => {
    expect(dataDir({ SOMECODE_DATA_DIR: '/data/sc', XDG_DATA_HOME: '/xdg' })).toBe('/data/sc');
  });

  it('falls back to $XDG_DATA_HOME/somecode, then ~/.local/share/somecode', () => {
    expect(dataDir({ XDG_DATA_HOME: '/xdg' })).toBe('/xdg/somecode');
    expect(dataDir({})).toBe(join(homedir(), '.local', 'share', 'somecode'));
    expect(dataDir({ XDG_DATA_HOME: '' })).toBe(join(homedir(), '.local', 'share', 'somecode'));
    // The XDG spec says relative values are invalid and must be ignored.
    expect(dataDir({ XDG_DATA_HOME: 'rel/xdg' })).toBe(join(homedir(), '.local', 'share', 'somecode'));
  });
});
