import { useCallback, useState } from 'react';
import { ChatHeader, ChatView, ErrorBanner } from './components/ChatView.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { SidebarIcon } from './components/icons.tsx';
import { NewSessionDialog, type NewSessionInput } from './components/NewSessionDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { useCatalog } from './hooks/useCatalog.ts';
import { useConnection, type UseConnectionOptions } from './hooks/useConnection.ts';
import { useSidebarOpen } from './hooks/useSidebarOpen.ts';
import { errorText, t, type MessageParams } from './i18n/index.ts';
import { loadActiveSession, saveActiveSession } from './lib/activeSession.ts';
import { createApi, type Api } from './lib/api.ts';
import { createSessionsStore, type SessionsStore } from './lib/sessionsStore.ts';
import { loadToken } from './lib/token.ts';

export function App() {
  const [token] = useState(loadToken);
  if (token === null) {
    return (
      <main className="flex h-dvh items-center justify-center bg-bg px-4 font-ui text-text">
        <p className="max-w-md text-center">{t('token.missing')}</p>
      </main>
    );
  }
  return <Client token={token} />;
}

/** The server normalises project paths; compare without trailing slashes so `/a/b/` finds `/a/b`. */
const samePath = (a: string, b: string): boolean => (a.replace(/\/+$/, '') || '/') === (b.replace(/\/+$/, '') || '/');

export type ClientProps = {
  token: string;
  /** Test seams: a fake REST client, a fake WebSocket and a store with a hand-driven frame scheduler. */
  api?: Api;
  createSocket?: UseConnectionOptions['createSocket'];
  store?: SessionsStore;
};

export function Client({ token, api: injectedApi, createSocket, store: injectedStore }: ClientProps) {
  const [api] = useState(() => injectedApi ?? createApi(token));
  const [store] = useState(() => injectedStore ?? createSessionsStore());
  // The session this tab showed before a reload (F5) is restored and replayed from seq 0.
  const [restoredId] = useState(loadActiveSession);
  const [activeId, setActiveId] = useState<string | null>(restoredId);
  const [banner, setBanner] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Opening the dialog re-reads the agents: sign-in state may have changed since the page loaded.
  const openDialog = () => {
    reloadAgents();
    setDialogOpen(true);
  };
  const [sidebarOpen, toggleSidebar] = useSidebarOpen();

  const showError = useCallback((code: string, params?: MessageParams) => setBanner(errorText(code, params)), []);
  const { conn, state, activate } = useConnection({
    token,
    store,
    restoredId,
    onError: showError,
    onRestoreFailed: (id) => setActiveId((current) => (current === id ? null : current)),
    ...(createSocket ? { createSocket } : {}),
  });
  const { agents, groups, reload, reloadAgents } = useCatalog(api, showError);

  const select = (sessionId: string) => {
    // A banner is about the session it happened in.
    setBanner(null);
    saveActiveSession(sessionId);
    setActiveId(sessionId);
    activate(sessionId);
  };

  const create = async ({ agentId, name, path }: NewSessionInput): Promise<void> => {
    const known = (await api.projects()).find((p) => samePath(p.path, path));
    const project = known ?? (await api.addProject(name, path));
    const row = await api.createSession(project.id, agentId);
    select(row.id);
    reload();
  };

  const row = groups.flatMap((g) => g.sessions).find((s) => s.id === activeId);
  const sessionAgent = row ? agents.find((a) => a.id === row.agentId) : undefined;
  const agentLabel = row ? (sessionAgent?.label ?? row.agentId) : '';
  const signInHint = sessionAgent?.signInHint;
  const toggle = (
    <button
      type="button"
      aria-label={t('sidebar.toggle')}
      title={`${t('sidebar.toggle')} (Ctrl+B)`}
      aria-expanded={sidebarOpen}
      aria-controls="sidebar"
      onClick={toggleSidebar}
      className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
    >
      <SidebarIcon />
    </button>
  );
  const dismiss = () => setBanner(null);

  return (
    <div className="flex h-dvh bg-bg text-text">
      {sidebarOpen && (
        <Sidebar
          groups={groups}
          activeId={activeId}
          store={store}
          agents={agents}
          connection={state}
          onSelect={select}
          onNewSession={openDialog}
        />
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        {activeId ? (
          <ChatView
            sessionId={activeId}
            store={store}
            send={(message) => conn?.send(message) ?? false}
            agentLabel={agentLabel}
            connection={state}
            banner={banner}
            onDismissBanner={dismiss}
            onError={showError}
            leading={toggle}
            {...(signInHint ? { signInHint } : {})}
          />
        ) : (
          <>
            <ChatHeader leading={toggle} />
            {banner && (
              <div className="mx-auto w-full max-w-3xl px-4 pt-3">
                <ErrorBanner message={banner} onDismiss={dismiss} />
              </div>
            )}
            <div className="min-h-0 flex-1">
              <EmptyState onNewSession={openDialog} />
            </div>
          </>
        )}
      </main>
      <NewSessionDialog
        open={dialogOpen}
        agents={agents}
        onClose={() => setDialogOpen(false)}
        onCreate={create}
        onError={showError}
      />
    </div>
  );
}
