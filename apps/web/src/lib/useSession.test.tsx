import { act, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredEvent } from '@somecode/protocol';
import { createSessionsStore, useDraft, useSession, type Schedule } from './sessionsStore.ts';

const chunk = (seq: number, text: string): StoredEvent => ({
  seq,
  sessionId: 's1',
  ts: 0,
  event: { type: 'agent_message', text },
});

function manualFrames() {
  let queue: (() => void)[] = [];
  const schedule: Schedule = (callback) => {
    queue.push(callback);
    return () => {
      queue = queue.filter((c) => c !== callback);
    };
  };
  const frame = () => {
    const run = queue;
    queue = [];
    for (const callback of run) callback();
  };
  return { schedule, frame };
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(consoleError).not.toHaveBeenCalled();
  consoleError.mockRestore();
});

describe('useSession / useDraft with frame-coalesced notifications', () => {
  it('a 5 000-event replay costs at most one React commit per frame', () => {
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    function View() {
      const state = useSession(store, 's1');
      return <p data-testid="seq">{state.lastSeq}</p>;
    }
    let commits = 0;
    render(
      <Profiler id="view" onRender={() => (commits += 1)}>
        <View />
      </Profiler>,
    );
    commits = 0;
    // Every WebSocket message is its own task (its own act scope); ~100 of them arrive per frame.
    for (let seq = 1; seq <= 5000; seq++) {
      act(() => store.apply('s1', chunk(seq, 'w ')));
      if (seq % 100 === 0) act(() => frames.frame());
    }
    act(() => frames.frame());
    expect(screen.getByTestId('seq')).toHaveTextContent('5000');
    expect(commits).toBeGreaterThan(0);
    expect(commits).toBeLessThanOrEqual(50);
  });

  it('a component that renders for another reason reads the current state, even before the frame', () => {
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    function View({ label }: { label: string }) {
      const state = useSession(store, 's1');
      return <p data-testid="v">{`${label}:${state.lastSeq}`}</p>;
    }
    const { rerender } = render(<View label="a" />);
    store.apply('s1', chunk(1, 'x'));
    rerender(<View label="b" />);
    expect(screen.getByTestId('v')).toHaveTextContent('b:1');
    act(() => frames.frame());
    expect(screen.getByTestId('v')).toHaveTextContent('b:1');
  });

  it('a draft change renders synchronously, without waiting for a frame', () => {
    const frames = manualFrames();
    const store = createSessionsStore({ schedule: frames.schedule });
    function Draft() {
      return <p data-testid="d">{useDraft(store, 's1')}</p>;
    }
    render(<Draft />);
    act(() => store.setDraft('s1', 'typed'));
    expect(screen.getByTestId('d')).toHaveTextContent('typed');
  });

  it('unmounting cancels the pending frame', () => {
    let cancelled = 0;
    let pending = 0;
    const schedule: Schedule = () => {
      pending += 1;
      return () => {
        cancelled += 1;
      };
    };
    const store = createSessionsStore({ schedule });
    function View() {
      return <p>{useSession(store, 's1').lastSeq}</p>;
    }
    const { unmount } = render(<View />);
    store.apply('s1', chunk(1, 'x'));
    expect(pending).toBe(1);
    unmount();
    expect(cancelled).toBe(1);
  });
});
