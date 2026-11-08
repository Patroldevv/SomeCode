import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { Subagent } from '../lib/subagents.ts';
import { SubagentsList } from './SubagentsList.tsx';

beforeAll(() => setLanguageForTests('en'));

const call = { kind: 'tool' as const, key: 'c1', id: 'c1', title: 'Read package.json', toolKind: 'read', status: 'completed', content: [] };
const agents: Subagent[] = [
  { id: 'a', name: 'explore', description: 'Explore the repo', prompt: 'Look around', status: 'completed', output: 'Found it', calls: [call] },
  { id: 'b', name: 'plan', status: 'running', calls: [] },
];

describe('SubagentsList', () => {
  it('lists the sub-agents; each opens to its task, activity and result', async () => {
    render(<SubagentsList agents={agents} />);
    // The running sub-agent starts open; the finished one starts folded.
    const [first] = screen.getAllByRole('button', { expanded: false });
    expect(screen.getByText('Explore the repo')).toBeInTheDocument();
    expect(screen.queryByText('Found it')).not.toBeInTheDocument();
    await userEvent.click(first!);
    expect(screen.getByText('Look around')).toBeInTheDocument();
    expect(screen.getByText('Read package.json')).toBeInTheDocument();
    expect(screen.getByText('Found it')).toBeInTheDocument();
  });

  it('says so when nothing was started', () => {
    render(<SubagentsList agents={[]} />);
    expect(screen.getByText('Sub-agents the agent starts will show up here.')).toBeInTheDocument();
  });
});
