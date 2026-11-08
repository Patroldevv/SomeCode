import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDirs: string[] = [];

/** Temp dir holding an executable shell script named `name` with the given body. */
export function binDirWith(name: string, script: string): string {
  const dir = mkdtempSync(join(tmpdir(), `somecode-${name}-`));
  tempDirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return dir;
}

export function cleanBinDirs(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}
