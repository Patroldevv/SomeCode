import { useState } from 'react';
import { plural, t } from '../i18n/index.ts';
import { buildSubagentTree, countSubagents, type SubagentNode } from '../lib/subagentTree.ts';
import type { Subagent } from '../lib/subagents.ts';
import { CheckIcon, CrossIcon } from './icons.tsx';
import { AgentDetails, SubagentsList } from './SubagentsList.tsx';

type View = 'list' | 'tree' | 'board';
const VIEWS: readonly View[] = ['list', 'tree', 'board'];
const KEY = 'somecode.subagentView';

function readView(): View {
  try {
    const saved = globalThis.localStorage?.getItem(KEY);
    return VIEWS.find((v) => v === saved) ?? 'tree';
  } catch {
    return 'tree';
  }
}

/** A round status mark: a spinner while running, a check when done, a cross when it failed. */
function Mark({ status }: { status: Subagent['status'] }) {
  const label = t(`subagent.status.${status}`);
  return (
    <span role="img" aria-label={label} className={`agent-mark agent-mark-${status}`}>
      {status === 'running' ? <span className="loading-ring size-3 border-[1.5px]" /> : status === 'completed' ? <CheckIcon className="animate-pop size-3" /> : <CrossIcon className="animate-pop size-3" />}
    </span>
  );
}

function Counts({ agents }: { agents: readonly Subagent[] }) {
  const c = countSubagents(buildSubagentTree(agents));
  return (
    <p className="agent-summary">
      {c.running > 0 && <span className="text-accent">{t('subagent.running', { count: c.running })}</span>}
      {c.completed > 0 && <span className="text-success">{t('subagent.done', { count: c.completed })}</span>}
      {c.failed > 0 && <span className="text-danger">{t('subagent.failedCount', { count: c.failed })}</span>}
      {c.depth > 1 && <span>{t('subagent.levels', { count: c.depth })}</span>}
    </p>
  );
}

function TreeItem({ node, selected, onSelect }: { node: SubagentNode; selected: string | null; onSelect: (id: string) => void }) {
  const { agent } = node;
  const open = selected === agent.id;
  return (
    <li className="agent-tree-item">
      <button type="button" className="agent-node" data-status={agent.status} aria-expanded={open} onClick={() => onSelect(agent.id)}>
        <Mark status={agent.status} />
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-text">{agent.name}</span>
          {agent.description && <span className="block truncate text-xs text-text-muted">{agent.description}</span>}
        </span>
        {agent.calls.length > 0 && <span className="shrink-0 text-xs text-text-muted">{plural('subagent.calls', agent.calls.length)}</span>}
      </button>
      {open && <AgentDetails agent={agent} className="agent-node-details" />}
      {node.children.length > 0 && (
        <ul className="agent-tree">
          {node.children.map((child) => (
            <TreeItem key={child.agent.id} node={child} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The main agent at the top, the sub-agents it started below it, and theirs below them. */
function Tree({ agents, mainLabel, selected, onSelect }: { agents: readonly Subagent[]; mainLabel: string; selected: string | null; onSelect: (id: string) => void }) {
  const roots = buildSubagentTree(agents);
  return (
    <div className="agent-tree-root">
      <p className="agent-main">
        <span className="agent-main-dot" aria-hidden="true" />
        {mainLabel}
      </p>
      <ul className="agent-tree">
        {roots.map((node) => (
          <TreeItem key={node.agent.id} node={node} selected={selected} onSelect={onSelect} />
        ))}
      </ul>
    </div>
  );
}

const COLUMNS = ['running', 'completed', 'failed'] as const;

/** A task board: one column per state, a card per sub-agent. */
function Board({ agents, selected, onSelect }: { agents: readonly Subagent[]; selected: string | null; onSelect: (id: string) => void }) {
  const chosen = agents.find((a) => a.id === selected);
  return (
    <div>
      <div className="agent-board">
        {COLUMNS.map((status) => {
          const cards = agents.filter((a) => a.status === status);
          return (
            <section key={status} className="agent-column" aria-label={t(`subagent.status.${status}`)}>
              <h3>
                {t(`subagent.status.${status}`)} <span>{cards.length}</span>
              </h3>
              {cards.map((agent) => (
                <button key={agent.id} type="button" className="agent-card" data-status={status} aria-pressed={agent.id === selected} onClick={() => onSelect(agent.id)}>
                  <span className="flex items-center gap-2">
                    <Mark status={agent.status} />
                    <span className="min-w-0 flex-1 truncate text-left text-text">{agent.name}</span>
                  </span>
                  {agent.description && <span className="mt-1 block truncate text-left text-xs text-text-muted">{agent.description}</span>}
                  {agent.calls.length > 0 && <span className="mt-1 block text-left text-[11.5px] text-text-muted">{plural('subagent.calls', agent.calls.length)}</span>}
                </button>
              ))}
              {cards.length === 0 && <p className="agent-column-empty">–</p>}
            </section>
          );
        })}
      </div>
      {chosen && <AgentDetails agent={chosen} className="agent-board-details" />}
    </div>
  );
}

/**
 * The sub-agents of the conversation in three views: a list, a tree (who started whom) and a task board. The tree
 * and board work for any agent that reports sub-agents; the tree gets deeper when an agent tags nested ones.
 */
export function SubagentsView({ agents, mainLabel = t('subagent.main') }: { agents: readonly Subagent[]; mainLabel?: string }) {
  const [view, setView] = useState<View>(readView);
  const [selected, setSelected] = useState<string | null>(null);
  if (agents.length === 0) return <div className="panel-empty">{t('subagent.none')}</div>;
  const pick = (v: View) => {
    setView(v);
    try {
      globalThis.localStorage?.setItem(KEY, v);
    } catch {
      // Not saving the choice is fine.
    }
  };
  const toggle = (id: string) => setSelected((cur) => (cur === id ? null : id));
  return (
    <div className="agent-view">
      <div className="agent-view-head">
        <Counts agents={agents} />
        <div className="panel-tabs !m-0" role="tablist" aria-label={t('subagent.view')}>
          {VIEWS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => pick(v)}>
              {t(`subagent.view.${v}`)}
            </button>
          ))}
        </div>
      </div>
      {view === 'list' && <SubagentsList agents={agents} />}
      {view === 'tree' && <Tree agents={agents} mainLabel={mainLabel} selected={selected} onSelect={toggle} />}
      {view === 'board' && <Board agents={agents} selected={selected} onSelect={toggle} />}
    </div>
  );
}
