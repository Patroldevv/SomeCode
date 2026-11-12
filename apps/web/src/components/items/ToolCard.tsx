import { useId, useMemo, useState } from 'react';
import { plural, t } from '../../i18n/index.ts';
import type { ToolItem } from '../../lib/sessionState.ts';
import { browserLabel, screenshotCaption } from '../../lib/browserTools.ts';
import { researchLabel, researchTool } from '../../lib/researchTools.ts';
import { isClaudeCall, isScoutCall } from '../../lib/subagents.ts';
import { sumStats, toolFiles, type ToolFile } from '../../lib/toolFiles.ts';
import { Collapse } from '../Collapse.tsx';
import { ChevronIcon } from '../icons.tsx';
import { ScreenshotThumb } from './ScreenshotThumb.tsx';
import { ToolDetails } from './ToolDetails.tsx';
import { ToolKindIcon, ToolStatus, toolKindLabel } from './ToolGlyphs.tsx';
import { FileIcon } from '../FileIcon.tsx';
import { SymbolIcon, type SymbolName } from '../SymbolIcon.tsx';

const GENERIC_TITLE = /^(file\s+.+|(run\s+)?(read|read_file|readfile|view_file|view|cat|file|write|edit|multiedit|multi_edit|patch|apply_patch|create|update|str_replace\w*|run_command|command|bash|exec|terminal|sh|search|search_web|find|grep|fetch)(\.ts|\.js)?)$/i;

const RESEARCH_ICON: Partial<Record<string, SymbolName>> = {
  web_search: 'search',
  web_read: 'globe',
  research_note: 'edit',
  research_status: 'steps',
  history_search: 'history',
  history_read: 'history',
  memory_add: 'brain',
  memory_list: 'brain',
  memory_forget: 'brain',
  schedule_create: 'schedule',
  schedule_list: 'schedule',
  schedule_cancel: 'schedule',
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function extractPath(item: ToolItem): string | null {
  if (isRecord(item.rawInput)) {
    for (const key of ['Path', 'filePath', 'file_path', 'path', 'file', 'filename']) {
      const v = item.rawInput[key];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
  }
  const m = item.title.match(/^(?:read_file|read|view_file|cat|file)\s+(.+)/i);
  return m?.[1]?.trim() ?? null;
}

function extractCommand(item: ToolItem): string | null {
  if (isRecord(item.rawInput)) {
    const summary = item.rawInput['toolSummary'];
    if (typeof summary === 'string' && summary.trim() !== '') return summary.trim();
    for (const key of ['CommandLine', 'command', 'cmd', 'commandLine']) {
      const v = item.rawInput[key];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
  }
  const m = item.title.match(/^(?:run_command|run|bash|exec|terminal|sh)\s+(.+)/i);
  if (m?.[1]) return m[1].trim();
  if (item.toolKind === 'execute' && item.title.trim() !== '') {
    return item.title.trim();
  }
  return null;
}

function extractQuery(item: ToolItem): string | null {
  if (isRecord(item.rawInput)) {
    for (const key of ['query', 'pattern', 'q']) {
      const v = item.rawInput[key];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
    const queries = item.rawInput['queries'];
    if (Array.isArray(queries) && queries.length > 0 && typeof queries[0] === 'string') return queries[0];
  }
  return null;
}

/** Natural, action-oriented titles like "Reading app.ts", "Ran npm test", or "Wrote README.md". */
export function describeToolAction(item: ToolItem, files: ToolFile[] = []): string | null {
  const running = item.status === 'in_progress' || item.status === 'pending';

  const research = researchLabel(item);
  if (research) return research;

  if (isScoutCall(item)) {
    const cmd = extractCommand(item) || item.title;
    const taskMatch = cmd.match(/somecode-scout(?:\s+--[\w-]+(?:\s+\S+)?)*\s+["']?([^"';\n]+)/i);
    const task = taskMatch?.[1]?.trim() || 'Workspace inspection';
    const shortTask = task.length > 60 ? task.slice(0, 57) + '…' : task;
    return running ? `Scouting: ${shortTask}…` : `Scout: ${shortTask}`;
  }

  if (isClaudeCall(item)) {
    const cmd = extractCommand(item) || item.title;
    const taskMatch = cmd.match(/somecode-claude(?:\s+--[\w-]+(?:\s+\S+)?)*\s+["']?([^"';\n]+)/i);
    const task = taskMatch?.[1]?.trim() || 'Code reasoning';
    const shortTask = task.length > 60 ? task.slice(0, 57) + '…' : task;
    return running ? `Claude: ${shortTask}…` : `Claude: ${shortTask}`;
  }

  if (item.toolKind === 'edit' || /^(write|edit|multiedit|multi_edit|patch|apply_patch|create|update|str_replace\w*)$/i.test(item.title.trim())) {
    if (files.length > 0) {
      const first = files[0]!;
      const name = first.path.split('/').pop() || first.path;
      const created = first.changes.every((c) => c.oldText === null);
      const verb = `${created ? 'write' : 'edit'}.${running ? 'running' : 'done'}` as 'write.done';
      const text = t(`tool.sum.${verb}`, { name });
      return files.length > 1 ? t('tool.sum.more', { name: text, count: files.length - 1 }) : text;
    }
    const p = extractPath(item);
    if (p) {
      const name = p.split(/[\\/]/).pop() || p;
      return t(running ? 'tool.sum.edit.running' : 'tool.sum.edit.done', { name });
    }
    return null;
  }

  if (item.toolKind === 'read' || /^(?:read|read_file|readfile|view_file|cat|file)(?:\s+.*)?$/i.test(item.title.trim())) {
    const p = extractPath(item);
    if (p) {
      const name = p.split(/[\\/]/).pop() || p;
      return t(running ? 'tool.sum.read.running' : 'tool.sum.read.done', { name });
    }
  }

  if (item.toolKind === 'execute' || /^(?:run_command|command|bash|exec|terminal|sh|run)(?:\s+.*)?$/i.test(item.title.trim())) {
    const cmd = extractCommand(item);
    if (cmd) {
      const shortCmd = cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd;
      return t(running ? 'tool.sum.execute.running' : 'tool.sum.execute.done', { name: shortCmd });
    }
  }

  if (item.toolKind === 'search' || /^(search|search_web|find|grep)$/i.test(item.title.trim())) {
    const q = extractQuery(item);
    if (q) {
      const shortQ = q.length > 50 ? q.slice(0, 47) + '…' : q;
      return t(running ? 'tool.sum.search.running' : 'tool.sum.search.done', { name: shortQ });
    }
  }

  return null;
}

/**
 * One compact, muted line per tool call — kind icon, title (truncated), `+n -m` for edits, status — that expands
 * to the raw input and the output. The status sits outside the button so its `role="status"` stays exposed.
 *
 * Controlled by `expanded`/`onToggle` in the list (the open state must survive the virtualized row being
 * unmounted and remounted); without them it keeps its own state.
 */
export function ToolCard({ item, expanded, onToggle }: { item: ToolItem; expanded?: boolean; onToggle?: () => void }) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = expanded ?? ownOpen;
  const toggle = onToggle ?? (() => setOwnOpen((o) => !o));
  const id = useId();
  const files = useMemo(() => toolFiles(item), [item]);
  const stats = files.length > 0 ? sumStats(files) : null;
  const targetPath = files[0]?.path ?? extractPath(item);
  const isScout = isScoutCall(item);
  const isClaude = isClaudeCall(item);
  const running = item.status === 'in_progress' || item.status === 'pending';
  const base = item.title.trim() || toolKindLabel(item.toolKind);
  const browser = browserLabel(item);
  const research = researchLabel(item);
  const title = browser ?? research ?? (item.title.trim() === '' || isScout || isClaude || GENERIC_TITLE.test(base) ? describeToolAction(item, files) : null) ?? base;
  // A picture the tool returned (a browser screenshot) sits in the conversation under the line, not behind the fold.
  const shot = item.content.find((c): c is Extract<typeof c, { type: 'image' }> => c.type === 'image');
  const caption = screenshotCaption(item);
  const details = shot ? { ...item, content: item.content.filter((c) => c.type !== 'image') } : item;

  return (
    <div className="min-w-0 font-ui text-[13.5px] text-text-muted">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
          className="tool-row group -ml-1.5 flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          {isScout ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium bg-bg-elevated text-text-secondary border border-border">
              <SymbolIcon name="spark" className="size-3 text-accent" />
              <span>Gemini Scout</span>
            </span>
          ) : isClaude ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium bg-bg-elevated text-text-secondary border border-border">
              <SymbolIcon name="spark" className="size-3 text-accent" />
              <span>Claude Subagent</span>
            </span>
          ) : running ? (
            <ToolStatus status={item.status} />
          ) : research ? (
            <SymbolIcon name={RESEARCH_ICON[researchTool(item) ?? 'web_search'] ?? 'globe'} className="size-3.5 shrink-0" />
          ) : browser ? (
            <SymbolIcon name="image" className="size-3.5 shrink-0" />
          ) : targetPath ? (
            <FileIcon path={targetPath} className="size-3.5 shrink-0" />
          ) : (
            <ToolKindIcon kind={item.toolKind} />
          )}
          <span className={`min-w-0 truncate ${item.status === 'in_progress' ? 'status-fade text-text font-medium' : ''}`} title={title}>
            {title}
          </span>
          {stats && (
            <span className="shrink-0 font-mono text-xs">
              <span aria-hidden="true">
                <span className="text-success">+{stats.added}</span> <span className="text-danger">-{stats.removed}</span>
              </span>
              <span className="sr-only"> {t('diff.stats', { added: plural('diff.added', stats.added), removed: plural('diff.removed', stats.removed) })}</span>
            </span>
          )}
          <ChevronIcon
            className={`ml-auto size-3 shrink-0 text-text-muted motion-safe:transition-transform ${open ? 'rotate-90 text-text' : ''}`}
          />
        </button>
        {!running && <ToolStatus status={item.status} />}
      </div>
      {shot && (
        <div className="mt-1.5 mb-1 ml-1 min-w-0">
          <ScreenshotThumb data={shot.data} mimeType={shot.mimeType} {...(caption ? { caption: caption.name || caption.url || '' } : {})} />
          {caption?.url && <p className="mt-1 truncate text-xs text-text-muted" title={caption.url}>{caption.url}</p>}
        </div>
      )}
      <Collapse id={id} open={open} className="mt-1 mb-2 ml-1 border-l border-border pl-4">
        <ToolDetails item={details} />
      </Collapse>
    </div>
  );
}
