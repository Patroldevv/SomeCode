import { useId, useState } from 'react';
import { t, plural } from '../i18n/index.ts';
import type { Subagent } from '../lib/subagents.ts';
import { Collapse } from './Collapse.tsx';
import { CheckIcon, ChevronIcon, CrossIcon } from './icons.tsx';
import { ToolCard } from './items/ToolCard.tsx';

/** A small status mark: a spinner while running, a check when done, a cross when it failed. */
export function SubagentStatus({ status }: { status: Subagent['status'] }) {
  const label = t(`subagent.status.${status}`);
  if (status === 'running') {
    return (
      <span className="flex items-center gap-1.5 text-accent text-xs font-medium">
        <span role="status" aria-label={label} className="loading-ring size-3 border-[1.5px]" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${status === 'completed' ? 'text-success' : 'text-danger'}`}>
      <span role="img" aria-label={label} className="flex">
        {status === 'completed' ? <CheckIcon className="animate-pop size-3.5" /> : <CrossIcon className="size-3.5" />}
      </span>
      <span>{label}</span>
    </span>
  );
}

function Entry({ agent, defaultOpen }: { agent: Subagent; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <li className="changes-file">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="changes-head">
        <ChevronIcon className={`size-3 shrink-0 text-text-muted motion-safe:transition-transform motion-safe:duration-300 ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-text">{agent.name}</span>
          {agent.description && <span className="block truncate text-xs text-text-muted">{agent.description}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
          {agent.calls.length > 0 && <span>{plural('subagent.calls', agent.calls.length)}</span>}
          <SubagentStatus status={agent.status} />
        </span>
      </button>
      <Collapse id={id} open={open}>
        <div className="flex flex-col gap-3 px-3 pb-3 pl-8 text-[13px]">
          {agent.prompt && (
            <section>
              <h4 className="mb-1 text-xs font-medium text-text-muted">{t('subagent.task')}</h4>
              <p className="whitespace-pre-wrap text-text [overflow-wrap:anywhere]">{agent.prompt}</p>
            </section>
          )}
          {agent.status === 'running' && (
            <div className="flex items-center gap-2 text-xs text-accent">
              <span className="loading-ring size-3 border-[1.5px]" />
              <span>{t('subagent.status.running')}…</span>
            </div>
          )}
          {agent.calls.length > 0 && (
            <section>
              <h4 className="mb-1 text-xs font-medium text-text-muted">{t('subagent.activity')}</h4>
              <div className="flex flex-col gap-0.5">
                {agent.calls.map((call) => (
                  <ToolCard key={call.key} item={call} />
                ))}
              </div>
            </section>
          )}
          {agent.output && (
            <section>
              <h4 className="mb-1 text-xs font-medium text-text-muted">{t('subagent.result')}</h4>
              <p className="max-h-60 overflow-auto whitespace-pre-wrap text-text [overflow-wrap:anywhere] bg-bg-subtle p-2 rounded text-xs">{agent.output}</p>
            </section>
          )}
        </div>
      </Collapse>
    </li>
  );
}

/** The sub-agents the agent started in this session; each one opens to its task, what it did and what it reported. */
export function SubagentsList({ agents }: { agents: readonly Subagent[] }) {
  if (agents.length === 0) return <div className="panel-empty">{t('subagent.none')}</div>;
  return (
    <ul className="py-1">
      {agents.map((agent, i) => (
        <Entry key={agent.id} agent={agent} defaultOpen={agents.length === 1 || (agent.status === 'running' && i === agents.length - 1)} />
      ))}
    </ul>
  );
}
