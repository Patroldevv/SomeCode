import { useEffect, useMemo, useState } from 'react';
import { currentLanguage, t } from '../i18n/index.ts';
import type { AgentUsage } from '../lib/api.ts';
import { buildGrid, compactTokens, cumulative, dayTotals, fromKey, monthMarks, summarize, totalOf, weeklyTotals, type Cell, type UsageHistory } from '../lib/usageStats.ts';
import { AgentUsageBlock } from './UsageBars.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';

type Tab = 'daily' | 'weekly' | 'cumulative';
const TABS: Tab[] = ['daily', 'weekly', 'cumulative'];

const dateLabel = (key: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string => new Intl.DateTimeFormat(currentLanguage(), opts).format(fromKey(key));

function cellTitle(c: Cell): string {
  const cache = c.tokens.cacheRead + c.tokens.cacheWrite;
  return c.total > 0
    ? `${dateLabel(c.date, { day: 'numeric', month: 'long', year: 'numeric' })}: ${t('usage.page.cell', { tokens: compactTokens(c.total) })} (${t('usage.page.detail', { input: compactTokens(c.tokens.input), output: compactTokens(c.tokens.output), cache: compactTokens(cache) })})`
    : `${dateLabel(c.date, { day: 'numeric', month: 'long', year: 'numeric' })}: ${t('usage.page.none')}`;
}

function Heatmap({ history, agent, today }: { history: UsageHistory; agent: string | null; today: Date }) {
  const { columns } = useMemo(() => buildGrid(history.days, agent, today), [history, agent, today]);
  const marks = useMemo(() => monthMarks(columns), [columns]);
  const weekdays = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => new Intl.DateTimeFormat(currentLanguage(), { weekday: 'narrow' }).format(new Date(2026, 10, 9 + i, 12))), []);
  return (
    <div className="heat" role="img" aria-label={t('usage.page.daily')}>
      <div className="heat-weekdays" aria-hidden="true">
        {weekdays.map((d, i) => (
          <span key={i}>{i % 2 === 0 ? d : ''}</span>
        ))}
      </div>
      <div className="heat-scroll">
        <div className="heat-grid">
          {columns.map((col, i) => (
            <div key={i} className="heat-col" style={{ animationDelay: `${i * 8}ms` }}>
              {col.map((c) => (
                <span key={c.date} className="heat-cell" data-level={c.future ? undefined : c.level} data-today={c.today || undefined} data-future={c.future || undefined} title={c.future ? undefined : cellTitle(c)} />
              ))}
            </div>
          ))}
        </div>
        <div className="heat-months" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
          {marks.map((m) => (
            <span key={m.column} style={{ gridColumn: `${m.column + 1} / span 4` }}>
              {new Intl.DateTimeFormat(currentLanguage(), { month: 'short' }).format(new Date(2026, m.month, 1))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Weekly({ history, agent, today }: { history: UsageHistory; agent: string | null; today: Date }) {
  const weeks = useMemo(() => weeklyTotals(history.days, agent, today), [history, agent, today]);
  const max = Math.max(1, ...weeks.map((w) => w.total));
  return (
    <div className="bars" role="img" aria-label={t('usage.page.weekly')}>
      {weeks.map((w, i) => (
        <span key={w.start} className="bar-slot" title={`${dateLabel(w.start)}: ${t('usage.page.cell', { tokens: compactTokens(w.total) })}`}>
          <span className="bar" data-last={i === weeks.length - 1 || undefined} style={{ height: `${Math.max(w.total > 0 ? 4 : 1, (w.total / max) * 100)}%`, animationDelay: `${i * 10}ms` }} />
        </span>
      ))}
    </div>
  );
}

function Cumulative({ history, agent, today }: { history: UsageHistory; agent: string | null; today: Date }) {
  const points = useMemo(() => cumulative(history.days, agent, today), [history, agent, today]);
  const max = Math.max(1, points.at(-1)?.total ?? 1);
  const W = 1000;
  const H = 200;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * W;
  const y = (v: number) => H - (v / max) * (H - 8) - 2;
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');
  return (
    <div className="cumulative" role="img" aria-label={t('usage.page.cumulative')}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={y(max * f)} y2={y(max * f)} className="cum-grid" />
        ))}
        <path d={`${line} L${W} ${H} L0 ${H} Z`} className="cum-area" />
        <path d={line} className="cum-line" pathLength={1} />
      </svg>
      <div className="cum-scale" aria-hidden="true">
        <span>{compactTokens(max)}</span>
        <span>{compactTokens(max / 2)}</span>
        <span>0</span>
      </div>
    </div>
  );
}

/**
 * Settings > Usage: the limits of every agent as bars, and the tokens used day by day over the last year (a heatmap, weekly
 * bars or a running total), for all agents or one. Only what the agents keep on this computer is counted.
 */
export function UsagePage({ loadUsage, loadHistory }: { loadUsage: (refresh?: boolean) => Promise<AgentUsage[]>; loadHistory: (refresh?: boolean) => Promise<UsageHistory> }) {
  const [usage, setUsage] = useState<AgentUsage[] | null>(null);
  const [history, setHistory] = useState<UsageHistory | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('daily');
  const [agent, setAgent] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(0);
  const today = useMemo(() => new Date(), []);
  const now = Date.now();

  useEffect(() => {
    let alive = true;
    void loadUsage(refreshing > 0).then((u) => alive && setUsage(u)).catch(() => alive && setUsage([]));
    return () => {
      alive = false;
    };
  }, [loadUsage, refreshing]);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    void loadHistory(refreshing > 0).then((h) => alive && setHistory(h)).catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [loadHistory, refreshing]);

  const counted = history?.sources.filter((s) => s.state === 'ok') ?? [];
  const summary = useMemo(() => (history ? summarize(history.days, agent, today) : null), [history, agent, today]);
  const unsupported = history?.sources.filter((s) => s.state === 'unsupported') ?? [];

  return (
    <>
      <section className="mb-8" aria-label={t('usage.page.limits')}>
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <h3 className="text-[14px] font-medium text-text">{t('usage.page.limits')}</h3>
          <button type="button" className="plan-btn" onClick={() => setRefreshing((n) => n + 1)}>
            <SymbolIcon name="refresh" className="size-3.5" /> {t('agent.refresh')}
          </button>
        </div>
        {usage === null && <p className="usage-empty">{t('chat.loading')}</p>}
        <div className="usage-cards">{usage?.map((a) => <AgentUsageBlock key={a.id} agent={a} now={now} />)}</div>
        <p className="mt-2 text-[12.5px] text-text-muted">{t('usage.note')}</p>
      </section>

      <section className="mb-8" aria-label={t('usage.page.tokens')}>
        <div className="usage-panel">
          <div className="usage-panel-head">
            <h3 className="text-[16px] font-semibold text-text">{t('usage.page.tokens')}</h3>
            <div role="tablist" className="usage-tabs">
              {TABS.map((name) => (
                <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
                  {t(`usage.page.${name}` as 'usage.page.daily')}
                </button>
              ))}
            </div>
          </div>

          {history && counted.length > 1 && (
            <div className="usage-filter" role="group" aria-label={t('usage.page.tokens')}>
              <button type="button" className="engine-pill" aria-pressed={agent === null} onClick={() => setAgent(null)}>
                {t('usage.page.allAgents')}
              </button>
              {counted.map((s) => (
                <button key={s.id} type="button" className="engine-pill" aria-pressed={agent === s.id} onClick={() => setAgent(agent === s.id ? null : s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {!history && !failed && (
            <p className="usage-loading" role="status">
              <span className="spin-arc size-4 text-accent" aria-hidden="true" /> {t('usage.page.counting')}
            </p>
          )}
          {failed && <p className="usage-empty">{t('usage.unavailable')}</p>}
          {history && counted.length === 0 && <p className="usage-empty">{t('usage.page.noData')}</p>}

          {history && counted.length > 0 && summary && (
            <>
              <dl className="usage-stats">
                <div>
                  <dt>{t('usage.page.total')}</dt>
                  <dd>{compactTokens(summary.total)}</dd>
                </div>
                <div>
                  <dt>{t('usage.page.activeDays')}</dt>
                  <dd>{summary.activeDays}</dd>
                </div>
                <div>
                  <dt>{t('usage.page.busiest')}</dt>
                  <dd title={summary.busiest ? dateLabel(summary.busiest.date, { day: 'numeric', month: 'long', year: 'numeric' }) : undefined}>{summary.busiest ? compactTokens(summary.busiest.total) : '–'}</dd>
                </div>
                <div>
                  <dt>{t('usage.page.average')}</dt>
                  <dd>{compactTokens(summary.average)}</dd>
                </div>
                <div>
                  <dt>{t('usage.page.streak')}</dt>
                  <dd>{t('usage.page.days', { n: summary.streak })}</dd>
                </div>
              </dl>
              <div key={`${tab}:${agent ?? 'all'}`} className="usage-chart">
                {tab === 'daily' && <Heatmap history={history} agent={agent} today={today} />}
                {tab === 'weekly' && <Weekly history={history} agent={agent} today={today} />}
                {tab === 'cumulative' && <Cumulative history={history} agent={agent} today={today} />}
              </div>
              {tab === 'daily' && (
                <div className="heat-legend" aria-hidden="true">
                  <span>{t('usage.page.less')}</span>
                  {[0, 1, 2, 3, 4].map((l) => (
                    <span key={l} className="heat-cell" data-level={l} />
                  ))}
                  <span>{t('usage.page.more')}</span>
                </div>
              )}
            </>
          )}
          {history && unsupported.length > 0 && (
            <p className="usage-footnote">{unsupported.map((s) => t('usage.page.unsupported', { agent: s.label })).join(' ')}</p>
          )}
          <p className="usage-footnote">{t('usage.page.footnote')}</p>
        </div>
      </section>
    </>
  );
}

// The day figures of one agent, for tests and callers that need them.
export { dayTotals, totalOf };
