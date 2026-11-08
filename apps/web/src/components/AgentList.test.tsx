import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { AgentInfo } from '../lib/api.ts';
import { AgentList } from './AgentList.tsx';

beforeAll(() => setLanguageForTests('en'));
afterEach(() => vi.restoreAllMocks());

const agents: AgentInfo[] = [
  { id: 'claude', label: 'Claude', installed: true, auth: 'signed_in', signInHint: 'claude auth login' },
  { id: 'opencode', label: 'OpenCode', installed: true, auth: 'unknown', signInHint: 'opencode acp --login' },
  { id: 'agy', label: 'Antigravity', installed: true, auth: 'signed_out', signInHint: 'agy login' },
  { id: 'ghost', label: 'Ghost', installed: false, installHint: 'npm install -g ghost' },
];

const itemOf = (name: string) => screen.getByRole('listitem', { name });

describe('AgentList', () => {
  it('names every agent with a status in words, not only colour', () => {
    render(<AgentList agents={agents} />);
    expect(within(itemOf('Claude')).getByText('Signed in')).toBeInTheDocument();
    expect(within(itemOf('OpenCode')).getByText('Installed')).toBeInTheDocument();
    expect(within(itemOf('Antigravity')).getByText('Sign-in needed')).toBeInTheDocument();
    expect(within(itemOf('Ghost')).getByText('Not installed')).toBeInTheDocument();
  });

  it('shows the sign-in command only for a signed-out agent and the install command only for a missing one', () => {
    render(<AgentList agents={agents} />);
    expect(within(itemOf('Antigravity')).getByText('agy login')).toBeInTheDocument();
    expect(within(itemOf('Ghost')).getByText('npm install -g ghost')).toBeInTheDocument();
    expect(within(itemOf('Claude')).queryByText('claude auth login')).not.toBeInTheDocument();
    expect(within(itemOf('OpenCode')).queryByText('opencode acp --login')).not.toBeInTheDocument();
  });

  it('renders hint text as text, never as markup', () => {
    const hostile: AgentInfo[] = [{ id: 'x', label: 'X', installed: false, installHint: '<img src=x onerror=alert(1)>' }];
    const { container } = render(<AgentList agents={hostile} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('copies a command to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<AgentList agents={agents} />);
    await user.click(within(itemOf('Antigravity')).getByRole('button', { name: 'Copy command' }));
    expect(writeText).toHaveBeenCalledWith('agy login');
    expect(await within(itemOf('Antigravity')).findByText('Copied')).toBeInTheDocument();
  });

  it('survives a failing clipboard and renders nothing for an empty list', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    const { container, rerender } = render(<AgentList agents={agents} />);
    await user.click(within(itemOf('Antigravity')).getByRole('button', { name: 'Copy command' }));
    expect(within(itemOf('Antigravity')).queryByText('Copied')).not.toBeInTheDocument();
    expect(within(itemOf('Antigravity')).getByText('agy login')).toBeInTheDocument();
    rerender(<AgentList agents={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
