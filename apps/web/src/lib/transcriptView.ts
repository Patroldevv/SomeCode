import { useSyncExternalStore } from 'react';
import { getClientSettings, useClientSettings, type TranscriptView } from './settings.ts';

export const TRANSCRIPT_VIEWS: readonly TranscriptView[] = ['normal', 'thinking', 'detailed'];

const KEY = 'somecode.transcriptViews';
const listeners = new Set<() => void>();
let saved: Record<string, TranscriptView> = read();

function read(): Record<string, TranscriptView> {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, TranscriptView] => TRANSCRIPT_VIEWS.includes(e[1] as TranscriptView)));
  } catch {
    return {};
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The view a chat was given from the menu, or null when it follows the default from the settings. */
export function sessionViewOverride(sessionId: string | null): TranscriptView | null {
  return sessionId ? (saved[sessionId] ?? null) : null;
}

export function setSessionView(sessionId: string, view: TranscriptView | null): void {
  const next = { ...saved };
  if (view === null) delete next[sessionId];
  else next[sessionId] = view;
  saved = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(saved));
  } catch {
    // The choice then only lasts until the page is closed.
  }
  for (const listener of listeners) listener();
}

/** Test hook. */
export function resetTranscriptViewsForTests(): void {
  saved = {};
  try {
    globalThis.localStorage?.removeItem(KEY);
  } catch {
    // nothing saved either way
  }
  for (const listener of listeners) listener();
}

/** The view of a chat: its own choice, else the default from the settings. */
export function useTranscriptView(sessionId: string | null): TranscriptView {
  const fallback = useClientSettings().defaultTranscriptView;
  const own = useSyncExternalStore(subscribe, () => sessionViewOverride(sessionId));
  return own ?? fallback;
}

export const defaultTranscriptView = (): TranscriptView => getClientSettings().defaultTranscriptView;
