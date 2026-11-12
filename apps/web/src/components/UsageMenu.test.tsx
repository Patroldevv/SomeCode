import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { AgentUsage } from '../lib/api.ts';
import { resetLabel, UsageMenu } from './UsageMenu.tsx';

beforeAll(() => setLanguageForTests('en'));
afterEach(() => vi.useRealTimers());

const now = new Date(2026, 10, 8, 12, 0).getTime();
const usage: AgentUsage[] = [
  {
    id: 'claude',
    label: 'Claude',
    limits: [
      { type: 'five_hour', used: 0.24, resetsAt: new Date(2026, 10, 8, 14, 20).getTime(), status: 'allowed', updatedAt: now },
      { type: 'seven_day', used: 0.47, resetsAt: new Date(2026, 10, 9, 3, 0).getTime(), status: 'allowed', updatedAt: now },
      { type: 'five_hour_old', used: 0.5, resetsAt: new Date(2026, 10, 7, 1, 0).getTime(), status: 'allowed', updatedAt: now },
    ],
  },
  { id: 'agy', label: 'Antigravity', limits: [] },
];

describe('UsageMenu', () => {
  it('shows what each agent reported (percent left, renewal) and says so for one that has not', async () => {
    // Only the clock is faked: the renewal times above are relative to this moment.
    vi.useFakeTimers({ toFake: ['Date'], now });
    const load = vi.fn(async () => usage);
    render(<UsageMenu load={load} />);
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(await screen.findByText('76% left')).toBeInTheDocument();
    expect(screen.getByText('53% left')).toBeInTheDocument();
    expect(screen.getByText('5-hour')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('Renewed')).toBeInTheDocument();
    expect(screen.getByText('Has not reported its limits yet')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Antigravity' })).toBeInTheDocument();
  });

  it('groups an agent\'s windows by their group, shows plain stats, and says why an agent could not be asked', async () => {
    const data: AgentUsage[] = [
      { id: 'agy', label: 'Antigravity', limits: [{ type: 'Gemini Models|five_hour', label: 'Gemini Models', used: 0.22, resetsAt: Date.now() + 3_600_000, status: 'allowed', updatedAt: 1 }] },
      { id: 'opencode', label: 'OpenCode', limits: [], stats: [{ key: 'prompts7d', value: 48 }, { key: 'tokens7d', value: 2_100_000 }] },
      { id: 'claude', label: 'Claude', limits: [], error: 'signed_out' },
      { id: 'other', label: 'Other', limits: [], error: 'unavailable' },
    ];
    render(<UsageMenu load={async () => data} />);
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(await screen.findByText('Gemini Models · 5-hour')).toBeInTheDocument();
    expect(screen.getByText('78% left')).toBeInTheDocument();
    expect(screen.getByText('Last 7 days: 48 requests, 2.1M tokens. No limit to show.')).toBeInTheDocument();
    expect(screen.getByText('Sign-in has run out: run the agent once to renew it.')).toBeInTheDocument();
    expect(screen.getByText('Could not be asked right now.')).toBeInTheDocument();
  });

  it('asks again from the server when refreshed', async () => {
    const load = vi.fn(async () => [] as AgentUsage[]);
    render(<UsageMenu load={load} />);
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh agents' }));
    expect(load).toHaveBeenNthCalledWith(1, false);
    expect(load).toHaveBeenLastCalledWith(true);
  });

  it('fetches in the background and shows what it has the moment the menu opens', async () => {
    const load = vi.fn(async () => usage);
    render(<UsageMenu load={load} />);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(screen.getByRole('region', { name: 'Claude' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    // What it has is fresh, so opening does not ask again.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('asks again every few minutes without being opened', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'], now });
    const load = vi.fn(async () => usage);
    render(<UsageMenu load={load} />);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(false);
  });

  it('offers the detailed page and closes itself when it is opened', async () => {
    const onOpenDetails = vi.fn();
    render(<UsageMenu load={async () => usage} onOpenDetails={onOpenDetails} />);
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Detailed usage' }));
    expect(onOpenDetails).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('draws each window as a bar with the percent left', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now });
    render(<UsageMenu load={async () => usage} />);
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(await screen.findByRole('progressbar', { name: '5-hour' })).toHaveAttribute('aria-valuenow', '76');
    expect(screen.getByRole('progressbar', { name: 'Weekly' })).toHaveAttribute('aria-valuenow', '53');
  });

  it('closes on Escape', async () => {
    render(<UsageMenu load={async () => []} />);
    await userEvent.click(screen.getByRole('button', { name: 'Usage' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('resetLabel', () => {
  it('gives the time today, the weekday within a week, a date beyond', () => {
    expect(resetLabel(new Date(2026, 10, 8, 14, 20).getTime(), now)).toMatch(/(14|02)[:.]20/);
    expect(resetLabel(new Date(2026, 10, 10, 3, 0).getTime(), now)).toMatch(/\w+ 03[:.]00/);
    expect(resetLabel(new Date(2026, 10, 25, 3, 0).getTime(), now)).toMatch(/Nov|25/);
  });
});
