import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNavHistory } from './useNavHistory.ts';

describe('useNavHistory', () => {
  it('goes back and forward through the chats opened, and drops the forward part on a new visit', () => {
    const go = vi.fn();
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useNavHistory(id, go), { initialProps: { id: null as string | null } });
    expect([result.current.canBack, result.current.canForward]).toEqual([false, false]);
    rerender({ id: 'a' });
    rerender({ id: 'b' });
    expect([result.current.canBack, result.current.canForward]).toEqual([true, false]);
    act(() => result.current.back());
    expect(go).toHaveBeenLastCalledWith('a');
    rerender({ id: 'a' });
    expect([result.current.canBack, result.current.canForward]).toEqual([true, true]);
    act(() => result.current.forward());
    expect(go).toHaveBeenLastCalledWith('b');
    rerender({ id: 'b' });
    act(() => result.current.back());
    rerender({ id: 'a' });
    rerender({ id: 'c' });
    expect(result.current.canForward).toBe(false);
    act(() => result.current.back());
    expect(go).toHaveBeenLastCalledWith('a');
  });

  it('does not swallow the next visit when back lands on the chat that is already open', () => {
    const go = vi.fn();
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useNavHistory(id, go), { initialProps: { id: 'a' as string | null } });
    rerender({ id: 'b' });
    act(() => result.current.back());
    rerender({ id: 'a' });
    rerender({ id: 'x' });
    expect(result.current.canBack).toBe(true);
    expect(result.current.canForward).toBe(false);
  });
});
