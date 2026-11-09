import { describe, expect, it } from 'vitest';
import { commonBinDirs, enrichedPath, useLoginPath } from './path.ts';

describe('enrichedPath', () => {
  it('appends the extra directories that exist and are new, keeping the order of the rest', () => {
    const found = new Set(['/home/u/.local/bin', '/opt/x']);
    expect(enrichedPath('/usr/bin:/bin', ['/home/u/.local/bin', '/usr/bin', '/missing', '/opt/x', ''], (d) => found.has(d) || d === '/usr/bin')).toBe('/usr/bin:/bin:/home/u/.local/bin:/opt/x');
  });

  it('lists the usual homes of agent CLIs', () => {
    expect(commonBinDirs('/home/u')).toContain('/home/u/.local/bin');
    expect(commonBinDirs('/home/u')).toContain('/home/u/.opencode/bin');
  });

  it('adds the places an agent lives to a bare PATH (no shell involved)', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', SHELL: '' };
    useLoginPath(env, '/nonexistent-home');
    expect(env.PATH?.startsWith('/usr/bin')).toBe(true);
  });
});
