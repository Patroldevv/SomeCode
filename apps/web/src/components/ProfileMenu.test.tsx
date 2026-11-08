import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { ProfileMenu } from './ProfileMenu.tsx';

beforeEach(() => setLanguageForTests('en'));

function setup(connection: 'open' | 'reconnecting' = 'open') {
  const props = { onOpenSettings: vi.fn(), onTheme: vi.fn() };
  render(<ProfileMenu connection={connection} light={false} {...props} />);
  return props;
}

describe('ProfileMenu', () => {
  it('opens Settings and switches the theme from its menu, closing after each', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Settings/ }));
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Switch theme' }));
    expect(props.onTheme).toHaveBeenCalledOnce();
  });

  it('closes on Escape and when clicking elsewhere', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    await userEvent.click(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('says how the connection is, to assistive tech always and in the menu when it is not fine', async () => {
    setup('reconnecting');
    expect(screen.getByText('Connection: Reconnecting')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(screen.getAllByText('Reconnecting').length).toBeGreaterThan(0);
  });
});
