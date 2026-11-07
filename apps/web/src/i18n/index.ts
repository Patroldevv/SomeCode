import { en, type MessageKey } from './en.ts';
import { tr } from './tr.ts';

export type { MessageKey };

export type MessageParams = Record<string, string | number>;

let override: string | null = null;

const language = (): string => override ?? globalThis.navigator?.language ?? 'en';

/** Test hook: force the language (e.g. `'tr'`); `null` goes back to `navigator.language`. */
export function setLanguageForTests(lang: string | null): void {
  override = lang;
}

/** Replaces `{name}` placeholders with `params[name]`; unknown placeholders stay as written. */
export function interpolate(message: string, params?: MessageParams): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

/** The UI language: `'tr'` when the browser language starts with `tr`, `'en'` otherwise. */
export function currentLanguage(): 'tr' | 'en' {
  return language().toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

/** Turkish when the browser language starts with `tr`, English otherwise. */
export function t(key: MessageKey, params?: MessageParams): string {
  const table: Record<MessageKey, string> = currentLanguage() === 'tr' ? tr : en;
  return interpolate(table[key], params);
}

/** One-sentence message for a server error code (the raw server message is never shown). */
export function errorText(code: string): string {
  const key = `error.${code}`;
  return t(key in en ? (key as MessageKey) : 'error.internal');
}
