import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../../i18n/index.ts';
import type { Item } from '../../lib/sessionState.ts';
import { ResearchControlProvider } from './ResearchContext.tsx';
import { VerificationCard } from './VerificationCard.tsx';

beforeEach(() => setLanguageForTests('en'));

type Card = Extract<Item, { kind: 'verification' }>;
const card = (over: Partial<Card> = {}): Card => ({
  kind: 'verification',
  key: 'v',
  id: 'v1',
  status: 'failed',
  round: 0,
  checks: [
    { name: 'Typecheck', command: 'npm run typecheck', status: 'passed', ms: 1200 },
    { name: 'Test', command: 'npm test', status: 'failed', ms: 800, output: 'FAIL src/a.test.ts\nexpected 1 to be 2' },
  ],
  ...over,
});

describe('verification card', () => {
  it('shows each check, opens the output of a failed one and says the errors went to the agent', async () => {
    const user = userEvent.setup();
    render(<VerificationCard item={card({ willFix: true })} />);
    expect(screen.getByText('1 checks failed')).toBeInTheDocument();
    expect(screen.getByText('The errors were sent to the agent to fix')).toBeInTheDocument();
    expect(screen.getByText('1.2 s')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show output' }));
    expect(screen.getByText(/expected 1 to be 2/)).toBeInTheDocument();
  });

  it('says why nothing was sent: automatic fixing is off, or the rounds are used up', () => {
    const { unmount } = render(<VerificationCard item={card()} />);
    expect(screen.getByText('Automatic fixing is off')).toBeInTheDocument();
    unmount();
    render(<VerificationCard item={card({ round: 2 })} />);
    expect(screen.getByText('The fix rounds are used up; the rest is yours')).toBeInTheDocument();
  });

  it('shows progress while running, a tick when everything passed, and runs again on request', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <VerificationCard item={card({ status: 'running', checks: [{ name: 'Typecheck', command: 'npm run typecheck', status: 'passed' }, { name: 'Test', command: 'npm test', status: 'running' }] })} />,
    );
    expect(screen.getByText('Running checks…')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument();
    unmount();
    const runChecks = vi.fn();
    render(
      <ResearchControlProvider value={{ running: false, runChecks }}>
        <VerificationCard item={card({ status: 'passed', checks: [{ name: 'Test', command: 'npm test', status: 'passed', ms: 50 }] })} />
      </ResearchControlProvider>,
    );
    expect(screen.getByText('All 1 checks passed')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run again' }));
    expect(runChecks).toHaveBeenCalledTimes(1);
  });
});
