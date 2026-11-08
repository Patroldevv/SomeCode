import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { SubagentWait, waitLabel } from './SubagentWait.tsx';

beforeAll(() => setLanguageForTests('en'));
afterEach(() => vi.useRealTimers());

describe('SubagentWait', () => {
  it('formats the wait in seconds, then minutes', () => {
    expect(waitLabel(30)).toBe('30 s');
    expect(waitLabel(125)).toBe('2 min 05 s');
  });

  it('shows nothing while no sub-agent runs', () => {
    const { container } = render(<SubagentWait running={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts up while sub-agents run and goes away when they are done', () => {
    vi.useFakeTimers();
    let clock = 1_000_000;
    const now = () => clock;
    const { rerender } = render(<SubagentWait running={2} now={now} />);
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for sub-agents… 0 s');
    expect(screen.getByRole('status')).toHaveTextContent('2 running');
    act(() => {
      clock += 31_000;
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('31 s');
    rerender(<SubagentWait running={0} now={now} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
