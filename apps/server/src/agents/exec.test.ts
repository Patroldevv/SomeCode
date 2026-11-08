import { afterEach, describe, expect, it } from 'vitest';
import { binDirWith, cleanBinDirs } from '../../test-support/bin-dir.ts';
import { runBounded } from './exec.ts';

afterEach(cleanBinDirs);

describe('runBounded', () => {
  it('returns stdout of a successful command', async () => {
    const PATH = binDirWith('tool', 'echo hello');
    expect(await runBounded('tool', [], { PATH }, 2000)).toEqual({ ok: true, stdout: 'hello\n' });
  });

  it('reports failure for a non-zero exit, a missing command and a timeout, without throwing', async () => {
    const failing = binDirWith('tool', 'exit 3');
    expect((await runBounded('tool', [], { PATH: failing }, 2000)).ok).toBe(false);
    expect((await runBounded('tool', [], { PATH: '' }, 2000)).ok).toBe(false);
    const slow = binDirWith('tool', 'sleep 5');
    const t0 = Date.now();
    expect((await runBounded('tool', [], { PATH: slow }, 200)).ok).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2500);
  });
});
