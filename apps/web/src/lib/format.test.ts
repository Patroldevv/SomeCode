import { describe, expect, it } from 'vitest';
import { formatDuration, prettyValue, truncateOutput } from './format.ts';

describe('formatDuration', () => {
  it('rounds to whole seconds', () => {
    expect(formatDuration(6000)).toBe('6');
    expect(formatDuration(6499)).toBe('6');
    expect(formatDuration(6500)).toBe('7');
  });

  it('never shows less than 1 second', () => {
    expect(formatDuration(400)).toBe('1');
    expect(formatDuration(0)).toBe('1');
    expect(formatDuration(-50)).toBe('1');
  });
});

describe('truncateOutput', () => {
  it('keeps the first 20 000 characters and reports how many were hidden', () => {
    const out = truncateOutput('a'.repeat(30_000));
    expect(out.text).toHaveLength(20_000);
    expect(out.hiddenChars).toBe(10_000);
  });

  it('leaves short text alone', () => {
    expect(truncateOutput('hello')).toEqual({ text: 'hello', hiddenChars: 0 });
    expect(truncateOutput('abcdef', 6)).toEqual({ text: 'abcdef', hiddenChars: 0 });
  });

  it('honours a custom limit', () => {
    expect(truncateOutput('abcdef', 4)).toEqual({ text: 'abcd', hiddenChars: 2 });
  });
});

describe('prettyValue', () => {
  it('shows strings as they are and everything else as indented JSON', () => {
    expect(prettyValue('ls -la')).toBe('ls -la');
    expect(prettyValue({ command: 'ls' })).toBe('{\n  "command": "ls"\n}');
    expect(prettyValue(3)).toBe('3');
  });

  it('never throws on values JSON cannot encode', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(typeof prettyValue(cyclic)).toBe('string');
    expect(prettyValue(undefined)).toBe('undefined');
  });
});
