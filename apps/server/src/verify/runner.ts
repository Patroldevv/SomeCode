import { spawn } from 'node:child_process';
import type { Check } from './config.ts';

export type CheckResult = { name: string; command: string; ok: boolean; exitCode: number | null; timedOut: boolean; output: string; ms: number };

const TAIL_CHARS = 3000;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

/** Runs one shell command in a folder; its output is kept only as far as its end (that is where errors are). */
export function runCheck(cwd: string, check: Check, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<CheckResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    let timedOut = false;
    const child = spawn('sh', ['-c', check.command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } });
    const keep = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > TAIL_CHARS * 4) output = output.slice(-TAIL_CHARS * 2);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    opts.signal?.addEventListener('abort', kill, { once: true });
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      // eslint-disable-next-line no-control-regex
      const clean = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
      resolve({ name: check.name, command: check.command, ok: exitCode === 0 && !timedOut, exitCode, timedOut, output: clean.length > TAIL_CHARS ? `…${clean.slice(-TAIL_CHARS)}` : clean, ms: Date.now() - started });
    };
    child.on('error', (err) => {
      output += `\n${err.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

/** The message that hands failed checks to the agent: what failed, the end of each output, and what to do. */
export function fixPrompt(results: readonly CheckResult[], round: number, max: number): string {
  const failed = results.filter((r) => !r.ok);
  const parts = failed.map((r) => `### ${r.name} (\`${r.command}\`) ${r.timedOut ? 'timed out' : `exit ${r.exitCode ?? '?'}`}\n\`\`\`\n${r.output.slice(-2500)}\n\`\`\``);
  return [
    `[SomeCode check] After your last change the project's checks failed (fix round ${round} of ${max}).`,
    ...parts,
    'Fix the cause in the code. Do not change a check, skip a test or loosen a rule to make it pass. Run the failing command yourself if you need to, and say briefly what was wrong.',
  ].join('\n\n');
}
