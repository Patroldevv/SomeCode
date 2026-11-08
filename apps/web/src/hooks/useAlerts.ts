import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionState } from '@somecode/protocol';
import { t } from '../i18n/index.ts';
import { attentionBetween, attentionSnapshot, lowLimits, type AttentionKind, type AttentionSnapshot } from '../lib/alerts.ts';
import type { AgentUsage } from '../lib/api.ts';
import { pageInFront, showSystemNotification } from '../lib/notify.ts';
import { getClientSettings } from '../lib/settings.ts';
import { playChime, type ChimeKind } from '../lib/sound.ts';
import type { SessionsStore } from '../lib/sessionsStore.ts';
import { rowName } from '../components/UsageMenu.tsx';

export type Toast = { id: number; kind: ChimeKind; text: string; sessionId?: string };

const TOAST_MS = 8000;

/**
 * Tells the user what needs them: a chat that finished, asks a question or failed, and an agent's limit running
 * low. Each one is a soft sound, a small card in the corner and (while the page is not in front) a system
 * notification, as far as the settings allow. A chat the user is looking at only speaks up for questions and errors.
 */
export function useAlerts({
  store,
  ids,
  labelOf,
  activeId,
  onOpen,
}: {
  store: SessionsStore;
  ids: () => string[];
  labelOf: (sessionId: string) => string;
  activeId: string | null;
  onOpen: (sessionId: string) => void;
}) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const seen = useRef(new Map<string, { state: SessionState; snap: AttentionSnapshot }>());
  const seenLimits = useRef(new Set<string>());
  const latest = useRef({ ids, labelOf, activeId, onOpen });
  useEffect(() => {
    latest.current = { ids, labelOf, activeId, onOpen };
  });

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((x) => x.id !== id)), []);

  const announce = useCallback(
    (kind: ChimeKind, title: string, body: string, tag: string, sessionId: string | undefined, toast: boolean) => {
      const settings = getClientSettings();
      if (settings.soundEnabled) playChime(kind);
      if (toast) {
        const id = ++next.current;
        setToasts((all) => [...all.slice(-3), { id, kind, text: body || title, ...(sessionId ? { sessionId } : {}) }]);
        setTimeout(() => dismiss(id), TOAST_MS);
      }
      if (settings.notifyEnabled) showSystemNotification(title, body, tag, sessionId ? () => latest.current.onOpen(sessionId) : undefined);
    },
    [dismiss],
  );

  useEffect(
    () =>
      store.subscribe(() => {
        for (const id of latest.current.ids()) {
          const state = store.get(id);
          const before = seen.current.get(id);
          if (before?.state === state) continue;
          const snap = attentionSnapshot(state);
          seen.current.set(id, { state, snap });
          const kind: AttentionKind | null = attentionBetween(before?.snap, snap);
          if (!kind) continue;
          const watching = pageInFront() && id === latest.current.activeId;
          if (kind === 'done' && watching) continue;
          const name = latest.current.labelOf(id);
          announce(kind, t(`alert.${kind}.title`), t(`alert.${kind}`, { name }), `${id}:${kind}`, id, !watching || kind !== 'done');
        }
      }),
    [store, announce],
  );

  /** Called with every usage answer: announces limits that just fell to 10 % or less. */
  const checkLimits = useCallback(
    (usage: AgentUsage[]) => {
      if (!getClientSettings().limitAlerts) return;
      for (const low of lowLimits(usage, seenLimits.current)) {
        announce('limit', t('alert.limit.title'), t('alert.limit', { name: `${low.agent} · ${rowName(low.limit)}`, percent: low.left }), `limit:${low.key}`, undefined, true);
      }
    },
    [announce],
  );

  return { toasts, dismiss, checkLimits };
}
