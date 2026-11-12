import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Item } from '../../lib/sessionState.ts';
import { PermissionCard } from './PermissionCard.tsx';
import { ResearchControlProvider } from './ResearchContext.tsx';
import { AUTO_START_SECONDS } from './ResearchPlanCard.tsx';

type PermissionItem = Extract<Item, { kind: 'permission' }>;

const plan = (over: Partial<PermissionItem> = {}): PermissionItem => ({
  kind: 'permission',
  key: 'k',
  requestId: 'r1',
  toolCallId: 'r1',
  title: 'Quickshell survey',
  options: [{ id: 'start', name: 'Start', kind: 'allow_once' }],
  resolved: false,
  plan: { steps: ['Read the repository', 'List popular shells', 'Compare them'] },
  ...over,
});

afterEach(() => vi.useRealTimers());

describe('research plan card', () => {
  it('shows the steps and starts or cancels', async () => {
    const onRespond = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<PermissionCard item={plan()} answered={false} onRespond={onRespond} />);
    expect(screen.getByText('Quickshell survey')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: /^Start/ }));
    expect(onRespond).toHaveBeenCalledWith('r1', 'start', { steps: ['Read the repository', 'List popular shells', 'Compare them'] });
    unmount();
    const again = vi.fn();
    render(<PermissionCard item={plan()} answered={false} onRespond={again} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(again).toHaveBeenCalledWith('r1', null);
  });

  it('edits steps (change, remove, add) and starts with the edited list', async () => {
    const onRespond = vi.fn();
    const user = userEvent.setup();
    render(<PermissionCard item={plan()} answered={false} onRespond={onRespond} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const first = screen.getByRole('textbox', { name: 'Step 1' });
    await user.clear(first);
    await user.type(first, 'Read the docs');
    await user.click(screen.getAllByRole('button', { name: 'Remove step' })[2]!);
    await user.click(screen.getByRole('button', { name: 'Add a step' }));
    await user.type(screen.getByRole('textbox', { name: 'Step 3' }), 'Check the issues');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: /^Start/ }));
    expect(onRespond).toHaveBeenCalledWith('r1', 'start', { steps: ['Read the docs', 'List popular shells', 'Check the issues'] });
  });

  it('starts by itself when nobody answers, but not while the user edits', () => {
    vi.useFakeTimers();
    const onRespond = vi.fn();
    render(<PermissionCard item={plan()} answered={false} onRespond={onRespond} />);
    act(() => void vi.advanceTimersByTime((AUTO_START_SECONDS - 1) * 1000));
    expect(onRespond).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1500));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('r1', 'start', expect.objectContaining({ steps: expect.any(Array) }));
  });

  it('stops the clock while editing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onRespond = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<PermissionCard item={plan()} answered={false} onRespond={onRespond} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    act(() => void vi.advanceTimersByTime((AUTO_START_SECONDS + 30) * 1000));
    expect(onRespond).not.toHaveBeenCalled();
  });

  it('shrinks to the approved steps once answered, or says it was cancelled', () => {
    const { rerender } = render(<PermissionCard item={plan({ resolved: true, answer: { steps: ['Only this'] } })} answered onRespond={vi.fn()} />);
    expect(screen.getByText('Only this')).toBeInTheDocument();
    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<PermissionCard item={plan({ resolved: true })} answered onRespond={vi.fn()} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});

describe('research plan progress', () => {
  it('marks the running step with a spinner and the finished ones with a tick', () => {
    const progress = [
      { content: 'Read the repository', status: 'completed', priority: 'medium' },
      { content: 'List popular shells', status: 'in_progress', priority: 'medium' },
      { content: 'Compare them', status: 'pending', priority: 'medium' },
    ];
    const item = plan({ resolved: true, answer: { steps: progress.map((p) => p.content) }, progress });
    const stop = vi.fn();
    const { unmount } = render(
      <ResearchControlProvider value={{ running: true, stop }}>
        <PermissionCard item={item} answered onRespond={vi.fn()} />
      </ResearchControlProvider>,
    );
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'Completed' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stop).toHaveBeenCalledTimes(1);
    unmount();
    // Once the agent has stopped (or the turn ended), nothing spins and there is nothing to stop.
    render(<PermissionCard item={item} answered onRespond={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.getByText('Stopped · 1 of 3 done')).toBeInTheDocument();
  });

  it('says it is finished when every step is done', () => {
    const progress = [{ content: 'Only this', status: 'completed', priority: 'medium' }];
    render(<PermissionCard item={plan({ resolved: true, answer: { steps: ['Only this'] }, progress })} answered onRespond={vi.fn()} />);
    expect(screen.getByText('Finished')).toBeInTheDocument();
  });
});
