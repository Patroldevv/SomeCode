import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { AgentUsageBlock } from './UsageBars.tsx';
import { percentLeft, toneOf } from '../lib/usageFormat.ts';
export { resetLabel, rowName } from '../lib/usageFormat.ts';
import type { AgentLimit, AgentUsage } from '../lib/api.ts';
import { SymbolIcon } from './SymbolIcon.tsx';

/**
 * The usage button above the profile one: for every agent, the subscription windows it has reported (how much is
 * left and when it renews). These are only the figures the agents really sent; one that has not reported yet says so.
 */
/** The figures are fetched in the background: once at start and then every few minutes. */
const POLL_MS = 5 * 60_000;
/** Opening the menu asks again only when what it has is older than this (a refresh button press always asks). */
const FRESH_MS = 60_000;

export function UsageMenu({ load, onOpenDetails }: { load: (refresh?: boolean) => Promise<AgentUsage[]>; onOpenDetails?: () => void }) {
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
  // The tightest window of any agent, drawn as a ring around the button: the answer at a glance.
  const lowest = (usage ?? []).flatMap((a) => a.limits.map((l) => percentLeft(l, now))).filter((n): n is number => n !== null).reduce<number | null>((min, n) => (min === null || n < min ? n : min), null);
  return (
    <div ref={root} className="profile">
      <button type="button" className="rail-button" data-anim="usage" aria-label={t('usage.title')} title={t('usage.title')} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {lowest !== null && (
          <svg className="rail-ring" viewBox="0 0 36 36" aria-hidden="true" data-tone={toneOf(lowest)}>
            <circle className="rail-ring-track" cx="18" cy="18" r="16" />
            <circle className="rail-ring-fill" cx="18" cy="18" r="16" pathLength={100} strokeDasharray={`${lowest} 100`} />
          </svg>
        )}
        <SymbolIcon name="ring" className="size-[18px]" />
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
          {usage?.map((agent) => <AgentUsageBlock key={agent.id} agent={agent} now={now} />)}
          <p className="usage-note">{t('usage.note')}</p>
          {onOpenDetails && (
            <button
              type="button"
              className="usage-details"
              onClick={() => {
                setOpen(false);
                onOpenDetails();
              }}
            >
              {t('usage.details')}
              <SymbolIcon name="external" className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
