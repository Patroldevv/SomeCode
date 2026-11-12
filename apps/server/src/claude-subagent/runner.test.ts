import { describe, expect, it, vi } from 'vitest';
import { runClaudeSubagent, claudeToolTitle, mapClaudeToolKind } from './runner.ts';
import type { ClaudeToolCallEvent } from './types.ts';

describe('Claude Subagent Runner', () => {
  it('rejects empty tasks immediately', async () => {
    const result = await runClaudeSubagent({ task: '   ' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('invokes claude with model, effort, stream-json, verbose and dangerously-skip-permissions', async () => {
    const mockRun = vi.fn(async (_cmd: string, args: string[], _opts: unknown) => {
      expect(args).toContain('-p');
      expect(args).toContain('--output-format');
      expect(args).toContain('stream-json');
      expect(args).toContain('--verbose');
      expect(args).toContain('--dangerously-skip-permissions');
      expect(args).toContain('--model');
      expect(args).toContain('sonnet');
      expect(args).toContain('--effort');
      expect(args).toContain('high');
      return { ok: true, stdout: 'Deep code review completed successfully.', stderr: '' };
    });

    const result = await runClaudeSubagent(
      { task: 'review database transactions', cwd: '/tmp/test', model: 'sonnet', effort: 'high', files: ['src/db.ts'] },
      mockRun,
    );

    expect(result.ok).toBe(true);
    expect(result.model).toBe('sonnet');
    expect(result.output).toContain('Deep code review completed successfully.');
    expect(mockRun).toHaveBeenCalled();
    const promptArg = (mockRun.mock.calls[0] as [string, string[], unknown])[1][1] as string;
    expect(promptArg).toContain('src/db.ts');
  });

  it('handles claude execution failure cleanly', async () => {
    const mockRun = vi.fn(async () => {
      return { ok: false, stdout: '', stderr: 'claude: authentication expired' };
    });

    const result = await runClaudeSubagent(
      { task: 'review code' },
      mockRun,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('claude: authentication expired');
  });

  it('streams tool_use and tool_result events in real time', async () => {
    const events: ClaudeToolCallEvent[] = [];
    const chunks: string[] = [];

    const mockRun = vi.fn(async (_cmd: string, _args: string[], opts: { onStdoutLine?: (line: string) => void }) => {
      // 1. Tool use: Read
      opts.onStdoutLine?.(
        JSON.stringify({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Inspecting package.json...\n' },
              { type: 'tool_use', id: 'toolu_123', name: 'Read', input: { file_path: 'package.json' } },
            ],
          },
        }),
      );

      // 2. Tool result
      opts.onStdoutLine?.(
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_123', content: '{"name": "somecode"}' }],
          },
        }),
      );

      // 3. Final result
      opts.onStdoutLine?.(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: 'The package name is somecode.',
          duration_ms: 1200,
        }),
      );

      return { ok: true, stdout: '', stderr: '' };
    });

    const result = await runClaudeSubagent(
      {
        task: 'check package name',
        onToolCall: (ev) => events.push(ev),
        onTextChunk: (text) => chunks.push(text),
      },
      mockRun,
    );

    expect(result.ok).toBe(true);
    expect(result.output).toBe('The package name is somecode.');
    expect(chunks).toContain('Inspecting package.json...\n');
    expect(events).toHaveLength(2);

    expect(events[0]).toMatchObject({
      id: 'toolu_123',
      name: 'Read',
      title: 'read_file package.json',
      kind: 'read',
      status: 'in_progress',
    });

    expect(events[1]).toMatchObject({
      id: 'toolu_123',
      status: 'completed',
      content: [{ type: 'text', text: '{"name": "somecode"}' }],
    });
  });

  it('correctly maps tool titles and kinds', () => {
    expect(mapClaudeToolKind('Read')).toBe('read');
    expect(mapClaudeToolKind('View')).toBe('read');
    expect(mapClaudeToolKind('Edit')).toBe('edit');
    expect(mapClaudeToolKind('StrReplace')).toBe('edit');
    expect(mapClaudeToolKind('Grep')).toBe('search');
    expect(mapClaudeToolKind('Glob')).toBe('search');
    expect(mapClaudeToolKind('Bash')).toBe('execute');

    expect(claudeToolTitle('Read', { file_path: 'src/main.ts' })).toBe('read_file main.ts');
    expect(claudeToolTitle('Edit', { file_path: 'src/auth.ts' })).toBe('edit_file auth.ts');
    expect(claudeToolTitle('Grep', { pattern: 'tokenMatches' })).toBe('grep "tokenMatches"');
    expect(claudeToolTitle('Bash', { command: 'npm test' })).toBe('npm test');
  });
});
