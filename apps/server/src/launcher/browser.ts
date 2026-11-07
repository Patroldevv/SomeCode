import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Chromium-family browsers that can open an `--app=` window, in order of preference. */
const BROWSERS = [
  'chromium',
  'chromium-browser',
  'google-chrome-stable',
  'google-chrome',
  'brave',
  'microsoft-edge-stable',
];

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(name: string, dirs: string[]): boolean {
  return dirs.some((dir) => isExecutableFile(join(dir, name)));
}

/**
 * Picks how to open `url`: a Chromium-family browser in app mode if one is on `pathEnv`,
 * else `xdg-open`. The only side effect is probing the file system; the command is returned
 * as a bare name (it is resolved through PATH again when spawned).
 */
export function pickBrowserCommand(url: string, pathEnv: string): { command: string; args: string[] } {
  // An empty entry means "the current directory" to a shell; never search there.
  const dirs = pathEnv.split(delimiter).filter((dir) => dir !== '');
  for (const name of BROWSERS) {
    if (onPath(name, dirs)) return { command: name, args: [`--app=${url}`] };
  }
  return { command: 'xdg-open', args: [url] };
}
