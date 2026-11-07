import { useSyncExternalStore } from 'react';
import type { StoredEvent } from '@somecode/protocol';
import { addLocalUserMessage, applyEvent, initialState, type SessionState } from './sessionState.ts';

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
  addLocalUser(sessionId: string, text: string): void;
  /** Forgets the session's state (so a replay can rebuild it); its draft is kept. Notifies on the next frame. */
  reset(sessionId: string): void;
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
  const sessions = new Map<string, SessionState>();
  const drafts = new Map<string, string>();
  const listeners = new Set<() => void>();
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

  const replace = (sessionId: string, next: SessionState, notify: () => void) => {
    if (next === get(sessionId)) return;
    sessions.set(sessionId, next);
    notify();
  };

  return {
    get,
    apply: (sessionId, stored) => replace(sessionId, applyEvent(get(sessionId), stored), notifyLater),
    addLocalUser: (sessionId, text) => replace(sessionId, addLocalUserMessage(get(sessionId), text), notifyNow),
    reset: (sessionId) => {
      if (sessions.delete(sessionId)) notifyLater();
    },
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
