import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createOpenCodeDriver } from './opencode.ts';

it('shows the supported auth login command for an installed OpenCode CLI', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'somecode-opencode-hint-'));
  try {
    await writeFile(join(bin, 'opencode'), '#!/bin/sh\nprintf "1.0.0\\n"\n', { mode: 0o755 });
    const status = await createOpenCodeDriver({ ...process.env, PATH: bin }).detect();
    expect(status.installed).toBe(true);
    expect(status.signInHint).toBe('opencode auth login');
  } finally { await rm(bin, { recursive: true, force: true }); }
});
