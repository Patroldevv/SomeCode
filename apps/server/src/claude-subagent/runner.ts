import { spawn } from 'node:child_process';
import path from 'node:path';
import { cleanTerminalOutput } from '../scout/runner.ts';
import type { ClaudeSubagentQuery, ClaudeSubagentResult, ClaudeToolCallEvent } from './types.ts';

export const DEFAULT_CLAUDE_SUBAGENT_MODEL = 'sonnet';
export const DEFAULT_CLAUDE_SUBAGENT_TIMEOUT_MS = 180_000;

export const CLAUDE_SUBAGENT_MARKER = 'You are a specialized Claude Subagent';

export type ClaudeRunOptions = {
  cwd: string;
  timeout: number;
  env?: NodeJS.ProcessEnv;
  onStdoutLine?: (line: string) => void;
};

export type ClaudeRunFn = (
  command: string,
  args: string[],
  options: ClaudeRunOptions,
) => Promise<{ ok: boolean; stdout: string; stderr?: string }>;

export const defaultClaudeExecRun: ClaudeRunFn = (command, args, options) =>
  new Promise((resolve) => {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let lineBuffer = '';

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let timer: NodeJS.Timeout | null = null;
    if (options.timeout > 0) {
      timer = setTimeout(() => {
        child.kill('SIGTERM');
      }, options.timeout);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdoutBuffer += text;
      lineBuffer += text;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? '';
      for (const line of lines) {
        options.onStdoutLine?.(line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, stdout: stdoutBuffer, stderr: err.message });
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (lineBuffer.trim()) {
        options.onStdoutLine?.(lineBuffer);
      }
      resolve({
        ok: code === 0,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
      });
    });
  });

export function mapClaudeToolKind(name: string): 'read' | 'edit' | 'execute' | 'search' | 'think' | 'other' {
  const n = name.toLowerCase();
  if (n.includes('read') || n === 'view' || n === 'cat') return 'read';
  if (n.includes('edit') || n.includes('write') || n.includes('patch') || n.includes('strreplace')) return 'edit';
  if (n.includes('command') || n.includes('exec') || n.includes('bash') || n.includes('terminal')) return 'execute';
  if (n.includes('search') || n.includes('grep') || n.includes('find') || n.includes('glob')) return 'search';
  if (n.includes('think')) return 'think';
  return 'other';
}

export function claudeToolTitle(name: string, input?: Record<string, unknown>): string {
  if (!input) return name;
  const file = input['file_path'] || input['filePath'] || input['path'] || input['file'];
  if (typeof file === 'string' && file.trim()) {
    const base = path.basename(file.trim()) || file.trim();
    const n = name.toLowerCase();
    if (n.includes('read') || n === 'view') return `read_file ${base}`;
    if (n.includes('edit') || n.includes('write') || n.includes('strreplace')) return `edit_file ${base}`;
    return `${name} ${base}`;
  }
  const pattern = input['pattern'];
  if (typeof pattern === 'string' && pattern.trim()) {
    const n = name.toLowerCase();
    if (n.includes('grep')) return `grep "${pattern.trim()}"`;
    if (n.includes('glob')) return `glob "${pattern.trim()}"`;
    return `${name} "${pattern.trim()}"`;
  }
  const cmd = input['command'] || input['cmd'];
  if (typeof cmd === 'string' && cmd.trim()) {
    const trimmed = cmd.trim();
    return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
  }
  return name;
}

/**
 * Runs a deep reasoning, review, or specialized coding task using Claude Code via the `claude` CLI.
 */
export async function runClaudeSubagent(
  query: ClaudeSubagentQuery,
  run: ClaudeRunFn = defaultClaudeExecRun,
): Promise<ClaudeSubagentResult> {
  const task = query.task?.trim();
  const model = query.model || DEFAULT_CLAUDE_SUBAGENT_MODEL;
  const timeoutMs = query.timeoutMs ?? DEFAULT_CLAUDE_SUBAGENT_TIMEOUT_MS;
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

  const targetFiles = query.files && query.files.length > 0
    ? ['\nTarget files to read and analyze:', ...query.files.map((f) => `- ${f}`)]
    : [];

  const prompt = [
    `${CLAUDE_SUBAGENT_MARKER} (powered by Claude Sonnet) assisting a primary agent.`,
    'Goal: Provide deep architectural analysis, code reasoning, refactoring, or specialized logic verification.',
    'Be structured, rigorous, and cite exact files and line numbers (file:line).',
    ...targetFiles,
    '',
    `Task: ${task}`,
  ].join('\n');

  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];
  if (model && model !== 'default') {
    args.push('--model', model);
  }
  if (query.effort && query.effort !== 'default') {
    args.push('--effort', query.effort);
  }

  let finalResult: string | null = null;
  let accumulatedText = '';
  const parsedLines = new Set<string>();

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{') || parsedLines.has(trimmed)) return;
    parsedLines.add(trimmed);

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const data = parsed as Record<string, unknown>;
    const type = data['type'];

    if (type === 'assistant' && typeof data['message'] === 'object' && data['message'] !== null) {
      const msg = data['message'] as Record<string, unknown>;
      const content = Array.isArray(msg['content']) ? msg['content'] : [];
      for (const item of content) {
        if (typeof item !== 'object' || item === null) continue;
        const it = item as Record<string, unknown>;
        if (it['type'] === 'tool_use') {
          const id = String(it['id'] || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
          const name = String(it['name'] || 'tool');
          const input = (typeof it['input'] === 'object' && it['input'] !== null) ? it['input'] as Record<string, unknown> : {};
          query.onToolCall?.({
            id,
            name,
            title: claudeToolTitle(name, input),
            kind: mapClaudeToolKind(name),
            status: 'in_progress',
            rawInput: input,
          });
        } else if (it['type'] === 'text' && typeof it['text'] === 'string') {
          accumulatedText += it['text'];
          query.onTextChunk?.(it['text']);
        }
      }
    } else if (type === 'user' && typeof data['message'] === 'object' && data['message'] !== null) {
      const msg = data['message'] as Record<string, unknown>;
      const content = Array.isArray(msg['content']) ? msg['content'] : [];
      for (const item of content) {
        if (typeof item !== 'object' || item === null) continue;
        const it = item as Record<string, unknown>;
        if (it['type'] === 'tool_result') {
          const id = String(it['tool_use_id'] || '');
          if (id) {
            const resContent = typeof it['content'] === 'string' ? [{ type: 'text' as const, text: it['content'] }] : undefined;
            query.onToolCall?.({
              id,
              name: '',
              title: '',
              kind: 'other',
              status: 'completed',
              content: resContent,
            });
          }
        }
      }
    } else if (type === 'result') {
      if (typeof data['result'] === 'string' && data['result'].trim()) {
        finalResult = data['result'];
      }
    }
  };

  try {
    const res = await run('claude', args, {
      cwd,
      timeout: timeoutMs,
      env: { SOMECODE_INSIDE_SUBAGENT: '1' },
      onStdoutLine: processLine,
    });
    const durationMs = Date.now() - startedAt;

    // In case any lines were buffered or not sent through onStdoutLine in test mocks:
    for (const line of res.stdout.split('\n')) {
      processLine(line);
    }

    const outputText = finalResult ?? (accumulatedText.trim() ? accumulatedText : res.stdout);
    const cleaned = cleanTerminalOutput(outputText);

    if (!res.ok) {
      const err = res.stderr?.trim() || 'Claude subagent run failed';
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
