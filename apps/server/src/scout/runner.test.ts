import { describe, expect, it, vi } from 'vitest';
import { cleanTerminalOutput, runScout } from './runner.ts';

describe('Scout Runner', () => {
  it('cleans ANSI terminal escape codes and spinner artifacts', () => {
    const raw = '\x1B[32m⠋ Fetching data...\x1B[0m\n\x1B[1mFound 3 matches:\x1B[0m\nfile.ts:10';
    const cleaned = cleanTerminalOutput(raw);
    expect(cleaned).toContain('Found 3 matches:');
    expect(cleaned).toContain('file.ts:10');
    expect(cleaned).not.toContain('\x1B');
    expect(cleaned).not.toContain('⠋');
  });

  it('rejects empty tasks immediately', async () => {
    const result = await runScout({ task: '   ' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('passes the effort to agy only when one is set', async () => {
    let seen: string[] = [];
    await runScout({ task: 'x', effort: 'high' }, async (_c, args) => { seen = args; return { ok: true, stdout: 'ok' }; });
    expect(seen).toEqual(expect.arrayContaining(['--effort', 'high']));
    await runScout({ task: 'x', effort: 'default' }, async (_c, args) => { seen = args; return { ok: true, stdout: 'ok' }; });
    expect(seen).not.toContain('--effort');
  });

  it('invokes agy with gemini-3.8-flash and plan mode', async () => {
    const mockRun = vi.fn(async (_cmd: string, args: string[], _opts: unknown) => {
      expect(args).toContain('--model');
      expect(args).toContain('gemini-3.8-flash');
      expect(args).toContain('--mode');
      expect(args).toContain('plan');
      expect(args).toContain('--dangerously-skip-permissions');
      return { ok: true, stdout: 'Here are the auth findings:\n- src/auth.ts line 20', stderr: '' };
    });

    const result = await runScout(
      { task: 'scan auth endpoints', cwd: '/tmp/test', files: ['src/auth.ts'] },
      mockRun,
    );

    expect(result.ok).toBe(true);
    expect(result.model).toBe('gemini-3.8-flash');
    expect(result.output).toContain('Here are the auth findings:');
    expect(mockRun).toHaveBeenCalled();
    const promptArg = (mockRun.mock.calls[0] as [string, string[], unknown])[1][1] as string;
    expect(promptArg).toContain('src/auth.ts');
  });

  it('handles agy execution failure cleanly', async () => {
    const mockRun = vi.fn(async () => {
      return { ok: false, stdout: '', stderr: 'agy: command not found' };
    });

    const result = await runScout(
      { task: 'scan auth endpoints' },
      mockRun,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('agy: command not found');
  });
});
