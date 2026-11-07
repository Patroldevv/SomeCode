import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStickToBottom, type ScrollTarget } from './useStickToBottom.ts';

/** A scroll container without layout: the browser's clamping of `scrollTop`, nothing else. */
class FakeScroller implements ScrollTarget {
  clientHeight = 100;
  scrollHeight = 1000;
  writes = 0;
  #top = 0;
  get scrollTop() {
    return this.#top;
  }
  set scrollTop(v: number) {
    this.writes++;
    this.#top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight));
  }
  /** A user scroll (no write counted). */
  userScrollTo(v: number) {
    this.#top = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight));
  }
  get atEnd() {
    return this.#top === Math.max(0, this.scrollHeight - this.clientHeight);
  }
}

type Props = { itemCount: number; tail: unknown; contentSize: number };

function setup(initial: Props = { itemCount: 3, tail: 'a', contentSize: 1000 }) {
  const el = new FakeScroller();
  el.scrollHeight = initial.contentSize;
  const ref = { current: el };
  const hook = renderHook((p: Props) => useStickToBottom({ scrollRef: ref, ...p }), { initialProps: initial });
  return { el, ...hook };
}

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  consoleWarn = vi.spyOn(console, 'warn');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleWarn).not.toHaveBeenCalled();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

describe('useStickToBottom', () => {
  it('starts pinned and scrolls to the end on mount', () => {
    const { el, result } = setup();
    expect(result.current.pinned).toBe(true);
    expect(result.current.newItemCount).toBe(0);
    expect(el.atEnd).toBe(true);
  });

  it('stays pinned and follows appended items and a growing last item', () => {
    const { el, result, rerender } = setup();
    act(() => result.current.onScroll()); // the event caused by the mount scroll
    el.scrollHeight = 1200;
    rerender({ itemCount: 4, tail: 'b', contentSize: 1200 });
    expect(el.atEnd).toBe(true);
    act(() => result.current.onScroll());
    // The last item grows (same count, new tail object / size).
    el.scrollHeight = 1500;
    rerender({ itemCount: 4, tail: 'b2', contentSize: 1500 });
    expect(el.atEnd).toBe(true);
    act(() => result.current.onScroll());
    expect(result.current.pinned).toBe(true);
    expect(result.current.newItemCount).toBe(0);
  });

  it('does not unpin on the scroll event caused by its own scroll, even if it landed short', () => {
    const { el, result, rerender } = setup();
    act(() => result.current.onScroll());
    el.scrollHeight = 1200;
    rerender({ itemCount: 4, tail: 'b', contentSize: 1200 });
    // Content grew again before the scroll event was delivered: the view is no longer near the bottom.
    el.scrollHeight = 2000;
    act(() => result.current.onScroll());
    expect(result.current.pinned).toBe(true);
  });

  it('unpins when the user scrolls up, keeps the view still and counts new items', () => {
    const { el, result, rerender } = setup();
    act(() => result.current.onScroll());
    el.userScrollTo(300);
    act(() => result.current.onScroll());
    expect(result.current.pinned).toBe(false);

    const writes = el.writes;
    el.scrollHeight = 1300;
    rerender({ itemCount: 5, tail: 'c', contentSize: 1300 });
    el.scrollHeight = 1400;
    rerender({ itemCount: 5, tail: 'c2', contentSize: 1400 }); // growth of the last item: not a new item
    el.scrollHeight = 1500;
    rerender({ itemCount: 6, tail: 'd', contentSize: 1500 });
    expect(el.writes).toBe(writes);
    expect(el.scrollTop).toBe(300);
    expect(result.current.pinned).toBe(false);
    expect(result.current.newItemCount).toBe(3);
  });

  it('jumpToLatest scrolls to the end, pins again and resets the count', () => {
    const { el, result, rerender } = setup();
    act(() => result.current.onScroll());
    el.userScrollTo(100);
    act(() => result.current.onScroll());
    el.scrollHeight = 1300;
    rerender({ itemCount: 4, tail: 'x', contentSize: 1300 });
    expect(result.current.newItemCount).toBe(1);

    act(() => result.current.jumpToLatest());
    expect(el.atEnd).toBe(true);
    expect(result.current.pinned).toBe(true);
    expect(result.current.newItemCount).toBe(0);
    act(() => result.current.onScroll());
    expect(result.current.pinned).toBe(true);

    el.scrollHeight = 1600;
    rerender({ itemCount: 5, tail: 'y', contentSize: 1600 });
    expect(el.atEnd).toBe(true);
  });

  it('pins again (and resets the count) when the user scrolls back to the bottom', () => {
    const { el, result, rerender } = setup();
    act(() => result.current.onScroll());
    el.userScrollTo(0);
    act(() => result.current.onScroll());
    el.scrollHeight = 1200;
    rerender({ itemCount: 4, tail: 'b', contentSize: 1200 });
    expect(result.current.newItemCount).toBe(1);
    el.userScrollTo(1100);
    act(() => result.current.onScroll());
    expect(result.current.pinned).toBe(true);
    expect(result.current.newItemCount).toBe(0);
  });

  it('does not swallow the next user scroll when its own scroll was a no-op', () => {
    const { el, result, rerender } = setup();
    act(() => result.current.onScroll());
    // Already at the end: a re-render with no growth writes nothing that would fire a scroll event.
    rerender({ itemCount: 3, tail: 'a2', contentSize: 1000 });
    el.userScrollTo(200);
    act(() => result.current.onScroll());
    expect(result.current.pinned).toBe(false);
  });
});
