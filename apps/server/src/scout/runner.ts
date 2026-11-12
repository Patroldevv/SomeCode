import { execFile } from 'node:child_process';
import { SCOUT_MARKER } from './detect.ts';
import type { ScoutQuery, ScoutResult } from './types.ts';

export const DEFAULT_SCOUT_MODEL = 'gemini-3.8-flash';
export const DEFAULT_SCOUT_TIMEOUT_MS = 180_000;

export type ScoutRunFn = (
  command: string,
  args: string[],
  options: { cwd: string; timeout: number; env?: NodeJS.ProcessEnv },
) => Promise<{ ok: boolean; stdout: string; stderr?: string }>;

export const defaultExecRun: ScoutRunFn = (command, args, options) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout,
        env: { ...process.env, ...options.env },
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      },
    );
  });

/** Strips terminal color codes, OSC sequences and cursor movement artifacts. */
export function cleanTerminalOutput(raw: string): string {
  return raw
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/[\u2800-\u28FF]/g, '') // remove braille spinner chars
    .replace(/\r\n/g, '\n')
    .replace(/\r+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Runs a rapid reconnaissance or analysis task using Gemini 3.8 Flash via the `agy` CLI in plan mode.
 * Safe and read-only: plan mode prevents destructive file changes or unsolicited command execution.
 */
export async function runScout(
  query: ScoutQuery,
  run: ScoutRunFn = defaultExecRun,
): Promise<ScoutResult> {
  const task = query.task?.trim();
  const model = query.model || DEFAULT_SCOUT_MODEL;
  const timeoutMs = query.timeoutMs ?? DEFAULT_SCOUT_TIMEOUT_MS;
  const cwd = query.cwd || process.cwd();
  const startedAt = Date.now();

  if (process.env.SOMECODE_INSIDE_SUBAGENT === '1') {
    return {
      ok: false,
      output: '',
      model,
      durationMs: 0,
      error: 'Recursive subagent invocation is disabled',
    };
  }

  if (!task) {
    return {
      ok: false,
      output: '',
      model,
      durationMs: 0,
      error: 'Task description must not be empty',
    };
  }

  // Prepend scout instruction: explore, summarize, be concise for the primary agent.
  const targetFiles = query.files && query.files.length > 0
    ? ['\nTarget files to read and analyze:', ...query.files.map((f) => `- ${f}`)]
    : [];

  const scoutPrompt = [
    `${SCOUT_MARKER} (powered by Gemini 3.8 Flash) assisting a primary agent (Claude).`,
    'Goal: Explore, analyze or inspect files in this workspace and return a concise, structured factual summary.',
    'Do NOT edit files or run destructive commands. Be direct, structured, and cite exact files and line numbers (file:line).',
    ...targetFiles,
    '',
    `Task: ${task}`,
  ].join('\n');

  const args = [
    '--print',
    scoutPrompt,
    '--model',
    model,
    '--mode',
    'plan',
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
    ...(query.effort && query.effort !== 'default' ? ['--effort', query.effort] : []),
  ];

  try {
    const res = await run('agy', args, { cwd, timeout: timeoutMs, env: { SOMECODE_INSIDE_SUBAGENT: '1' } });
    const durationMs = Date.now() - startedAt;
    const cleaned = cleanTerminalOutput(res.stdout);

    if (!res.ok) {
      const err = res.stderr?.trim() || 'Scout run failed';
      return {
        ok: false,
        output: cleaned,
        model,
        durationMs,
        error: err,
      };
    }

    return {
      ok: true,
      output: cleaned,
      model,
      durationMs,
    };
  } catch (err) {
    return {
      ok: false,
      output: '',
      model,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
