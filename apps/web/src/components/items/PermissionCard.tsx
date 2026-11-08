import { useId } from 'react';
import type { FormAnswer } from '@somecode/protocol';
import { t } from '../../i18n/index.ts';
import type { Item } from '../../lib/sessionState.ts';
import { Collapse } from '../Collapse.tsx';
import { ShieldIcon } from '../icons.tsx';
import { Markdown } from '../Markdown.tsx';
import { SymbolIcon } from '../SymbolIcon.tsx';
import { answerSummary, QuestionForm } from './QuestionForm.tsx';

type PermissionItem = Extract<Item, { kind: 'permission' }>;

const BUTTON =
  'rounded-md px-3 py-1 text-sm font-medium motion-safe:transition-[background-color,opacity,transform] motion-safe:active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';
/** `allow_*` options get the accent; the rest stay neutral. */
const ALLOW = 'bg-accent text-bg enabled:hover:opacity-90';
const OTHER = 'border border-border text-text enabled:hover:bg-bg-subtle';

/**
 * A pending request from the agent. Three shapes: a plain permission (the buttons are exactly the agent's own
 * options; no extra "Reject", since a cancelled answer would end the whole turn), a plan to approve (the plan
 * text is shown above the same buttons) and a question (a small form). Disabled once answered; a resolved card
 * collapses to "Answered" (with the submitted answer for a question).
 */
export function PermissionCard({
  item,
  answered,
  onRespond,
}: {
  item: PermissionItem;
  answered: boolean;
  onRespond: (requestId: string, optionId: string | null, answer?: FormAnswer) => void;
}) {
  const headingId = useId();
  const form = item.form;
  const submitId = item.options[0]?.id ?? 'submit';
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      data-pending={!item.resolved}
      className={`permission-card min-w-0 rounded-lg border bg-bg-elevated px-3.5 py-3 font-ui ${item.resolved ? 'border-border' : 'border-warning/60'}`}
    >
      <p id={headingId} className={`flex items-center gap-1.5 text-xs font-medium ${item.resolved ? 'text-text-muted' : 'text-warning'}`}>
        {form ? <SymbolIcon name="chat" className="size-3.5 shrink-0" /> : <ShieldIcon className="size-3.5 shrink-0" />}
        {form ? t('permission.question') : t('permission.heading')}
      </p>
      <p className="mt-1 text-sm text-text [overflow-wrap:anywhere]">{item.title}</p>
      {item.detail && (
        <div className="permission-detail mt-2.5" role="region" aria-label={t('permission.plan')}>
          <Markdown text={item.detail} />
        </div>
      )}
      {form ? (
        <Collapse open={!item.resolved}>
          <QuestionForm
            fields={form.fields}
            disabled={answered || item.resolved}
            onSubmit={(answer) => onRespond(item.requestId, submitId, answer)}
            onSkip={() => onRespond(item.requestId, null)}
          />
        </Collapse>
      ) : (
        <Collapse open={!item.resolved}>
          <div className="flex flex-wrap gap-2 pt-3">
            {item.options.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={answered}
                onClick={() => onRespond(item.requestId, o.id)}
                className={`${BUTTON} ${o.kind.startsWith('allow') ? ALLOW : OTHER}`}
              >
                {o.name}
              </button>
            ))}
          </div>
        </Collapse>
      )}
      {item.resolved && (
        <div className="animate-enter mt-2 text-xs text-text-muted">
          <p>{t('permission.resolved')}</p>
          {form && item.answer && (
            <dl className="mt-1.5 space-y-0.5">
              {answerSummary(form.fields, item.answer).map((row) => (
                <div key={row.title} className="flex gap-1.5">
                  <dt>{row.title}:</dt>
                  <dd className="min-w-0 text-text [overflow-wrap:anywhere]">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
