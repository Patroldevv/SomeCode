import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { EditedFile } from '../lib/edits.ts';
import { ChangesCard } from './ChangesCard.tsx';
import { ChangesList } from './ChangesList.tsx';

beforeAll(() => setLanguageForTests('en'));

const file = (path: string, added: number, removed: number): EditedFile => ({
  path,
  added,
  removed,
  toolKeys: [path],
  changes: [{ oldText: 'a\n', newText: 'b\n' }],
});

describe('ChangesCard', () => {
  const agent = (id: string, status: 'running' | 'completed' | 'failed') => ({ id, name: id, status, calls: [] });
  const open = () => ({ onOpenFiles: vi.fn(), onOpenChanges: vi.fn(), onOpenAgents: vi.fn() });

  it('shows the folder, the summed line counts and the sub-agents, each opening its tab', async () => {
    const handlers = open();
    render(<ChangesCard projectName="demo" files={[file('a.ts', 3, 1), file('b.ts', 2, 0)]} subagents={[agent('x', 'running'), agent('y', 'completed')]} {...handlers} />);
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
    expect(screen.getByText('1 running')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'demo' }));
    await userEvent.click(screen.getByRole('button', { name: /Changes/ }));
    await userEvent.click(screen.getByRole('button', { name: /Sub-agents/ }));
    expect(handlers.onOpenFiles).toHaveBeenCalledOnce();
    expect(handlers.onOpenChanges).toHaveBeenCalledOnce();
    expect(handlers.onOpenAgents).toHaveBeenCalledOnce();
  });

  it('shows only what exists, and counts finished sub-agents when none is running', () => {
    render(<ChangesCard projectName="demo" files={[]} subagents={[agent('x', 'completed'), agent('y', 'completed')]} {...open()} />);
    expect(screen.queryByRole('button', { name: /Changes/ })).not.toBeInTheDocument();
    expect(screen.getByText('2 done')).toBeInTheDocument();
  });
});

describe('ChangesCard context', () => {
  const none = { onOpenFiles: () => {}, onOpenChanges: () => {}, onOpenAgents: () => {} };

  it('is there from the start of a session and shows how full the context is', () => {
    render(<ChangesCard projectName="demo" files={[]} subagents={[]} context={{ used: 150_000, size: 1_000_000, estimated: false }} {...none} />);
    expect(screen.getByRole('button', { name: 'demo' })).toBeInTheDocument();
    expect(screen.getByText('15% used')).toBeInTheDocument();
    expect(screen.getByText('150k / 1.0M')).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });

  it('marks an estimate as one', () => {
    render(<ChangesCard projectName="demo" files={[]} subagents={[]} context={{ used: 20_000, size: 200_000, estimated: true }} {...none} />);
    expect(screen.getByText('≈ 10% used')).toBeInTheDocument();
  });
});

describe('ChangesList', () => {
  it('says so when nothing changed', () => {
    render(<ChangesList files={[]} />);
    expect(screen.getByText('Files the agent changes will show up here.')).toBeInTheDocument();
  });

  it('opens the first file and unfolds the others on request', async () => {
    render(<ChangesList files={[file('src/a.ts', 1, 1), file('src/b.ts', 1, 1)]} />);
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(second!);
    expect(second).toHaveAttribute('aria-expanded', 'true');
  });
});
