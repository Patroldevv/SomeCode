import { useRef } from "react";

/**
 * Keys that arrived after this list mounted, for `windowMs` after they first appeared. Items already present at
 * mount (history, another session, a row scrolled back into view) are never fresh, so only live arrivals animate.
 * `now` is injectable for tests.
 */
export function useFreshKeys(
  keys: readonly string[],
  windowMs = 500,
  now: () => number = Date.now,
): ReadonlySet<string> {
  const state = useRef<{ seen: Set<string>; until: Map<string, number> } | null>(null);
  if (state.current === null) {
    // First render: everything that is already here is history.
    state.current = { seen: new Set(keys), until: new Map() };
  }
  const { seen, until } = state.current;
  const t = now();
  for (const key of keys) {
    if (!seen.has(key)) {
      seen.add(key);
      until.set(key, t + windowMs);
    }
  }
  const fresh = new Set<string>();
  for (const key of keys) {
    const end = until.get(key);
    if (end !== undefined && end > t) fresh.add(key);
  }
  return fresh;
}
