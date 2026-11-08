import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { Toasts } from './Toasts.tsx';

beforeAll(() => setLanguageForTests('en'));

describe('Toasts', () => {
  it('opens the chat a card belongs to and dismisses it; a card without a chat only dismisses', async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Toasts
        toasts={[
          { id: 1, kind: 'done', text: 'Fix the bug is finished.', sessionId: 's1' },
          { id: 2, kind: 'limit', text: 'Claude · 5-hour: only 8% left.' },
        ]}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fix the bug is finished.' }));
    expect(onOpen).toHaveBeenCalledWith('s1');
    expect(onDismiss).toHaveBeenCalledWith(1);
    expect(screen.getByRole('button', { name: 'Claude · 5-hour: only 8% left.' })).toBeDisabled();
    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[1]!);
    expect(onDismiss).toHaveBeenLastCalledWith(2);
  });
});
