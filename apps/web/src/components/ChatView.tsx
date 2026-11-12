import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useAutoContinue } from "../hooks/useAutoContinue.ts";
import { subagentsOf } from "../lib/subagents.ts";
import { useTranscriptView } from "../lib/transcriptView.ts";
import { SubagentWait } from "./SubagentWait.tsx";
import type { ClientMessage, FormAnswer, ImageAttachment } from "@somecode/protocol";
import { t, type MessageParams } from "../i18n/index.ts";
import type { ProjectInfo } from "../lib/api.ts";
import type { WorkspaceApi } from "../lib/workspaceApi.ts";
import { SymbolIcon } from "./SymbolIcon.tsx";
import type { ConnectionState } from "../lib/connection.ts";
import { groupDigits, MAX_PROMPT_BYTES, promptBytes } from "../lib/format.ts";
import { planAnswer } from "../lib/permissionAnswers.ts";
import { useClientSettings } from "../lib/settings.ts";
import {
  useDraft,
  useSession,
  type SessionsStore,
} from "../lib/sessionsStore.ts";
import { Composer } from "./Composer.tsx";
import { ConfigChips } from "./ConfigChips.tsx";
import { ResearchFollowUps } from "./ResearchFollowUps.tsx";
import { ResearchControlProvider } from "./items/ResearchContext.tsx";
import { isResearchMode } from "../lib/configChips.ts";
import { CrossIcon } from "./icons.tsx";
import { MessageList } from "./MessageList.tsx";
import { dotStatus, isBusyStatus, StatusDot } from "./StatusDot.tsx";

const NONE: ReadonlySet<string> = new Set();
/** Safety net: stop showing a change as pending if the agent never answers. */
const CONFIG_PENDING_MS = 10_000;
/** A lost agent is reconnected on its own: this many tries, waiting 1.2 s, 2.4 s, 4.8 s before them. */
const AUTO_RESUME_TRIES = 3;
const AUTO_RESUME_BASE_MS = 1200;
const AUTO_RESUME_RESET_MS = 30_000;

/** The header strip above the conversation; `leading` holds the sidebar toggle. */
export function ChatHeader({
  leading,
  children,
}: {
  leading: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="chat-header flex h-14 shrink-0 items-center gap-3 px-3 font-ui text-sm">
      {leading}
      {children}
    </header>
  );
}

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-danger/60 bg-bg-elevated px-3 py-2 font-ui text-sm text-text"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        aria-label={t("error.dismiss")}
        title={t("error.dismiss")}
        onClick={onDismiss}
        className="shrink-0 rounded p-0.5 text-text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-accent"
      >
        <CrossIcon className="size-4" />
      </button>
    </div>
  );
}

/**
 * One session's conversation: header, message list, error banner and composer. The draft lives in the store
 * (per session); it is cleared synchronously inside `onSend` once the prompt was handed to the socket, and kept
 * (with a `network` banner) when it could not be.
 */
export function ChatView({
  sessionId,
  store,
  send,
  agentLabel,
  connection,
  banner,
  onDismissBanner,
  onError,
  leading,
  signInHint,
  onRunChecks,
  trailing,
  project,
  workspaceApi,
  onResume,
  onOlder,
  onRecent,
  onOpenAgents,
}: {
  onOlder?: () => Promise<void>;
  onRecent?: () => void;
  onOpenAgents?: (subagentId?: string) => void;
  trailing?: ReactNode;
  project?: ProjectInfo;
  workspaceApi?: WorkspaceApi;
  onResume?: () => Promise<void>;
  sessionId: string;
  store: SessionsStore;
  /** False when the message could not be sent right now. */
  send: (message: ClientMessage) => boolean;
  agentLabel: string;
  connection: ConnectionState;
  banner: string | null;
  onDismissBanner: () => void;
  onError: (code: string, params?: MessageParams) => void;
  leading: ReactNode;
  /** The session agent's sign-in command (from the agent list). */
  signInHint?: string;
  /** Runs the project's checks now. */
  onRunChecks?: () => void;
}) {
  const [resuming, setResuming] = useState(false);
  const { showAdvancedOptions, autoContinueSubagents, subagentsEnabled } = useClientSettings();
  const state = useSession(store, sessionId);
  const transcriptView = useTranscriptView(sessionId);
  const displayItems = useMemo(
    () => (state.olderItems?.length ? [...state.olderItems, ...state.items] : state.items),
    [state.olderItems, state.items],
  );
  const sessionSubagents = useMemo(() => subagentsOf(displayItems), [displayItems]);
  const runningSubagents = useMemo(() => sessionSubagents.filter((a) => a.status === "running").length, [sessionSubagents]);
  const autoTries = useRef(0);
  const lost = state.status === "disconnected" && Boolean(onResume);
  /** One reconnect try; an automatic one stays quiet until its last failure. */
  const resume = (auto: boolean) => {
    if (!onResume) return;
    setResuming(true);
    void onResume()
      .catch(() => {
        if (!auto || autoTries.current >= AUTO_RESUME_TRIES) onError("disconnected");
      })
      .finally(() => setResuming(false));
  };
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  useEffect(() => {
    if (!lost) {
      // Only a connection that then holds for a while earns a fresh set of tries (a crash loop must not spin).
      const timer = setTimeout(() => {
        autoTries.current = 0;
      }, AUTO_RESUME_RESET_MS);
      return () => clearTimeout(timer);
    }
    if (resuming || autoTries.current >= AUTO_RESUME_TRIES) return;
    const timer = setTimeout(() => {
      autoTries.current += 1;
      resumeRef.current(true);
    }, AUTO_RESUME_BASE_MS * 2 ** autoTries.current);
    return () => clearTimeout(timer);
  }, [lost, resuming, sessionId]);
  const draft = useDraft(store, sessionId);
  // Answered permission requests per session: the ref guards a double click before React re-renders,
  // the re-render disables the card's buttons. Kept across session switches.
  const answeredRef = useRef(new Map<string, ReadonlySet<string>>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const answered = answeredRef.current.get(sessionId) ?? NONE;

  const onSend = (text: string, attachments?: ImageAttachment[]) => {
    if (promptBytes(text) > MAX_PROMPT_BYTES) {
      // Over the socket's payload limit the server would drop the connection and the prompt with it: refuse
      // up front and keep the draft (nothing sent, no optimistic item).
      onError("prompt_too_long", { limit: groupDigits(MAX_PROMPT_BYTES) });
      return;
    }

    // /verify is not a message: it runs the project's checks now.
    if (text.trim() === "/verify" && onRunChecks) {
      onRunChecks();
      store.setDraft(sessionId, "");
      return;
    }

    const isGoal = text.startsWith('/goal');
    const goalTarget = isGoal ? text.slice(5).trim() : '';
    let promptText = text;
    if (isGoal) {
      promptText = `[GOAL MODE: AUTONOMOUS EXECUTION]\nHedef: ${goalTarget || 'Görevi eksiksiz tamamla'}\nTalimat: Bu hedefi tamamen bitirene, tüm dosyaları güncelleyene ve testlerle doğrulayana kadar durmadan otonom olarak çalış.`;
    }
    if (!subagentsEnabled) {
      promptText += '\n\n[SİSTEM BİLGİSİ: Alt ajan sistemi ayarlardan kapatılmıştır. invoke_subagent, Task veya alt ajan araçlarını KULLANMAYIN. Tüm görevleri doğrudan tek başınıza çözün.]';
    }

    if (
      send({
        type: "prompt",
        sessionId,
        text: promptText,
        ...(attachments && attachments.length > 0 ? { images: attachments } : {}),
      })
    ) {
      // Shown at once with the user's prompt text and attachments; the server journals the prompt as a user_message.
      store.addLocalUser(sessionId, text, attachments);
      store.setDraft(sessionId, "");
    } else {
      onError("network");
    }
  };

  const onRespond = (requestId: string, optionId: string | null, answer?: FormAnswer) => {
    const plan = planAnswer(
      answeredRef.current.get(sessionId) ?? NONE,
      sessionId,
      requestId,
      optionId,
      answer,
    );
    if (!plan) return;
    if (!send(plan.message)) {
      onError("network");
      return;
    }
    answeredRef.current.set(sessionId, plan.answered);
    rerender();
  };

  // The option whose change was requested and not yet confirmed. The shown value only ever comes from the agent's
  // own `config_options`, so the request is pending until the value moves, an error shows up, or it times out.
  const [pending, setPending] = useState<{ id: string; from: string } | null>(
    null,
  );
  const confirmed = pending
    ? state.configOptions?.find((o) => o.id === pending.id)?.currentValue
    : undefined;
  useEffect(() => {
    if (pending && confirmed !== undefined && confirmed !== pending.from)
      setPending(null);
  }, [pending, confirmed]);
  useEffect(() => {
    if (banner) setPending(null);
  }, [banner]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), CONFIG_PENDING_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const onConfigChange = (configId: string, value: string) => {
    const from = state.configOptions?.find(
      (o) => o.id === configId,
    )?.currentValue;
    if (from === undefined || from === value) return;
    if (send({ type: "set_config", sessionId, configId, value }))
      setPending({ id: configId, from });
    else onError("network");
  };

  useAutoContinue(
    runningSubagents,
    state.status === "ready",
    autoContinueSubagents && subagentsEnabled,
    () => {
      const latestWithOutput = sessionSubagents.findLast((a) => Boolean(a.output));
      const message = latestWithOutput?.output
        ? t("subagent.continueWithResult", {
            name: latestWithOutput.name,
            result: latestWithOutput.output.slice(0, 4000),
          })
        : t("subagent.continue");
      // Send continuation silently without creating a user bubble in the chat
      if (!send({ type: "prompt", sessionId, text: message })) {
        onError("network");
      }
    },
  );

  const onCancel = () => {
    if (!send({ type: "cancel", sessionId })) onError("network");
  };

  const researching = isResearchMode(state.configOptions);
  return (
    <div className="chat-view flex min-h-0 flex-1 flex-col" data-research={researching || undefined}>
      <div className="research-glow" data-on={researching || undefined} aria-hidden="true" />
      <ChatHeader leading={leading}>
        {project && (
          <span className="hidden items-center gap-1.5 text-xs text-text-muted sm:flex">
            <SymbolIcon name="folder" className="size-3.5" />
            {project.name}
            <span className="px-1 opacity-40">/</span>
          </span>
        )}
        <span className="truncate font-medium text-text">{agentLabel}</span>
        <span className="flex items-center gap-1.5 text-text-muted">
          <StatusDot state={state} quiet />
          <span
            aria-hidden="true"
            className={
              dotStatus(state) === "ready"
                ? "sr-only"
                : isBusyStatus(dotStatus(state))
                  ? "status-fade"
                  : ""
            }
          >
            {t(`session.status.${dotStatus(state)}`)}
          </span>
        </span>
        <span
          className={`ml-auto text-xs text-text-muted ${connection === "open" ? "sr-only" : ""}`}
        >
          <span className="sr-only">{t("connection.label")}: </span>
          {t(`connection.${connection}`)}
        </span>
        {trailing}
      </ChatHeader>
      {state.status === "disconnected" && onResume && (
        <div className="resume-banner">
          <span>{t("session.status.disconnected")}</span>
          <button
            className="small-button"
            disabled={resuming}
            onClick={() => {
              autoTries.current = 0;
              resume(false);
            }}
          >
            <SymbolIcon
              name="refresh"
              className={resuming ? "animate-spin" : ""}
            />
            {t(resuming ? "chat.resuming" : "chat.resume")}
          </button>
        </div>
      )}
      {(state.olderBeforeSeq != null || Boolean(state.olderItems?.length)) && (
        <div className="flex shrink-0 items-center justify-center gap-2 py-2 text-xs text-text-muted">
          {state.olderBeforeSeq != null && (
            <button
              className="small-button"
              disabled={state.historyLoading}
              onClick={() => void onOlder?.().catch(() => onError("network"))}
            >
              {t(state.historyLoading ? "chat.loading" : "chat.older")}
            </button>
          )}
          {Boolean(state.olderItems?.length) && (
            <button className="small-button" onClick={onRecent}>
              {t("list.jumpToLatest")}
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ResearchControlProvider value={{ running: state.status === "running", stop: onCancel, researching, ...(onRunChecks ? { runChecks: onRunChecks } : {}) }}>
        <MessageList
          key={sessionId}
          items={displayItems}
          plan={state.plan}
          status={state.status}
          answeredRequests={answered}
          onRespond={onRespond}
          subagents={sessionSubagents}
          view={transcriptView}
          {...(project && workspaceApi
            ? {
                onRollbackTurn: async (files) => {
                  const reqFiles = files.map((f) => ({
                    path: f.path,
                    content: f.changes[0]?.oldText ?? null,
                  }));
                  await workspaceApi.revert(project.id, { files: reqFiles });
                },
                onUndoTurn: async (item, files, revertFiles) => {
                  if (revertFiles && files.length > 0) {
                    try {
                      const reqFiles = files.map((f) => ({
                        path: f.path,
                        content: f.changes[0]?.oldText ?? null,
                      }));
                      await workspaceApi.revert(project.id, { files: reqFiles });
                    } catch {
                      // ignore
                    }
                  }
                  if ('text' in item && typeof item.text === 'string') {
                    store.setDraft(sessionId, item.text);
                  }
                  const seq = state.itemSeqs?.[item.key] ?? Number(item.key);
                  if (Number.isSafeInteger(seq) && seq > 0) {
                    try {
                      await workspaceApi.rewindSession(sessionId, seq);
                    } catch {
                      // ignore
                    }
                  }
                  store.rewindTo(sessionId, item.key);
                  setTimeout(() => {
                    const textarea = document.querySelector<HTMLTextAreaElement>('textarea');
                    if (textarea) {
                      textarea.focus();
                      const len = textarea.value.length;
                      textarea.setSelectionRange(len, len);
                    }
                  }, 50);
                },
              }
            : {})}
          {...(onOpenAgents ? { onOpenAgents } : {})}
          {...(signInHint ? { signInHint } : {})}
        />
        </ResearchControlProvider>
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pt-2 pb-3">
        {banner && <ErrorBanner message={banner} onDismiss={onDismissBanner} />}
        <SubagentWait running={runningSubagents} />
        {researching && state.status === "ready" && (() => {
          const last = displayItems[displayItems.length - 1];
          return last?.kind === "agent" && last.text.length >= 900 ? <ResearchFollowUps onPick={(text) => onSend(text)} /> : null;
        })()}
        <Composer
          inChat
          projectId={project?.id}
          workspaceApi={workspaceApi}
          value={draft}
          onChange={(text) => store.setDraft(sessionId, text)}
          running={state.status === "running"}
          disabled={state.status === "disconnected"}
          disableSend={runningSubagents > 0}
          sendDisabledTooltip={
            runningSubagents > 0
              ? t(runningSubagents > 1 ? "composer.subagentsWaiting.multiple" : "composer.subagentsWaiting")
              : undefined
          }
          onSend={onSend}
          onCancel={onCancel}
          toolbar={
            <ConfigChips
              options={state.configOptions}
              disabled={state.status !== "ready"}
              pendingId={pending?.id ?? null}
              onChange={onConfigChange}
              advanced={showAdvancedOptions}
            />
          }
        />
      </div>
    </div>
  );
}
