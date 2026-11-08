import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguageForTests } from '../i18n/index.ts';
import type { AgentInfo, ProjectInfo, SessionInfo } from '../lib/api.ts';
import { createSessionsStore, type SessionsStore } from '../lib/sessionsStore.ts';
import { EmptyState } from './EmptyState.tsx';
import { Sidebar, type ProjectGroup } from './Sidebar.tsx';

const agents: AgentInfo[] = [{ id: 'claude', label: 'Claude Code', installed: true }];
const project = (id: string, name: string): ProjectInfo => ({ id, name, path: `/home/u/${name}` });
const session = (id: string, projectId: string, createdAt = Date.now() - 60_000): SessionInfo => ({
  id,
  projectId,
  agentId: 'claude',
  createdAt,
  title: null,
});

const groups: ProjectGroup[] = [
  { project: project('p1', 'alpha'), sessions: [session('a1', 'p1'), session('a2', 'p1')] },
  { project: project('p2', 'beta'), sessions: [session('b1', 'p2')] },
];

let store: SessionsStore;
beforeEach(() => {
  setLanguageForTests('en');
  store = createSessionsStore();
});

function renderSidebar(over: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props = {
    groups,
    activeId: null,
    store,
    agents,
    onSelect: vi.fn(),
    onNewSession: vi.fn(),
    ...over,
  };
  render(<Sidebar {...props} />);
  return props;
}

const userMessage = (sessionId: string, text: string) =>
  store.apply(sessionId, { seq: 1, sessionId, ts: 0, event: { type: 'user_message', text } });

describe('Sidebar', () => {
  it('groups sessions under their projects', () => {
    userMessage('a1', 'First alpha task');
    userMessage('b1', 'Beta work');
    renderSidebar();
    const alpha = screen.getByRole('region', { name: 'alpha' });
    const beta = screen.getByRole('region', { name: 'beta' });
    // A collapse toggle plus the two sessions.
    expect(within(alpha).getAllByRole('button')).toHaveLength(3);
    expect(within(alpha).getByRole('button', { name: /First alpha task/ })).toBeInTheDocument();
    expect(within(alpha).getByRole('button', { name: /Claude Code · 1 min\. ago/ })).toBeInTheDocument();
    expect(within(beta).getAllByRole('button')).toHaveLength(2);
    expect(within(beta).getByRole('button', { name: /Beta work/ })).toBeInTheDocument();
  });

  it('marks only the active session with aria-current="true"', () => {
    userMessage('a2', 'Active one');
    renderSidebar({ activeId: 'a2' });
    const alpha = within(screen.getByRole('region', { name: 'alpha' }));
    const active = alpha.getByRole('button', { name: /Active one/ });
    expect(active).toHaveAttribute('aria-current', 'true');
    for (const other of alpha.getAllByRole('button').filter((b) => b !== active)) {
      expect(other).not.toHaveAttribute('aria-current');
    }
    expect(within(screen.getByRole('region', { name: 'beta' })).queryByRole('button', { current: true })).toBeNull();
  });

  it('calls onSelect with the session id on click', async () => {
    userMessage('b1', 'Beta work');
    const props = renderSidebar();
    await userEvent.click(within(screen.getByRole('region', { name: 'beta' })).getByRole('button', { name: /Beta work/ }));
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('b1');
  });

  it('opens the new-session dialog from its button', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(props.onNewSession).toHaveBeenCalledOnce();
  });

  it('labels the active session dot "Waiting for permission" while a permission is unresolved', () => {
    store.apply('a1', {
      seq: 1,
      sessionId: 'a1',
      ts: 0,
      event: { type: 'permission_request', requestId: 'r1', toolCallId: 't1', title: 'Run ls', options: [] },
    });
    renderSidebar({ activeId: 'a1' });
    const [active] = screen.getAllByRole('button', { current: true });
    expect(within(active!).getByRole('img', { name: 'Waiting for permission' })).toBeInTheDocument();
  });

  it('shows a status dot only for sessions that are not idle', () => {
    store.apply('a1', { seq: 1, sessionId: 'a1', ts: 0, event: { type: 'status', status: 'running' } });
    renderSidebar({ activeId: 'a1' });
    const dots = screen.getAllByRole('img');
    expect(dots.length).toBeGreaterThan(0);
    for (const dot of dots) expect(dot).toHaveAccessibleName('Running');
  });

  it('lists the newest sessions again under Recent, flat', () => {
    renderSidebar({
      groups: [
        { project: project('p1', 'alpha'), sessions: [session('a1', 'p1', 1000), session('a2', 'p1', 3000)] },
        { project: project('p2', 'beta'), sessions: [session('b1', 'p2', 2000)] },
      ],
    });
    const recent = within(screen.getByRole('region', { name: 'Recent' }));
    expect(recent.getAllByRole('button')).toHaveLength(3);
  });

  it('empty: says there are no sessions yet and still offers New session', async () => {
    const props = renderSidebar({ groups: [] });
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(props.onNewSession).toHaveBeenCalledOnce();
  });
});

describe('EmptyState', () => {
  it('shows "Start your first session" with an action that opens the dialog', async () => {
    const onNewSession = vi.fn();
    render(<EmptyState onNewSession={onNewSession} />);
    expect(screen.getByRole('heading', { name: 'Start your first session' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it('is in Turkish when the language is Turkish', () => {
    setLanguageForTests('tr');
    render(<EmptyState onNewSession={() => {}} />);
    expect(screen.getByRole('heading', { name: 'İlk oturumunu başlat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni oturum' })).toBeInTheDocument();
  });
});

describe('Sidebar behaviours', () => {
  it('collapses and expands a project from its header', async () => {
    userMessage('a1', 'First alpha task');
    renderSidebar();
    const alpha = screen.getByRole('region', { name: 'alpha' });
    const toggle = within(alpha).getByRole('button', { name: 'alpha' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(alpha).queryByRole('button', { name: /First alpha task/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'beta' })).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(within(alpha).getByRole('button', { name: /First alpha task/ })).toBeInTheDocument();
  });

  it('shows how many sessions a project has, outside its accessible name', () => {
    renderSidebar();
    const alpha = screen.getByRole('region', { name: 'alpha' });
    expect(within(alpha).getByText('2')).toBeInTheDocument();
  });

  it('filters across projects, hides projects without a match and says so when nothing matches', async () => {
    userMessage('a1', 'Fix the parser');
    userMessage('b1', 'Write docs');
    renderSidebar();
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    await userEvent.type(search, 'parser');
    expect(screen.getByRole('region', { name: 'alpha' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'beta' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Write docs/ })).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('No matching conversations')).toBeInTheDocument();
    expect(screen.queryByText('No sessions yet')).not.toBeInTheDocument();
  });

  it('a collapsed project is expanded while searching so matches stay visible', async () => {
    userMessage('a1', 'Fix the parser');
    renderSidebar();
    const alpha = screen.getByRole('region', { name: 'alpha' });
    await userEvent.click(within(alpha).getByRole('button', { name: 'alpha' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search conversations' }), 'parser');
    expect(within(screen.getByRole('region', { name: 'alpha' })).getByRole('button', { name: /Fix the parser/ })).toBeInTheDocument();
  });

  it('Ctrl+K focuses the search and Escape clears it', async () => {
    renderSidebar();
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(search).toHaveFocus();
    await userEvent.type(search, 'abc');
    expect(search).toHaveValue('abc');
    await userEvent.keyboard('{Escape}');
    expect(search).toHaveValue('');
  });

  it('the arrow keys move focus between session rows', async () => {
    userMessage('a1', 'One');
    userMessage('a2', 'Two');
    renderSidebar();
    const rows = screen.getAllByRole('button').filter((b) => /^(One|Two|Claude Code)/.test(b.textContent ?? ''));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    rows[0]!.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(rows[0]).toHaveFocus();
  });
});

describe('Sidebar right-click menu, rename and drag', () => {
  beforeEach(() => localStorage.removeItem('somecode.sidebarOrder'));

  const alpha = () => within(screen.getByRole('region', { name: 'alpha' }));

  it('renames a session in place from its right-click menu', async () => {
    userMessage('a1', 'First alpha task');
    const props = renderSidebar({ onRenameSession: vi.fn(), onDeleteSession: vi.fn() });
    fireEvent.contextMenu(alpha().getByRole('button', { name: /First alpha task/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename' });
    await userEvent.clear(input);
    await userEvent.type(input, '  Better name {Enter}');
    expect(props.onRenameSession).toHaveBeenCalledExactlyOnceWith('a1', 'Better name');
    expect(screen.queryByRole('textbox', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('cancels a rename with Escape and ignores an empty name', async () => {
    userMessage('a1', 'First alpha task');
    const props = renderSidebar({ onRenameSession: vi.fn() });
    fireEvent.contextMenu(alpha().getByRole('button', { name: /First alpha task/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Rename' }), 'x{Escape}');
    expect(props.onRenameSession).not.toHaveBeenCalled();
    fireEvent.contextMenu(alpha().getByRole('button', { name: /First alpha task/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Rename' }));
    await userEvent.keyboard('{Enter}');
    expect(props.onRenameSession).not.toHaveBeenCalled();
  });

  it('asks again before deleting, and only then deletes', async () => {
    userMessage('a1', 'First alpha task');
    const props = renderSidebar({ onDeleteSession: vi.fn() });
    fireEvent.contextMenu(alpha().getByRole('button', { name: /First alpha task/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText('Delete this chat for good?')).toBeInTheDocument();
    expect(props.onDeleteSession).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(props.onDeleteSession).toHaveBeenCalledExactlyOnceWith('a1');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('offers rename and delete for a project too, and closes on Escape', async () => {
    const props = renderSidebar({ onRenameProject: vi.fn(), onDeleteProject: vi.fn() });
    fireEvent.contextMenu(screen.getByRole('button', { name: 'alpha' }));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Delete']);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'alpha' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Rename' }), '2{Enter}');
    expect(props.onRenameProject).toHaveBeenCalledWith('p1', 'alpha2');
  });

  it('has no menu when nothing can be done', () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'alpha' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('drags a session to a new place in its project and remembers it', () => {
    userMessage('a1', 'First alpha task');
    userMessage('a2', 'Second alpha task');
    renderSidebar();
    const labels = () => alpha().getAllByRole('button').filter((b) => b.hasAttribute('data-session-row')).map((b) => b.textContent);
    expect(labels()).toEqual(['Second alpha task', 'First alpha task']);
    const first = alpha().getByRole('button', { name: /First alpha task/ });
    const second = alpha().getByRole('button', { name: /Second alpha task/ });
    fireEvent.dragStart(first, { dataTransfer: { setData: () => {}, effectAllowed: '' } });
    const over = createEvent.dragOver(second);
    Object.defineProperty(over, 'clientY', { value: 0 });
    fireEvent(second, over);
    const drop = createEvent.drop(second);
    Object.defineProperty(drop, 'clientY', { value: 0 });
    fireEvent(second, drop);
    expect(labels()).toEqual(['First alpha task', 'Second alpha task']);
    expect(JSON.parse(localStorage.getItem('somecode.sidebarOrder')!).sessions.p1).toEqual(['a1', 'a2']);
  });
});
