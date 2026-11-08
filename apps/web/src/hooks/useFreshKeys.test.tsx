import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFreshKeys } from './useFreshKeys.ts';

function setup(initial: string[], windowMs = 500) {
  let clock = 1_000;
  const now = () => clock;
  const hook = renderHook(({ keys }) => useFreshKeys(keys, windowMs, now), { initialProps: { keys: initial } });
  return { hook, advance: (ms: number) => (clock += ms) };
}

describe('useFreshKeys', () => {
  it('items already there at mount (history) are never fresh', () => {
    const { hook } = setup(['a', 'b']);
    expect([...hook.result.current]).toEqual([]);
  });

  it('an item that arrives later is fresh for the window, then not', () => {
    const { hook, advance } = setup(['a']);
    hook.rerender({ keys: ['a', 'b'] });
    expect([...hook.result.current]).toEqual(['b']);
    advance(300);
    hook.rerender({ keys: ['a', 'b', 'c'] });
    expect([...hook.result.current].sort()).toEqual(['b', 'c']);
    advance(300);
    hook.rerender({ keys: ['a', 'b', 'c'] });
    expect([...hook.result.current]).toEqual(['c']);
    advance(600);
    hook.rerender({ keys: ['a', 'b', 'c'] });
    expect([...hook.result.current]).toEqual([]);
  });

  it('a list that mounts empty treats the first arrivals as fresh', () => {
    const { hook } = setup([]);
    hook.rerender({ keys: ['x'] });
    expect([...hook.result.current]).toEqual(['x']);
  });

  it('a remounted list (another session, or a scrolled-back row) starts without fresh items', () => {
    const first = setup(['a']);
    first.hook.rerender({ keys: ['a', 'b'] });
    first.hook.unmount();
    const second = setup(['a', 'b']);
    expect([...second.hook.result.current]).toEqual([]);
  });

  it('is stable across re-renders with the same keys (React StrictMode renders twice)', () => {
    const { hook } = setup(['a']);
    hook.rerender({ keys: ['a', 'b'] });
    hook.rerender({ keys: ['a', 'b'] });
    expect([...hook.result.current]).toEqual(['b']);
  });
});
