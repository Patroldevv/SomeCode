import { useSyncExternalStore } from 'react';
import type { StoredEvent } from '@somecode/protocol';
import { addLocalUserMessage, applyEvent, initialState, type SessionState } from './sessionState.ts';

/**
 * In-memory state of every session the client has opened, so switching sessions loses nothing.
 * React-free (only `useSession` below touches React): it is a plain external store for `useSyncExternalStore`.
 */
export type SessionsStore = {
  /** Referentially stable until that specific session changes; an unknown id yields one shared empty state. */
  get(sessionId: string): SessionState;
  /** Applies a journaled event; a duplicate/old seq changes nothing and notifies nobody. */
  apply(sessionId: string, stored: StoredEvent): void;
  /** Adds the optimistic user item for a prompt that was just sent. */
  addLocalUser(sessionId: string, text: string): void;
  /** Forgets the session's state (so a replay can rebuild it); its draft is kept. */
  reset(sessionId: string): void;
  getDraft(sessionId: string): string;
  /** Drafts notify (so a controlled textarea can be backed by the store); identical text is a no-op. */
  setDraft(sessionId: string, text: string): void;
  /** Listeners run synchronously, once per effective change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
};

/** Shared by `get` for unknown ids and by `useSession(store, null)`; never stored in a map. */
const EMPTY_STATE: SessionState = initialState();

export function createSessionsStore(): SessionsStore {
  const sessions = new Map<string, SessionState>();
  const drafts = new Map<string, string>();
  const listeners = new Set<() => void>();

  const notify = () => {
    // Copy so a listener that (un)subscribes during notification does not disturb the loop.
    for (const listener of [...listeners]) listener();
  };

  const get = (sessionId: string): SessionState => sessions.get(sessionId) ?? EMPTY_STATE;

  const replace = (sessionId: string, next: SessionState) => {
    if (next === get(sessionId)) return;
    sessions.set(sessionId, next);
    notify();
  };

  return {
    get,
    apply: (sessionId, stored) => replace(sessionId, applyEvent(get(sessionId), stored)),
    addLocalUser: (sessionId, text) => replace(sessionId, addLocalUserMessage(get(sessionId), text)),
    reset: (sessionId) => {
      if (sessions.delete(sessionId)) notify();
    },
    getDraft: (sessionId) => drafts.get(sessionId) ?? '',
    setDraft: (sessionId, text) => {
      if (text === (drafts.get(sessionId) ?? '')) return;
      if (text === '') drafts.delete(sessionId);
      else drafts.set(sessionId, text);
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Subscribes a component to one session; `null` (no active session) yields the shared stable empty state. */
export function useSession(store: SessionsStore, sessionId: string | null): SessionState {
  return useSyncExternalStore(store.subscribe, () => (sessionId === null ? EMPTY_STATE : store.get(sessionId)));
}
