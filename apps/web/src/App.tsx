import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatHeader, ChatView, ErrorBanner } from "./components/ChatView.tsx";
import { NewChat, type FirstMessage } from "./components/NewChat.tsx";
import { WorkspacePanel } from "./components/WorkspacePanel.tsx";
import { TerminalPane } from "./components/TerminalPane.tsx";
import { CommandHint } from "./components/CommandHint.tsx";
import { SymbolIcon } from "./components/SymbolIcon.tsx";
import { SidebarIcon } from "./components/icons.tsx";
import { ContextIndicator } from "./components/ContextIndicator.tsx";
import { createWorkspaceApi, type WorkspaceApi } from "./lib/workspaceApi.ts";
import { ApiError, type SessionInfo } from "./lib/api.ts";
import { clearActiveSession } from "./lib/activeSession.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { ChangesCard } from "./components/ChangesCard.tsx";
import { ProfileMenu } from "./components/ProfileMenu.tsx";
import { TitleBar, type MenuDef } from "./components/TitleBar.tsx";
import { UsageMenu } from "./components/UsageMenu.tsx";
import { calculateContextStats } from "./components/ContextIndicator.tsx";
import { useNavHistory } from "./hooks/useNavHistory.ts";
// The two full pages are loaded the first time they are opened, which keeps them out of the start-up bundle.
const PluginsPage = lazy(() => import("./components/PluginsPage.tsx").then((m) => ({ default: m.PluginsPage })));
const SettingsPage = lazy(() => import("./components/SettingsPage.tsx").then((m) => ({ default: m.SettingsPage })));
import { matchesShortcut } from "./lib/shortcuts.ts";
import { getClientSettings, useClientSettings } from "./lib/settings.ts";
import type { ServerSettings } from "./lib/api.ts";
import { editsOfSession } from "./lib/edits.ts";
import { subagentsOf } from "./lib/subagents.ts";
import { useCatalog } from "./hooks/useCatalog.ts";
import { useAlerts } from "./hooks/useAlerts.ts";
import { Toasts } from "./components/Toasts.tsx";
import { primeAudio } from "./lib/sound.ts";
import { sessionLabel } from "./lib/sessionLabel.ts";
import {
  useConnection,
  type UseConnectionOptions,
} from "./hooks/useConnection.ts";
import { usePresence } from "./hooks/usePresence.ts";
import { useSidebarOpen } from "./hooks/useSidebarOpen.ts";
import { errorText, t, type MessageParams } from "./i18n/index.ts";
import { loadActiveSession, saveActiveSession } from "./lib/activeSession.ts";
import { createApi, type Api } from "./lib/api.ts";
import {
  createSessionsStore,
  useSession,
  type SessionsStore,
} from "./lib/sessionsStore.ts";
import { loadToken } from "./lib/token.ts";

export function App() {
  const [token] = useState(loadToken);
  if (token === null) {
    return (
      <main className="flex h-dvh items-center justify-center bg-bg px-4 font-ui text-text">
        <p className="max-w-md text-center">{t("token.missing")}</p>
      </main>
    );
  }
  return <Client token={token} />;
}

/** The server normalises project paths; compare without trailing slashes so `/a/b/` finds `/a/b`. */
const samePath = (a: string, b: string): boolean =>
  (a.replace(/\/+$/, "") || "/") === (b.replace(/\/+$/, "") || "/");

export type ClientProps = {
  token: string;
  /** Test seams: a fake REST client, a fake WebSocket and a store with a hand-driven frame scheduler. */
  api?: Api;
  workspaceApi?: WorkspaceApi;
  createSocket?: UseConnectionOptions["createSocket"];
  store?: SessionsStore;
};

export function Client({
  token,
  api: injectedApi,
  createSocket,
  store: injectedStore,
  workspaceApi: injectedWorkspaceApi,
}: ClientProps) {
  const [api] = useState(() => injectedApi ?? createApi(token));
  const [store] = useState(() => injectedStore ?? createSessionsStore());
  // The session this tab showed before a reload (F5) is restored and replayed from seq 0.
  const [restoredId] = useState(loadActiveSession);
  const [activeId, setActiveId] = useState<string | null>(restoredId);
  const [banner, setBanner] = useState<string | null>(null);
  const [workspaceApi] = useState(
    () => injectedWorkspaceApi ?? createWorkspaceApi(token),
  );
  const [panelOpen, setPanelOpen] = useState(() => getClientSettings().openPanelAtStart);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const clientSettings = useClientSettings();
  const [tabRequest, setTabRequest] = useState<{ tab: "files" | "changes" | "agents"; n: number } | undefined>();
  const [loginAgent, setLoginAgent] = useState<string | undefined>();
  const [lastCreated, setLastCreated] = useState<SessionInfo | null>(null);
  const navigation = useRef(0);
  const pendingCreated = useRef<{ key: string; row: SessionInfo } | null>(null);
  const [newKey, setNewKey] = useState(0);
  const [light, setLight] = useState(() => {
    try {
      return localStorage.getItem("somecode.theme") === "light";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.dataset["theme"] = light ? "light" : "dark";
    try {
      localStorage.setItem("somecode.theme", light ? "light" : "dark");
    } catch {}
  }, [light]);
  const [sidebarOpen, toggleSidebar] = useSidebarOpen();
  // Settings has its own category list, so the chat sidebar steps aside immediately while it is open (and comes back after).
  const sidebarVisible = sidebarOpen && !settingsOpen && !pluginsOpen;
  const sidebarMounted = usePresence(sidebarVisible, settingsOpen ? 0 : 420);

  const openSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const showError = useCallback(
    (code: string, params?: MessageParams) =>
      setBanner(errorText(code, params)),
    [],
  );
  const { conn, state, activate, loadOlder, showRecent } = useConnection({
    token,
    loadHistory: workspaceApi.history,
    store,
    restoredId,
    onError: showError,
    onRestoreFailed: (id) =>
      setActiveId((current) => (current === id ? null : current)),
    ...(createSocket ? { createSocket } : {}),
  });
  const { agents, groups, reload, reloadAgents } = useCatalog(api, showError);
  // Warm the server's options cache: an agent takes 5-15 s to start, and the new-chat screen should not wait on it.
  const warmed = useRef(new Set<string>());
  const warmPath = groups[0]?.project.path;
  useEffect(() => {
    if (!warmPath) return;
    for (const agent of agents) {
      if (!agent.installed || warmed.current.has(agent.id)) continue;
      warmed.current.add(agent.id);
      void api.agentOptions(agent.id, warmPath).catch(() => {});
    }
  }, [agents, warmPath, api]);

  const select = (sessionId: string) => {
    setSettingsOpen(false);
    setPluginsOpen(false);
    // Already open: nothing to load, nothing to replay.
    if (sessionId === activeId) {
      if (window.innerWidth <= 760 && sidebarOpen) toggleSidebar();
      return;
    }
    navigation.current++;
    // A banner is about the session it happened in.
    setBanner(null);
    saveActiveSession(sessionId);
    setActiveId(sessionId);
    activate(sessionId);
    if (window.innerWidth <= 760 && sidebarOpen) toggleSidebar();
  };

  const start = async ({
    agentId,
    name,
    path,
    text,
    attachments,
    config,
  }: FirstMessage): Promise<void> => {
    if (state !== "open" || !conn) throw new ApiError("network");
    const mine = navigation.current;
    const key = `${agentId}:${path}`;
    let row =
      pendingCreated.current?.key === key ? pendingCreated.current.row : null;
    const retrying = row !== null;
    if (!row) {
      const known = (await api.projects()).find((p) => samePath(p.path, path));
      const project = known ?? (await api.addProject(name, path));
      row = await api.createSession(project.id, agentId);
      pendingCreated.current = { key, row };
      setLastCreated(row);
    }
    const destination = row;
    if (mine !== navigation.current) {
      store.setDraft(destination.id, text);
      pendingCreated.current = null;
      reload();
      return;
    }
    // Keep the first draft on this screen until the server journals it. A successful socket
    // write alone does not mean that a disconnected agent accepted the message.
    const alreadyAccepted = store
      .get(destination.id)
      .items.some(
        (item) => item.kind === "user" && !item.local && item.text === text,
      );
    if(retrying&&!alreadyAccepted){
      await workspaceApi.resume(destination.id);
      if(mine!==navigation.current){store.setDraft(destination.id,text);return;}
    }
    // Model/mode/effort picked on the new-chat screen go in before the first prompt, best effort: each change is
    // confirmed by one config_options event, and a slow agent only delays the prompt by a few seconds.
    const wanted = Object.entries(config ?? {});
    if (!alreadyAccepted && wanted.length > 0) {
      activate(destination.id);
      await new Promise<void>((resolve) => {
        let confirmations = 0;
        let off = () => {};
        const timer = setTimeout(() => {
          off();
          resolve();
        }, 4_000);
        off = conn.onMessage((message) => {
          if (
            message.type === "event" &&
            message.stored.sessionId === destination.id &&
            message.stored.event.type === "config_options" &&
            ++confirmations >= wanted.length
          ) {
            clearTimeout(timer);
            off();
            resolve();
          }
        });
        for (const [configId, value] of wanted)
          conn.send({ type: "set_config", sessionId: destination.id, configId, value });
      });
    }
    if (!alreadyAccepted)
      await new Promise<void>((resolve, reject) => {
        let off = () => {};
        const timer = setTimeout(() => {
          off();
          reject(new ApiError("network"));
        }, 15_000);
        const done = (error?: ApiError) => {
          clearTimeout(timer);
          off();
          error ? reject(error) : resolve();
        };
        off = conn.onMessage((message) => {
          if (
            message.type === "event" &&
            message.stored.sessionId === destination.id &&
            message.stored.event.type === "user_message"
          )
            done();
          else if (message.type === "error") done(new ApiError(message.code));
        });
        activate(destination.id);
        if (
          !conn.send({
            type: "prompt",
            sessionId: destination.id,
            text,
            ...(attachments && attachments.length > 0 ? { images: attachments } : {}),
          })
        ) {
          done(new ApiError("network"));
        } else {
          store.addLocalUser(destination.id, text, attachments);
        }
      });
    if (mine === navigation.current) select(destination.id);
    pendingCreated.current = null;
    reload();
  };
  const newChat = () => {
    setSettingsOpen(false);
    setPluginsOpen(false);
    // Already on the new-chat screen: keep it as it is (draft, folder, agent) instead of rebuilding it.
    if (activeId === null) {
      setBanner(null);
      if (window.innerWidth <= 760 && sidebarOpen) toggleSidebar();
      return;
    }
    reloadAgents();
    navigation.current++;
    pendingCreated.current = null;
    clearActiveSession();
    setActiveId(null);
    setBanner(null);
    setNewKey((n) => n + 1);
  };

  const row =
    groups.flatMap((g) => g.sessions).find((s) => s.id === activeId) ??
    (lastCreated?.id === activeId ? lastCreated : undefined);
  const project = groups.find((g) => g.project.id === row?.projectId)?.project;
  const sessionAgent = row
    ? agents.find((a) => a.id === row.agentId)
    : undefined;
  const agentLabel = row ? (sessionAgent?.label ?? row.agentId) : "";
  const signInHint = sessionAgent?.signInHint;
  const activeState = useSession(store, activeId);
  const working = activeState.status === "running";

  // Settings: Ctrl+, opens them; the server's own preferences are fetched when the page first opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesShortcut(e, "ctrl+,")) {
        e.preventDefault();
        openSettings();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!settingsOpen || serverSettings) return;
    void api.settings().then(setServerSettings).catch(() => {});
  }, [settingsOpen, serverSettings, api]);
  const changeServerSetting = useCallback(
    async (patch: Partial<ServerSettings>) => {
      try {
        setServerSettings(await api.updateSettings(patch));
      } catch {
        showError("network");
      }
    },
    [api, showError],
  );

  // "Ask before closing the tab" and "keep the computer awake", both only while an agent is working.
  useEffect(() => {
    if (!clientSettings.confirmClose || !working) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [clientSettings.confirmClose, working]);
  useEffect(() => {
    if (!clientSettings.preventSleep || !working || !navigator.wakeLock) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    void navigator.wakeLock
      .request("screen")
      .then((l) => {
        if (alive) lock = l;
        else void l.release();
      })
      .catch(() => {});
    return () => {
      alive = false;
      void lock?.release().catch(() => {});
    };
  }, [clientSettings.preventSleep, working]);
  const sessionEdits = useMemo(() => editsOfSession(activeState.items), [activeState.items]);
  const sessionSubagents = useMemo(() => subagentsOf(activeState.items), [activeState.items]);
  const openPanelTab = (tab: "files" | "changes" | "agents") => {
    setLoginAgent(undefined);
    setTabRequest((r) => ({ tab, n: (r?.n ?? 0) + 1 }));
    setPanelOpen(true);
  };
  const dismiss = () => setBanner(null);
  // Context figures mean nothing before the first message: the session shows them once it has started.
  const sessionStarted = activeState.items.some((i) => i.kind === "user");
  // The plugin lists and their logos are asked for in the background, so the page opens on them.
  useEffect(() => {
    // After the first screen is up, so it never competes with it.
    const timer = setTimeout(() => void api.prefetchPlugins().catch(() => {}), 1500);
    return () => clearTimeout(timer);
  }, [api]);
  const labelOf = useCallback(
    (id: string) => {
      const found = groups.flatMap((g) => g.sessions).find((s) => s.id === id);
      return found ? sessionLabel(found, store.get(id), agents) : t("alert.untitled");
    },
    [groups, agents, store],
  );
  const { toasts, dismiss: dismissToast, checkLimits } = useAlerts({
    store,
    ids: () => groups.flatMap((g) => g.sessions.map((s) => s.id)),
    labelOf,
    activeId,
    onOpen: (id) => select(id),
  });
  useEffect(() => primeAudio(), []);
  const loadUsage = useCallback(
    (refresh?: boolean) =>
      api.usage(refresh).then((usage) => {
        checkLimits(usage);
        return usage;
      }),
    [api, checkLimits],
  );
  // Sidebar edits: the server changes first, then the list is read again (a deleted open chat leaves the screen).
  const renameSession = (id: string, title: string) => void api.renameSession(id, title).then(reload, () => showError("network"));
  const renameProject = (id: string, name: string) => void api.renameProject(id, name).then(reload, () => showError("network"));
  const deleteSession = (id: string) =>
    void api.deleteSession(id).then(() => {
      if (id === activeId) newChat();
      reload();
    }, () => showError("network"));
  const deleteProject = (id: string) =>
    void api.deleteProject(id).then(() => {
      if (groups.find((g) => g.project.id === id)?.sessions.some((s) => s.id === activeId)) newChat();
      reload();
    }, () => showError("network"));
  const nav = useNavHistory(activeId, (target) => (target === null ? newChat() : select(target)));
  // The agent's own context figures when it reports them; otherwise the page's estimate, marked as one.
  const contextFigures = useMemo(() => {
    const real = activeState.usage;
    if (real && real.size > 0) return { used: real.used, size: real.size, estimated: false };
    const est = calculateContextStats(activeState);
    return { used: est.usedTokens, size: est.maxTokens, estimated: true };
  }, [activeState]);
  const focusSearch = () => {
    if (!sidebarVisible) toggleSidebar();
    setTimeout(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })), sidebarVisible ? 0 : 450);
  };
  const menus: MenuDef[] = [
    {
      id: "file",
      label: t("menu.file"),
      items: [
        { label: t("menu.newChat"), onSelect: newChat },
        { separator: true },
        { label: t("account.settings"), shortcut: "Ctrl+,", onSelect: () => setSettingsOpen(true) },
      ],
    },
    { id: "edit", label: t("menu.edit"), items: [{ label: t("menu.search"), shortcut: "Ctrl+K", onSelect: focusSearch }] },
    {
      id: "view",
      label: t("menu.view"),
      items: [
        { label: t("menu.toggleSidebar"), shortcut: "Ctrl+B", onSelect: toggleSidebar },
        { label: t("menu.togglePanel"), disabled: !project, onSelect: () => setPanelOpen((v) => !v) },
        { separator: true },
        { label: t("account.theme"), onSelect: () => setLight((v) => !v) },
      ],
    },
    {
      id: "help",
      label: t("menu.help"),
      items: [
        { heading: t("menu.shortcuts") },
        { label: t("menu.sendHint"), shortcut: "Enter", disabled: true, onSelect: () => {} },
        { label: t("menu.newlineHint"), shortcut: "Shift+Enter", disabled: true, onSelect: () => {} },
        { label: t("menu.search"), shortcut: "Ctrl+K", disabled: true, onSelect: () => {} },
        { label: t("menu.toggleSidebar"), shortcut: "Ctrl+B", disabled: true, onSelect: () => {} },
        { label: t("account.settings"), shortcut: "Ctrl+,", disabled: true, onSelect: () => {} },
      ],
    },
  ];

  return (
    <div className="app-shell flex h-dvh flex-col overflow-hidden bg-bg text-text">
      <TitleBar
        canBack={nav.canBack}
        canForward={nav.canForward}
        onBack={nav.back}
        onForward={nav.forward}
        sidebarOpen={sidebarVisible}
        onToggleSidebar={toggleSidebar}
        menus={menus}
      />
      <div className="relative flex min-h-0 flex-1">
      <div className="icon-rail" role="toolbar" aria-orientation="vertical" aria-label={t("rail.label")}>
        <button
          type="button"
          className="rail-button"
          aria-label={t("rail.home")}
          title={t("rail.home")}
          onClick={() => newChat()}
        >
          <SymbolIcon name="home" className="size-[18px]" />
        </button>
        <button
          type="button"
          className="rail-button"
          aria-label={t("rail.plugins")}
          title={t("rail.plugins")}
          aria-pressed={pluginsOpen}
          onClick={() => {
            setSettingsOpen(false);
            setPluginsOpen((v) => !v);
          }}
        >
          <SymbolIcon name="puzzle" className="size-[18px]" />
        </button>
        <UsageMenu load={loadUsage} />
        <ProfileMenu
          connection={state}
          light={light}
          onOpenSettings={openSettings}
          onTheme={() => setLight((v) => !v)}
        />
      </div>
      {sidebarMounted && !settingsOpen && (
        <div className="sidebar-shell" data-open={sidebarVisible} aria-hidden={!sidebarVisible || undefined}>
        <Sidebar
          groups={groups}
          activeId={activeId}
          store={store}
          agents={agents}
          onSelect={select}
          onRenameSession={renameSession}
          onDeleteSession={deleteSession}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onNewSession={() => {
            newChat();
          }}
        />
        </div>
      )}
      <main className="relative flex min-w-0 flex-1 flex-col">
        {pluginsOpen && !settingsOpen ? (
          <Suspense fallback={null}>
            <PluginsPage api={api} onClose={() => setPluginsOpen(false)} />
          </Suspense>
        ) : settingsOpen ? (
          <Suspense fallback={null}>
          <SettingsPage
            light={light}
            onTheme={setLight}
            agents={agents}
            onRefreshAgents={reloadAgents}
            onSignIn={(agentId) => {
              setSettingsOpen(false);
              setLoginAgent(agentId);
              setPanelOpen(true);
            }}
            serverSettings={serverSettings}
            onServerSetting={changeServerSetting}
            onClose={() => setSettingsOpen(false)}
          />
          </Suspense>
        ) : activeId ? (
          <ChatView
            sessionId={activeId}
            store={store}
            send={(message) => conn?.send(message) ?? false}
            agentLabel={agentLabel}
            connection={state}
            banner={banner}
            onDismissBanner={dismiss}
            onError={showError}
            leading={null}
            trailing={
              <div className="flex items-center gap-2">
                {sessionStarted && (
                  <ContextIndicator
                    state={activeId ? store.get(activeId) : null}
                    onCompact={() => {
                      if (activeId && conn) {
                        conn.send({ type: "prompt", sessionId: activeId, text: "/compact" });
                        store.addLocalUser(activeId, "/compact");
                      }
                    }}
                  />
                )}
                <button
                  className="icon-button"
                  aria-label={t("panel.toggle")}
                  aria-expanded={panelOpen}
                  disabled={!project}
                  onClick={() => {
                    setLoginAgent(undefined);
                    setTabRequest(undefined);
                    setPanelOpen((v) => !v);
                  }}
                >
                  <SymbolIcon name="panel" />
                </button>
              </div>
            }
            project={project}
            workspaceApi={workspaceApi}
            onOpenAgents={() => openPanelTab("agents")}
            onOlder={() => loadOlder(activeId)}
            onRecent={() => showRecent(activeId)}
            onResume={() => workspaceApi.resume(activeId).then(() => undefined)}
            {...(signInHint ? { signInHint } : {})}
          />
        ) : (
          <>
            <ChatHeader leading={null} />
            {banner && (
              <div className="mx-auto w-full max-w-3xl px-4 pt-3">
                <ErrorBanner message={banner} onDismiss={dismiss} />
              </div>
            )}
            <NewChat
              key={newKey}
              agents={agents}
              projects={groups.map((g) => g.project)}
              onStart={start}
              loadOptions={(agentId, path) => api.agentOptions(agentId, path)}
              workspaceApi={workspaceApi}
            />
          </>
        )}
        {activeId && project && !settingsOpen && !pluginsOpen && !panelOpen && (
          <ChangesCard
            projectName={project.name}
            files={sessionEdits}
            subagents={sessionSubagents}
            {...(sessionStarted ? { context: contextFigures } : {})}
            onOpenFiles={() => openPanelTab("files")}
            onOpenChanges={() => openPanelTab("changes")}
            onOpenAgents={() => openPanelTab("agents")}
          />
        )}
      </main>
      <Toasts toasts={toasts} onOpen={select} onDismiss={dismissToast} />
      {panelOpen && !loginAgent && project && (
        <WorkspacePanel
          key={project.id}
          api={workspaceApi}
          project={project}
          loginAgent={loginAgent}
          edits={sessionEdits}
          subagents={sessionSubagents}
          {...(tabRequest ? { tabRequest } : {})}
          onClose={() => setPanelOpen(false)}
          onInsert={(path) =>
            activeId &&
            store.setDraft(
              activeId,
              `${store.getDraft(activeId)} @${path} `.trimStart(),
            )
          }
        />
      )}
      {panelOpen && loginAgent && (
        <aside
          className="workspace-panel panel-in"
          aria-label={t("panel.signIn")}
        >
          <div className="flex h-14 items-center justify-between border-b border-border px-4 text-sm">
            <span>
              {loginAgent} · {t("panel.signIn")}
            </span>
            <button
              className="icon-button"
              aria-label={t("panel.close")}
              onClick={() => {
                setPanelOpen(false);
                setLoginAgent(undefined);
                reloadAgents();
              }}
            >
              <SymbolIcon name="close" />
            </button>
          </div>
          {loginAgent === "agy" ? (
            <div className="p-4 text-sm leading-6">
              <p>{t("panel.authUnknown")}</p>
              <CommandHint command="agy" />
            </div>
          ) : (
            <TerminalPane
              key={loginAgent}
              api={workspaceApi}
              projectId={project?.id ?? ""}
              loginAgent={loginAgent}
            />
          )}
          <button className="small-button m-3" onClick={reloadAgents}>
            {t("agent.refresh")}
          </button>
        </aside>
      )}
      </div>
    </div>
  );
}
