import { useReducer, useRef, type ReactNode } from 'react';
import type { ClientMessage } from '@somecode/protocol';
import { t, type MessageParams } from '../i18n/index.ts';
import type { ConnectionState } from '../lib/connection.ts';
import { groupDigits, MAX_PROMPT_BYTES, promptBytes } from '../lib/format.ts';
import { planAnswer } from '../lib/permissionAnswers.ts';
import { useDraft, useSession, type SessionsStore } from '../lib/sessionsStore.ts';
import { Composer } from './Composer.tsx';
import { CrossIcon } from './icons.tsx';
import { MessageList } from './MessageList.tsx';
import { dotStatus, StatusDot } from './StatusDot.tsx';

const NONE: ReadonlySet<string> = new Set();

/** The header strip above the conversation; `leading` holds the sidebar toggle. */
export function ChatHeader({ leading, children }: { leading: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-3 font-ui text-sm">
      {leading}
      {children}
    </header>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/60 bg-bg-elevated px-3 py-2 font-ui text-sm text-text">
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        aria-label={t('error.dismiss')}
        title={t('error.dismiss')}
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
}: {
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
}) {
  const state = useSession(store, sessionId);
  const draft = useDraft(store, sessionId);
  // Answered permission requests per session: the ref guards a double click before React re-renders,
  // the re-render disables the card's buttons. Kept across session switches.
  const answeredRef = useRef(new Map<string, ReadonlySet<string>>());
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const answered = answeredRef.current.get(sessionId) ?? NONE;

  const onSend = (text: string) => {
    if (promptBytes(text) > MAX_PROMPT_BYTES) {
      // Over the socket's payload limit the server would drop the connection and the prompt with it: refuse
      // up front and keep the draft (nothing sent, no optimistic item).
      onError('prompt_too_long', { limit: groupDigits(MAX_PROMPT_BYTES) });
      return;
    }
    if (send({ type: 'prompt', sessionId, text })) {
      // Shown at once; the server journals the prompt as a user_message, which confirms this item.
      store.addLocalUser(sessionId, text);
      store.setDraft(sessionId, '');
    } else {
      onError('network');
    }
  };

  const onRespond = (requestId: string, optionId: string) => {
    const plan = planAnswer(answeredRef.current.get(sessionId) ?? NONE, sessionId, requestId, optionId);
    if (!plan) return;
    if (!send(plan.message)) {
      onError('network');
      return;
    }
    answeredRef.current.set(sessionId, plan.answered);
    rerender();
  };

  const onCancel = () => {
    if (!send({ type: 'cancel', sessionId })) onError('network');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader leading={leading}>
        <span className="truncate font-medium text-text">{agentLabel}</span>
        <span className="flex items-center gap-1.5 text-text-muted">
          <StatusDot state={state} />
          <span aria-hidden="true">{t(`session.status.${dotStatus(state)}`)}</span>
        </span>
        <span className="ml-auto text-xs text-text-muted">
          <span className="sr-only">{t('connection.label')}: </span>
          {t(`connection.${connection}`)}
        </span>
      </ChatHeader>
      <div className="min-h-0 flex-1">
        <MessageList
          key={sessionId}
          items={state.items}
          plan={state.plan}
          status={state.status}
          answeredRequests={answered}
          onRespond={onRespond}
        />
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pt-2 pb-3">
        {banner && <ErrorBanner message={banner} onDismiss={onDismissBanner} />}
        <Composer
          value={draft}
          onChange={(text) => store.setDraft(sessionId, text)}
          running={state.status === 'running'}
          disabled={state.status === 'disconnected'}
          onSend={onSend}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}
