import { render, screen, within } from '@testing-library/react';
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
    connection: 'open' as const,
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
    expect(within(alpha).getAllByRole('button')).toHaveLength(2);
    expect(within(alpha).getByRole('button', { name: /First alpha task/ })).toBeInTheDocument();
    expect(within(alpha).getByRole('button', { name: /Claude Code · 1 min\. ago/ })).toBeInTheDocument();
    expect(within(beta).getAllByRole('button')).toHaveLength(1);
    expect(within(beta).getByRole('button', { name: /Beta work/ })).toBeInTheDocument();
  });

  it('marks only the active session with aria-current="true"', () => {
    userMessage('a2', 'Active one');
    renderSidebar({ activeId: 'a2' });
    const active = screen.getByRole('button', { name: /Active one/ });
    expect(active).toHaveAttribute('aria-current', 'true');
    for (const other of screen.getAllByRole('button').filter((b) => b !== active)) {
      expect(other).not.toHaveAttribute('aria-current');
    }
  });

  it('calls onSelect with the session id on click', async () => {
    userMessage('b1', 'Beta work');
    const props = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: /Beta work/ }));
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('b1');
  });

  it('opens the new-session dialog from its button', async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
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
    const active = screen.getByRole('button', { current: true });
    expect(within(active).getByRole('img', { name: 'Waiting for permission' })).toBeInTheDocument();
  });

  it('shows the status of the active session only; other sessions get a neutral dot', () => {
    store.apply('a1', { seq: 1, sessionId: 'a1', ts: 0, event: { type: 'status', status: 'running' } });
    renderSidebar({ activeId: 'a1' });
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument();
  });

  it('shows the connection state at the bottom', () => {
    renderSidebar({ connection: 'reconnecting' });
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
  });

  it('empty: says there are no sessions yet and still offers New session', async () => {
    const props = renderSidebar({ groups: [] });
    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
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
