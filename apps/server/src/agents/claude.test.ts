import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { binDirWith, cleanBinDirs } from '../../test-support/bin-dir.ts';
import { createClaudeDriver } from './claude.ts';

afterEach(cleanBinDirs);

/** A fake `claude` CLI: `--version` prints a version, `auth status --json` prints `authOutput`. */
const claudeScript = (authOutput: string) =>
  `case "$1" in\n  --version) echo "2.1.319 (Claude Code)" ;;\n  auth) printf '%s' '${authOutput}' ;;\nesac`;

describe('claude driver', () => {
  it('launches the bundled ACP adapter through node, resolved from the dependency (not PATH)', () => {
    const driver = createClaudeDriver({});
    expect(driver.id).toBe('claude');
    expect(driver.label).toBe('Claude');
    const launch = driver.launch();
    expect(launch.command).toBe(process.execPath);
    expect(launch.args).toHaveLength(1);
    expect(launch.args[0]).toMatch(/claude-agent-acp.*dist.index\.js$/);
    expect(existsSync(launch.args[0]!)).toBe(true);
  });

  it('asks for thinking summaries, since newer models send no thinking text otherwise, unless the user chose', () => {
    expect(createClaudeDriver({}).launch().env).toEqual({ CLAUDE_CODE_THINKING_DISPLAY: 'summarized' });
    expect(createClaudeDriver({ CLAUDE_CODE_THINKING_DISPLAY: 'omitted' }).launch().env).toEqual({ CLAUDE_CODE_THINKING_DISPLAY: 'omitted' });
  });

  it('reports installed, version and signed_in from `claude auth status --json`', async () => {
    const PATH = binDirWith('claude', claudeScript('{"loggedIn":true,"email":"someone@example.com","orgName":"Acme"}'));
    expect(await createClaudeDriver({ PATH }).detect()).toEqual({
      installed: true,
      version: '2.1.319 (Claude Code)',
      auth: 'signed_in',
      signInHint: 'claude auth login',
    });
  });

  it('reports signed_out when not logged in', async () => {
    const PATH = binDirWith('claude', claudeScript('{"loggedIn":false}'));
    expect((await createClaudeDriver({ PATH }).detect()).auth).toBe('signed_out');
  });

  it('keeps the agent installed with auth unknown when the status output is broken or the command fails', async () => {
    const broken = binDirWith('claude', claudeScript('not json at all'));
    expect(await createClaudeDriver({ PATH: broken }).detect()).toMatchObject({ installed: true, auth: 'unknown' });
    const failing = binDirWith('claude', 'case "$1" in --version) echo 2.0.0;; auth) exit 1;; esac');
    expect(await createClaudeDriver({ PATH: failing }).detect()).toMatchObject({ installed: true, auth: 'unknown' });
  });

  it('reports not installed with an install hint when `claude` is missing', async () => {
    const status = await createClaudeDriver({ PATH: '' }).detect();
    expect(status.installed).toBe(false);
    expect(status.installHint).toEqual(expect.stringContaining('claude'));
  });
});
