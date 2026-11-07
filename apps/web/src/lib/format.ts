/** Whole seconds for a duration in ms, rounded, never below 1 (a thought always "took" some time). */
export function formatDuration(ms: number): string {
  return String(Math.max(1, Math.round(ms / 1000)));
}

/**
 * Keeps the first `max` UTF-16 units of `text` (never splitting a surrogate pair) and says how many were
 * dropped, so a huge tool output cannot freeze the page.
 */
export function truncateOutput(text: string, max = 20_000): { text: string; hiddenChars: number } {
  if (text.length <= max) return { text, hiddenChars: 0 };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), hiddenChars: text.length - end };
}

/** A tool's raw input/output for display: strings verbatim, anything else as indented JSON; never throws. */
export function prettyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value, null, 2);
    return json ?? String(value);
  } catch {
    return String(value);
  }
}
