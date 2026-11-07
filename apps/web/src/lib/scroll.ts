export type ScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number };

/**
 * Whether a scroll container is within `threshold` px of its end. A list shorter than its container
 * (nothing to scroll) is always at the bottom.
 */
export function isNearBottom(m: ScrollMetrics, threshold = 80): boolean {
  if (m.scrollHeight <= m.clientHeight) return true;
  return m.scrollHeight - m.clientHeight - m.scrollTop <= threshold;
}
