import { plural, t } from '../i18n/index.ts';
import { totalStats, type EditedFile } from '../lib/edits.ts';
import type { Subagent } from '../lib/subagents.ts';
import { ChevronIcon } from './icons.tsx';
import { SymbolIcon } from './SymbolIcon.tsx';
import { SubagentStatus } from './SubagentsList.tsx';
import type { ResearchWork } from '../lib/researchSources.ts';

const tokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/**
 * The small floating card at the top right of a chat: the project folder, what the agent changed and the
 * sub-agents it started, each opening the matching tab of the workspace panel. It stays for the whole session.
 */
export function ChangesCard({
  projectName,
  files,
  subagents,
  context,
  onOpenFiles,
  onOpenChanges,
  onOpenAgents,
  research,
  onOpenSources,
}: {
  projectName: string;
  files: readonly EditedFile[];
  subagents: readonly Subagent[];
  /** How full the context window is (tokens used of its size); `estimated` when the agent did not report it. */
  context?: { used: number; size: number; estimated: boolean };
  onOpenFiles: () => void;
  onOpenChanges: () => void;
  onOpenAgents: () => void;
  /** What a deep research has found; its row shows once there are sources. */
  research?: ResearchWork;
  onOpenSources?: () => void;
}) {
  const { added, removed } = totalStats(files);
  const running = subagents.filter((a) => a.status === 'running').length;
  return (
    <aside className="changes-card" aria-label={t('changesCard.label')}>
      <button type="button" onClick={onOpenFiles} className="changes-card-head" title={projectName}>
        <SymbolIcon name="folder" className="size-4 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-left">{projectName}</span>
        <ChevronIcon className="size-3 shrink-0 text-text-muted" />
      </button>
      {context && context.size > 0 && (
        <div className="changes-card-context" title={`${context.used.toLocaleString()} / ${context.size.toLocaleString()}`}>
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-text-muted">{t('context.title')}</span>
            <span>
              {context.estimated ? '≈ ' : ''}
              {t('context.used', { percent: Math.min(100, Math.max(1, Math.round((context.used / context.size) * 100))) })}
            </span>
          </div>
          <p className="mt-0.5 text-right text-[11.5px] text-text-muted">{tokens(context.used)} / {tokens(context.size)}</p>
        </div>
      )}
      {files.length > 0 && (
        <button type="button" onClick={onOpenChanges} className="changes-card-row">
          <SymbolIcon name="diff" className="size-4 text-text-muted" />
          <span className="min-w-0 flex-1 truncate text-left">{t('panel.changes')}</span>
          <span className="shrink-0 font-mono text-xs">
            <span aria-hidden="true">
              <span className="text-success">+{added}</span> <span className="text-danger">-{removed}</span>
            </span>
            <span className="sr-only">
              {plural('edits.title', files.length)}, {t('diff.stats', { added: plural('diff.added', added), removed: plural('diff.removed', removed) })}
            </span>
          </span>
        </button>
      )}
      {research && research.sources.length > 0 && onOpenSources && (
        <button type="button" onClick={onOpenSources} className="changes-card-row">
          <SymbolIcon name="research" className="size-4 text-text-muted" />
          <span className="min-w-0 flex-1 truncate text-left">{t('changesCard.sources')}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
            {research.busy && <span className="spin-arc size-3 text-accent" aria-hidden="true" />}
            <span>{research.sources.length}</span>
          </span>
        </button>
      )}
      {subagents.length > 0 && (
        <button type="button" onClick={onOpenAgents} className="changes-card-row">
          <SymbolIcon name="spark" className="size-4 text-text-muted" />
          <span className="min-w-0 flex-1 truncate text-left">{t('subagent.title')}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
            {running > 0 && <SubagentStatus status="running" />}
            <span>{running > 0 ? t('subagent.running', { count: running }) : t('subagent.done', { count: subagents.length })}</span>
          </span>
        </button>
      )}
    </aside>
  );
}
