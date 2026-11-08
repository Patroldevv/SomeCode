import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import { ApiError, type PluginsOverview, type ServiceInfo } from '../lib/api.ts';
import { PluginsPage, prettyName } from './PluginsPage.tsx';

beforeEach(() => setLanguageForTests('en'));

const overview = (): PluginsOverview => ({
  plugins: [
    { id: 'redis-development@official', name: 'redis-development', marketplace: 'official', description: 'Redis guidance', category: 'database', owner: 'redis', components: { skills: 2, commands: 1, agents: 0, hooks: false, mcp: true }, homepage: 'https://redis.io', installed: true, enabled: true, version: '1.4.0' },
    { id: 'supabase@official', name: 'supabase', marketplace: 'official', description: 'Manage databases', category: 'database', installed: false },
    { id: 'snyk@official', name: 'snyk', marketplace: 'official', description: 'Security scanning', category: 'security', installed: false },
  ],
  skills: [
    { agent: 'claude', name: 'my-skill', description: 'Mine', source: 'user', removable: true },
    { agent: 'claude', name: 'redis-core', description: 'From plugin', source: 'plugin', removable: false, owner: 'redis' },
  ],
});

const services = (): ServiceInfo[] => [
  { id: 'github', name: 'GitHub', description: 'Pull requests and issues', url: 'https://api.githubcopilot.com/mcp/', transport: 'http', owner: 'github', category: 'development', token: 'optional', connected: false },
  { id: 'linear', name: 'Linear', description: 'Issues', url: 'https://mcp.linear.app/mcp', transport: 'http', category: 'productivity', connected: false },
  { id: 'notion', name: 'Notion', description: 'Pages and databases', url: 'https://mcp.notion.com/mcp', transport: 'http', category: 'productivity', connected: true },
];

function setup(over: Partial<React.ComponentProps<typeof PluginsPage>['api']> = {}) {
  let data = overview();
  let servicesNow = services();
  const api = {
    plugins: vi.fn(async () => data),
    pluginAction: vi.fn(async (action: string, id: string) => {
      data = { ...data, plugins: data.plugins.map((p) => (p.id === id ? { ...p, installed: action !== 'uninstall' ? true : false, enabled: action === 'disable' ? false : true } : p)) };
    }),
    addSkill: vi.fn(async () => {}),
    addSkillsFromGit: vi.fn(async () => ({ added: ['one', 'two'] })),
    removeSkill: vi.fn(async () => {}),
    services: vi.fn(async () => servicesNow),
    connectService: vi.fn(async (input: { name: string }) => {
      servicesNow = servicesNow.map((s) => (s.id === input.name ? { ...s, connected: true } : s));
    }),
    disconnectService: vi.fn(async (name: string) => {
      servicesNow = servicesNow.map((s) => (s.id === name ? { ...s, connected: false } : s));
    }),
    pluginIcon: vi.fn(async (owner: string) => (owner === 'redis' ? 'blob:logo' : null)),
    ...over,
  };
  const onClose = vi.fn();
  render(<PluginsPage api={api} onClose={onClose} />);
  return { api, onClose, user: userEvent.setup() };
}

describe('PluginsPage', () => {
  it('groups what is on offer by category and marks what is installed', async () => {
    setup();
    const database = await screen.findByRole('region', { name: 'Database' });
    expect(within(database).getByText('Redis development')).toBeInTheDocument();
    expect(within(database).getByRole('img', { name: 'Installed' })).toBeInTheDocument();
    expect(within(database).getByRole('button', { name: 'Install Supabase' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Security' })).toBeInTheDocument();
  });

  it('installs a plugin from its + button and says so', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Install Snyk' }));
    expect(api.pluginAction).toHaveBeenCalledWith('install', 'snyk@official');
    expect(await screen.findByText('Snyk installed. New chats will use it.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Install Snyk' })).not.toBeInTheDocument());
  });

  it('shows an error when an install fails and leaves the plugin installable', async () => {
    const { user } = setup({ pluginAction: vi.fn(async () => { throw new ApiError('internal'); }) });
    await user.click(await screen.findByRole('button', { name: 'Install Snyk' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install Snyk' })).toBeEnabled();
  });

  it('filters by search across names, descriptions and categories', async () => {
    const { user } = setup();
    await screen.findByRole('region', { name: 'Security' });
    await user.type(screen.getByRole('textbox', { name: 'Search plugins and skills' }), 'scanning');
    expect(screen.queryByRole('region', { name: 'Database' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Security' })).toBeInTheDocument();
    await user.clear(screen.getByRole('textbox', { name: 'Search plugins and skills' }));
    await user.type(screen.getByRole('textbox', { name: 'Search plugins and skills' }), 'zzzz');
    expect(screen.getByText('Nothing matches.')).toBeInTheDocument();
  });

  it('lists installed plugins with a switch and skills with where they come from; only the user\'s own can be removed', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('tab', { name: 'Installed (4)' }));
    const toggle = screen.getByRole('switch', { name: 'Redis development enabled' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    expect(api.pluginAction).toHaveBeenCalledWith('disable', 'redis-development@official');
    expect(screen.getByText('yours')).toBeInTheDocument();
    expect(screen.getByText('from a plugin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove skill my-skill' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove skill redis-core' })).not.toBeInTheDocument();
  });

  it('asks again before removing a skill, and uninstalls a plugin', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('tab', { name: /Installed/ }));
    await user.click(screen.getByRole('button', { name: 'Remove skill my-skill' }));
    expect(api.removeSkill).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.removeSkill).toHaveBeenCalledWith('claude', 'my-skill');
    await user.click(screen.getByRole('button', { name: 'Uninstall Redis development' }));
    expect(api.pluginAction).toHaveBeenCalledWith('uninstall', 'redis-development@official');
  });

  it('writes a skill for an agent', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Add a skill' }));
    const form = screen.getByRole('form', { name: 'Add a skill' });
    expect(within(form).getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: 'Name (letters, digits, dashes)' }), 'My Skill!');
    await user.type(within(form).getByRole('textbox', { name: 'When should the agent use it?' }), 'For tests');
    await user.type(within(form).getByRole('textbox', { name: 'Instructions' }), 'Do things');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'For which agent' }), 'agy');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(api.addSkill).toHaveBeenCalledWith({ agent: 'agy', name: 'my-skill-', description: 'For tests', content: 'Do things' });
    expect(await screen.findByText('Skill added: my-skill-.')).toBeInTheDocument();
  });

  it('adds the skills of a Git repository, and shows a refused one', async () => {
    const failing = vi.fn(async () => { throw new ApiError('bad_request'); });
    const { api, user } = setup({ addSkillsFromGit: failing });
    await user.click(await screen.findByRole('button', { name: 'Add a skill' }));
    await user.click(screen.getByRole('tab', { name: 'From Git' }));
    await user.type(screen.getByRole('textbox', { name: 'Repository address (https)' }), 'https://github.com/o/r');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.addSkillsFromGit).toHaveBeenCalledWith('claude', 'https://github.com/o/r');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('closes with Escape', async () => {
    const { onClose, user } = setup();
    await screen.findByRole('region', { name: 'Security' });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('PluginsPage logos, details and services', () => {
  it('shows a plugin\'s logo once it is loaded, and the letter tile for one without', async () => {
    const { api } = setup();
    const database = await screen.findByRole('region', { name: 'Database' });
    await waitFor(() => expect(within(database).getAllByRole('presentation', { hidden: true }).length + database.querySelectorAll('img').length).toBeGreaterThan(0));
    await waitFor(() => expect(database.querySelector('img')?.getAttribute('src')).toBe('blob:logo'));
    expect(api.pluginIcon).toHaveBeenCalledWith('redis');
    expect(within(screen.getByRole('region', { name: 'Security' })).queryByRole('img')).not.toBeInTheDocument();
  });

  it('opens the details of a plugin: what it adds, who made it, install or uninstall, and closes with Escape', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Details of Redis development' }));
    const dialog = screen.getByRole('dialog', { name: 'Redis development' });
    expect(within(dialog).getByText('Redis guidance')).toBeInTheDocument();
    expect(within(dialog).getByText('2 skills')).toBeInTheDocument();
    expect(within(dialog).getByText('1 commands')).toBeInTheDocument();
    expect(within(dialog).getByText('a service connection')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Open the homepage' })).toHaveAttribute('href', 'https://redis.io');
    await user.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    expect(api.pluginAction).toHaveBeenCalledWith('uninstall', 'redis-development@official');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a setup panel from a service\'s +, asks for an optional token, then connects and closes', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('tab', { name: 'Services' }));
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(api.connectService).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Set up GitHub' });
    expect(within(dialog).getByLabelText('Address')).toHaveValue('https://api.githubcopilot.com/mcp/');
    await user.type(within(dialog).getByLabelText('Access token (optional)'), 'ghp_abcdef123456');
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(api.connectService).toHaveBeenCalledWith({ name: 'github', url: 'https://api.githubcopilot.com/mcp/', transport: 'http', token: 'ghp_abcdef123456' });
    expect(await screen.findByText(/GitHub connected\./)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Set up GitHub' })).not.toBeInTheDocument();
  });

  it('shows no token field for a service that signs in on its own, and lets the address be changed', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('tab', { name: 'Services' }));
    await user.click(screen.getByRole('button', { name: 'Connect Linear' }));
    const dialog = screen.getByRole('dialog', { name: 'Set up Linear' });
    expect(within(dialog).queryByLabelText('Access token (optional)')).not.toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText('Address'));
    await user.type(within(dialog).getByLabelText('Address'), 'https://eu.linear.app/mcp');
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(api.connectService).toHaveBeenCalledWith({ name: 'linear', url: 'https://eu.linear.app/mcp', transport: 'http' });
  });

  it('closes the setup panel with Escape without connecting', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('tab', { name: 'Services' }));
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.connectService).not.toHaveBeenCalled();
  });

  it('connects and disconnects a service from the Services tab', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('tab', { name: 'Services' }));
    await user.click(screen.getByRole('button', { name: 'Connect Linear' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Connect' }));
    expect(api.connectService).toHaveBeenCalledWith({ name: 'linear', url: 'https://mcp.linear.app/mcp', transport: 'http' });
    expect(await screen.findByText(/Linear connected\./)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Disconnect Notion' }));
    expect(api.disconnectService).toHaveBeenCalledWith('notion');
  });

  it('connects another service by its address, and lists connected ones under Installed', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('tab', { name: 'Services' }));
    await user.click(screen.getByRole('button', { name: 'Connect another service' }));
    const form = screen.getByRole('form', { name: 'Connect another service' });
    expect(within(form).getByRole('button', { name: 'Connect' })).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: 'Name (letters, digits, dashes)' }), 'My Svc');
    await user.type(within(form).getByRole('textbox', { name: 'Address of the service (https)' }), 'https://svc.example/mcp');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Kind of connection' }), 'sse');
    await user.click(within(form).getByRole('button', { name: 'Connect' }));
    expect(api.connectService).toHaveBeenCalledWith({ name: 'my-svc', url: 'https://svc.example/mcp', transport: 'sse' });
    await user.click(screen.getByRole('tab', { name: /Installed/ }));
    expect(await screen.findByRole('button', { name: 'Disconnect Notion' })).toBeInTheDocument();
  });

  it('shows the failure when a service cannot be connected', async () => {
    const { user } = setup({ connectService: vi.fn(async () => { throw new ApiError('bad_request'); }) });
    await user.click(await screen.findByRole('tab', { name: 'Services' }));
    await user.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    const dialog = screen.getByRole('dialog', { name: 'Set up GitHub' });
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }));
    // The error shows in the panel, which stays open for another try.
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Set up GitHub' })).toBeInTheDocument();
  });
});

describe('PluginsPage loading', () => {
  it('shows placeholder cards until the lists arrive', async () => {
    let release!: (o: PluginsOverview) => void;
    setup({ plugins: vi.fn(() => new Promise<PluginsOverview>((r) => (release = r))) });
    expect(screen.getByRole('status', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true');
    release(overview());
    await screen.findByRole('region', { name: 'Database' });
    expect(screen.queryByRole('status', { name: 'Loading…' })).not.toBeInTheDocument();
  });

  it('opens on the lists asked for earlier, with no placeholder, and still refreshes them', async () => {
    const cachedPlugins = () => ({ overview: overview(), services: services() });
    const { api } = setup({ cachedPlugins });
    expect(screen.queryByRole('status', { name: 'Loading…' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Database' })).toBeInTheDocument();
    await waitFor(() => expect(api.plugins).toHaveBeenCalled());
  });

  it('shows a skill\'s owner logo in the Installed list', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('tab', { name: /Installed/ }));
    const row = (await screen.findByText('redis-core')).closest('li')!;
    await waitFor(() => expect(row.querySelector('img')?.getAttribute('src')).toBe('blob:logo'));
    expect(api.pluginIcon).toHaveBeenCalledWith('redis');
  });

  it('marks an installed plugin with a check icon, not a character', async () => {
    setup();
    const mark = (await screen.findAllByRole('img', { name: 'Installed' }))[0]!;
    expect(mark.querySelector('svg')).not.toBeNull();
    expect(mark.textContent).toBe('');
  });
});

describe('prettyName', () => {
  it('turns a dashed id into words', () => {
    expect(prettyName('redis-development')).toBe('Redis development');
    expect(prettyName('a_b-c')).toBe('A b c');
  });
});
