import { useId, useState } from 'react';
import { t } from '../../i18n/index.ts';
import { diffStats } from '../../lib/diffView.ts';
import type { ToolItem } from '../../lib/sessionState.ts';
import { ChevronIcon } from '../icons.tsx';
import { ToolDetails } from './ToolDetails.tsx';
import { ToolKindIcon, ToolStatus, toolKindLabel } from './ToolGlyphs.tsx';

/** Sum of `+added -removed` over the tool's diff blocks; null when it has none. Cheap: `diffStats` is cached per string pair. */
function editStats(content: ToolItem['content']): { added: number; removed: number } | null {
  let found = false;
  let added = 0;
  let removed = 0;
  for (const block of content) {
    if (block.type !== 'diff') continue;
    found = true;
    const s = diffStats(block.oldText, block.newText);
    added += s.added;
    removed += s.removed;
  }
  return found ? { added, removed } : null;
}

/**
 * One compact, muted line per tool call — kind icon, title (truncated), `+n -m` for edits, status — that expands
 * to the raw input and the output. The status sits outside the button so its `role="status"` stays exposed.
 */
export function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const stats = editStats(item.content);
  const title = item.title.trim() || toolKindLabel(item.toolKind);

  return (
    <div className="min-w-0 font-ui text-sm text-text-muted">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="group -ml-1.5 flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <ToolKindIcon kind={item.toolKind} />
          <span className="min-w-0 truncate" title={title}>
            {title}
          </span>
          {stats && (
            <span className="shrink-0 font-mono text-xs">
              <span aria-hidden="true">
                <span className="text-success">+{stats.added}</span> <span className="text-danger">-{stats.removed}</span>
              </span>
              <span className="sr-only"> {t('diff.stats', stats)}</span>
            </span>
          )}
          <ChevronIcon
            className={`ml-auto size-3 shrink-0 motion-safe:transition-transform ${open ? 'rotate-90' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}
          />
        </button>
        <ToolStatus status={item.status} />
      </div>
      <div id={id} hidden={!open} className="mt-1 mb-2 ml-1 border-l border-border pl-4">
        {open && <ToolDetails item={item} />}
      </div>
    </div>
  );
}
