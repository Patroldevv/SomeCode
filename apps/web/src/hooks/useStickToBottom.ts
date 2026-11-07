import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { isNearBottom, type ScrollMetrics } from '../lib/scroll.ts';

/** What the hook reads and writes on the scroll container (an `HTMLElement` satisfies it). */
export type ScrollTarget = ScrollMetrics;

export type StickToBottom = {
  /** Following the end: new content scrolls the view down. */
  pinned: boolean;
  /** Items appended since the user left the bottom (0 while pinned). */
  newItemCount: number;
  /** Wire to the container's `onScroll`. */
  onScroll: () => void;
  /** Scroll to the end and follow again. */
  jumpToLatest: () => void;
};

/**
 * Chat-style stick-to-bottom. Starts pinned (a freshly mounted list opens at its end). While pinned, every
 * change of `itemCount`, `tail` (the last item's identity: it streams) or `contentSize` (measured height)
 * scrolls to the end. A user scroll up away from the bottom unpins: the view then stays where it is and
 * appended items are counted. Scrolling back to the bottom, or `jumpToLatest`, pins again.
 *
 * The scroll event caused by our own write is ignored for unpinning (content may grow again before it is
 * delivered, so it can land short of the end); a write that does not move the view sets no such guard, so it
 * cannot swallow the user's next scroll.
 */
export function useStickToBottom({
  scrollRef,
  itemCount,
  tail,
  contentSize,
}: {
  scrollRef: { readonly current: ScrollTarget | null };
  itemCount: number;
  tail: unknown;
  contentSize: number;
}): StickToBottom {
  const [pinned, setPinnedState] = useState(true);
  const [newItemCount, setNewItemCount] = useState(0);
  const pinnedRef = useRef(true);
  const ownScrollRef = useRef(false);
  const lastTopRef = useRef(0);
  const prevCountRef = useRef(itemCount);

  const setPinned = useCallback((value: boolean) => {
    pinnedRef.current = value;
    setPinnedState(value);
    if (value) setNewItemCount(0);
  }, []);

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight; // the browser clamps to the end
    if (el.scrollTop !== before) ownScrollRef.current = true;
    lastTopRef.current = el.scrollTop;
  }, [scrollRef]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const own = ownScrollRef.current;
    ownScrollRef.current = false;
    const top = el.scrollTop;
    const movedUp = top < lastTopRef.current;
    lastTopRef.current = top;
    if (isNearBottom(el)) {
      if (!pinnedRef.current) setPinned(true);
    } else if (!own && movedUp && pinnedRef.current) {
      setPinned(false);
    }
  }, [scrollRef, setPinned]);

  const jumpToLatest = useCallback(() => {
    setPinned(true);
    scrollToEnd();
  }, [scrollToEnd, setPinned]);

  useLayoutEffect(() => {
    const added = itemCount - prevCountRef.current;
    prevCountRef.current = itemCount;
    if (pinnedRef.current) scrollToEnd();
    else if (added > 0) setNewItemCount((c) => c + added);
  }, [itemCount, tail, contentSize, scrollToEnd]);

  return { pinned, newItemCount, onScroll, jumpToLatest };
}
