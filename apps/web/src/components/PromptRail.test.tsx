import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { Item } from '../lib/sessionState.ts';
import { PromptRail, promptEntries } from './PromptRail.tsx';

beforeAll(() => setLanguageForTests('en'));

const user = (key: string, text: string): Item => ({ kind: 'user', key, text });
const agent = (key: string, text: string): Item => ({ kind: 'agent', key, text });

describe('promptEntries', () => {
  it('pairs every prompt with the start of its answer, without markdown noise', () => {
    const entries = promptEntries([user('1', 'First  question'), agent('2', '**Done.** See `code` here'), user('3', 'Second'), user('4', 'Third')]);
    expect(entries).toEqual([
      { index: 0, key: '1', text: 'First question', reply: 'Done. See code here' },
      { index: 2, key: '3', text: 'Second', reply: '' },
      { index: 3, key: '4', text: 'Third', reply: '' },
    ]);
  });
});

describe('PromptRail', () => {
  const prompts = promptEntries([user('1', 'Build the login'), agent('2', 'Login is built.'), user('3', 'Add tests'), agent('4', 'Tests added.')]);

  it('shows one tick per prompt with its text and reply, marks the active one and jumps on click', async () => {
    const onJump = vi.fn();
    render(<PromptRail prompts={prompts} activeKey="3" onJump={onJump} />);
    const ticks = screen.getAllByRole('button');
    expect(ticks).toHaveLength(2);
    expect(ticks[1]).toHaveAttribute('data-active', 'true');
    expect(ticks[0]).toHaveAccessibleName('Build the login');
    expect(screen.getByText('Login is built.')).toBeInTheDocument();
    await userEvent.click(ticks[1]!);
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it('stays out of the way with fewer than two prompts', () => {
    const { container } = render(<PromptRail prompts={prompts.slice(0, 1)} activeKey={null} onJump={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
