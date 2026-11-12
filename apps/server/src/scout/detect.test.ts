import { describe, expect, it } from 'vitest';
import { isScoutRun } from './detect.ts';

describe('isScoutRun', () => {
  it('recognises the command, also after a cd or in a title', () => {
    expect(isScoutRun('Run somecode-scout "scan"', undefined)).toBe(true);
    expect(isScoutRun('Bash', { command: 'cd /app && somecode-scout "scan" --files a.ts' })).toBe(true);
  });
  it('ignores loading the skill and reading files that mention it', () => {
    expect(isScoutRun('Load skill: scout', { name: 'scout', content: 'Run somecode-scout "<task>"' })).toBe(false);
    expect(isScoutRun('cat', { command: 'cat SKILL.md # somecode-scout' })).toBe(false);
    expect(isScoutRun('Read somecode-scout.ts', { path: 'bin/somecode-scout.ts' })).toBe(false);
  });
});

describe('isScoutRun as a tool of its own', () => {
  it('recognises the scout tool of the MCP server by its name and task, not any call that has a task', () => {
    expect(isScoutRun('mcp__somecode__scout', { task: 'map the server', files: ['apps/server'] })).toBe(true);
    expect(isScoutRun('somecode - scout (MCP)', { task: 'x' })).toBe(true);
    expect(isScoutRun('Task: explore', { task: 'x' })).toBe(false);
    expect(isScoutRun('mcp__somecode__scout', { files: [] })).toBe(false);
  });
});
