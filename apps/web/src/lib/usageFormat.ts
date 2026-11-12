import { currentLanguage, t, type MessageKey } from '../i18n/index.ts';
import type { AgentLimit } from './api.ts';

/** A window's name in our words; an unknown one shows the agent's own name. */
export function limitName(type: string): string {
  const key = `usage.window.${type}` as MessageKey;
  const text = t(key);
  return text === undefined || text.startsWith('usage.window.') ? type.replace(/_/g, ' ') : text;
}

/** "14:20" today, "Mon 03:00" within the week, a date beyond: when a window renews. */
export function resetLabel(resetsAt: number, now = Date.now()): string {
  const locale = currentLanguage();
  const at = new Date(resetsAt);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at);
  const dayMs = 24 * 3600 * 1000;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(at) - startOfDay(new Date(now))) / dayMs);
  if (days === 0) return time;
  if (days > 0 && days < 7) return `${new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(at)} ${time}`;
  return `${new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at)} ${time}`;
}

/** "Gemini Models · 5-hour" for an agent that groups its windows, "5-hour" for the rest. */
export function rowName(limit: AgentLimit): string {
  const [, window] = limit.type.split('|');
  return window !== undefined && limit.label ? `${limit.label} · ${limitName(window)}` : limitName(limit.type);
}

/** "2 h 14 min", "3 d 4 h": how long until a window renews, in its two largest units. */
export function untilLabel(resetsAt: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((resetsAt - now) / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return t('usage.span.dh', { d, h });
  if (h > 0) return t('usage.span.hm', { h, m });
  return t('usage.span.m', { m });
}

/** How much of a window is left, in whole percent (null when unknown or already renewed). */
export function percentLeft(limit: AgentLimit, now: number): number | null {
  const expired = limit.resetsAt !== null && limit.resetsAt < now;
  return limit.used === null || expired ? null : Math.max(0, Math.round((1 - limit.used) * 100));
}

export type Tone = 'ok' | 'warn' | 'low' | 'none';
export const toneOf = (left: number | null): Tone => (left === null ? 'none' : left <= 10 ? 'low' : left <= 30 ? 'warn' : 'ok');
