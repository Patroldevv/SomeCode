import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStickToBottom, type ScrollTarget } from './useStickToBottom.ts';

/** A scroll container without layout: the browser's clamping of `scrollTop`, nothing else. */
class FakeScroller extends EventTarget implements ScrollTarget {
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

/** A user scroll gesture's first event, dispatched on the container (as the browser does, before any scroll). */
function wheel(el: FakeScroller, deltaY: number) {
  const e = new Event('wheel');
  Object.assign(e, { deltaY });
  act(() => {
    el.dispatchEvent(e);
  });
}
function key(el: FakeScroller, k: string, init: { shiftKey?: boolean } = {}) {
  act(() => {
    el.dispatchEvent(Object.assign(new Event('keydown'), { key: k, shiftKey: init.shiftKey ?? false }));
  });
}
function touch(el: FakeScroller, type: 'touchstart' | 'touchmove', clientY: number) {
  act(() => {
    el.dispatchEvent(Object.assign(new Event(type), { touches: [{ clientY }] }));
  });
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

  describe('user intent (a smooth gesture must escape a streaming reply)', () => {
    it('a wheel up unpins at once: the next chunk makes no scroll write', () => {
      const { el, result, rerender } = setup();
      act(() => result.current.onScroll());
      const writes = el.writes;
      wheel(el, -40);
      expect(result.current.pinned).toBe(false);
      // A chunk lands in the same frame, before the smooth scroll moved the view at all.
      el.scrollHeight = 1050;
      rerender({ itemCount: 3, tail: 'a2', contentSize: 1050 });
      // The first frames of the animation: a few px up, still within the 80 px threshold.
      el.userScrollTo(el.scrollTop - 20);
      act(() => result.current.onScroll());
      el.scrollHeight = 1100;
      rerender({ itemCount: 4, tail: 'b', contentSize: 1100 });
      expect(el.writes).toBe(writes);
      expect(result.current.pinned).toBe(false);
      expect(result.current.newItemCount).toBe(1);
    });

    it('a wheel down does not unpin', () => {
      const { el, result, rerender } = setup();
      act(() => result.current.onScroll());
      wheel(el, 40);
      expect(result.current.pinned).toBe(true);
      el.scrollHeight = 1200;
      rerender({ itemCount: 4, tail: 'b', contentSize: 1200 });
      expect(el.atEnd).toBe(true);
    });

    it.each(['ArrowUp', 'PageUp', 'Home'])('%s unpins', (k) => {
      const { el, result } = setup();
      act(() => result.current.onScroll());
      key(el, k);
      expect(result.current.pinned).toBe(false);
    });

    it('Shift+Space unpins; other keys do not', () => {
      const { el, result } = setup();
      act(() => result.current.onScroll());
      key(el, 'ArrowDown');
      key(el, 'End');
      key(el, ' ');
      key(el, 'a');
      expect(result.current.pinned).toBe(true);
      key(el, ' ', { shiftKey: true });
      expect(result.current.pinned).toBe(false);
    });

    it('a touch drag that scrolls content up unpins; one that scrolls down does not', () => {
      const { el, result } = setup();
      act(() => result.current.onScroll());
      touch(el, 'touchstart', 300);
      touch(el, 'touchmove', 290); // finger up: content scrolls down
      expect(result.current.pinned).toBe(true);
      touch(el, 'touchmove', 320); // finger down: content scrolls up
      expect(result.current.pinned).toBe(false);
    });

    it('a pointerdown on the container itself (its scrollbar) unpins; one on a child does not', () => {
      // A real element so the event bubbles from a child; layout metrics are faked on the instance.
      const el = document.createElement('div');
      const child = el.appendChild(document.createElement('p'));
      let top = 0;
      Object.defineProperties(el, {
        clientHeight: { value: 100 },
        scrollHeight: { value: 1000 },
        scrollTop: { get: () => top, set: (v: number) => (top = Math.max(0, Math.min(v, 900))) },
      });
      const { result } = renderHook(() =>
        useStickToBottom({ scrollRef: { current: el }, itemCount: 3, tail: 'a', contentSize: 1000 }),
      );
      act(() => result.current.onScroll());
      act(() => {
        child.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(result.current.pinned).toBe(true);
      act(() => {
        el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(result.current.pinned).toBe(false);
    });

    it('does not unpin when there is nothing above to scroll to', () => {
      const { el, result } = setup({ itemCount: 1, tail: 'a', contentSize: 50 });
      el.scrollHeight = 50;
      act(() => result.current.onScroll());
      wheel(el, -40);
      key(el, 'PageUp');
      expect(result.current.pinned).toBe(true);
    });

    it('after unpinning by intent, scrolling back down to within 80 px of the bottom pins again', () => {
      const { el, result, rerender } = setup();
      act(() => result.current.onScroll());
      wheel(el, -100);
      el.userScrollTo(500);
      act(() => result.current.onScroll());
      el.scrollHeight = 1200;
      rerender({ itemCount: 4, tail: 'b', contentSize: 1200 });
      expect(result.current.newItemCount).toBe(1);
      el.userScrollTo(1050); // 50 px from the end
      act(() => result.current.onScroll());
      expect(result.current.pinned).toBe(true);
      expect(result.current.newItemCount).toBe(0);
      el.scrollHeight = 1400;
      rerender({ itemCount: 5, tail: 'c', contentSize: 1400 });
      expect(el.atEnd).toBe(true);
    });

    it('unmount removes every listener it added', () => {
      const el = new FakeScroller();
      const add = vi.spyOn(el, 'addEventListener');
      const remove = vi.spyOn(el, 'removeEventListener');
      const { unmount } = renderHook(() =>
        useStickToBottom({ scrollRef: { current: el }, itemCount: 1, tail: 'a', contentSize: 1000 }),
      );
      const added = add.mock.calls.map((c) => [c[0], c[1]]);
      expect(added.map((c) => c[0]).sort()).toEqual(['keydown', 'pointerdown', 'touchmove', 'touchstart', 'wheel']);
      for (const call of add.mock.calls) expect(call[2]).toEqual({ passive: true });
      unmount();
      expect(remove.mock.calls.map((c) => [c[0], c[1]])).toEqual(expect.arrayContaining(added));
      expect(remove).toHaveBeenCalledTimes(added.length);
    });
  });
});
