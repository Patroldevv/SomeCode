import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { AgentUsage } from '../lib/api.ts';
import { dayKey, type UsageHistory } from '../lib/usageStats.ts';
import { UsagePage } from './UsagePage.tsx';

beforeEach(() => setLanguageForTests('en'));

const now = Date.now();
const usage: AgentUsage[] = [
  { id: 'claude', label: 'Claude', limits: [{ type: 'five_hour', used: 0.8, resetsAt: now + 2 * 3_600_000 + 14 * 60_000, status: 'allowed', updatedAt: now }, { type: 'seven_day', used: 0.3, resetsAt: now + 3 * 86_400_000, status: 'allowed', updatedAt: now }] },
  { id: 'opencode', label: 'OpenCode', limits: [], stats: [{ key: 'prompts7d', value: 54 }, { key: 'tokens7d', value: 28_700_000 }] },
];
const today = new Date();
const history: UsageHistory = {
  from: '2025-11-12',
  to: dayKey(today),
  generatedAt: now,
  days: [
    { date: dayKey(today), agents: { claude: { input: 1000, output: 4000, cacheWrite: 0, cacheRead: 5_000_000 } } },
    { date: dayKey(new Date(today.getTime() - 86_400_000)), agents: { opencode: { input: 10, output: 20, cacheWrite: 0, cacheRead: 0 } } },
  ],
  sources: [
    { id: 'claude', label: 'Claude', state: 'ok' },
    { id: 'opencode', label: 'OpenCode', state: 'ok' },
    { id: 'agy', label: 'Antigravity', state: 'unsupported', note: 'x' },
  ],
};

describe('UsagePage', () => {
  it('shows each limit as a bar with what is left and when it renews, colouring a nearly used one', async () => {
    render(<UsagePage loadUsage={async () => usage} loadHistory={async () => history} />);
    const claude = await screen.findByRole('region', { name: 'Claude' });
    const five = within(claude).getByRole('progressbar', { name: '5-hour' });
    expect(five).toHaveAttribute('aria-valuenow', '20');
    expect(within(claude).getByText('20% left')).toBeInTheDocument();
    expect(within(claude).getByText('2 h 14 min')).toBeInTheDocument();
    expect(within(claude).getByRole('progressbar', { name: 'Weekly' })).toHaveAttribute('aria-valuenow', '70');
    expect(five.closest('li')).toHaveAttribute('data-tone', 'warn');
    expect(screen.getByText('Last 7 days: 54 requests, 28.7M tokens. No limit to show.')).toBeInTheDocument();
  });

  it('shows the token history: totals, a heatmap whose cells say what was used, and a note for an agent that keeps no record', async () => {
    render(<UsagePage loadUsage={async () => usage} loadHistory={async () => history} />);
    expect(await screen.findByText('Active days')).toBeInTheDocument();
    const totals = screen.getByText('Total').parentElement!;
    expect(totals).toHaveTextContent('5.0M');
    const cells = document.querySelectorAll('.heat-cell[title]');
    const withUse = [...cells].filter((c) => c.getAttribute('data-level') !== '0');
    expect(withUse).toHaveLength(2);
    expect([...withUse].some((c) => /5\.0M tokens/.test(c.getAttribute('title') ?? ''))).toBe(true);
    expect(screen.getByText(/Antigravity keeps no token record/)).toBeInTheDocument();
  });

  it('switches between daily, weekly and cumulative, and narrows to one agent', async () => {
    const user = userEvent.setup();
    render(<UsagePage loadUsage={async () => usage} loadHistory={async () => history} />);
    await screen.findByText('Active days');
    await user.click(screen.getByRole('tab', { name: 'Weekly' }));
    expect(screen.getByRole('img', { name: 'Weekly' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Cumulative' }));
    expect(screen.getByRole('img', { name: 'Cumulative' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Daily' }));
    await user.click(screen.getByRole('button', { name: 'OpenCode' }));
    expect(screen.getByText('Total').parentElement).toHaveTextContent('30');
    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Total').parentElement).toHaveTextContent('5.0M');
  });

  it('says what it is doing while counting, and when there is nothing or it failed', async () => {
    const { unmount } = render(<UsagePage loadUsage={async () => []} loadHistory={() => new Promise(() => {})} />);
    expect(screen.getByRole('status')).toHaveTextContent('Counting tokens…');
    unmount();
    const empty = render(<UsagePage loadUsage={async () => []} loadHistory={async () => ({ ...history, days: [], sources: [{ id: 'claude', label: 'Claude', state: 'empty' }] })} />);
    expect(await screen.findByText('No token record found on this computer yet.')).toBeInTheDocument();
    empty.unmount();
    render(<UsagePage loadUsage={async () => []} loadHistory={async () => Promise.reject(new Error('x'))} />);
    await waitFor(() => expect(screen.getByText('Could not be asked right now.')).toBeInTheDocument());
  });

  it('asks again from the server when refreshed', async () => {
    const loadUsage = vi.fn(async () => usage);
    const loadHistory = vi.fn(async () => history);
    render(<UsagePage loadUsage={loadUsage} loadHistory={loadHistory} />);
    await screen.findByText('Active days');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh agents' }));
    await waitFor(() => expect(loadUsage).toHaveBeenLastCalledWith(true));
    expect(loadHistory).toHaveBeenLastCalledWith(true);
  });
});
