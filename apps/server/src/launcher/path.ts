import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Some Linux desktop shells (e.g. Quickshell) start apps with `RLIMIT_RTTIME = 0` (`Max realtime timeout = 0 us`)
 * while leaving `RLIMIT_RTPRIO = 99`. Any child (such as Electron's renderer audio thread) that then enters `SCHED_RR`
 * is sent `SIGKILL` (exit 9) by the kernel on its first microsecond of CPU time. Dropping `rtprio` to 0 keeps all
 * threads on normal scheduling so the kernel never kills them.
 */
export function sanitizeRealtimeLimit(): void {
  if (process.platform !== 'linux') return;
  try {
    const limits = readFileSync('/proc/self/limits', 'utf8');
    if (/^Max realtime timeout\s+0\s+/m.test(limits)) {
      execFileSync('prlimit', ['--rtprio=0', `--pid=${process.pid}`], { stdio: 'ignore' });
    }
  } catch {
    // Best effort: if /proc or prlimit is unavailable, continue normally.
  }
}

/** Where agent CLIs usually put themselves; checked even when the PATH we were started with misses them. */
export function commonBinDirs(home: string): string[] {
  return [
    join(home, '.local/bin'),
    join(home, '.opencode/bin'),
    join(home, '.antigravity/bin'),
    join(home, '.npm-global/bin'),
    join(home, '.bun/bin'),
    join(home, '.cargo/bin'),
    join(home, '.volta/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/home/linuxbrew/.linuxbrew/bin',
    '/snap/bin',
  ];
}

/** The PATH the user's login shell has (what a terminal would see), or '' when it cannot be asked. */
export function loginShellPath(shell: string | undefined = process.env.SHELL): string {
  if (!shell || !shell.startsWith('/')) return '';
  try {
    return execFileSync(shell, ['-lc', 'printenv PATH'], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop() ?? '';
  } catch {
    return '';
  }
}

/** `current` followed by every directory of the login shell and the usual places that exists and is not in it yet. */
export function enrichedPath(current: string, extra: string[], exists: (dir: string) => boolean = existsSync): string {
  const parts = current.split(delimiter).filter(Boolean);
  for (const dir of extra) if (dir && !parts.includes(dir) && exists(dir)) parts.push(dir);
  return parts.join(delimiter);
}

/**
 * An app started from the application menu gets a bare PATH, so agent CLIs installed under the home folder
 * (agy, claude, opencode) would look missing. Called once at start.
 */
export function useLoginPath(env: NodeJS.ProcessEnv = process.env, home: string = env.HOME ?? ''): void {
  sanitizeRealtimeLimit();
  env.PATH = enrichedPath(env.PATH ?? '', [...loginShellPath(env.SHELL).split(delimiter), ...(home ? commonBinDirs(home) : [])]);
}
