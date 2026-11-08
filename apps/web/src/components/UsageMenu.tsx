import { useEffect, useRef, useState } from 'react';
import { currentLanguage, t, type MessageKey } from '../i18n/index.ts';
import type { AgentLimit, AgentUsage } from '../lib/api.ts';
import { SymbolIcon } from './SymbolIcon.tsx';

/** A window's name in our words; an unknown one shows the agent's own name. */
function limitName(type: string): string {
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

const compact = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

function Limit({ limit, now }: { limit: AgentLimit; now: number }) {
  const expired = limit.resetsAt !== null && limit.resetsAt < now;
  const left = limit.used === null || expired ? null : Math.max(0, Math.round((1 - limit.used) * 100));
  return (
    <li className="usage-row">
      <span className="min-w-0 flex-1">{rowName(limit)}</span>
      <span className="text-right">
        <span className={left !== null && left <= 10 ? 'text-warn' : 'text-text'}>
          {left !== null ? t('usage.left', { percent: left }) : expired ? t('usage.renewed') : t('usage.unknown')}
        </span>
        {limit.resetsAt !== null && !expired && <span className="usage-reset">{t('usage.resets', { when: resetLabel(limit.resetsAt, now) })}</span>}
      </span>
    </li>
  );
}

/**
 * The usage button above the profile one: for every agent, the subscription windows it has reported (how much is
 * left and when it renews). These are only the figures the agents really sent; one that has not reported yet says so.
 */
/** The figures are fetched in the background: once at start and then every few minutes. */
const POLL_MS = 5 * 60_000;
/** Opening the menu asks again only when what it has is older than this (a refresh button press always asks). */
const FRESH_MS = 60_000;

export function UsageMenu({ load }: { load: (refresh?: boolean) => Promise<AgentUsage[]> }) {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<AgentUsage[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(0);
  const [pending, setPending] = useState(false);
  const fetchedAt = useRef(0);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      fetchedAt.current = Date.now();
      void load(false).then((u) => alive && setUsage(u)).catch(() => {});
    };
    pull();
    const timer = setInterval(pull, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    // What is already there shows at once; a newer answer replaces it.
    if (refreshing > 0 || Date.now() - fetchedAt.current > FRESH_MS) {
      fetchedAt.current = Date.now();
      setPending(true);
      void load(refreshing > 0)
        .then((u) => alive && setUsage(u))
        .catch(() => alive && setUsage((old) => old ?? []))
        .finally(() => setPending(false));
    }
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      alive = false;
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [open, load, refreshing]);
  const now = Date.now();
  return (
    <div ref={root} className="profile">
      <button type="button" className="profile-button" aria-label={t('usage.title')} title={t('usage.title')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SymbolIcon name="ring" className="size-[18px] text-text-muted" />
      </button>
      {open && (
        <div role="dialog" aria-label={t('usage.title')} className="profile-menu usage-menu">
          <div className="flex items-center justify-between pb-2">
            <p className="usage-title !pb-0">{t('usage.title')}</p>
            <button type="button" className="icon-button size-6" aria-label={t('agent.refresh')} title={t('agent.refresh')} onClick={() => setRefreshing((n) => n + 1)}>
              <SymbolIcon name="refresh" className={`size-3.5 ${pending ? 'motion-safe:animate-spin' : ''}`} />
            </button>
          </div>
          {usage === null && <p className="usage-empty">{t('chat.loading')}</p>}
          {usage?.map((agent) => (
            <section key={agent.id} className="usage-agent" aria-label={agent.label}>
              <h3>{agent.label}</h3>
              {agent.limits.length > 0 && (
                <ul>
                  {agent.limits.map((l) => (
                    <Limit key={l.type} limit={l} now={now} />
                  ))}
                </ul>
              )}
              {agent.stats && agent.stats.length > 0 && (
                <p className="usage-empty">
                  {t('usage.stats7d', {
                    prompts: agent.stats.find((s) => s.key === 'prompts7d')?.value ?? 0,
                    tokens: compact(agent.stats.find((s) => s.key === 'tokens7d')?.value ?? 0),
                  })}
                </p>
              )}
              {agent.error && <p className="usage-empty">{t(agent.error === 'signed_out' ? 'usage.signedOut' : 'usage.unavailable')}</p>}
              {agent.limits.length === 0 && !agent.stats && !agent.error && <p className="usage-empty">{t('usage.none')}</p>}
            </section>
          ))}
          <p className="usage-note">{t('usage.note')}</p>
        </div>
      )}
    </div>
  );
}
