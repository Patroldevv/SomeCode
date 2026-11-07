import { describe, expect, it } from 'vitest';
import { MAX_DIFF_LINES, diffLines, diffStats } from './diffView.ts';

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';

describe('diffStats', () => {
  it('counts every line of a new file (oldText: null) as added', () => {
    expect(diffStats(null, 'a\nb\nc\n')).toEqual({ added: 3, removed: 0 });
  });

  it('is {0,0} for identical text', () => {
    expect(diffStats('a\nb\n', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
  });

  it('counts a one-line change as one added and one removed', () => {
    expect(diffStats(lines(10), lines(10).replace('line 5\n', 'LINE 5\n'))).toEqual({ added: 1, removed: 1 });
  });

  it('counts a missing final newline as a changed last line', () => {
    expect(diffStats('a\nb', 'a\nb\n')).toEqual({ added: 1, removed: 1 });
  });

  it('is {0,0} for an empty new file', () => {
    expect(diffStats(null, '')).toEqual({ added: 0, removed: 0 });
  });
});

describe('diffLines', () => {
  it('marks every line of a new file as an addition', () => {
    expect(diffLines(null, 'a\nb\n')).toEqual([
      { type: 'add', text: 'a' },
      { type: 'add', text: 'b' },
    ]);
  });

  it('is empty for identical text', () => {
    expect(diffLines('a\nb\n', 'a\nb\n')).toEqual([]);
  });

  it('shows a one-line change with at most 3 context lines around it and gaps for the rest', () => {
    const out = diffLines(lines(20), lines(20).replace('line 10\n', 'LINE 10\n'));
    expect(out).toEqual([
      { type: 'gap', text: '' },
      { type: 'context', text: 'line 7' },
      { type: 'context', text: 'line 8' },
      { type: 'context', text: 'line 9' },
      { type: 'del', text: 'line 10' },
      { type: 'add', text: 'LINE 10' },
      { type: 'context', text: 'line 11' },
      { type: 'context', text: 'line 12' },
      { type: 'context', text: 'line 13' },
      { type: 'gap', text: '' },
    ]);
  });

  it('honours a custom context size and keeps short unchanged runs between hunks', () => {
    const changed = lines(8).replace('line 2\n', 'X\n').replace('line 6\n', 'Y\n');
    const out = diffLines(lines(8), changed, 1);
    expect(out.map((l) => l.type)).toEqual(['context', 'del', 'add', 'context', 'gap', 'context', 'del', 'add', 'context', 'gap']);
    // An unchanged run of <= 2 × context between two changes is kept whole: no gap.
    expect(diffLines(lines(5), lines(5).replace('line 2\n', 'X\n').replace('line 4\n', 'Y\n'), 1).map((l) => l.type)).toEqual([
      'context',
      'del',
      'add',
      'context',
      'del',
      'add',
      'context',
    ]);
  });

  it('shows a final-newline difference as a changed last line', () => {
    expect(diffLines('a\nb', 'a\nb\n')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'b' },
    ]);
  });

  it('caps a huge diff at MAX_DIFF_LINES lines plus one trailing gap', () => {
    expect(MAX_DIFF_LINES).toBe(2000);
    const huge = lines(10_000);
    const created = diffLines(null, huge);
    expect(created.length).toBeLessThanOrEqual(2001);
    expect(created.at(-1)).toEqual({ type: 'gap', text: '' });
    const rewritten = diffLines(huge, lines(10_000, 'other'));
    expect(rewritten.length).toBeLessThanOrEqual(2001);
  });
});
