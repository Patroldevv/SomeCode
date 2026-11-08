import { useSyncExternalStore } from 'react';
import { HISTORY_PAGE_ITEMS, HISTORY_WINDOW_BYTES, type ImageAttachment, type Item, type SessionHistoryPage, type StoredEvent } from '@somecode/protocol';
import { addLocalUserMessage, applyEvent, initialState, TRUNCATION_MARKER, type SessionState } from './sessionState.ts';

/**
 * In-memory state of every session the client has opened, so switching sessions loses nothing.
 * React-free (only `useSession` below touches React): it is a plain external store for `useSyncExternalStore`.
 *
 * Notification contract: `get`/`getDraft` are always current and synchronous. Journaled events (`apply`,
 * `reset`) mark the store dirty and notify at most once per frame (a replay of thousands of events costs one
 * render per frame, not one per event). User actions (`addLocalUser`, `setDraft`) notify synchronously, so
 * typing and sending never wait for a frame; a synchronous notification also delivers any pending change.
 */
export type SessionsStore = {
  /** Referentially stable until that specific session changes; an unknown id yields one shared empty state. */
  get(sessionId: string): SessionState;
  /** Applies a journaled event; a duplicate/old seq changes nothing and schedules nothing. Notifies on the next frame. */
  apply(sessionId: string, stored: StoredEvent): void;
  /** Adds the optimistic user item for a prompt that was just sent. Notifies synchronously. */
  addLocalUser(sessionId: string, text: string, images?: ImageAttachment[]): void;
  /** Forgets the session's state (so a replay can rebuild it); its draft is kept. Notifies on the next frame. */
  reset(sessionId: string): void;
  setSnapshot(sessionId: string, history: SessionHistoryPage): void;
  setOlderHistory(sessionId: string, history: SessionHistoryPage): void;
  clearOlderHistory(sessionId: string): void;
  setHistoryLoading(sessionId: string, loading: boolean): void;
  /** Protect the active session from inactive-cache eviction. */
  activate(sessionId: string): void;
  getDraft(sessionId: string): string;
  /** Drafts notify synchronously (a controlled textarea is backed by the store); identical text is a no-op. */
  setDraft(sessionId: string, text: string): void;
  /** Delivers a pending (frame-scheduled) notification now; a no-op when nothing is pending. */
  flush(): void;
  /** Returns the unsubscribe function. The last unsubscribe cancels a pending frame. */
  subscribe(listener: () => void): () => void;
};

/** Runs `callback` later (once); returns a function that cancels it if it has not run yet. */
export type Schedule = (callback: () => void) => () => void;

export type SessionsStoreOptions = {
  /** Test seam: when a deferred notification runs. Defaults to `frameSchedule`. */
  schedule?: Schedule;
  maxSessions?: number;
  maxItems?: number;
};

/**
 * The next animation frame; a 16 ms timer when rAF is missing or the tab is hidden (where rAF does not fire
 * at all, and the sidebar must still catch up).
 */
export const frameSchedule: Schedule = (callback) => {
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (typeof requestAnimationFrame === 'function' && !hidden) {
    const id = requestAnimationFrame(() => callback());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 16);
  return () => clearTimeout(id);
};

/** Shared by `get` for unknown ids and by `useSession(store, null)`; never stored in a map. */
const EMPTY_STATE: SessionState = initialState();

export function createSessionsStore(options: SessionsStoreOptions = {}): SessionsStore {
  const schedule = options.schedule ?? frameSchedule;
  const maxSessions = Math.max(1, options.maxSessions ?? 4);
  const maxItems = Math.max(1, options.maxItems ?? HISTORY_PAGE_ITEMS);
  let active: string | null = null;
  const sessions = new Map<string, SessionState>();
  const drafts = new Map<string, string>();
  const listeners = new Set<() => void>();
  const encoder = new TextEncoder();
  /** Cancels the scheduled notification; `null` when none is pending. */
  let pending: (() => void) | null = null;

  const cancelPending = () => {
    if (pending === null) return;
    const cancel = pending;
    pending = null;
    cancel();
  };

  const notifyNow = () => {
    cancelPending();
    // Copy so a listener that (un)subscribes during notification does not disturb the loop.
    for (const listener of [...listeners]) listener();
  };

  const notifyLater = () => {
    if (pending !== null || listeners.size === 0) return;
    pending = schedule(() => {
      pending = null;
      notifyNow();
    });
  };

  const get = (sessionId: string): SessionState => sessions.get(sessionId) ?? EMPTY_STATE;
  const durableSeq = (state: SessionState, item: Item): number => state.itemSeqs?.[item.key] ?? Number(item.key);
  const firstDurableSeq = (state: SessionState, items: Item[]): number | null =>
    items.map((item) => durableSeq(state,item)).find((seq) => Number.isSafeInteger(seq) && seq > 0) ?? null;

  const boundItems = (items: Item[]): Item[] => {
    let bytes = 0;
    let start = items.length;
    while (start > 0 && items.length-start < maxItems) {
      const size = encoder.encode(JSON.stringify(items[start-1])).byteLength;
      if (start < items.length && bytes + size > HISTORY_WINDOW_BYTES) break;
      bytes += size;
      start--;
    }
    return start === 0 ? items : items.slice(start);
  };

  const replace = (sessionId: string, next: SessionState, notify: () => void) => {
    if (next === get(sessionId)) return;
    const items = boundItems(next.items);
    if (items !== next.items) {
      const retainedKeys = new Set(items.map((item) => item.key));
      next = {...next,items,itemSeqs:Object.fromEntries(Object.entries(next.itemSeqs??{}).filter(([key])=>retainedKeys.has(key))),
        ...(next.olderItems?.length ? {} : {olderBeforeSeq:firstDurableSeq(next,items) ?? next.olderBeforeSeq})};
    }
    sessions.delete(sessionId);
    sessions.set(sessionId, next);
    while (sessions.size > maxSessions) {
      const oldest = [...sessions.keys()].find((id) => id !== active);
      if (!oldest) break;
      sessions.delete(oldest);
    }
    notify();
  };

  return {
    get,
    apply: (sessionId, stored) => {
      const previous = get(sessionId);
      let next: SessionState = applyEvent(previous,stored);
      if (next !== previous && stored.event.type === 'user_message') {
        const confirmed = next.items.find((item) => item.kind === 'user' && !item.local &&
          previous.items.some((before) => before.kind === 'user' && before.local && before.key === item.key));
        if (confirmed) next = {...next,itemSeqs:{...previous.itemSeqs,[confirmed.key]:stored.seq}};
      }
      if (next !== previous && previous.olderItems?.length && (stored.event.type === 'tool_call_update' || stored.event.type === 'permission_resolved')) {
        const older = applyEvent({...previous,items:previous.olderItems},stored);
        next = {...next,olderItems:older.items};
      }
      replace(sessionId,next,notifyLater);
    },
    addLocalUser: (sessionId, text, images) => replace(sessionId, addLocalUserMessage(get(sessionId), text, images), notifyNow),
    reset: (sessionId) => {
      if (sessions.delete(sessionId)) notifyLater();
    },
    activate: (sessionId) => {
      active = sessionId;
      const state = sessions.get(sessionId);
      if (state) { sessions.delete(sessionId); sessions.set(sessionId,state); }
    },
    setSnapshot: (sessionId, history) => {
      const previous = get(sessionId);
      if (history.state.lastSeq < previous.lastSeq) return;
      // Preserve a prompt that was sent but has not yet been echoed by the journal.
      const echoed = history.state.items.filter((item) => item.kind === 'user' && Number(item.key) > previous.lastSeq);
      const pending = previous.items.filter((item) => {
        if (item.kind !== 'user' || !item.local) return false;
        const index = echoed.findIndex((candidate) => candidate.kind === 'user' && (candidate.text === item.text ||
          (candidate.text.endsWith(TRUNCATION_MARKER) && item.text.startsWith(candidate.text.slice(0,-TRUNCATION_MARKER.length)))));
        if (index < 0) return true;
        echoed.splice(index,1);
        return false;
      });
      replace(sessionId,{...history.state,localSeq:previous.localSeq,items:[...history.state.items,...pending],olderBeforeSeq:history.beforeSeq},notifyLater);
    },
    setOlderHistory: (sessionId, history) => {
      const previous = get(sessionId);
      const recent = new Set(previous.items.map((item) => durableSeq(previous,item)));
      const candidates = history.state.items.filter((item) => !recent.has(Number(item.key)));
      const items = boundItems(candidates);
      replace(sessionId,{...previous,olderItems:items,olderBeforeSeq:items.length < candidates.length ? Number(items[0]!.key) : history.beforeSeq,historyLoading:false},notifyNow);
    },
    clearOlderHistory: (sessionId) => {
      const previous = get(sessionId);
      replace(sessionId,{...previous,olderItems:[],olderBeforeSeq:firstDurableSeq(previous,previous.items),historyLoading:false},notifyNow);
    },
    setHistoryLoading: (sessionId, loading) => replace(sessionId,{...get(sessionId),historyLoading:loading},notifyNow),
    getDraft: (sessionId) => drafts.get(sessionId) ?? '',
    setDraft: (sessionId, text) => {
      if (text === (drafts.get(sessionId) ?? '')) return;
      if (text === '') drafts.delete(sessionId);
      else drafts.set(sessionId, text);
      notifyNow();
    },
    flush: () => {
      if (pending !== null) notifyNow();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) cancelPending();
      };
    },
  };
}

/** Subscribes a component to one session; `null` (no active session) yields the shared stable empty state. */
export function useSession(store: SessionsStore, sessionId: string | null): SessionState {
  return useSyncExternalStore(store.subscribe, () => (sessionId === null ? EMPTY_STATE : store.get(sessionId)));
}

/** Subscribes a component to one session's draft; `null` yields `''`. Strings compare by value, so it is stable. */
export function useDraft(store: SessionsStore, sessionId: string | null): string {
  return useSyncExternalStore(store.subscribe, () => (sessionId === null ? '' : store.getDraft(sessionId)));
}
