import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenCodeDriver, openCodeDriver } from './opencode.ts';
import { createRegistry } from './registry.ts';
import type { AgentDriver } from './types.ts';

const tempDirs: string[] = [];

/** Temp dir holding an executable `opencode` shell script with the given body. */
function binDirWith(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'somecode-opencode-'));
  tempDirs.push(dir);
  const file = join(dir, 'opencode');
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stubDriver(id: string, installed: boolean, version?: string): AgentDriver {
  return {
    id,
    label: id.toUpperCase(),
    launch: () => ({ command: id, args: [] }),
    detect: async () => (version === undefined ? { installed } : { installed, version }),
  };
}

describe('openCodeDriver', () => {
  it('launches `opencode acp`', () => {
    expect(openCodeDriver.id).toBe('opencode');
    expect(openCodeDriver.label).toBe('OpenCode');
    expect(openCodeDriver.launch()).toEqual({ command: 'opencode', args: ['acp'] });
  });

  it('detects the installed version from --version output', async () => {
    const driver = createOpenCodeDriver({ PATH: binDirWith('echo "1.2.3"') });
    expect(await driver.detect()).toEqual({ installed: true, version: '1.2.3', auth: 'unknown', signInHint: 'opencode acp --login' });
  });

  it('uses the first non-empty line of output as the version', async () => {
    const driver = createOpenCodeDriver({ PATH: binDirWith('printf "\\n  v2.0.1  \\nextra\\n"') });
    expect(await driver.detect()).toEqual({ installed: true, version: 'v2.0.1', auth: 'unknown', signInHint: 'opencode acp --login' });
  });

  it('reports installed without a version when output is empty', async () => {
    const driver = createOpenCodeDriver({ PATH: binDirWith('exit 0') });
    expect(await driver.detect()).toEqual({ installed: true, auth: 'unknown', signInHint: 'opencode acp --login' });
  });

  it('reports not installed when the command exits non-zero', async () => {
    const driver = createOpenCodeDriver({ PATH: binDirWith('exit 3') });
    expect(await driver.detect()).toEqual({ installed: false });
  });

  it('reports not installed when PATH is empty', async () => {
    const driver = createOpenCodeDriver({ PATH: '' });
    expect(await driver.detect()).toEqual({ installed: false });
  });
});

describe('createRegistry', () => {
  it('returns undefined for an unknown driver id', () => {
    const registry = createRegistry([stubDriver('a', true)]);
    expect(registry.get('yok')).toBeUndefined();
  });

  it('lists and looks up drivers in order', () => {
    const a = stubDriver('a', true);
    const b = stubDriver('b', false);
    const registry = createRegistry([a, b]);
    expect(registry.list()).toEqual([a, b]);
    expect(registry.get('b')).toBe(b);
  });

  it('returns one status per driver in driver order', async () => {
    const registry = createRegistry([stubDriver('a', true, '1.0.0'), stubDriver('b', false)]);
    expect(await registry.statuses()).toEqual([
      { id: 'a', label: 'A', installed: true, version: '1.0.0' },
      { id: 'b', label: 'B', installed: false },
    ]);
  });

  it('throws on duplicate driver ids', () => {
    expect(() => createRegistry([stubDriver('a', true), stubDriver('a', false)])).toThrow(/duplicate/i);
  });
});

describe('registry statuses resilience', () => {
  it('returns every driver even when one detect() rejects', async () => {
    const bad: AgentDriver = { ...stubDriver('bad', true), detect: async () => Promise.reject(new Error('boom')) };
    const registry = createRegistry([stubDriver('a', true, '1'), bad]);
    expect(await registry.statuses()).toEqual([
      { id: 'a', label: 'A', installed: true, version: '1' },
      { id: 'bad', label: 'BAD', installed: false },
    ]);
  });
});
