import { en, type MessageKey } from './en.ts';
import { tr } from './tr.ts';

export type { MessageKey };

const language = (): string => globalThis.navigator?.language ?? 'en';

/** Turkish when the browser language starts with `tr`, English otherwise. */
export function t(key: MessageKey): string {
  const table: Record<MessageKey, string> = language().toLowerCase().startsWith('tr') ? tr : en;
  return table[key];
}

/** One-sentence message for a server error code (the raw server message is never shown). */
export function errorText(code: string): string {
  const key = `error.${code}`;
  return t(key in en ? (key as MessageKey) : 'error.internal');
}
