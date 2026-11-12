import { useEffect, useRef, useState } from "react";
import { errorText, t } from "../i18n/index.ts";
import type { ProjectInfo } from "../lib/api.ts";
import type {
  FileEntry,
  FilePreview,
  WorkspaceApi,
} from "../lib/workspaceApi.ts";
import type { EditedFile } from "../lib/edits.ts";
import type { Subagent } from "../lib/subagents.ts";
import { ChangesList } from "./ChangesList.tsx";
import { SubagentsView } from "./SubagentsView.tsx";
import { SourcesView } from "./SourcesView.tsx";
import { hasResearch, type ResearchWork } from "../lib/researchSources.ts";
import { CodeBlock } from "./CodeBlock.tsx";
import { SymbolIcon } from "./SymbolIcon.tsx";
import { TerminalPane } from "./TerminalPane.tsx";
type Tab = "files" | "changes" | "agents" | "sources" | "preview" | "terminal";
export function WorkspacePanel({
  api,
  project,
  onInsert,
  onClose,
  loginAgent,
  edits = [],
  subagents = [],
  research,
  tabRequest,
}: {
  api: WorkspaceApi;
  project: ProjectInfo;
  onInsert: (path: string) => void;
  onClose: () => void;
  loginAgent?: string;
  /** Files the agent changed in the open session. */
  edits?: readonly EditedFile[];
  subagents?: readonly Subagent[];
  /** What a deep research has found (the Sources tab shows when there is something). */
  research?: ResearchWork;
  /** Brings a tab to the front (a new `n` each time, so asking twice works). */
  tabRequest?: { tab: Tab; n: number };
}) {
  const [tab, setTab] = useState<Tab>(
    loginAgent ? "terminal" : (tabRequest?.tab ?? "files"),
  );
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  useEffect(() => {
    if (loginAgent) setTab("terminal");
  }, [loginAgent]);
  useEffect(() => {
    if (tabRequest) setTab(tabRequest.tab);
  }, [tabRequest]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void api
      .files(project.id, path)
      .then((r) => {
        if (alive) setEntries(r.entries);
      })
      .catch(() => {
        if (alive) setError(errorText("bad_request"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, project.id, path, revision]);
  const open = async (entry: FileEntry) => {
    if (entry.type === "directory") {
      setPath(entry.path);
      return;
    }
    const mine = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.file(project.id, entry.path);
      if (mine === request.current) {
        setPreview(result);
        setTab("preview");
      }
    } catch {
      if (mine === request.current) setError(errorText("bad_request"));
    } finally {
      if (mine === request.current) setLoading(false);
    }
  };

  const handleRevertFile = async (file: EditedFile) => {
    try {
      const content = file.changes[0]?.oldText ?? null;
      await api.revert(project.id, { files: [{ path: file.path, content }] });
      setRevision((r) => r + 1);
    } catch {
      setError(errorText("internal"));
    }
  };

  const handleRevertAll = async () => {
    try {
      const files = edits.map((f) => ({ path: f.path, content: f.changes[0]?.oldText ?? null }));
      await api.revert(project.id, { files });
      setRevision((r) => r + 1);
    } catch {
      setError(errorText("internal"));
    }
  };

  return (
    <aside
      className="workspace-panel panel-in"
      aria-label={t("new.workspace")}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium"
          title={project.path}
        >
          {project.name}
        </span>
        <button
          className="icon-button"
          aria-label={t("panel.refresh")}
          onClick={() => setRevision((n) => n + 1)}
        >
          <SymbolIcon name="refresh" />
        </button>
        <button
          className="icon-button"
          aria-label={t("panel.close")}
          onClick={onClose}
        >
          <SymbolIcon name="close" />
        </button>
      </div>
      <div role="tablist" className="panel-tabs">
        {(["files", "changes", ...(subagents.length > 0 ? (["agents"] as const) : []), ...(research && hasResearch(research) ? (["sources"] as const) : []), "preview", "terminal"] as const).map((name) => (
          <button
            role="tab"
            aria-selected={tab === name}
            aria-controls={`workspace-${name}`}
            id={`tab-${name}`}
            key={name}
            onClick={() => setTab(name)}
          >
            {t(`panel.${name}`)}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div
        role="tabpanel"
        id="workspace-files"
        aria-labelledby="tab-files"
        hidden={tab !== "files"}
        className="min-h-0 flex-1 overflow-auto"
      >
        <div className="px-4 pt-1 pb-2 text-[11px] text-text-muted">
          <span className="block truncate">{path || project.name}</span>
        </div>
        {path && (
          <button
            className="file-row"
            onClick={() => setPath(path.split("/").slice(0, -1).join("/"))}
          >
            <SymbolIcon name="up" />
            ..
          </button>
        )}
        {entries.map((entry) => (
          <button
            key={entry.path}
            className="file-row"
            onClick={() => void open(entry)}
          >
            <SymbolIcon
              name={entry.type === "directory" ? "folder" : "file"}
              className={
                "text-text-muted"
              }
            />
            <span className="truncate">{entry.name}</span>
            {entry.type === "directory" && (
              <SymbolIcon
                name="chevron"
                className="ml-auto size-3 text-text-muted"
              />
            )}
          </button>
        ))}
        {loading ? (
          <p role="status" className="p-4 text-xs text-text-muted">
            {t("chat.loading")}
          </p>
        ) : (
          entries.length === 0 && (
            <p className="p-4 text-xs text-text-muted">{t("panel.noFiles")}</p>
          )
        )}
      </div>
      <div
        role="tabpanel"
        id="workspace-changes"
        aria-labelledby="tab-changes"
        hidden={tab !== "changes"}
        className="min-h-0 flex-1 overflow-auto"
      >
        <ChangesList files={edits} onRevertFile={handleRevertFile} onRevertAll={handleRevertAll} />
      </div>
      <div
        role="tabpanel"
        id="workspace-agents"
        aria-labelledby="tab-agents"
        hidden={tab !== "agents"}
        className="min-h-0 flex-1 overflow-auto"
      >
        <SubagentsView agents={subagents} />
      </div>
      <div
        role="tabpanel"
        id="workspace-sources"
        aria-labelledby="tab-sources"
        hidden={tab !== "sources"}
        className="min-h-0 flex-1 overflow-auto"
      >
        {research && <SourcesView work={research} />}
      </div>
      <div
        role="tabpanel"
        id="workspace-preview"
        aria-labelledby="tab-preview"
        hidden={tab !== "preview"}
        className="min-h-0 flex-1 overflow-auto"
      >
        {preview ? (
          <div className="p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-xs" title={preview.path}>
                {preview.path}
              </span>
              <button
                className="small-button shrink-0"
                onClick={() => onInsert(preview.path)}
              >
                <SymbolIcon name="at" />
                {t("panel.insert")}
              </button>
            </div>
            {preview.truncated && (
              <p className="text-xs text-warning">{t("panel.truncated")}</p>
            )}
            <CodeBlock
              code={preview.text}
              lang={preview.path.split(".").pop()}
            />
          </div>
        ) : (
          <div className="panel-empty">
            <SymbolIcon name="file" className="mb-3 size-8" />
            {t("panel.empty")}
          </div>
        )}
      </div>
      <div
        role="tabpanel"
        id="workspace-terminal"
        aria-labelledby="tab-terminal"
        hidden={tab !== "terminal"}
        className="min-h-0 flex-1"
      >
        <TerminalPane
          key={loginAgent ?? "shell"}
          api={api}
          projectId={project.id}
          loginAgent={loginAgent}
          visible={tab === "terminal"}
        />
      </div>
    </aside>
  );
}
