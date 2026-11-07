import * as jsdiff from 'diff';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXACT_DIFF_MAX_CHARS,
  MAX_DIFF_CHARS,
  MAX_DIFF_LINES,
  MAX_LINE_CHARS,
  buildDiff,
  diffLines,
  diffStats,
} from './diffView.ts';

// Pass-through spy on the line-diff engine (counts calls, keeps real behaviour).
vi.mock('diff', async (importOriginal) => {
  const real = await importOriginal<typeof import('diff')>();
  return { ...real, diffLines: vi.fn(real.diffLines) };
});
const engine = vi.mocked(jsdiff.diffLines);
beforeEach(() => {
  engine.mockClear();
});

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

/** Adds and removals counted from an uncollapsed `diffLines` (context large enough to never gap). */
function counted(oldText: string | null, newText: string) {
  const out = diffLines(oldText, newText, 1_000_000);
  return { added: out.filter((l) => l.type === 'add').length, removed: out.filter((l) => l.type === 'del').length };
}

describe('cost ceiling', () => {
  it('skips the line diff above the size threshold and still answers a 10 000-line rewrite fast', () => {
    const before = lines(10_000);
    const after = lines(10_000, 'other');
    expect(before.length + after.length).toBeGreaterThan(EXACT_DIFF_MAX_CHARS);
    const started = Date.now();
    const stats = diffStats(before, after);
    const view = buildDiff(before, after);
    expect(Date.now() - started).toBeLessThan(300);
    expect(engine).not.toHaveBeenCalled();
    expect(view.exact).toBe(false);
    expect(stats).toEqual({ added: 10_000, removed: 10_000 });
    expect(view.lines.length).toBeLessThanOrEqual(MAX_DIFF_LINES + 1);
  });

  it('gives up on a line diff whose edit is too large and falls back, below the size threshold too', () => {
    const before = lines(1500, 'a');
    const after = lines(1500, 'b');
    expect(before.length + after.length).toBeLessThan(EXACT_DIFF_MAX_CHARS);
    const started = Date.now();
    const view = buildDiff(before, after);
    expect(Date.now() - started).toBeLessThan(300);
    expect(engine).toHaveBeenCalledTimes(1);
    expect(view.exact).toBe(false);
    expect(diffStats(before, after)).toEqual({ added: 1500, removed: 1500 });
  });

  it('the fallback keeps common leading and trailing lines as context', () => {
    const before = lines(15_000);
    expect(before.length * 2).toBeGreaterThan(EXACT_DIFF_MAX_CHARS);
    const after = before.replace('line 5000\n', 'X\nY\n');
    const view = buildDiff(before, after, 1);
    expect(view.exact).toBe(false);
    expect(view.lines).toEqual([
      { type: 'gap', text: '' },
      { type: 'context', text: 'line 4999' },
      { type: 'del', text: 'line 5000' },
      { type: 'add', text: 'X' },
      { type: 'add', text: 'Y' },
      { type: 'context', text: 'line 5001' },
      { type: 'gap', text: '' },
    ]);
  });

  it.each([
    ['exact', lines(30), lines(30).replace('line 3\n', 'A\n').replace('line 20\n', 'B\nC\n')],
    ['fallback (edit too large)', lines(800, 'p'), lines(700, 'q')],
    ['fallback (size)', lines(15_000), lines(15_000).replace('line 7\n', 'Z\n').replace('line 9\n', '')],
    ['new file', null, lines(40)],
  ] as const)('diffStats agrees with diffLines: %s', (_mode, before, after) => {
    expect(diffStats(before, after)).toEqual(counted(before, after));
  });

  it('computes each (oldText, newText) pair once, also for equal strings built separately', () => {
    const before = lines(50, 'memo');
    const after = before.replace('memo 10\n', 'changed\n');
    diffStats(before, after);
    diffLines(before, after);
    buildDiff(before, after, 1);
    diffStats(before.slice(0), `${after}`);
    expect(engine).toHaveBeenCalledTimes(1);
  });
});

describe('long content', () => {
  it('cuts a 5 MB single line to the per-line cap plus an ellipsis', () => {
    const view = buildDiff(null, 'y'.repeat(5_000_000));
    expect(view.lines).toHaveLength(2);
    const [line, gap] = view.lines;
    expect(line!.type).toBe('add');
    expect(line!.text.length).toBeLessThanOrEqual(MAX_LINE_CHARS + 1);
    expect(line!.text.endsWith('…')).toBe(true);
    expect(gap).toEqual({ type: 'gap', text: '' });
    expect(view.truncated).toBe(true);
  });

  it('never splits a surrogate pair at the cut', () => {
    const text = 'a'.repeat(MAX_LINE_CHARS - 1) + '😀' + 'b';
    const [line] = diffLines(null, text);
    expect(line!.text).toBe('a'.repeat(MAX_LINE_CHARS - 1) + '…');
    expect(line!.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('stops at the total character budget with a trailing gap', () => {
    const big = Array.from({ length: 300 }, (_, i) => `${i}`.padEnd(1000, 'x')).join('\n') + '\n';
    const view = buildDiff(null, big);
    expect(view.truncated).toBe(true);
    expect(view.lines.at(-1)).toEqual({ type: 'gap', text: '' });
    const chars = view.lines.reduce((n, l) => n + l.text.length, 0);
    expect(chars).toBeLessThanOrEqual(MAX_DIFF_CHARS + MAX_LINE_CHARS);
    expect(view.lines.length).toBeLessThan(300);
  });

  it('is not truncated when everything fits', () => {
    expect(buildDiff('a\n', 'b\n').truncated).toBe(false);
  });
});

describe('line endings', () => {
  it('treats CRLF and LF versions of the same text as unchanged', () => {
    expect(diffStats('a\r\nb\r\n', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
    expect(diffLines('a\r\nb\r\n', 'a\nb\n')).toEqual([]);
  });

  it('never shows a trailing \\r in a displayed line', () => {
    expect(diffLines('a\r\nb\r\n', 'a\r\nc\r\n')).toEqual([
      { type: 'context', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'c' },
    ]);
  });
});
