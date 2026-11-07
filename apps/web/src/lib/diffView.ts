import { diffLines as jsdiffLines, type ChangeObject } from 'diff';

export type DiffLine = { type: 'context' | 'add' | 'del' | 'gap'; text: string };

/** The most lines `diffLines` returns; anything beyond is cut and replaced by one trailing `gap`. */
export const MAX_DIFF_LINES = 2000;

/** Give up on a minimal diff after this long and show the edit as "everything replaced". */
const DIFF_TIMEOUT_MS = 1000;

/** Splits a change value into lines; the final newline ends the last line rather than starting an empty one. */
function splitLines(value: string): string[] {
  if (value === '') return [];
  const parts = value.split('\n');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

function changes(oldText: string | null, newText: string): ChangeObject<string>[] {
  const old = oldText ?? '';
  if (old === newText) return [];
  const result = jsdiffLines(old, newText, { timeout: DIFF_TIMEOUT_MS });
  if (result) return result;
  // Timed out: show it as a full replacement (still correct, just not minimal).
  return [
    { value: old, added: false, removed: true, count: splitLines(old).length },
    { value: newText, added: true, removed: false, count: splitLines(newText).length },
  ];
}

/** Lines added and removed by an edit; a new file (`oldText: null`) is all additions. */
export function diffStats(oldText: string | null, newText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const c of changes(oldText, newText)) {
    const n = splitLines(c.value).length;
    if (c.added) added += n;
    else if (c.removed) removed += n;
  }
  return { added, removed };
}

/**
 * A unified, line-numberless diff: changed lines with at most `context` unchanged lines around each change;
 * longer unchanged runs collapse into one `gap`. Capped at MAX_DIFF_LINES (+ one trailing `gap`).
 */
export function diffLines(oldText: string | null, newText: string, context = 3): DiffLine[] {
  const all: DiffLine[] = [];
  for (const c of changes(oldText, newText)) {
    const type = c.added ? 'add' : c.removed ? 'del' : 'context';
    for (const text of splitLines(c.value)) all.push({ type, text });
  }

  const out: DiffLine[] = [];
  let i = 0;
  while (i < all.length && out.length < MAX_DIFF_LINES) {
    const line = all[i] as DiffLine;
    if (line.type !== 'context') {
      out.push(line);
      i++;
      continue;
    }
    // An unchanged run [i, j): keep `context` lines after the previous change and before the next one.
    let j = i;
    while (j < all.length && (all[j] as DiffLine).type === 'context') j++;
    const keepHead = i === 0 ? 0 : context;
    const keepTail = j === all.length ? 0 : context;
    if (j - i <= keepHead + keepTail) {
      for (let k = i; k < j; k++) out.push(all[k] as DiffLine);
    } else {
      for (let k = i; k < i + keepHead; k++) out.push(all[k] as DiffLine);
      out.push({ type: 'gap', text: '' });
      for (let k = j - keepTail; k < j; k++) out.push(all[k] as DiffLine);
    }
    i = j;
  }

  if (out.length > MAX_DIFF_LINES || i < all.length) {
    out.length = Math.min(out.length, MAX_DIFF_LINES);
    if (out.at(-1)?.type !== 'gap') out.push({ type: 'gap', text: '' });
  }
  return out;
}
