import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormAnswer } from '@somecode/protocol';
import { useStickToBottom } from '../hooks/useStickToBottom.ts';
import { useFreshKeys } from "../hooks/useFreshKeys.ts";
import { t } from '../i18n/index.ts';
import type { Item, PlanEntry, SessionStatus } from '../lib/sessionState.ts';
import { ChevronIcon } from './icons.tsx';
import { ItemRow } from './ItemRow.tsx';
import { EditsCard } from './items/EditsCard.tsx';
import { PlanChecklist } from './items/PlanChecklist.tsx';
import { PromptRail, promptEntries } from './PromptRail.tsx';
import { SubagentGroup } from './items/SubagentGroup.tsx';
import { groupSubagentCalls, subagentsOf, type Subagent, type AgentsRow } from '../lib/subagents.ts';
import { withEditsRows, editsOfTurn, type EditedFile, type EditsRow } from '../lib/edits.ts';
import { isHiddenTool } from '../lib/researchTools.ts';
import { groupToolCalls, type ToolGroupRow } from '../lib/toolGroups.ts';
import type { TranscriptView } from '../lib/settings.ts';
import { ToolGroup } from './items/ToolGroup.tsx';
import { SubagentWait } from './SubagentWait.tsx';
import { ConfirmUndoDialog } from './ConfirmUndoDialog.tsx';

export type SubagentWaitRow = { kind: 'agents_wait'; key: string; running: number };
export type MessageListRow = AgentsRow | EditsRow | ToolGroupRow | Item | SubagentWaitRow;

/** First-paint height guesses per kind (px, including the row's vertical padding); rows are then measured. */
const ESTIMATE: Record<Item['kind'] | 'edits' | 'agents' | 'tool_group' | 'agents_wait', number> = {
  user: 56,
  agent: 96,
  thought: 28,
  tool: 32,
  tool_group: 34,
  agents_wait: 36,
  permission: 120,
  verification: 110,
  edits: 150,
  agents: 32,
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
  signInHint,
  subagents,
  onOpenAgents,
  onRollbackTurn,
  onUndoTurn,
  view = 'normal',
}: {
  items: Item[];
  plan: PlanEntry[] | null;
  status: SessionStatus;
  answeredRequests: ReadonlySet<string>;
  onRespond: (requestId: string, optionId: string | null, answer?: FormAnswer) => void;
  /** The session agent's sign-in command, shown under an `auth_required` failure. */
  signInHint?: string;
  subagents?: readonly Subagent[];
  onOpenAgents?: (subagentId?: string) => void;
  /** Reverts the changes made in a specific turn. */
  onRollbackTurn?: (files: EditedFile[]) => Promise<void> | void;
  /** Undoes a user turn, rewinds the conversation, puts text in draft, and optionally reverts file edits. */
  onUndoTurn?: (item: Item, files: EditedFile[], revertFiles: boolean) => Promise<void> | void;
  /** How much starts open: normal (nothing), thinking (the agent's thoughts) or detailed (thoughts and tool calls). */
  view?: TranscriptView;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionSubagents = useMemo(() => subagents ?? subagentsOf(items), [subagents, items]);
  const runningCount = sessionSubagents.filter((s) => s.status === 'running').length;
  const [undoTarget, setUndoTarget] = useState<{ item: Item; files: EditedFile[] } | null>(null);

  const handleUndoMessage = useCallback(
    (item: Item) => {
      setUndoTarget({ item, files: editsOfTurn(items, item.key, true) });
    },
    [items],
  );
  // Only items that arrive while the list is open animate in; history and scrolled-back rows do not.
  // The log: the items, with a "files edited" summary after each finished turn that changed files.
  // A sub-agent's own tool calls live in the sub-agent view (card and panel), not in the main conversation.
  const rows: readonly MessageListRow[] = useMemo(() => {
    const list: MessageListRow[] = [
      ...groupToolCalls(
        groupSubagentCalls(
          withEditsRows(items, status === 'running').filter((r) => !(r.kind === 'tool' && (r.parent || isHiddenTool(r)))),
        ),
      ),
    ];
    if (runningCount > 0) {
      list.push({
        kind: 'agents_wait',
        key: 'agents:wait',
        running: runningCount,
      });
    }
    return list;
  }, [items, status, runningCount]);
  const fresh = useFreshKeys(rows.map((r) => r.key));
  const [planEl, setPlanEl] = useState<HTMLDivElement | null>(null);
  const showPlan = plan !== null && plan.length > 0;
  const planHeight = useElementHeight(showPlan ? planEl : null);

  // Rows are memoised: hand them one stable callback that always calls the latest `onRespond`.
  const respondRef = useRef(onRespond);
  useLayoutEffect(() => {
    respondRef.current = onRespond;
  });
  const respond = useCallback(
    (requestId: string, optionId: string | null, answer?: FormAnswer) =>
      answer ? respondRef.current(requestId, optionId, answer) : respondRef.current(requestId, optionId),
    [],
  );

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

  // The chosen view decides what starts open: items already shown follow a change of view at once, later ones as
  // they arrive (and one the user then folds or opens by hand stays as they left it).
  const seenForView = useRef<{ view: TranscriptView; keys: Set<string> }>({ view, keys: new Set() });
  useEffect(() => {
    const wanted = (kind: 'thought' | 'tool') => (kind === 'thought' ? view !== 'normal' : view === 'detailed');
    const entries = rows.flatMap((r): { key: string; kind: 'thought' | 'tool' }[] =>
      r.kind === 'thought' ? [{ key: r.key, kind: 'thought' }]
      : r.kind === 'tool' ? [{ key: r.key, kind: 'tool' }]
      : r.kind === 'tool_group' ? [{ key: r.key, kind: 'tool' }, ...r.calls.map((c) => ({ key: c.key, kind: 'tool' as const }))]
      : [],
    );
    const seen = seenForView.current;
    if (seen.view !== view) {
      seenForView.current = { view, keys: new Set(entries.map((e) => e.key)) };
      setExpanded(new Set(entries.filter((e) => wanted(e.kind)).map((e) => e.key)));
      return;
    }
    const fresh = entries.filter((e) => !seen.keys.has(e.key));
    if (fresh.length === 0) return;
    for (const e of fresh) seen.keys.add(e.key);
    const open = fresh.filter((e) => wanted(e.kind)).map((e) => e.key);
    if (open.length > 0) setExpanded((prev) => new Set([...prev, ...open]));
  }, [rows, view]);

  const viewChanges = (files: readonly EditedFile[]) => {
    const keys = new Set(files.flatMap((f) => f.toolKeys));
    setExpanded((prev) => new Set([...prev, ...keys]));
    const first = rows.findIndex((r) => {
      if (keys.has(r.key)) return true;
      if (r.kind === 'tool_group') return r.calls.some((c) => keys.has(c.key));
      return false;
    });
    if (first >= 0) {
      const hit = rows[first]!;
      if (hit.kind === 'tool_group') {
        setExpanded((prev) => new Set([...prev, hit.key]));
      }
      virtualizer.scrollToIndex(first, { align: 'start' });
    }
  };

  const getItemKey = useCallback((index: number) => (rows[index] as { key: string }).key, [rows]);
  const estimateSize = useCallback((index: number) => ESTIMATE[(rows[index] as { kind: keyof typeof ESTIMATE }).kind], [rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
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
    itemCount: rows.length,
    tail: rows[rows.length - 1] as Item | undefined,
    contentSize: totalSize + planHeight,
  });

  const lastIndex = rows.length - 1;

  // The prompt rail: which prompt is being read is the last one at or above the first visible row.
  const prompts = useMemo(() => promptEntries(rows), [rows]);
  const firstVisible = virtualizer.range?.startIndex ?? 0;
  const activeKey = pinned && prompts.length > 0 ? prompts[prompts.length - 1]!.key : (prompts.findLast((p) => p.index <= firstVisible)?.key ?? prompts[0]?.key ?? null);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        role="log"
        aria-label={t('list.label')}
        aria-live="off"
        tabIndex={0}
        onScroll={onScroll}
        // scrollIntoView / focus scrolling must not land a row under the sticky plan.
        style={{ scrollPaddingTop: planHeight }}
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
            const entry = rows[row.index]!;
            if (entry.kind === 'edits') {
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  data-item-key={entry.key}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
                >
                  <div className="mx-auto w-full max-w-3xl px-4 py-2">
                    <EditsCard
                      files={entry.files}
                      onView={() => viewChanges(entry.files)}
                      onRollback={onRollbackTurn ? () => onRollbackTurn(entry.files) : undefined}
                    />
                  </div>
                </div>
              );
            }
            if (entry.kind === 'agents') {
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  data-item-key={entry.key}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
                >
                  <div className="mx-auto w-full max-w-3xl px-4 py-2">
                    <SubagentGroup
                      calls={entry.calls}
                      subagents={sessionSubagents}
                      open={expanded.has(entry.key)}
                      onToggle={() => toggle(entry.key)}
                      {...(onOpenAgents ? { onOpenAgents } : {})}
                    />
                  </div>
                </div>
              );
            }
            if (entry.kind === 'tool_group') {
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  data-item-key={entry.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <div className={`mx-auto w-full max-w-3xl px-4 py-1.5 ${fresh.has(entry.key) ? 'animate-enter' : ''}`}>
                    <ToolGroup
                      calls={entry.calls}
                      open={expanded.has(entry.key)}
                      onToggle={() => toggle(entry.key)}
                      expandedKeys={expanded}
                      onToggleKey={toggle}
                    />
                  </div>
                </div>
              );
            }
            if (entry.kind === 'agents_wait') {
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  data-item-key={entry.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <div className="mx-auto w-full max-w-3xl px-4 py-1.5">
                    <SubagentWait running={entry.running} />
                  </div>
                </div>
              );
            }
            const item = entry;
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
                <div className={`mx-auto w-full max-w-3xl px-4 py-2 ${fresh.has(item.key) ? "animate-enter" : ""}`}>
                  <ItemRow
                    item={item}
                    live={live}
                    answered={answered}
                    onRespond={respond}
                    expanded={(item.kind === 'tool' || item.kind === 'thought') && expanded.has(item.key)}
                    onToggle={toggle}
                    onUndoMessage={onUndoTurn ? handleUndoMessage : undefined}
                    {...(signInHint ? { signInHint } : {})}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <PromptRail prompts={prompts} activeKey={activeKey} onJump={(index) => virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' })} />
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
      <ConfirmUndoDialog
        open={undoTarget !== null}
        files={undoTarget?.files ?? []}
        hasFileEdits={(undoTarget?.files.length ?? 0) > 0}
        onClose={() => setUndoTarget(null)}
        onConfirm={async (revertFiles) => {
          if (undoTarget && onUndoTurn) {
            await onUndoTurn(undoTarget.item, undoTarget.files, revertFiles);
          }
        }}
      />
    </div>
  );
}
