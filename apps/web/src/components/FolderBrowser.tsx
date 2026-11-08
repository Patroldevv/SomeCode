import { useEffect, useRef, useState } from "react";
import { errorText, t } from "../i18n/index.ts";
import type { Folder, WorkspaceApi } from "../lib/workspaceApi.ts";
import { SymbolIcon } from "./SymbolIcon.tsx";

export function FolderBrowser({
  api,
  initial,
  onSelect,
  onClose,
}: {
  api: WorkspaceApi;
  initial?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [path, setPath] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const browse = async (target?: string) => {
    const mine = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const next = await api.folders(target);
      if (mine === generation.current) {
        setFolder(next);
        setPath(next.path);
      }
    } catch {
      if (mine === generation.current) setError(errorText("bad_request"));
    } finally {
      if (mine === generation.current) setBusy(false);
    }
  };
  useEffect(() => {
    void browse(initial);
    return () => {
      generation.current++;
    };
  }, []);
  return (
    <section
      className="folder-browser animate-enter"
      aria-label={t("folder.title")}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{t("folder.title")}</h2>
        <button
          className="icon-button"
          aria-label={t("error.dismiss")}
          onClick={onClose}
        >
          <SymbolIcon name="close" />
        </button>
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void browse(path);
        }}
      >
        <input
          autoFocus
          className="field min-w-0 flex-1 font-mono text-xs"
          aria-label={t("folder.path")}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button className="small-button" disabled={busy}>
          {t("folder.open")}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="my-3 max-h-56 overflow-auto" aria-busy={busy}>
        {folder?.parent && (
          <button
            className="file-row"
            onClick={() => void browse(folder.parent!)}
          >
            <SymbolIcon name="up" />
            .. <span className="ml-auto text-text-muted">{t("folder.up")}</span>
          </button>
        )}
        {folder?.entries.map((entry) => (
          <button
            className="file-row"
            key={entry.path}
            onClick={() => void browse(entry.path)}
          >
            <SymbolIcon name="folder" />
            {entry.name}
            <SymbolIcon name="chevron" className="ml-auto" />
          </button>
        ))}
        {folder?.entries.length === 0 && (
          <p className="p-3 text-xs text-text-muted">{t("folder.empty")}</p>
        )}
        {busy && (
          <p role="status" className="p-3 text-xs text-text-muted">
            {t("chat.loading")}
          </p>
        )}
      </div>
      <button
        className="primary-button w-full"
        disabled={!folder || busy || path !== folder.path}
        onClick={() => folder && path === folder.path && onSelect(folder.path)}
      >
        {t("folder.use")}
      </button>
    </section>
  );
}
