import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { isNearBottom, type ScrollMetrics } from '../lib/scroll.ts';

/** What the hook reads, writes and listens to on the scroll container (an `HTMLElement` satisfies it). */
export type ScrollTarget = ScrollMetrics & Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Keys that scroll the container up (Space scrolls down; Shift+Space up). */
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);
const LISTEN = { passive: true } as const;

/**
 * Whether the gesture that started on `target` scrolls an element nested inside `container` rather than the
 * container itself: some ancestor of `target` (strictly inside the container) can still scroll up. The
 * browser scrolls that inner scroller first (tool output, diffs, the plan box); the list only moves once it
 * is at its top (scroll chaining), and then the intent counts again.
 */
function innerScrollsUp(target: EventTarget | null, container: unknown): boolean {
  if (typeof Element === 'undefined') return false;
  for (let node = target instanceof Element ? target : null; node && node !== container; node = node.parentElement) {
    if (node.scrollTop > 0 && node.scrollHeight > node.clientHeight) return true;
  }
  return false;
}

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
 * Unpinning is driven by user INTENT, seen on the container before the view moves: a wheel up
 * (`deltaY < 0`), an up key (ArrowUp / PageUp / Home / Shift+Space), a touch drag whose finger moves down
 * (content scrolls up), or a pointerdown on the container itself rather than a child (its scrollbar). It
 * unpins at once, so the next streamed chunk does not snap a smooth (multi-frame) gesture back to the end.
 * Intent is ignored while there is nothing above to scroll to (`scrollTop === 0`), for mostly horizontal
 * gestures (a sideways swipe over a code block: `|dx| >= |dy|`), and while an inner scroller under the
 * pointer/finger can still scroll up itself (the list does not move then).
 *
 * Scroll events re-pin only when the view moved DOWN to within the threshold of the end (so the first,
 * small frames of an upward gesture never re-pin). As a fallback, a user scroll up past the threshold also
 * unpins. The scroll event caused by our own write is ignored for that fallback (content may grow again
 * before it is delivered); a write that does not move the view sets no such guard, so it cannot swallow the
 * user's next scroll. Virtual-core's own end-following/measurement writes only ever push the view down
 * while at the end, so they never look like "moved up".
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
    const movedDown = top > lastTopRef.current;
    lastTopRef.current = top;
    if (movedDown && isNearBottom(el)) {
      if (!pinnedRef.current) setPinned(true);
    } else if (!own && movedUp && pinnedRef.current) {
      setPinned(false);
    }
  }, [scrollRef, setPinned]);

  // User intent to scroll up: unpin before the gesture moves the view (and before the next chunk re-scrolls).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const intendUp = () => {
      if (!pinnedRef.current || el.scrollTop <= 0) return;
      ownScrollRef.current = false; // the coming scroll events are the user's
      setPinned(false);
    };
    let touch: { x: number; y: number } | null = null;
    const onWheel = (e: Event) => {
      const { deltaX = 0, deltaY } = e as WheelEvent;
      if (deltaY >= 0 || Math.abs(deltaX) >= Math.abs(deltaY)) return;
      if (innerScrollsUp(e.target, el)) return;
      intendUp();
    };
    const onKeyDown = (e: Event) => {
      const { key, shiftKey } = e as KeyboardEvent;
      if (UP_KEYS.has(key) || (key === ' ' && shiftKey)) intendUp();
    };
    const point = (e: Event): { x: number; y: number } | null => {
      const t = (e as TouchEvent).touches[0];
      return t ? { x: t.clientX ?? 0, y: t.clientY } : null;
    };
    const onTouchStart = (e: Event) => {
      touch = point(e);
    };
    const onTouchMove = (e: Event) => {
      const next = point(e);
      if (next === null || touch === null) return;
      const dx = next.x - touch.x;
      const dy = next.y - touch.y;
      touch = next;
      // Finger moves down (content scrolls up), mostly vertically, and not an inner scroller's own scroll.
      if (dy > 0 && Math.abs(dx) <= Math.abs(dy) && !innerScrollsUp(e.target, el)) intendUp();
    };
    const onPointerDown = (e: Event) => {
      if (e.target === (el as unknown)) intendUp(); // on the container, not a row: its scrollbar
    };
    const listeners: [string, (e: Event) => void][] = [
      ['wheel', onWheel],
      ['keydown', onKeyDown],
      ['touchstart', onTouchStart],
      ['touchmove', onTouchMove],
      ['pointerdown', onPointerDown],
    ];
    for (const [type, fn] of listeners) el.addEventListener(type, fn, LISTEN);
    return () => {
      for (const [type, fn] of listeners) el.removeEventListener(type, fn);
    };
  }, [scrollRef, setPinned]);

  const jumpToLatest = useCallback(() => {
    setPinned(true);
    const el = scrollRef.current;
    if (!el) return;
    ownScrollRef.current = true;
    if ('scrollTo' in el && typeof (el as HTMLElement).scrollTo === 'function') {
      try {
        (el as HTMLElement).scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } catch {
        el.scrollTop = el.scrollHeight;
      }
    } else {
      el.scrollTop = el.scrollHeight;
    }
    lastTopRef.current = el.scrollHeight;
  }, [scrollRef, setPinned]);

  useLayoutEffect(() => {
    const added = itemCount - prevCountRef.current;
    prevCountRef.current = itemCount;
    if (pinnedRef.current) scrollToEnd();
    else if (added > 0) setNewItemCount((c) => c + added);
  }, [itemCount, tail, contentSize, scrollToEnd]);

  return { pinned, newItemCount, onScroll, jumpToLatest };
}
