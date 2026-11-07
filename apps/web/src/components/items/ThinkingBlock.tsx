import { useId, useState } from 'react';
import { t } from '../../i18n/index.ts';
import { formatDuration } from '../../lib/format.ts';
import type { ThoughtItem } from '../../lib/sessionState.ts';
import { ChevronIcon } from '../icons.tsx';

const TEXT = 'whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed text-text-muted italic';

/**
 * The agent's reasoning. Live: the text streams in, open, under a quiet "Thinking…" label. Done: one muted
 * "Thought for N s" line that toggles the text. Shown as plain text (never markdown).
 *
 * When done, the open state is controlled by `expanded`/`onToggle` in the list (it must survive the virtualized
 * row being unmounted); without them it keeps its own state. While live it is always open and has no toggle, so
 * it collapses when the thought ends unless the user opens it afterwards.
 */
export function ThinkingBlock({
  item,
  live,
  expanded,
  onToggle,
}: {
  item: ThoughtItem;
  live: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = expanded ?? ownOpen;
  const toggle = onToggle ?? (() => setOwnOpen((o) => !o));
  const id = useId();

  if (live) {
    return (
      <div className="font-ui">
        <p className="flex items-center gap-2 text-sm text-text-muted">
          <span aria-hidden="true" className="relative flex size-2">
            <span className="absolute inline-flex size-full rounded-full bg-accent opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          {t('thinking.live')}
        </p>
        <div className={`mt-1 border-l border-border pl-3 ${TEXT}`}>{item.text}</div>
      </div>
    );
  }

  const label =
    item.endedAt === undefined
      ? t('thinking.doneNoDuration')
      : t('thinking.done', { seconds: formatDuration(item.endedAt - item.startedAt) });

  return (
    <div className="font-ui">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        className="-mx-1.5 flex max-w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-sm text-text-muted hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <ChevronIcon className={`size-3 shrink-0 motion-safe:transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="truncate">{label}</span>
      </button>
      <div id={id} hidden={!open} className={`mt-1 ml-1 border-l border-border pl-3 ${TEXT}`}>
        {open && item.text}
      </div>
    </div>
  );
}
