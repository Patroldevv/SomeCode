import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAutoContinue } from './useAutoContinue.ts';

const setup = (running: number, ready = true, enabled = true) => {
  const fire = vi.fn();
  const hook = renderHook((p: { running: number; ready: boolean; enabled: boolean }) => useAutoContinue(p.running, p.ready, p.enabled, fire), { initialProps: { running, ready, enabled } });
  return { fire, ...hook };
};

describe('useAutoContinue', () => {
  it('fires once when the last sub-agent finishes while the agent is idle', () => {
    const { fire, rerender } = setup(2);
    rerender({ running: 1, ready: true, enabled: true });
    expect(fire).not.toHaveBeenCalled();
    rerender({ running: 0, ready: true, enabled: true });
    expect(fire).toHaveBeenCalledOnce();
    rerender({ running: 0, ready: true, enabled: true });
    expect(fire).toHaveBeenCalledOnce();
  });

  it('stays quiet when the agent is mid-turn, when switched off, or when nothing was running', () => {
    const busy = setup(1, false);
    busy.rerender({ running: 0, ready: false, enabled: true });
    expect(busy.fire).not.toHaveBeenCalled();
    busy.rerender({ running: 0, ready: true, enabled: true });
    expect(busy.fire).toHaveBeenCalledOnce();

    const off = setup(1, true, false);
    off.rerender({ running: 0, ready: true, enabled: false });
    expect(off.fire).not.toHaveBeenCalled();
    const none = setup(0);
    none.rerender({ running: 0, ready: true, enabled: true });
    expect(none.fire).not.toHaveBeenCalled();
  });
});
