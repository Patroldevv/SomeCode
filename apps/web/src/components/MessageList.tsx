import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useStickToBottom } from '../hooks/useStickToBottom.ts';
import { t } from '../i18n/index.ts';
import type { Item, PlanEntry, SessionStatus } from '../lib/sessionState.ts';
import { ChevronIcon } from './icons.tsx';
import { ItemRow } from './ItemRow.tsx';
import { PlanChecklist } from './items/PlanChecklist.tsx';

/** First-paint height guesses per kind (px, including the row's vertical padding); rows are then measured. */
const ESTIMATE: Record<Item['kind'], number> = {
  user: 56,
  agent: 96,
  thought: 28,
  tool: 32,
  permission: 120,
  error: 64,
  unsupported: 24,
};

const OVERSCAN = 8;
const PADDING_START = 16;
const PADDING_END = 24;

/** The element's border-box height, kept current with a ResizeObserver (0 without an element). */
function useElementHeight(el: HTMLElement | null): number {
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setHeight(el.offsetHeight);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return el ? height : 0;
}

/**
 * The conversation: a virtualized log of items (TanStack Virtual, dynamic measured heights, row key =
 * `item.key`) that follows the end while the user is at the bottom. Scrolling up stops following and shows
 * a "Jump to latest" button with the number of items added since. A non-empty plan sits above the rows as a
 * sticky box inside the scroll container (not virtualized, not an item).
 *
 * A different session is a different list: the parent remounts it with a `key`, so it opens at the end.
 */
export function MessageList({
  items,
  plan,
  status,
  answeredRequests,
  onRespond,
}: {
  items: Item[];
  plan: PlanEntry[] | null;
  status: SessionStatus;
  answeredRequests: ReadonlySet<string>;
  onRespond: (requestId: string, optionId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [planEl, setPlanEl] = useState<HTMLDivElement | null>(null);
  const showPlan = plan !== null && plan.length > 0;
  const planHeight = useElementHeight(showPlan ? planEl : null);

  // Rows are memoised: hand them one stable callback that always calls the latest `onRespond`.
  const respondRef = useRef(onRespond);
  useLayoutEffect(() => {
    respondRef.current = onRespond;
  });
  const respond = useCallback((requestId: string, optionId: string) => respondRef.current(requestId, optionId), []);

  // Opened tool cards / thoughts by item key. Held here, not in the rows: virtualization unmounts rows outside
  // the window, and a row that comes back must not collapse under its cached (expanded) measured height. A new
  // session remounts the list (`key`), which starts with nothing open.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const getItemKey = useCallback((index: number) => (items[index] as Item).key, [items]);
  const estimateSize = useCallback((index: number) => ESTIMATE[(items[index] as Item).kind], [items]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize,
    overscan: OVERSCAN,
    paddingStart: PADDING_START,
    paddingEnd: PADDING_END,
    // The sticky plan occupies flow space above the rows inside the same scroll container.
    scrollMargin: planHeight,
  });
  const totalSize = virtualizer.getTotalSize();

  const { pinned, newItemCount, onScroll, jumpToLatest } = useStickToBottom({
    scrollRef,
    itemCount: items.length,
    tail: items[items.length - 1],
    contentSize: totalSize + planHeight,
  });

  const lastIndex = items.length - 1;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        role="log"
        aria-label={t('list.label')}
        aria-live="off"
        tabIndex={0}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
      >
        {showPlan && (
          <div
            ref={setPlanEl}
            data-sticky-plan=""
            style={{ position: 'sticky', top: 0 }}
            className="z-10 max-h-[40vh] overflow-y-auto border-b border-border bg-bg-elevated"
          >
            <div className="mx-auto w-full max-w-3xl px-4 py-3">
              <PlanChecklist plan={plan} />
            </div>
          </div>
        )}
        <div style={{ position: 'relative', width: '100%', height: totalSize }}>
          {virtualizer.getVirtualItems().map((row) => {
            const item = items[row.index] as Item;
            const live =
              item.kind === 'thought' && row.index === lastIndex && status === 'running' && item.endedAt === undefined;
            const answered = item.kind === 'permission' && answeredRequests.has(item.requestId);
            return (
              <div
                key={row.key}
                ref={virtualizer.measureElement}
                data-index={row.index}
                data-item-key={item.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                <div className="mx-auto w-full max-w-3xl px-4 py-2">
                  <ItemRow
                    item={item}
                    live={live}
                    answered={answered}
                    onRespond={respond}
                    expanded={(item.kind === 'tool' || item.kind === 'thought') && expanded.has(item.key)}
                    onToggle={toggle}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {!pinned && (
        <button
          type="button"
          onClick={() => {
            jumpToLatest();
            // The button unmounts once pinned: keep keyboard focus in the log rather than dropping it to <body>.
            scrollRef.current?.focus({ preventScroll: true });
          }}
          className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-bg-elevated px-3 py-1.5 font-ui text-sm text-text hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronIcon className="size-3.5 rotate-90" />
          {t('list.jumpToLatest')}
          {newItemCount > 0 && (
            <span className="text-text-muted tabular-nums">· {t('list.newItems', { count: newItemCount })}</span>
          )}
        </button>
      )}
    </div>
  );
}
