import { useId } from 'react';
import { t } from '../i18n/index.ts';
import type { AgentInfo, ProjectInfo, SessionInfo } from '../lib/api.ts';
import type { ConnectionState } from '../lib/connection.ts';
import { sessionLabel } from '../lib/sessionLabel.ts';
import { useSession, type SessionsStore } from '../lib/sessionsStore.ts';
import { NeutralDot, StatusDot } from './StatusDot.tsx';

export type ProjectGroup = { project: ProjectInfo; sessions: SessionInfo[] };

const CONNECTION_DOT: Record<ConnectionState, string> = {
  connecting: 'bg-warning',
  open: 'bg-success',
  reconnecting: 'bg-warning',
  closed: 'bg-danger',
};

/** Projects with their sessions (newest first), a New session button and the connection state. */
export function Sidebar({
  groups,
  activeId,
  store,
  agents,
  connection,
  onSelect,
  onNewSession,
}: {
  groups: ProjectGroup[];
  activeId: string | null;
  store: SessionsStore;
  agents: AgentInfo[];
  connection: ConnectionState;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
}) {
  const empty = groups.every((g) => g.sessions.length === 0);
  return (
    <nav
      id="sidebar"
      aria-label={t('sidebar.label')}
      className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-bg-subtle font-ui"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <span className="text-sm font-semibold text-text">{t('app.title')}</span>
        <button
          type="button"
          onClick={onNewSession}
          className="rounded-md border border-border px-2 py-1 text-xs font-medium text-text hover:bg-bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {t('session.new')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {empty ? (
          <p className="px-2 py-3 text-sm text-text-muted">{t('sidebar.noSessions')}</p>
        ) : (
          groups.map((g) => (
            <ProjectSection key={g.project.id} group={g} activeId={activeId} store={store} agents={agents} onSelect={onSelect} />
          ))
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-xs text-text-muted">
        <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${CONNECTION_DOT[connection]}`} />
        <span className="sr-only">{t('connection.label')}: </span>
        <span>{t(`connection.${connection}`)}</span>
      </div>
    </nav>
  );
}

function ProjectSection({
  group,
  activeId,
  store,
  agents,
  onSelect,
}: {
  group: ProjectGroup;
  activeId: string | null;
  store: SessionsStore;
  agents: AgentInfo[];
  onSelect: (sessionId: string) => void;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-2">
      <h2 id={headingId} title={group.project.path} className="truncate px-2 py-1 text-xs font-medium text-text-muted">
        {group.project.name}
      </h2>
      <ul className="flex flex-col gap-px">
        {[...group.sessions].reverse().map((row) => (
          <li key={row.id}>
            <SessionButton row={row} active={row.id === activeId} store={store} agents={agents} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Subscribes to its own session only, so a streaming chunk re-renders just this row. */
function SessionButton({
  row,
  active,
  store,
  agents,
  onSelect,
}: {
  row: SessionInfo;
  active: boolean;
  store: SessionsStore;
  agents: AgentInfo[];
  onSelect: (sessionId: string) => void;
}) {
  const state = useSession(store, row.id);
  const label = sessionLabel(row, state, agents);
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      title={label}
      onClick={() => onSelect(row.id)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
        active ? 'bg-bg-elevated text-text' : 'text-text-muted hover:bg-bg-elevated hover:text-text'
      }`}
    >
      {active ? <StatusDot state={state} /> : <NeutralDot />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
