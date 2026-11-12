import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { AgentInfo, MemoryNote, ProjectInfo, ScheduledTaskInfo, ServerSettings } from '../lib/api.ts';
import { AutomationSettings, MemorySettings, type AutomationApi } from './AutomationSettings.tsx';

beforeEach(() => setLanguageForTests('en'));

const projects: ProjectInfo[] = [{ id: 'p1', name: 'shop', path: '/a' }, { id: 'p2', name: 'blog', path: '/b' }];
const agents: AgentInfo[] = [{ id: 'claude', label: 'Claude', installed: true } as AgentInfo];
const task = (over: Partial<ScheduledTaskInfo> = {}): ScheduledTaskInfo => ({ id: 't1', projectId: 'p1', project: 'shop', agentId: 'claude', title: 'Morning tests', prompt: 'Run the tests', when: 'every day at 09:00', enabled: true, nextRun: Date.now() + 3_600_000, lastRun: null, lastSessionId: null, runs: 2, ...over });

function setup(over: Partial<AutomationApi> = {}, settings: Partial<ServerSettings> = {}) {
  let tasks = [task()];
  let notes: MemoryNote[] = [{ id: 'm1', projectId: 'p1', text: 'Use pnpm, not npm', createdAt: 1 }];
  const api: AutomationApi = {
    tasks: vi.fn(async () => tasks),
    createTask: vi.fn(async (input) => {
      const created = task({ id: 't2', title: input.title, prompt: input.prompt });
      tasks = [...tasks, created];
      return created;
    }),
    updateTask: vi.fn(async (id, patch) => void (tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)))),
    deleteTask: vi.fn(async (id) => void (tasks = tasks.filter((t) => t.id !== id))),
    runTask: vi.fn(async () => ({ sessionId: 'chat-9' })),
    memory: vi.fn(async (projectId) => notes.filter((n) => n.projectId === projectId)),
    addMemory: vi.fn(async (projectId, text) => {
      const n = { id: `m${notes.length + 1}`, projectId, text, createdAt: 2 };
      notes = [...notes, n];
      return n;
    }),
    deleteMemory: vi.fn(async (id) => void (notes = notes.filter((n) => n.id !== id))),
    importMemory: vi.fn(async (projectId: string, text: string) => {
      const lines = text.split('\n').map((l: string) => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean);
      notes = [...notes, ...lines.map((l: string, i: number) => ({ id: `i${i}`, projectId, text: l, createdAt: 3 }))];
      return { added: lines.length, skipped: 0 };
    }),
    exportMemory: vi.fn(async () => undefined),
    verifyConfig: vi.fn(async () => ({ config: { enabled: true, autoFix: true, maxFixes: 2, checks: [] }, suggested: [{ name: 'Typecheck', command: 'npm run typecheck' }, { name: 'Test', command: 'npm test' }] })),
    askForChecks: vi.fn(async () => ({ sessionId: 'chat-checks' })),
    saveVerifyConfig: vi.fn(async (_id: string, config: { enabled: boolean; autoFix: boolean; maxFixes: number; checks: { name: string; command: string }[] }) => config),
    ...over,
  };
  const onOpenSession = vi.fn();
  const onSetting = vi.fn();
  const current = { planAutoApprove: true, defaultApproval: 'ask', agentGuide: true, scoutSubagent: true, agentTools: true, ...settings } as ServerSettings;
  // The Automation and Memory tabs of Settings, side by side here.
  render(
    <>
      <AutomationSettings api={api} projects={projects} agents={agents} settings={current} onSetting={onSetting} onOpenSession={onOpenSession} />
      <MemorySettings api={api} projects={projects} settings={current} onSetting={onSetting} />
    </>,
  );
  return { api, onOpenSession, onSetting, user: userEvent.setup() };
}

describe('AutomationSettings', () => {
  it('lists scheduled tasks with when, next run and how often they ran; pauses, runs now and deletes one', async () => {
    const { api, user, onOpenSession } = setup();
    const row = (await screen.findByText('Morning tests')).closest('.settings-row') as HTMLElement;
    expect(within(row).getByText(/shop · every day at 09:00 · next .* · ran 2×/)).toBeInTheDocument();
    await user.click(within(row).getByRole('switch', { name: 'Run Morning tests on schedule' }));
    expect(api.updateTask).toHaveBeenCalledWith('t1', { enabled: false });
    await user.click(within(row).getByRole('button', { name: 'Run Morning tests now' }));
    expect(api.runTask).toHaveBeenCalledWith('t1');
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith('chat-9'));
    await user.click(within(row).getByRole('button', { name: 'Delete Morning tests' }));
    await waitFor(() => expect(screen.queryByText('Morning tests')).not.toBeInTheDocument());
  });

  it('schedules a new daily task for a project and agent', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'New task' }));
    const form = screen.getByRole('form', { name: 'New task' });
    expect(within(form).getByRole('button', { name: 'Schedule' })).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: 'Name' }), 'Weekly report');
    await user.type(within(form).getByRole('textbox', { name: /What should the agent do/ }), 'Summarise the week');
    await user.click(within(form).getByRole('button', { name: 'Schedule' }));
    expect(api.createTask).toHaveBeenCalledWith({ projectId: 'p1', agentId: 'claude', title: 'Weekly report', prompt: 'Summarise the week', spec: { kind: 'daily', at: '09:00' } });
    expect(await screen.findByText('Weekly report')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'New task' })).not.toBeInTheDocument();
  });

  it('shows a project\'s memory, switches project, adds a note and forgets one', async () => {
    const { api, user } = setup();
    expect(await screen.findByText('Use pnpm, not npm')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'A note to remember (one fact)' }), 'Tests live in /spec');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(api.addMemory).toHaveBeenCalledWith('p1', 'Tests live in /spec');
    expect(await screen.findByText('Tests live in /spec')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Forget the note "Use pnpm/ }));
    await waitFor(() => expect(screen.queryByText('Use pnpm, not npm')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Project' }));
    await user.click(screen.getByRole('option', { name: 'blog' }));
    expect(await screen.findByText('No notes for this project yet.')).toBeInTheDocument();
    expect(api.memory).toHaveBeenLastCalledWith('p2');
  });

  it('switches the agent tools and each of their parts on and off', async () => {
    const { user, onSetting } = setup();
    await user.click(await screen.findByRole('switch', { name: 'Memory and scheduling tools for agents' }));
    expect(onSetting).toHaveBeenLastCalledWith({ agentTools: false });
    await user.click(screen.getByRole('switch', { name: 'Search past chats' }));
    expect(onSetting).toHaveBeenLastCalledWith({ historySearch: false });
    await user.click(screen.getByRole('switch', { name: 'Project memory' }));
    expect(onSetting).toHaveBeenLastCalledWith({ projectMemory: false });
    await user.click(screen.getByRole('switch', { name: 'Scheduled tasks' }));
    expect(onSetting).toHaveBeenLastCalledWith({ scheduledTasks: false });
  });

  it('shows the parts as off, and out of reach, when the tools are off', async () => {
    setup({}, { agentTools: false });
    const history = await screen.findByRole('switch', { name: 'Search past chats' });
    expect(history).toHaveAttribute('aria-checked', 'false');
    expect(history.closest('.auto-row')).toHaveAttribute('data-disabled');
  });

  it('sets up deep research: plan approval, depth and the engines (one always stays on)', async () => {
    const { user, onSetting } = setup({}, { researchEngines: ['google', 'bing'], researchDepth: 'deep' });
    await user.click(await screen.findByRole('switch', { name: 'Ask me to approve the plan' }));
    expect(onSetting).toHaveBeenLastCalledWith({ researchPlan: false });
    await user.click(screen.getByRole('button', { name: 'Depth' }));
    await user.click(screen.getByRole('option', { name: /Exhaustive/ }));
    expect(onSetting).toHaveBeenLastCalledWith({ researchDepth: 'exhaustive' });
    const engines = screen.getByRole('group', { name: 'Search engines' });
    await user.click(within(engines).getByRole('button', { name: 'Yandex' }));
    expect(onSetting).toHaveBeenLastCalledWith({ researchEngines: ['google', 'yandex', 'bing'] });
    await user.click(within(engines).getByRole('button', { name: 'Google' }));
    expect(onSetting).toHaveBeenLastCalledWith({ researchEngines: ['bing'] });
  });

  it('never lets the last engine be switched off', async () => {
    setup({}, { researchEngines: ['yandex'] });
    const engines = await screen.findByRole('group', { name: 'Search engines' });
    expect(within(engines).getByRole('button', { name: 'Yandex' })).toBeDisabled();
  });

  it('imports notes from pasted text and exports the memory', async () => {
    const { api, user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Import' }));
    await user.type(screen.getByRole('textbox', { name: 'Import notes' }), 'Deploy from main');
    await user.click(screen.getByRole('button', { name: 'Import notes' }));
    expect(api.importMemory).toHaveBeenCalledWith('p1', 'Deploy from main');
    expect(await screen.findByText('1 added, 0 skipped')).toBeInTheDocument();
    expect(await screen.findByText('Deploy from main')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(api.exportMemory).toHaveBeenCalled();
  });

  it('says so when nothing is scheduled', async () => {
    setup({ tasks: vi.fn(async () => []) });
    expect(await screen.findByText(/Nothing scheduled yet/)).toBeInTheDocument();
  });

  it('sets up a project\'s checks: suggestions, edits, limits, and saves only on the button', async () => {
    const { api, user } = setup();
    const section = await screen.findByRole('region', { name: 'Checks after changes' });
    const box = within(section);
    expect(await box.findByText(/No checks yet/)).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(box.getByRole('button', { name: 'Use suggestions' }));
    expect(box.getAllByRole('textbox', { name: 'Command, e.g. npm test' }).map((i) => (i as HTMLInputElement).value)).toEqual(['npm run typecheck', 'npm test']);
    await user.click(box.getByRole('button', { name: 'Add a check' }));
    // An unfinished row cannot be saved.
    expect(box.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(box.getByRole('button', { name: 'Remove check 3' }));
    await user.click(box.getByRole('switch', { name: 'Send failures to the agent to fix' }));
    await user.click(box.getByRole('button', { name: 'Save' }));
    expect(api.saveVerifyConfig).toHaveBeenCalledWith('p1', { enabled: true, autoFix: false, maxFixes: 2, checks: [{ name: 'Typecheck', command: 'npm run typecheck' }, { name: 'Test', command: 'npm test' }] });
    expect(await box.findByText('Saved')).toBeInTheDocument();
    expect(box.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('adds a suggestion with one press, and lets an agent work the checks out in a chat of its own', async () => {
    const { api, user, onOpenSession, onSetting } = setup();
    const box = within(await screen.findByRole('region', { name: 'Checks after changes' }));
    await user.click(await box.findByRole('switch', { name: 'Let agents propose the checks themselves' }));
    expect(onSetting).toHaveBeenLastCalledWith({ autoChecks: false });
    await user.click(await box.findByRole('button', { name: /Test\s*npm test/ }));
    expect(box.getAllByRole('textbox', { name: 'Command, e.g. npm test' }).map((i) => (i as HTMLInputElement).value)).toEqual(['npm test']);
    expect(box.getByRole('button', { name: /Test\s*npm test/ })).toBeDisabled();
    await user.click(box.getByRole('button', { name: 'Ask an agent' }));
    expect(api.askForChecks).toHaveBeenCalledWith('p1', 'claude', expect.stringContaining('checks_propose'));
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledWith('chat-checks'));
  });
});

