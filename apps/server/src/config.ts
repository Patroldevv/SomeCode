import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * Where SomeCode keeps its data: `$SOMECODE_DATA_DIR`, else `$XDG_DATA_HOME/somecode`, else
 * `~/.local/share/somecode`. Only computes the path; creating it is the launcher's job.
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SOMECODE_DATA_DIR) return env.SOMECODE_DATA_DIR;
  const xdg = env.XDG_DATA_HOME;
  // Per the XDG Base Directory spec, relative paths are invalid and must be ignored.
  const base = xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.local', 'share');
  return join(base, 'somecode');
}
