import type { ConfigOption, ImageAttachment } from "@somecode/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, errorText } from "../i18n/index.ts";
import { ApiError, type AgentInfo, type ProjectInfo } from "../lib/api.ts";
import { MAX_PROMPT_BYTES, promptBytes } from "../lib/format.ts";
import { useClientSettings } from "../lib/settings.ts";
import type { WorkspaceApi } from "../lib/workspaceApi.ts";
import { Composer } from "./Composer.tsx";
import { ConfigChips } from "./ConfigChips.tsx";
import { Menu } from "./Menu.tsx";
import { FolderBrowser } from "./FolderBrowser.tsx";
import { SymbolIcon } from "./SymbolIcon.tsx";
export type FirstMessage = {
  agentId: string;
  path: string;
  name: string;
  text: string;
  attachments?: ImageAttachment[];
  /** Model/mode/effort values the user changed on this screen, applied before the first prompt. */
  config?: Record<string, string>;
};
export function NewChat({
  agents,
  projects,
  onStart,
  workspaceApi,
  loadOptions,
}: {
  agents: AgentInfo[];
  projects: ProjectInfo[];
  onStart: (input: FirstMessage) => Promise<void>;
  workspaceApi?: WorkspaceApi;
  /** The agent's model/mode/effort options for a folder (best effort; failures just hide the picker). */
  loadOptions?: (agentId: string, path: string) => Promise<ConfigOption[]>;
}) {
  const [path, setPath] = useState(projects[0]?.path ?? "");
  const [agent, setAgent] = useState("");
  const [draft, setDraft] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const selected = agents.some((a) => a.id === agent && a.installed)
    ? agent
    : (agents.find((a) => a.installed)?.id ?? "");
  const chosenPath = path || projects[0]?.path || "";
  const name = chosenPath.split("/").filter(Boolean).pop() || "/";
  const { showAdvancedOptions } = useClientSettings();
  const [options, setOptions] = useState<ConfigOption[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  useEffect(() => {
    setChoice({});
    if (!loadOptions || !selected || !chosenPath) {
      setOptions(null);
      return;
    }
    let alive = true;
    setOptions(null);
    void Promise.resolve()
      .then(() => loadOptions(selected, chosenPath))
      .then((list) => alive && setOptions(list))
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [loadOptions, selected, chosenPath]);
  const shownOptions = useMemo(
    () => options?.map((o) => ({ ...o, currentValue: choice[o.id] ?? o.currentValue })) ?? null,
    [options, choice],
  );
  const changed = useMemo(() => {
    const result: Record<string, string> = {};
    for (const o of options ?? []) {
      const value = choice[o.id];
      if (value !== undefined && value !== o.currentValue) result[o.id] = value;
    }
    return result;
  }, [options, choice]);
  const start = async (text: string, attachments?: ImageAttachment[]) => {
    if (guard.current) return;
    if (!chosenPath || !selected) {
      setError(t("new.noFolder"));
      setChoosing(true);
      return;
    }
    if (promptBytes(text) > MAX_PROMPT_BYTES) {
      setError(errorText("prompt_too_long", { limit: MAX_PROMPT_BYTES }));
      return;
    }
    guard.current = true;
    setBusy(true);
    setError(null);
    try {
      await onStart({
        agentId: selected,
        path: chosenPath,
        name,
        text,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
        ...(Object.keys(changed).length > 0 ? { config: changed } : {}),
      });
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : "internal"));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const [before, after] = chosenPath
    ? t("new.headingProject", { project: "\u0000" }).split("\u0000")
    : [t("new.heading"), ""];
  const installed = agents.filter((a) => a.installed);
  const toggleFolder = () => setChoosing((v) => !v);
  return (
    <div className="new-chat flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto px-6 py-10">
        <h1 className="new-chat-title text-center">
          {before}
          {chosenPath && (
            <button
              type="button"
              disabled={busy}
              onClick={toggleFolder}
              title={chosenPath}
              className="project-link"
            >
              {name}
            </button>
          )}
          {after}
        </h1>
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-5">
        {choosing &&
          (workspaceApi ? (
            <FolderBrowser
              api={workspaceApi}
              initial={chosenPath || undefined}
              onClose={() => setChoosing(false)}
              onSelect={(p) => {
                setPath(p);
                setChoosing(false);
                setError(null);
              }}
            />
          ) : (
            <input
              className="field mb-3 w-full"
              aria-label={t("newSession.projectPath")}
              value={chosenPath}
              onChange={(e) => setPath(e.target.value)}
            />
          ))}
        <div className="context-bar">
          <button type="button" disabled={busy} className="context-chip" onClick={toggleFolder}>
            <SymbolIcon name="folder" className="size-4" />
            <span className="max-w-60 truncate">{chosenPath ? name : t("new.folder")}</span>
          </button>
          {installed.length > 0 ? (
            <Menu
              label={t("new.agent")}
              items={installed.map((a) => ({ value: a.id, name: a.label }))}
              selected={selected}
              disabled={busy}
              busy={false}
              onSelect={setAgent}
            >
              <span className={`agent-orb agent-${selected}`} />
              <span className="text-text">{installed.find((a) => a.id === selected)?.label}</span>
            </Menu>
          ) : (
            <span className="text-xs text-text-muted">{t("newSession.agentNone")}</span>
          )}
        </div>
        <Composer
          value={draft}
          onChange={setDraft}
          running={false}
          disabled={busy}
          onSend={(text, attachments) => void start(text, attachments)}
          onCancel={() => {}}
          toolbar={
            loadOptions && selected && chosenPath ? (
              shownOptions ? (
                <ConfigChips
                  options={shownOptions}
                  disabled={busy}
                  pendingId={null}
                  onChange={(id, value) => setChoice((c) => ({ ...c, [id]: value }))}
                  advanced={showAdvancedOptions}
                />
              ) : (
                <span className="picker-skeleton ml-auto" aria-hidden="true" />
              )
            ) : undefined
          }
        />
        {busy && (
          <div role="status" className="mt-3 flex items-center gap-3 text-sm text-text-muted">
            <span className="loading-ring" />
            <div>
              <p className="font-medium text-text">{t("new.starting")}</p>
              <p className="mt-0.5 text-xs">{t("new.startingBody")}</p>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
