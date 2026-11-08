import type { Item, ToolItem } from './sessionState.ts';
import { isSubagentCall } from './subagents.ts';
import { describeToolAction } from '../components/items/ToolCard.tsx';
import { t } from '../i18n/index.ts';

export type ToolGroupRow = {
  kind: 'tool_group';
  key: string;
  calls: ToolItem[];
};

export function isRegularTool(row: unknown): row is ToolItem {
  if (typeof row !== 'object' || row === null) return false;
  const item = row as Item;
  return item.kind === 'tool' && !isSubagentCall(item) && !item.parent;
}

/**
 * Groups runs of 2 or more consecutive regular tool calls into a single `tool_group` row.
 * A single tool call remains an individual row.
 */
export function groupToolCalls<T extends { kind: string; key: string }>(rows: readonly T[]): (T | ToolGroupRow)[] {
  const out: (T | ToolGroupRow)[] = [];
  let buffer: ToolItem[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    if (buffer.length === 1) {
      out.push(buffer[0] as unknown as T);
    } else {
      out.push({
        kind: 'tool_group',
        key: `tool_group:${buffer[0]!.key}`,
        calls: [...buffer],
      });
    }
    buffer = [];
  };

  for (const row of rows) {
    if (isRegularTool(row)) {
      buffer.push(row);
    } else {
      flush();
      out.push(row);
    }
  }
  flush();

  return out;
}

export type ToolGroupSummary = {
  status: 'in_progress' | 'failed' | 'completed';
  title: string;
  count: number;
};

export function summarizeToolGroup(calls: readonly ToolItem[]): ToolGroupSummary {
  const anyRunning = calls.some((c) => c.status === 'in_progress' || c.status === 'pending');
  const anyFailed = calls.some((c) => c.status === 'failed');
  const count = calls.length;

  if (anyRunning) {
    const active = [...calls].reverse().find((c) => c.status === 'in_progress' || c.status === 'pending') ?? calls[calls.length - 1]!;
    const action = describeToolAction(active);
    const title = action
      ? t('tool.group.running', { action, count })
      : t('tool.group.runningCount', { count });
    return { status: 'in_progress', title, count };
  }

  const status = anyFailed ? 'failed' : 'completed';

  const hasRead = calls.some((c) => c.toolKind === 'read' || /^(?:read|read_file|readfile|view_file|cat|file)/i.test(c.title));
  const hasExecute = calls.some((c) => c.toolKind === 'execute' || /^(?:run_command|command|bash|exec|terminal|sh)/i.test(c.title));
  const hasEdit = calls.some((c) => c.toolKind === 'edit' || /^(?:write|edit|multiedit|multi_edit|patch|apply_patch)/i.test(c.title));

  let detail: string;
  if (hasRead && hasExecute) {
    detail = t('tool.group.detail.mixed');
  } else if (hasRead && !hasExecute && !hasEdit) {
    detail = t('tool.group.detail.read');
  } else if (hasExecute && !hasRead && !hasEdit) {
    detail = t('tool.group.detail.execute');
  } else if (hasEdit && !hasRead && !hasExecute) {
    detail = t('tool.group.detail.edit');
  } else {
    detail = t('tool.group.detail.mixed');
  }

  const title = t('tool.group.summary', { count, detail });
  return { status, title, count };
}
