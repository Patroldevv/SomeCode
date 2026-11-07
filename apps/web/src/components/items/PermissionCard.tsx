import { useId } from 'react';
import { t } from '../../i18n/index.ts';
import type { Item } from '../../lib/sessionState.ts';
import { ShieldIcon } from '../icons.tsx';

type PermissionItem = Extract<Item, { kind: 'permission' }>;

const BUTTON =
  'rounded-md px-3 py-1 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';
/** `allow_*` options get the accent; the rest stay neutral. */
const ALLOW = 'bg-accent text-bg enabled:hover:opacity-90';
const OTHER = 'border border-border text-text enabled:hover:bg-bg-subtle';

/**
 * A pending permission request. The buttons are exactly the agent's own options (no extra "Reject": a
 * cancelled answer would end the whole turn). Disabled once answered; a resolved card just says "Answered".
 */
export function PermissionCard({
  item,
  answered,
  onRespond,
}: {
  item: PermissionItem;
  answered: boolean;
  onRespond: (requestId: string, optionId: string) => void;
}) {
  const headingId = useId();
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className={`min-w-0 rounded-lg border bg-bg-elevated px-3.5 py-3 font-ui ${item.resolved ? 'border-border' : 'border-warning/60'}`}
    >
      <p id={headingId} className={`flex items-center gap-1.5 text-xs font-medium ${item.resolved ? 'text-text-muted' : 'text-warning'}`}>
        <ShieldIcon className="size-3.5 shrink-0" />
        {t('permission.heading')}
      </p>
      <p className="mt-1 text-sm text-text [overflow-wrap:anywhere]">{item.title}</p>
      {item.resolved ? (
        <p className="mt-2 text-xs text-text-muted">{t('permission.resolved')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
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
      )}
    </div>
  );
}
