import { currentLanguage } from '../i18n/index.ts';
import type { AgentInfo, SessionInfo } from './api.ts';
import type { SessionState } from './sessionState.ts';

const MAX_LABEL = 48;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['week', 7 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "5 min. ago" / "5 dk. önce" in the active UI language; the largest unit that fits, seconds below a minute. */
function relativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const format = new Intl.RelativeTimeFormat(currentLanguage(), { style: 'short' });
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
  }
  return format.format(-seconds, 'second');
}

/** The first non-blank line, trimmed, cut to `MAX_LABEL` characters (the last one being `…`). */
function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '';
  const chars = [...line];
  return chars.length > MAX_LABEL ? `${chars.slice(0, MAX_LABEL - 1).join('')}…` : line;
}

/**
 * The sidebar label of a session: the first line of its first user message when that is loaded, else
 * `"<agent label> · <relative time>"` (an agent missing from the list shows its raw id).
 */
export function sessionLabel(
  row: SessionInfo,
  state: SessionState | undefined,
  agents: AgentInfo[],
  now: number = Date.now(),
): string {
  if(row.title?.trim())return firstLine(row.title);
  for (const item of state?.items ?? []) {
    if (item.kind !== 'user') continue;
    const label = firstLine(item.text);
    if (label !== '') return label;
  }
  const agent = agents.find((a) => a.id === row.agentId)?.label ?? row.agentId;
  return `${agent} · ${relativeTime(row.createdAt, now)}`;
}
