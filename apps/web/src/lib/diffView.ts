import { diffLines as jsdiffLines } from 'diff';

export type DiffLine = { type: 'context' | 'add' | 'del' | 'gap'; text: string };

/** The most lines `diffLines` returns; anything beyond is cut and replaced by one trailing `gap`. */
export const MAX_DIFF_LINES = 2000;
/** Longest line text shown; a longer line is cut (on a code-point boundary) and ends with `…`. */
export const MAX_LINE_CHARS = 2000;
/** Total line characters one diff shows; the remaining lines collapse into one trailing `gap`. */
export const MAX_DIFF_CHARS = 200_000;
/** Above this many characters (old + new) the line diff is skipped for the cheap prefix/suffix diff. */
export const EXACT_DIFF_MAX_CHARS = 200_000;
/**
 * Myers' cost grows with the square of the number of changed lines: jsdiff gives up beyond this many edits
 * (≈ 15 ms worst case) and the cheap prefix/suffix diff is used instead.
 */
const MAX_EDIT_LENGTH = 300;
/** Wall-clock safety net on top of MAX_EDIT_LENGTH. */
const DIFF_TIMEOUT_MS = 50;

type Chunk = { type: 'context' | 'add' | 'del'; lines: string[] };
type Computed = { chunks: Chunk[]; added: number; removed: number; exact: boolean };

/** Splits text into lines (no trailing empty line for a final newline; a trailing `\r` is dropped). */
function splitLines(value: string): string[] {
  if (value === '') return [];
  const parts = value.split('\n');
  if (parts.at(-1) === '') parts.pop();
  return parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/**
 * Cheap O(n) diff: common leading and trailing lines are context, everything between is one removal plus one
 * addition. Exact for a single contiguous change; a "full replacement" otherwise.
 */
function prefixSuffixDiff(oldLines: string[], newLines: string[]): Chunk[] {
  let head = 0;
  const max = Math.min(oldLines.length, newLines.length);
  while (head < max && oldLines[head] === newLines[head]) head++;
  let tail = 0;
  while (
    tail < max - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) {
    tail++;
  }
  const chunks: Chunk[] = [
    { type: 'context', lines: oldLines.slice(0, head) },
    { type: 'del', lines: oldLines.slice(head, oldLines.length - tail) },
    { type: 'add', lines: newLines.slice(head, newLines.length - tail) },
    { type: 'context', lines: oldLines.slice(oldLines.length - tail) },
  ];
  return chunks.filter((c) => c.lines.length > 0);
}

function compute(oldText: string | null, newText: string): Computed {
  const old = oldText ?? '';
  let chunks: Chunk[] = [];
  let exact = true;
  if (old !== newText) {
    const result =
      old.length + newText.length > EXACT_DIFF_MAX_CHARS
        ? undefined
        : jsdiffLines(old, newText, { stripTrailingCr: true, maxEditLength: MAX_EDIT_LENGTH, timeout: DIFF_TIMEOUT_MS });
    if (result) {
      chunks = result.map((c) => ({ type: c.added ? 'add' : c.removed ? 'del' : 'context', lines: splitLines(c.value) }));
    } else {
      exact = false;
      chunks = prefixSuffixDiff(splitLines(old), splitLines(newText));
    }
  }
  let added = 0;
  let removed = 0;
  for (const c of chunks) {
    if (c.type === 'add') added += c.lines.length;
    else if (c.type === 'del') removed += c.lines.length;
  }
  return { chunks, added, removed, exact };
}

/**
 * The change set of the last few (oldText, newText) pairs, so the `+n -m` summary, the expanded view and every
 * re-render (a new `content` array with the same strings) share one computation.
 */
const CACHE_SIZE = 32;
const cache: { old: string | null; new: string; computed: Computed }[] = [];

function computeCached(oldText: string | null, newText: string): Computed {
  const index = cache.findIndex((e) => e.old === oldText && e.new === newText);
  if (index >= 0) {
    const [entry] = cache.splice(index, 1);
    cache.push(entry!);
    return entry!.computed;
  }
  const computed = compute(oldText, newText);
  cache.push({ old: oldText, new: newText, computed });
  if (cache.length > CACHE_SIZE) cache.shift();
  return computed;
}

/** Lines added and removed by an edit; a new file (`oldText: null`) is all additions. Agrees with `diffLines`. */
export function diffStats(oldText: string | null, newText: string): { added: number; removed: number } {
  const { added, removed } = computeCached(oldText, newText);
  return { added, removed };
}

/** Cuts `text` to `max` UTF-16 units without splitting a surrogate pair, ending with `…` when cut. */
function capLine(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end) + '…', cut: true };
}

/**
 * A unified, line-numberless diff ready to render: changed lines with at most `context` unchanged lines around
 * each change, longer unchanged runs collapsed into one `gap`. Bounded: MAX_DIFF_LINES lines, MAX_LINE_CHARS
 * per line, MAX_DIFF_CHARS in total; `truncated` says whether any of these caps cut something. `exact` is false
 * when the cheap prefix/suffix diff was used instead of a line diff.
 */
export function buildDiff(
  oldText: string | null,
  newText: string,
  context = 3,
): { lines: DiffLine[]; truncated: boolean; exact: boolean } {
  const { chunks, exact } = computeCached(oldText, newText);
  if (!chunks.some((c) => c.type !== 'context')) return { lines: [], truncated: false, exact };

  const out: DiffLine[] = [];
  let chars = 0;
  let truncated = false;
  const push = (type: DiffLine['type'], raw: string): boolean => {
    if (out.length >= MAX_DIFF_LINES || chars >= MAX_DIFF_CHARS) {
      truncated = true;
      return false;
    }
    const line = capLine(raw, MAX_LINE_CHARS);
    if (line.cut) truncated = true;
    chars += line.text.length;
    out.push({ type, text: line.text });
    return true;
  };
  const gap = () => {
    if (out.at(-1)?.type !== 'gap') out.push({ type: 'gap', text: '' });
  };

  outer: for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]!;
    if (chunk.type !== 'context') {
      for (const text of chunk.lines) if (!push(chunk.type, text)) break outer;
      continue;
    }
    // An unchanged run: keep `context` lines after the previous change and before the next one.
    const n = chunk.lines.length;
    const keepHead = ci === 0 ? 0 : context;
    const keepTail = ci === chunks.length - 1 ? 0 : context;
    if (n <= keepHead + keepTail) {
      for (const text of chunk.lines) if (!push('context', text)) break outer;
    } else {
      for (let k = 0; k < keepHead; k++) if (!push('context', chunk.lines[k]!)) break outer;
      gap();
      for (let k = n - keepTail; k < n; k++) if (!push('context', chunk.lines[k]!)) break outer;
    }
  }
  if (truncated) gap();
  return { lines: out, truncated, exact };
}

/** `buildDiff(...).lines`. */
export function diffLines(oldText: string | null, newText: string, context = 3): DiffLine[] {
  return buildDiff(oldText, newText, context).lines;
}
