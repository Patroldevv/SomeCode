import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { TitleBar, type MenuDef } from './TitleBar.tsx';

beforeAll(() => setLanguageForTests('en'));

function setup(over: Partial<React.ComponentProps<typeof TitleBar>> = {}) {
  const onNew = vi.fn();
  const menus: MenuDef[] = [
    { id: 'file', label: 'File', items: [{ label: 'New chat', shortcut: 'Ctrl+N', onSelect: onNew }, { separator: true }, { label: 'Off', disabled: true, onSelect: vi.fn() }] },
    { id: 'help', label: 'Help', items: [{ heading: 'Shortcuts' }, { label: 'Search', onSelect: vi.fn() }] },
  ];
  const props = { canBack: true, canForward: false, onBack: vi.fn(), onForward: vi.fn(), sidebarOpen: true, onToggleSidebar: vi.fn(), menus, ...over };
  render(<TitleBar {...props} />);
  return { ...props, onNew, user: userEvent.setup() };
}

describe('TitleBar', () => {
  it('has back, forward and the sidebar switch, enabled as the history allows', async () => {
    const { user, onBack, onToggleSidebar } = setup();
    expect(screen.getByRole('button', { name: 'Forward' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: /Toggle sidebar/ }));
    expect(onBack).toHaveBeenCalledOnce();
    expect(onToggleSidebar).toHaveBeenCalledOnce();
  });

  it('opens a menu, runs an entry and closes; the neighbour opens as the pointer moves over it', async () => {
    const { user, onNew } = setup();
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: /Off/ })).toBeDisabled();
    await user.hover(screen.getByRole('menuitem', { name: 'Help' }));
    expect(screen.getByRole('menu', { name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'File' })).not.toBeInTheDocument();
    await user.hover(screen.getByRole('menuitem', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: /New chat/ }));
    expect(onNew).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes a menu with Escape', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
