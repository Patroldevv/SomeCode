import type { ConfigOption, ImageAttachment } from "@somecode/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, errorText } from "../i18n/index.ts";
import { ApiError, type AgentInfo, type ProjectInfo, type ServerSettings } from "../lib/api.ts";
import { MAX_PROMPT_BYTES, promptBytes } from "../lib/format.ts";
import { useClientSettings } from "../lib/settings.ts";
import type { WorkspaceApi } from "../lib/workspaceApi.ts";
import { ChatHeader } from "./ChatView.tsx";
import { Composer } from "./Composer.tsx";
import { UserMessage } from "./items/UserMessage.tsx";
import { ConfigChips } from "./ConfigChips.tsx";
import { isResearchMode } from "../lib/configChips.ts";
import { Menu } from "./Menu.tsx";
import { FolderBrowser } from "./FolderBrowser.tsx";
import { ResearchHeading, ResearchPanel, ResearchStarters, withFocus, type Focus, type Format } from "./ResearchPanel.tsx";
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
  serverSettings = null,
  onServerSetting,
}: {
  agents: AgentInfo[];
  projects: ProjectInfo[];
  onStart: (input: FirstMessage) => Promise<void>;
  workspaceApi?: WorkspaceApi;
  /** The agent's model/mode/effort options for a folder (best effort; failures just hide the picker). */
  loadOptions?: (agentId: string, path: string) => Promise<ConfigOption[]>;
  /** The saved research settings, and how to change them (the deep research page edits them). */
  serverSettings?: ServerSettings | null;
  onServerSetting?: (patch: Partial<ServerSettings>) => void;
}) {
  const [path, setPath] = useState(projects[0]?.path ?? "");
  const [agent, setAgent] = useState("");
  const [draft, setDraft] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  /** What was sent: the page becomes the new chat at once, with this message and a "starting" line. */
  const [sent, setSent] = useState<{ text: string; attachments?: ImageAttachment[] } | null>(null);
  const selected = agents.some((a) => a.id === agent && a.installed)
    ? agent
    : (agents.find((a) => a.installed)?.id ?? "");
  const chosenPath = path || projects[0]?.path || "";
  const name = chosenPath.split("/").filter(Boolean).pop() || "/";
  const { showAdvancedOptions } = useClientSettings();
  const [options, setOptions] = useState<ConfigOption[] | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  // The app may hand over a new function on every render: what the user picked must survive that.
  const loader = useRef(loadOptions);
  loader.current = loadOptions;
  const canLoad = loadOptions !== undefined;
  useEffect(() => {
    setChoice({});
    const loadOptions = canLoad ? loader.current : undefined;
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
  }, [canLoad, selected, chosenPath]);
  const shownOptions = useMemo(
    () => options?.map((o) => ({ ...o, currentValue: choice[o.id] ?? o.currentValue })) ?? null,
    [options, choice],
  );
  // Everything the user picked is sent, even a value equal to what the preview showed: the preview comes from a
  // throwaway session, and the real one may start from a different default.
  const changed = useMemo(() => {
    const result: Record<string, string> = {};
    for (const o of options ?? []) {
      const value = choice[o.id];
      if (value !== undefined) result[o.id] = value;
    }
    return result;
  }, [options, choice]);
  // Picking "Deep research" in the mode menu turns this page into a research page.
  const researching = isResearchMode(shownOptions);
  const [focus, setFocus] = useState<Focus[]>([]);
  const [format, setFormat] = useState<Format | null>(null);
  const start = async (raw: string, attachments?: ImageAttachment[]) => {
    const text = researching ? withFocus(raw, focus, format) : raw;
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
    setSent({ text, ...(attachments && attachments.length > 0 ? { attachments } : {}) });
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
  if (busy && sent) {
    const agentName = installed.find((a) => a.id === selected)?.label ?? "";
    return (
      <div className="new-chat flex min-h-0 flex-1 flex-col" data-research={researching || undefined}>
        <div className="research-glow" data-on={researching || undefined} aria-hidden="true" />
        <ChatHeader leading={null}>
          <span className="hidden items-center gap-1.5 text-xs text-text-muted sm:flex">
            <SymbolIcon name="folder" className="size-3.5" />
            {name}
            <span className="px-1 opacity-40">/</span>
          </span>
          <span className="truncate font-medium text-text">{agentName}</span>
        </ChatHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
            <UserMessage text={sent.text} {...(sent.attachments ? { images: sent.attachments } : {})} local />
            <div role="status" className="starting-row">
              <span className="spin-arc size-4 text-accent" aria-hidden="true" />
              <div className="min-w-0">
                <p className="status-fade font-medium text-text">{t("new.starting")}</p>
                <p className="mt-0.5 text-xs text-text-muted">{t("new.startingBody")}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-3xl px-4 pb-3">
          <Composer value="" onChange={() => {}} running={false} disabled disabledPlaceholder={t("new.starting")} onSend={() => {}} onCancel={() => {}} />
        </div>
      </div>
    );
  }
  return (
    <div className="new-chat flex min-h-0 flex-1 flex-col" data-research={researching || undefined}>
      {/* Always there, so the light fades in and out with the mode instead of appearing and vanishing. */}
      <div className="research-glow" data-on={researching || undefined} aria-hidden="true" />
      <div className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-auto px-6 py-8 [&>:first-child]:mt-auto [&>:last-child]:mb-auto">
        {researching ? (
          <>
            <ResearchHeading />
            <ResearchStarters onPick={(text) => setDraft((d) => (d.trim() === "" ? text : d))} />
            <ResearchPanel settings={serverSettings} onSetting={(patch) => onServerSetting?.(patch)} focus={focus} onFocus={setFocus} format={format} onFormat={setFormat} disabled={busy} />
          </>
        ) : (
          <h1 className="new-chat-title research-swap text-center">
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
        )}
      </div>
      <div className="new-chat-composer mx-auto w-full max-w-3xl px-6">
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
          {...(researching ? { placeholder: t("dr.placeholder") } : {})}
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
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
