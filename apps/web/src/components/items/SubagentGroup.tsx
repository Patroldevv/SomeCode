import { useId, useState } from 'react';
import { plural, t } from '../../i18n/index.ts';
import type { ToolItem } from '../../lib/sessionState.ts';
import { describeSubagentCall, type Subagent } from '../../lib/subagents.ts';
import { Collapse } from '../Collapse.tsx';
import { ChevronIcon } from '../icons.tsx';
import { SymbolIcon } from '../SymbolIcon.tsx';
import { SubagentStatus } from '../SubagentsList.tsx';
import { ToolCard } from './ToolCard.tsx';

const statusOf = (s: string) => (s === 'completed' ? 'completed' : s === 'failed' ? 'failed' : 'running');

function Entry({ call, agent, onOpenAgents }: { call: ToolItem; agent?: Subagent; onOpenAgents?: (id?: string) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { name, description, prompt } = describeSubagentCall(call);
  const status = agent ? agent.status : statusOf(call.status);
  const calls = agent?.calls ?? [];
  const output = agent?.output;

  return (
    <li>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="subagent-entry group">
        <ChevronIcon className={`size-3 shrink-0 text-text-muted motion-safe:transition-transform motion-safe:duration-300 ${open ? 'rotate-90 text-text' : ''}`} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-text font-medium">{name}</span>
          {description && <span className="block truncate text-xs text-text-muted">{description}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          {calls.length > 0 && <span>{plural('subagent.calls', calls.length)}</span>}
          <SubagentStatus status={status} />
        </span>
      </button>
      <Collapse id={id} open={open}>
        <div className="subagent-task space-y-2.5">
          {prompt && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">{t('subagent.task')}</p>
              <p className="max-h-72 overflow-auto whitespace-pre-wrap text-text [overflow-wrap:anywhere]">{prompt}</p>
            </div>
          )}
          {status === 'running' && (
            <div className="flex items-center gap-2 text-xs text-accent">
              <span className="loading-ring size-3 border-[1.5px]" />
              <span>{t('subagent.status.running')}…</span>
            </div>
          )}
          {calls.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">
                {t('subagent.activity')} ({calls.length})
              </p>
              <div className="space-y-1 pl-1 border-l border-border">
                {calls.slice(0, 5).map((c) => (
                  <ToolCard key={c.key} item={c} />
                ))}
                {calls.length > 5 && (
                  <p className="text-xs text-text-muted pt-1">
                    +{calls.length - 5} {t('subagent.calls.other', { count: calls.length - 5 })}
                  </p>
                )}
              </div>
            </div>
          )}
          {output && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">{t('subagent.result')}</p>
              <p className="max-h-60 overflow-auto whitespace-pre-wrap text-text [overflow-wrap:anywhere] bg-bg-subtle p-2 rounded text-xs">{output}</p>
            </div>
          )}
          {onOpenAgents && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onOpenAgents(agent?.id ?? call.id)}
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
              >
                <SymbolIcon name="spark" className="size-3" />
                {t('subagent.viewInPanel')} →
              </button>
            </div>
          )}
        </div>
      </Collapse>
    </li>
  );
}

/**
 * Sub-agents the agent just handed work to, as one quiet line ("4 sub-agents started") instead of a row of raw tool
 * calls. It opens to each sub-agent with what it is for, and each of those opens to its full task.
 */
export function SubagentGroup({
  calls,
  subagents,
  open,
  onToggle,
  onOpenAgents,
}: {
  calls: readonly ToolItem[];
  subagents?: readonly Subagent[];
  open: boolean;
  onToggle: () => void;
  onOpenAgents?: (subagentId?: string) => void;
}) {
  const id = useId();
  const running = calls.filter((c) => {
    const ag = subagents?.find((a) => a.id === c.id);
    return (ag ? ag.status : statusOf(c.status)) === 'running';
  }).length;
  const first = describeSubagentCall(calls[0]!);
  const title = calls.length === 1 ? t('subagent.started.single', { name: first.name }) : t('subagent.started.multiple', { count: calls.length });
  return (
    <div className="min-w-0 font-ui text-[13.5px] text-text-muted">
      <div className="flex w-full items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={onToggle}
          className="tool-row group -ml-1.5 flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-bg-subtle hover:text-text"
        >
          <SymbolIcon name="spark" className={`size-3.5 shrink-0 ${running > 0 ? 'text-accent' : ''}`} />
          <span className={`min-w-0 truncate ${running > 0 ? 'status-fade font-medium text-text' : ''}`}>{title}</span>
          {running > 0 && calls.length > 1 && <span className="shrink-0 text-xs text-accent">{t('subagent.running', { count: running })}</span>}
          <ChevronIcon className={`ml-auto size-3 shrink-0 text-text-muted motion-safe:transition-transform ${open ? 'rotate-90 text-text' : ''}`} />
        </button>
        {onOpenAgents && (
          <button
            type="button"
            onClick={() => onOpenAgents()}
            title={t('subagent.viewInPanel')}
            className="shrink-0 flex items-center gap-1 rounded px-2 py-0.5 text-xs text-accent hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-accent"
          >
            <SymbolIcon name="spark" className="size-3" />
            <span>{t('subagent.viewInPanel')}</span>
          </button>
        )}
      </div>
      <Collapse id={id} open={open} className="mt-1 mb-2 ml-1 border-l border-border pl-3">
        <ul className="flex flex-col gap-0.5">
          {calls.map((call) => (
            <Entry
              key={call.key}
              call={call}
              agent={subagents?.find((a) => a.id === call.id)}
              {...(onOpenAgents ? { onOpenAgents } : {})}
            />
          ))}
        </ul>
      </Collapse>
    </div>
  );
}
