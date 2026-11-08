import { useEffect, useId, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { t } from "../i18n/index.ts";
import type { AgentInfo, ProjectInfo, SessionInfo } from "../lib/api.ts";
import { sessionLabel } from "../lib/sessionLabel.ts";
import { useSession, type SessionsStore } from "../lib/sessionsStore.ts";
import { applyOrder, loadOrder, moveNextTo, saveOrder, type SidebarOrder } from "../lib/sidebarOrder.ts";
import { Collapse } from "./Collapse.tsx";
import { ContextMenu, type ContextItem } from "./ContextMenu.tsx";
import { SymbolIcon } from "./SymbolIcon.tsx";
import { dotStatus, isBusyStatus, StatusDot } from "./StatusDot.tsx";

export type ProjectGroup = { project: ProjectInfo; sessions: SessionInfo[] };


const RECENT_COUNT = 6;

type Kind = "session" | "project";
/** What the rows need from the sidebar: open the right-click menu, rename in place, drag and drop. */
type RowActions = {
  /** `scope` says which list the row is in (a project id, or `recent`): only that one row turns into the rename box. */
  menu: (e: ReactMouseEvent, kind: Kind, id: string, scope?: string) => void;
  renaming: { kind: Kind; id: string; scope?: string } | null;
  /** `null` cancels. */
  rename: (kind: Kind, id: string, text: string | null) => void;
  drag: { kind: Kind; id: string; projectId?: string } | null;
  mark: { id: string; after: boolean } | null;
  startDrag: (kind: Kind, id: string, projectId?: string) => void;
  overDrag: (kind: Kind, id: string, after: boolean, projectId?: string) => void;
  drop: (kind: Kind, id: string, after: boolean, projectId?: string) => void;
  endDrag: () => void;
  order: SidebarOrder;
};

/** Where in the row the pointer is: its lower half drops after it. */
const lowerHalf = (e: DragEvent<HTMLElement>) => {
  const box = e.currentTarget.getBoundingClientRect();
  return e.clientY > box.top + box.height / 2;
};

/** The rename box that replaces a label: Enter or leaving it saves, Escape cancels. */
function RenameInput({ initial, onDone }: { initial: string; onDone: (text: string | null) => void }) {
  const done = useRef(false);
  const finish = (text: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(text);
  };
  return (
    <input
      autoFocus
      className="rename-input"
      aria-label={t("menu.rename")}
      defaultValue={initial}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

/** Projects with their sessions (newest first), a New session button and the recent list. */
export function Sidebar({
  groups,
  activeId,
  store,
  agents,
  onSelect,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  onRenameProject,
  onDeleteProject,
}: {
  groups: ProjectGroup[];
  activeId: string | null;
  store: SessionsStore;
  agents: AgentInfo[];
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onRenameSession?: (id: string, title: string) => void;
  onDeleteSession?: (id: string) => void;
  onRenameProject?: (id: string, name: string) => void;
  onDeleteProject?: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState<SidebarOrder>(loadOrder);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextItem[] } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: Kind; id: string; scope?: string } | null>(null);
  const [drag, setDrag] = useState<RowActions["drag"]>(null);
  const [mark, setMark] = useState<RowActions["mark"]>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const query = search.trim().toLowerCase();
  const searching = query !== "";

  // Ctrl/⌘+K jumps to the search box from anywhere, like the chat apps this sidebar follows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const filtered = groups
    .map((g) => ({
      ...g,
      sessions: g.sessions.filter(
        (row) => !searching || sessionLabel(row, store.get(row.id), agents).toLowerCase().includes(query),
      ),
    }))
    // While searching, projects without a match disappear.
    .filter((g) => !searching || g.sessions.length > 0);
  const noSessions = groups.every((g) => g.sessions.length === 0);
  const recent = groups
    .flatMap((g) => g.sessions)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, RECENT_COUNT);
  const update = (next: SidebarOrder) => {
    setOrder(next);
    saveOrder(next);
  };
  const actions: RowActions = {
    menu: (e, kind, id, scope) => {
      e.preventDefault();
      const items: ContextItem[] = [];
      const rename = kind === "session" ? onRenameSession : onRenameProject;
      const remove = kind === "session" ? onDeleteSession : onDeleteProject;
      if (rename) items.push({ label: t("menu.rename"), onSelect: () => setRenaming({ kind, id, ...(scope ? { scope } : {}) }) });
      if (remove) {
        items.push({
          label: t("menu.delete"),
          danger: true,
          confirm: t(kind === "session" ? "menu.deleteSession" : "menu.deleteProject"),
          onSelect: () => remove(id),
        });
      }
      if (items.length > 0) setMenu({ x: e.clientX, y: e.clientY, items });
    },
    renaming,
    rename: (kind, id, text) => {
      setRenaming(null);
      const clean = text?.trim();
      if (!clean) return;
      if (kind === "session") onRenameSession?.(id, clean);
      else onRenameProject?.(id, clean);
    },
    drag,
    mark,
    startDrag: (kind, id, projectId) => setDrag({ kind, id, ...(projectId ? { projectId } : {}) }),
    overDrag: (kind, id, after, projectId) => {
      if (drag?.kind !== kind || drag.id === id || (kind === "session" && drag.projectId !== projectId)) return;
      setMark((m) => (m?.id === id && m.after === after ? m : { id, after }));
    },
    drop: (kind, id, after, projectId) => {
      if (drag?.kind === kind && drag.id !== id) {
        if (kind === "project") {
          const ids = applyOrder(groups.map((g) => ({ id: g.project.id })), order.projects).map((x) => x.id);
          update({ ...order, projects: moveNextTo(ids, drag.id, id, after) });
        } else if (projectId && drag.projectId === projectId) {
          const group = groups.find((g) => g.project.id === projectId);
          const ids = applyOrder([...(group?.sessions ?? [])].reverse(), order.sessions[projectId]).map((x) => x.id);
          update({ ...order, sessions: { ...order.sessions, [projectId]: moveNextTo(ids, drag.id, id, after) } });
        }
      }
      setDrag(null);
      setMark(null);
    },
    endDrag: () => {
      setDrag(null);
      setMark(null);
    },
    order,
  };
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Up/Down move between the visible session rows (Home/End jump), so the list is usable without a mouse.
  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-session-row]")];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    if (rows.length === 0 || at === -1) return;
    e.preventDefault();
    const next =
      e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : e.key === "ArrowDown" ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0);
    rows[next]?.focus();
  };

  return (
    <nav
      id="sidebar"
      aria-label={t("sidebar.label")}
      className="app-sidebar flex h-full w-[264px] shrink-0 flex-col border-r border-border font-ui"
    >
      <div className="flex h-14 items-center px-4">
        <span className="text-[17px] font-semibold tracking-tight">{t("app.title")}</span>
      </div>
      <div className="flex flex-col gap-0.5 px-2 pb-3">
        <button type="button" aria-label={t("nav.new")} onClick={onNewSession} className="nav-row">
          <SymbolIcon name="edit" className="size-4" />
          <span>{t("nav.new")}</span>
        </button>
        <label className="nav-row nav-row-search">
          <SymbolIcon name="search" className="size-4 shrink-0" />
          <input
            ref={searchRef}
            aria-label={t("nav.search")}
            placeholder={t("nav.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && search !== "") {
                e.preventDefault();
                setSearch("");
              }
            }}
          />
          {!searching && <kbd className="kbd-hint">{t("nav.searchShortcut")}</kbd>}
        </label>
      </div>
      <p className="px-4 pt-1 pb-1.5 text-[13px] text-text-muted">{t("nav.projects")}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" onKeyDown={onListKeyDown}>
        {noSessions ? (
          <p className="px-2 py-3 text-sm text-text-muted">{t("sidebar.noSessions")}</p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-3 text-sm text-text-muted">{t("sidebar.noMatches")}</p>
        ) : (
          applyOrder(
            filtered.map((g) => ({ id: g.project.id, g })),
            order.projects,
          ).map(({ g }) => (
            <ProjectSection
              key={g.project.id}
              actions={actions}
              searching={searching}
              group={g}
              open={searching || !collapsed.has(g.project.id)}
              onToggle={() => toggle(g.project.id)}
              activeId={activeId}
              store={store}
              agents={agents}
              onSelect={onSelect}
            />
          ))
        )}
        {!searching && recent.length > 0 && (
          <section aria-label={t("nav.recent")} className="mt-5">
            <p className="px-2 pb-1.5 text-[13px] text-text-muted">{t("nav.recent")}</p>
            <ul className="flex flex-col gap-px">
              {recent.map((row) => (
                <li key={row.id}>
                  <SessionButton row={row} active={row.id === activeId} store={store} agents={agents} onSelect={onSelect} actions={actions} flat />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </nav>
  );
}

function ProjectSection({
  actions,
  searching,
  group,
  open,
  onToggle,
  activeId,
  store,
  agents,
  onSelect,
}: {
  actions: RowActions;
  searching: boolean;
  group: ProjectGroup;
  open: boolean;
  onToggle: () => void;
  activeId: string | null;
  store: SessionsStore;
  agents: AgentInfo[];
  onSelect: (sessionId: string) => void;
}) {
  const headingId = useId();
  const listId = useId();
  const id = group.project.id;
  const renaming = actions.renaming?.kind === "project" && actions.renaming.id === id;
  const mark = actions.drag?.kind === "project" && actions.mark?.id === id ? actions.mark : null;
  const rows = applyOrder([...group.sessions].reverse(), actions.order.sessions[id]);
  return (
    <section aria-labelledby={headingId} className="mt-1">
      <div
        className={`flex items-center gap-1 pr-2 ${mark ? (mark.after ? "drop-after" : "drop-before") : ""}`}
        data-dragging={actions.drag?.kind === "project" && actions.drag.id === id}
        draggable={!searching && !renaming}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", id);
          actions.startDrag("project", id);
        }}
        onDragOver={(e) => {
          if (actions.drag?.kind !== "project") return;
          e.preventDefault();
          actions.overDrag("project", id, lowerHalf(e));
        }}
        onDrop={(e) => {
          if (actions.drag?.kind !== "project") return;
          e.preventDefault();
          actions.drop("project", id, lowerHalf(e));
        }}
        onDragEnd={actions.endDrag}
        onContextMenu={(e) => actions.menu(e, "project", id)}
      >
        <h2 id={headingId} title={group.project.path} className="min-w-0 flex-1 text-xs font-medium">
          {renaming ? (
            <div className="project-toggle">
              <SymbolIcon name="folderOpen" className="size-4 shrink-0" />
              <RenameInput initial={group.project.name} onDone={(text) => actions.rename("project", id, text)} />
            </div>
          ) : (
            <button type="button" aria-expanded={open} aria-controls={listId} onClick={onToggle} className="project-toggle">
              <SymbolIcon name={open ? "folderOpen" : "folder"} className="size-4 shrink-0" />
              <span className="truncate">{group.project.name}</span>
            </button>
          )}
        </h2>
        <span className="text-[11px] text-text-muted tabular-nums">{group.sessions.length}</span>
      </div>
      <Collapse id={listId} open={open}>
        <ul className="flex flex-col gap-px">
          {rows.map((row) => (
            <li key={row.id}>
              <SessionButton row={row} active={row.id === activeId} store={store} agents={agents} onSelect={onSelect} actions={actions} projectId={id} draggable={!searching} />
            </li>
          ))}
        </ul>
      </Collapse>
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
  actions,
  projectId,
  draggable = false,
  flat = false,
}: {
  actions: RowActions;
  /** The project the row is listed under (not for the recent list). */
  projectId?: string;
  draggable?: boolean;
  row: SessionInfo;
  active: boolean;
  store: SessionsStore;
  agents: AgentInfo[];
  onSelect: (sessionId: string) => void;
  /** Recent list: no indent (it is not nested under a project). */
  flat?: boolean;
}) {
  const state = useSession(store, row.id);
  const label = sessionLabel(row, state, agents);
  if (actions.renaming?.kind === "session" && actions.renaming.id === row.id && actions.renaming.scope === (projectId ?? "recent")) {
    return (
      <div className={`session-row flex w-full items-center rounded-lg py-1 pr-2 ${flat ? "pl-1.5" : "pl-7"}`}>
        <RenameInput initial={label} onDone={(text) => actions.rename("session", row.id, text)} />
      </div>
    );
  }
  const mark = projectId && actions.drag?.kind === "session" && actions.mark?.id === row.id ? actions.mark : null;
  return (
    <button
      type="button"
      data-session-row
      draggable={draggable && projectId !== undefined}
      data-dragging={actions.drag?.kind === "session" && actions.drag.id === row.id}
      onContextMenu={(e) => actions.menu(e, "session", row.id, projectId ?? "recent")}
      onDragStart={(e) => {
        if (!projectId) return;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.id);
        actions.startDrag("session", row.id, projectId);
      }}
      onDragOver={(e) => {
        if (!projectId || actions.drag?.kind !== "session") return;
        e.preventDefault();
        actions.overDrag("session", row.id, lowerHalf(e), projectId);
      }}
      onDrop={(e) => {
        if (!projectId || actions.drag?.kind !== "session") return;
        e.preventDefault();
        actions.drop("session", row.id, lowerHalf(e), projectId);
      }}
      onDragEnd={actions.endDrag}
      aria-current={active ? "true" : undefined}
      title={label}
      onClick={() => onSelect(row.id)}
      className={`session-row relative flex w-full items-center gap-2 rounded-lg py-1.5 pr-2.5 text-left text-[13.5px] transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
        flat ? "pl-2.5" : "pl-8"
      } ${active ? "bg-bg-subtle text-text" : "text-text hover:bg-bg-elevated"} ${mark ? (mark.after ? "drop-after" : "drop-before") : ""}`}
    >
      <span className={`min-w-0 flex-1 truncate ${isBusyStatus(dotStatus(state)) ? "status-fade" : ""}`}>{label}</span>
      {dotStatus(state) !== "ready" && <StatusDot state={state} quiet />}
    </button>
  );
}
