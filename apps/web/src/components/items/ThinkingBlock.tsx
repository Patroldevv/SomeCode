import { useId, useState } from 'react';
import { t } from '../../i18n/index.ts';
import { formatDuration } from '../../lib/format.ts';
import type { ThoughtItem } from '../../lib/sessionState.ts';
import { Collapse } from '../Collapse.tsx';
import { ChevronIcon } from '../icons.tsx';

const TEXT = 'whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-relaxed text-text-muted italic';

/**
 * The agent's reasoning, folded by default. Live: a softly breathing "Thinking…" line; done: "Thought for N s".
 * Either way the line toggles the text, which keeps streaming in while open. Shown as plain text (never markdown).
 *
 * The open state is controlled by `expanded`/`onToggle` in the list (it must survive the virtualized row being
 * unmounted); without them it keeps its own state.
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

  const label = live
    ? t('thinking.live')
    : item.endedAt === undefined
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
        <ChevronIcon className={`size-3 shrink-0 motion-safe:transition-transform motion-safe:duration-300 ${open ? 'rotate-90' : ''}`} />
        <span className={`truncate ${live ? 'status-fade' : ''}`}>{label}</span>
      </button>
      <Collapse id={id} open={open} className={`mt-1 ml-1 border-l border-border pl-3 ${TEXT}`}>
        {item.text}
      </Collapse>
    </div>
  );
}
