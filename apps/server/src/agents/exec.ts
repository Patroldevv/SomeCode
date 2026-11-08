import { execFile } from 'node:child_process';

export const DETECT_TIMEOUT_MS = 5_000;

/**
 * Runs a command with a hard time limit. Spawn failure (ENOENT), a non-zero exit and a timeout all
 * resolve `{ ok: false }`; it never rejects, so one broken CLI cannot break agent detection.
 */
export function runBounded(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number = DETECT_TIMEOUT_MS,
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, env, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout ?? '') });
    });
  });
}

/** First non-empty trimmed line of `--version` style output. */
export function firstLine(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}
