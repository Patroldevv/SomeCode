import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Collapse } from './Collapse.tsx';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const motion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));

describe('Collapse', () => {
  it('without animation support (or with reduced motion) content appears and disappears at once', () => {
    motion(true);
    const { rerender } = render(
      <Collapse id="c" open={false}>
        <p>body</p>
      </Collapse>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
    rerender(
      <Collapse id="c" open>
        <p>body</p>
      </Collapse>,
    );
    expect(screen.getByText('body')).toBeInTheDocument();
    rerender(
      <Collapse id="c" open={false}>
        <p>body</p>
      </Collapse>,
    );
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('with motion allowed the content stays mounted while closing, then is removed', () => {
    vi.useFakeTimers();
    motion(false);
    const { rerender } = render(
      <Collapse id="c" open>
        <p>body</p>
      </Collapse>,
    );
    rerender(
      <Collapse id="c" open={false}>
        <p>body</p>
      </Collapse>,
    );
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(document.getElementById('c')).toHaveAttribute('data-state', 'closed');
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('reopening while it is still closing keeps the content', () => {
    vi.useFakeTimers();
    motion(false);
    const { rerender } = render(
      <Collapse id="c" open>
        <p>body</p>
      </Collapse>,
    );
    rerender(
      <Collapse id="c" open={false}>
        <p>body</p>
      </Collapse>,
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender(
      <Collapse id="c" open>
        <p>body</p>
      </Collapse>,
    );
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(document.getElementById('c')).toHaveAttribute('data-state', 'open');
  });
});
