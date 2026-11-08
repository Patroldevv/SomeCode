import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../../i18n/index.ts';
import type { ToolItem } from '../../lib/sessionState.ts';
import { SubagentGroup } from './SubagentGroup.tsx';

beforeAll(() => setLanguageForTests('en'));

const invoke = (id: string, role: string, status = 'completed'): ToolItem => ({
  kind: 'tool', key: id, id, title: 'Run invoke_subagent', toolKind: 'other', status, content: [],
  rawInput: { Prompt: `Do the ${role} work`, Role: role, TypeName: 'research' },
});

describe('SubagentGroup', () => {
  it('shows one line for several sub-agents, opens to each, and each opens to its task', async () => {
    const onToggle = vi.fn();
    const calls = [invoke('a', 'Database check'), invoke('b', 'Security review', 'in_progress')];
    const { rerender } = render(<SubagentGroup calls={calls} open={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole('button', { name: /2 sub-agents started/ }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<SubagentGroup calls={calls} open onToggle={onToggle} />);
    expect(screen.getByText('Database check')).toBeInTheDocument();
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.queryByText('Do the Security review work')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Security review/ }));
    expect(screen.getByText('Do the Security review work')).toBeInTheDocument();
  });

  it('names a single sub-agent in its line', () => {
    render(<SubagentGroup calls={[invoke('a', 'Database check')]} open={false} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: /Sub-agent started: Database check/ })).toBeInTheDocument();
  });

  it('provides a button to view in workspace panel and shows subagent tool calls', async () => {
    const onOpen = vi.fn();
    const calls = [invoke('a', 'Database check')];
    const subagents = [{
      id: 'a',
      name: 'Database check',
      prompt: 'Do the work',
      status: 'completed' as const,
      calls: [{ kind: 'tool' as const, key: 'c1', id: 'c1', title: 'Read db.ts', toolKind: 'read', status: 'completed', content: [] }],
      output: 'All tables verified',
    }];
    render(<SubagentGroup calls={calls} subagents={subagents} open onToggle={() => {}} onOpenAgents={onOpen} />);
    const panelBtn = screen.getByRole('button', { name: 'View in panel' });
    expect(panelBtn).toBeInTheDocument();
    await userEvent.click(panelBtn);
    expect(onOpen).toHaveBeenCalledWith();

    await userEvent.click(screen.getByRole('button', { name: /^Database check/ }));
    expect(screen.getByText('Read db.ts')).toBeInTheDocument();
    expect(screen.getByText('All tables verified')).toBeInTheDocument();
    const entryPanelBtn = screen.getByRole('button', { name: /View in panel →/ });
    await userEvent.click(entryPanelBtn);
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});
