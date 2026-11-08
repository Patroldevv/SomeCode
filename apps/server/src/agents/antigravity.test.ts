import { afterEach, describe, expect, it } from 'vitest';
import { binDirWith, cleanBinDirs } from '../../test-support/bin-dir.ts';
import { createAntigravityDriver } from './antigravity.ts';

afterEach(cleanBinDirs);

describe('antigravity driver', () => {
  it('launches `agy acp` and never a permission-skipping flag', () => {
    const driver = createAntigravityDriver({});
    expect(driver.id).toBe('agy');
    expect(driver.label).toBe('Antigravity');
    expect(driver.launch()).toEqual({ command: 'agy', args: ['acp'] });
  });

  it('reads the version and reports auth as unknown (there is no status command)', async () => {
    const PATH = binDirWith('agy', 'echo 1.5.3');
    expect(await createAntigravityDriver({ PATH }).detect()).toMatchObject({
      installed: true,
      version: '1.5.3',
      auth: 'unknown',
    });
  });

  it('reports not installed when `agy` is missing', async () => {
    expect((await createAntigravityDriver({ PATH: '' }).detect()).installed).toBe(false);
  });
});
