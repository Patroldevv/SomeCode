import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { getClientSettings, resetClientSettingsForTests } from '../lib/settings.ts';
import { SettingsPage } from './SettingsPage.tsx';

beforeEach(() => {
  setLanguageForTests('en');
  resetClientSettingsForTests();
});

function setup(over: Partial<React.ComponentProps<typeof SettingsPage>> = {}) {
  const props = {
    light: false,
    onTheme: vi.fn(),
    agents: [{ id: 'claude', label: 'Claude', installed: true, auth: 'signed_in' as const, version: '2.1' }],
    serverSettings: { planAutoApprove: true, defaultApproval: 'ask' as const, agentGuide: true },
    onRefreshAgents: vi.fn(),
    onSignIn: vi.fn(),
    onServerSetting: vi.fn(async () => {}),
    onClose: vi.fn(),
    ...over,
  };
  render(<SettingsPage {...props} />);
  return { ...props, user: userEvent.setup() };
}

describe('SettingsPage', () => {
  it('lists the categories and starts on General', () => {
    setup();
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['General', 'Permissions', 'Appearance', 'Agents']);
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 1, name: 'General' })).toBeInTheDocument();
  });

  it('has sound, notification and limit-alert switches, and the agent guide goes to the server', async () => {
    const { user, onServerSetting } = setup();
    expect(getClientSettings().soundEnabled).toBe(true);
    await user.click(screen.getByRole('switch', { name: 'Play a sound' }));
    expect(getClientSettings().soundEnabled).toBe(false);
    expect(getClientSettings().limitAlerts).toBe(true);
    await user.click(screen.getByRole('switch', { name: 'Warn when a limit runs low' }));
    expect(getClientSettings().limitAlerts).toBe(false);
    await user.click(screen.getByRole('tab', { name: 'Permissions' }));
    await user.click(screen.getByRole('switch', { name: 'Tell agents about the app' }));
    expect(onServerSetting).toHaveBeenCalledWith({ agentGuide: false });
  });

  it('saves browser-side preferences at once', async () => {
    const { user } = setup();
    expect(getClientSettings().confirmClose).toBe(false);
    await user.click(screen.getByRole('switch', { name: 'Ask before closing the tab' }));
    expect(getClientSettings().confirmClose).toBe(true);
    expect(screen.getByRole('switch', { name: 'Ask before closing the tab' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('switch', { name: 'Keep the computer awake while working' }));
    expect(getClientSettings().preventSleep).toBe(true);
  });

  it('sends the server-side plan-mode setting to the server', async () => {
    const { user, onServerSetting } = setup();
    await user.click(screen.getByRole('tab', { name: 'Permissions' }));
    const toggle = screen.getByRole('switch', { name: 'Allow read-only commands without asking' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(onServerSetting).toHaveBeenCalledWith({ planAutoApprove: false });
  });

  it('sets the default permissions of new chats on the server', async () => {
    const { user, onServerSetting } = setup();
    await user.click(screen.getByRole('tab', { name: 'Permissions' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Default permissions' }), 'full');
    expect(onServerSetting).toHaveBeenCalledWith({ defaultApproval: 'full' });
  });

  it('keeps the plan-mode switch off the table until the server answered', async () => {
    const { user } = setup({ serverSettings: null });
    await user.click(screen.getByRole('tab', { name: 'Permissions' }));
    expect(screen.getByRole('switch', { name: 'Allow read-only commands without asking' })).toBeDisabled();
  });

  it('switches the theme and lists the agents, with the extra-pickers option explained', async () => {
    const { user, onTheme } = setup();
    await user.click(screen.getByRole('tab', { name: 'Appearance' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Theme' }), 'light');
    expect(onTheme).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('tab', { name: 'Agents' }));
    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    const panel = within(screen.getByRole('tabpanel'));
    await user.click(panel.getByRole('switch', { name: 'Show extra pickers' }));
    expect(getClientSettings().showAdvancedOptions).toBe(true);
  });

  it('closes with the button and with Escape', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
