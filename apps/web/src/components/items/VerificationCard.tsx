import { useState } from 'react';
import { t } from '../../i18n/index.ts';
import type { Item } from '../../lib/sessionState.ts';
import { Collapse } from '../Collapse.tsx';
import { CheckIcon, CrossIcon } from '../icons.tsx';
import { SymbolIcon } from '../SymbolIcon.tsx';
import { useResearchControl } from './ResearchContext.tsx';

type VerificationItem = Extract<Item, { kind: 'verification' }>;

const seconds = (ms: number | undefined): string => (ms === undefined ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

function CheckMark({ status }: { status: VerificationItem['checks'][number]['status'] }) {
  if (status === 'running') return <span className="spin-arc size-3.5 text-accent" role="status" aria-label={t('verify.running')} />;
  if (status === 'passed') return <CheckIcon className="animate-pop size-3.5 text-success" aria-label={t('verify.passed')} role="img" />;
  if (status === 'failed') return <CrossIcon className="size-3.5 text-danger" aria-label={t('verify.failed')} role="img" />;
  return <span className="verify-wait" aria-hidden="true" />;
}

/**
 * The project's checks after the agent changed files: each check with its state, the end of the output of a failed one
 * (open it to read), and what happened next (handed to the agent, or left to you). Runs again on request.
 */
export function VerificationCard({ item }: { item: VerificationItem }) {
  const { runChecks } = useResearchControl();
  const [open, setOpen] = useState<string | null>(null);
  const failed = item.checks.filter((c) => c.status === 'failed');
  const done = item.checks.filter((c) => c.status === 'passed').length;
  const title =
    item.status === 'running'
      ? t('verify.running')
      : item.status === 'passed'
        ? t('verify.allPassed', { count: item.checks.length })
        : t('verify.someFailed', { count: failed.length });
  const note =
    item.status !== 'failed'
      ? null
      : item.willFix
        ? t('verify.sentToAgent')
        : item.round > 0
          ? t('verify.fixLimit')
          : t('verify.noAutoFix');
  return (
    <section className="verify-card" data-status={item.status} aria-label={t('verify.title')}>
      <header className="verify-head">
        <span className="verify-icon" aria-hidden="true">
          {item.status === 'running' ? <span className="spin-arc size-4" /> : item.status === 'passed' ? <SymbolIcon name="shield" className="size-4" /> : <SymbolIcon name="alert" className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="verify-title">{title}</p>
          <p className="verify-sub">
            {item.status === 'running' ? t('verify.progress', { done, total: item.checks.length }) : note ?? (item.round > 0 ? t('verify.afterFix', { round: item.round }) : t('verify.afterTurn'))}
          </p>
        </div>
        {item.status !== 'running' && runChecks && (
          <button type="button" className="plan-btn" onClick={runChecks}>
            <SymbolIcon name="refresh" className="size-3.5" /> {t('verify.rerun')}
          </button>
        )}
      </header>
      <ul className="verify-list">
        {item.checks.map((check) => (
          <li key={check.name + check.command}>
            <div className="verify-row">
              <CheckMark status={check.status} />
              <span className="font-medium text-text">{check.name}</span>
              <code className="verify-command">{check.command}</code>
              <span className="verify-ms">{seconds(check.ms)}</span>
              {check.status === 'failed' && check.output && (
                <button type="button" className="verify-toggle" aria-expanded={open === check.name} onClick={() => setOpen(open === check.name ? null : check.name)}>
                  {open === check.name ? t('verify.hideOutput') : t('verify.showOutput')}
                </button>
              )}
            </div>
            {check.output && (
              <Collapse open={open === check.name}>
                <pre className="verify-output">{check.output}</pre>
              </Collapse>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
