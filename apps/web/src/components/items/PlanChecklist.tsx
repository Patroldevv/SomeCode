import { useId } from 'react';
import { t } from '../../i18n/index.ts';
import type { PlanEntry } from '../../lib/sessionState.ts';
import { CheckIcon, DotIcon, Glyph, HalfRingIcon, RingIcon } from '../icons.tsx';

function EntryStatus({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return (
        <Glyph label={t('plan.status.completed')} className="text-success">
          <CheckIcon className="animate-pop size-3.5" />
        </Glyph>
      );
    case 'in_progress':
      return (
        <Glyph label={t('plan.status.in_progress')} className="text-accent">
          <HalfRingIcon className="size-3.5 motion-safe:animate-[spin_2.4s_linear_infinite]" />
        </Glyph>
      );
    case 'pending':
      return (
        <Glyph label={t('plan.status.pending')} className="text-text-muted">
          <RingIcon className="size-3.5" />
        </Glyph>
      );
    default:
      return (
        <Glyph label={t('plan.status.unknown')} title={status} className="text-text-muted">
          <DotIcon className="size-3.5" />
        </Glyph>
      );
  }
}

const TEXT: Record<string, string> = {
  completed: 'text-text-muted line-through decoration-text-muted/60 motion-safe:transition-colors',
  in_progress: 'text-text font-medium',
};

/** The agent's current plan as a checklist; presentational (the sticky container belongs to the chat view). */
export function PlanChecklist({ plan }: { plan: PlanEntry[] }) {
  const headingId = useId();
  const done = plan.filter((p) => p.status === 'completed').length;
  return (
    <section aria-labelledby={headingId} className="min-w-0 font-ui text-sm">
      <div className="mb-1.5 flex items-baseline gap-2">
        <h2 id={headingId} className="text-xs font-semibold text-text">
          {t('plan.heading')}
        </h2>
        <span className="text-xs text-text-muted tabular-nums">{t('plan.progress', { done, total: plan.length })}</span>
      </div>
      <ol className="space-y-1">
        {plan.map((entry, i) => (
          <li key={i} className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 flex">
              <EntryStatus status={entry.status} />
            </span>
            <span className={`min-w-0 [overflow-wrap:anywhere] ${TEXT[entry.status] ?? 'text-text-muted'}`}>{entry.content}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
