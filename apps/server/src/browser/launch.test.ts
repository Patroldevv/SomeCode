import { describe, expect, it } from 'vitest';
import { findBrowser } from './launch.ts';

describe('findBrowser', () => {
  it('prefers a Chromium-family browser to Electron, and Electron to nothing', () => {
    const have = (...paths: string[]) => (p: string) => paths.includes(p);
    expect(findBrowser('/usr/bin:/opt/bin', have('/opt/bin/google-chrome', '/usr/bin/electron42'))).toEqual({ kind: 'chromium', command: '/opt/bin/google-chrome' });
    expect(findBrowser('/usr/bin', have('/usr/bin/electron42'))).toEqual({ kind: 'electron', command: '/usr/bin/electron42' });
    expect(findBrowser('/usr/bin', have())).toBeNull();
  });
});
