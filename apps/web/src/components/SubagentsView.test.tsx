import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { Subagent } from '../lib/subagents.ts';
import { SubagentsView } from './SubagentsView.tsx';

beforeAll(() => setLanguageForTests('en'));
beforeEach(() => globalThis.localStorage?.removeItem('somecode.subagentView'));

const agents: Subagent[] = [
  { id: 'a', name: 'explore', description: 'Explore the repo', prompt: 'Look around', status: 'completed', output: 'Found it', calls: [] },
  { id: 'b', name: 'plan', status: 'running', parentId: 'a', calls: [] },
  { id: 'c', name: 'broken', status: 'failed', calls: [] },
];

describe('SubagentsView', () => {
  it('starts on the tree: the main agent, its sub-agents and theirs below them; pressing one shows its details', async () => {
    render(<SubagentsView agents={agents} />);
    expect(screen.getByText('Main agent')).toBeInTheDocument();
    const root = screen.getByRole('button', { name: /explore/ });
    const nested = within(root.closest('li')!).getByRole('button', { name: /plan/ });
    expect(nested).toBeInTheDocument();
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.getByText('2 levels')).toBeInTheDocument();
    await userEvent.click(root);
    expect(screen.getByText('Look around')).toBeInTheDocument();
    expect(screen.getByText('Found it')).toBeInTheDocument();
    await userEvent.click(root);
    expect(screen.queryByText('Found it')).not.toBeInTheDocument();
  });

  it('shows a task board with a column per state', async () => {
    render(<SubagentsView agents={agents} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(within(screen.getByRole('region', { name: 'Running' })).getByText('plan')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Done' })).getByText('explore')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Failed' })).getByText('broken')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('region', { name: 'Done' })).getByRole('button'));
    expect(screen.getByText('Found it')).toBeInTheDocument();
  });

  it('keeps the chosen view, offers the plain list, and says so when there are none', async () => {
    const { unmount } = render(<SubagentsView agents={agents} />);
    await userEvent.click(screen.getByRole('tab', { name: 'List' }));
    unmount();
    render(<SubagentsView agents={agents} />);
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true');
    unmount();
    render(<SubagentsView agents={[]} />);
    expect(screen.getByText('Sub-agents the agent starts will show up here.')).toBeInTheDocument();
  });
});
