import { useId, useMemo, useState } from 'react';
import type { ToolItem } from '../../lib/sessionState.ts';
import { summarizeToolGroup } from '../../lib/toolGroups.ts';
import { Collapse } from '../Collapse.tsx';
import { ChevronIcon } from '../icons.tsx';
import { ToolCard } from './ToolCard.tsx';
import { ToolStatus } from './ToolGlyphs.tsx';

export function ToolGroup({
  calls,
  open: controlledOpen,
  onToggle: controlledToggle,
  expandedKeys,
  onToggleKey,
}: {
  calls: ToolItem[];
  open?: boolean;
  onToggle?: () => void;
  expandedKeys?: ReadonlySet<string>;
  onToggleKey?: (key: string) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const toggle = controlledToggle ?? (() => setOwnOpen((o) => !o));
  const id = useId();

  const summary = useMemo(() => summarizeToolGroup(calls), [calls]);
  const running = summary.status === 'in_progress';

  return (
    <div className="tool-group min-w-0 font-ui text-[13.5px] text-text-muted">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          className="group -ml-1.5 flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          {running ? (
            <span
              aria-hidden="true"
              className="spin-arc size-3.5"
            />
          ) : (
            <ToolStatus status={summary.status} />
          )}
          <span
            className={`min-w-0 truncate ${running ? 'status-fade text-text font-medium' : 'text-text-muted group-hover:text-text'}`}
            title={summary.title}
          >
            {summary.title}
          </span>
          <ChevronIcon
            className={`ml-auto size-3 shrink-0 text-text-muted motion-safe:transition-transform ${
              open ? 'rotate-90 text-text' : ''
            }`}
          />
        </button>
      </div>

      <Collapse id={id} open={open} className="mt-1 mb-2 ml-2 border-l border-border/80 pl-3 space-y-1">
        {calls.map((call) => (
          <ToolCard
            key={call.key}
            item={call}
            expanded={expandedKeys?.has(call.key)}
            onToggle={() => onToggleKey?.(call.key)}
          />
        ))}
      </Collapse>
    </div>
  );
}
