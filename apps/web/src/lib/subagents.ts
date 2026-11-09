import type { Item, ToolItem } from './sessionState.ts';

export type SubagentStatus = 'running' | 'completed' | 'failed';
export type Subagent = {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  status: SubagentStatus;
  /** What the sub-agent reported back (text of its Task call), if anything yet. */
  output?: string;
  /** The tool calls the sub-agent made itself. */
  calls: ToolItem[];
  /** The sub-agent that started this one (when the agent tags it so); absent for the main agent's own. */
  parentId?: string;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

const statusOf = (status: string): SubagentStatus => (status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'running');

/** A field of the hand-off's input, whatever the agent capitalises it as (`subagent_type`, `Role`, `Prompt`, ...). */
function field(input: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const hit = Object.keys(input).find((k) => k.toLowerCase() === name.toLowerCase());
    const value = hit === undefined ? undefined : str(input[hit]);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Whether the tool call is the sub-agent hand-off itself: Claude's Task and OpenCode's task name a `subagent_type`;
 * Antigravity's `invoke_subagent` carries a `Role`, a `Prompt` and a `TypeName`.
 */
export function isSubagentCall(item: ToolItem): boolean {
  if (!isRecord(item.rawInput)) return false;
  if (field(item.rawInput, 'subagent_type') !== undefined) return true;
  if (field(item.rawInput, 'Role') !== undefined && field(item.rawInput, 'Prompt') !== undefined) return true;
  return /subagent/i.test(item.title) && field(item.rawInput, 'prompt') !== undefined;
}

/** Who the sub-agent is and what it was asked to do, from the hand-off call. */
export function describeSubagentCall(item: ToolItem): { name: string; description?: string; prompt?: string } {
  const input = isRecord(item.rawInput) ? item.rawInput : {};
  const type = field(input, 'subagent_type', 'TypeName');
  const role = field(input, 'Role');
  const task = field(input, 'description');
  const name = field(input, 'Role') ?? field(input, 'subagent_type') ?? type ?? task ?? 'Sub-agent';
  const description = task && task !== name ? task : role && role !== name ? role : type && type !== name ? type : undefined;
  const prompt = field(input, 'prompt');
  return { name, ...(description ? { description } : {}), ...(prompt ? { prompt } : {}) };
}

/**
 * The sub-agents of a conversation. Where the agent tags its sub-agents' own tool calls (Claude: with the Task that
 * started them; OpenCode: with the child session) those calls are grouped under the sub-agent; the hand-off call
 * itself supplies the name, task and result when it is the one that identifies it.
 */
export function subagentsOf(items: readonly Item[]): Subagent[] {
  const byParent = new Map<string, ToolItem[]>();
  const titles = new Map<string, string | undefined>();
  const handOffs: ToolItem[] = [];
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    if (item.parent && isSubagentCall(item)) {
      // A hand-off made by a sub-agent: a node under that sub-agent, not one of its plain calls.
      handOffs.push(item);
    } else if (item.parent) {
      const list = byParent.get(item.parent.id) ?? [];
      list.push(item);
      byParent.set(item.parent.id, list);
      if (item.parent.title) titles.set(item.parent.id, item.parent.title);
    } else if (isSubagentCall(item)) {
      handOffs.push(item);
    }
  }
  const sessionGroups = [...byParent.keys()].filter((id) => id.startsWith('session:'));
  if (sessionGroups.length > 0) {
    // OpenCode: the child sessions are the sub-agents.
    return sessionGroups.map((id) => {
      const calls = byParent.get(id) ?? [];
      const anyRunning = calls.some((c) => c.status !== 'completed' && c.status !== 'failed');
      const allFailed = calls.length > 0 && calls.every((c) => c.status === 'failed');
      return {
        id,
        name: titles.get(id) ?? 'Sub-agent',
        status: anyRunning ? 'running' : allFailed ? 'failed' : 'completed',
        calls,
      };
    });
  }
  return handOffs.map((item) => {
    let output = item.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n\n').trim();
    if (!output && item.rawOutput !== undefined) {
      if (typeof item.rawOutput === 'string') {
        output = item.rawOutput.trim();
      } else if (isRecord(item.rawOutput)) {
        const outStr = field(item.rawOutput, 'result', 'output', 'summary', 'text', 'response', 'message', 'Message');
        if (outStr) output = outStr.trim();
        else output = JSON.stringify(item.rawOutput, null, 2);
      }
    }
    // Launch confirmation is not a finished task report
    const isLaunchOutput = output && (output.includes('Created the following subagent') || (output.includes('"conversationId"') && !output.includes('Message')));
    const effectiveOutput = isLaunchOutput || !output ? undefined : output;

    const { name, description, prompt } = describeSubagentCall(item);
    const calls = byParent.get(item.id) ?? [];
    const callsRunning = calls.some((c) => c.status === 'in_progress' || c.status === 'pending');
    const allCallsFailed = calls.length > 0 && calls.every((c) => c.status === 'failed');

    let status: SubagentStatus;
    if (item.status === 'failed') {
      status = 'failed';
    } else if (effectiveOutput) {
      status = 'completed';
    } else if (callsRunning || item.status === 'in_progress' || item.status === 'pending') {
      status = 'running';
    } else if (calls.length > 0 && !callsRunning && item.status === 'completed' && allCallsFailed) {
      status = 'failed';
    } else {
      status = 'running';
    }

    return {
      id: item.id,
      name,
      ...(description ? { description } : {}),
      ...(prompt ? { prompt } : {}),
      status,
      ...(effectiveOutput ? { output: effectiveOutput } : {}),
      calls,
      ...(item.parent ? { parentId: item.parent.id } : {}),
    };
  });
}

/** Several hand-offs in a row, shown as one line in the conversation. */
export type AgentsRow = { kind: 'agents'; key: string; calls: ToolItem[] };

/** Replaces each run of consecutive sub-agent hand-off calls with one `agents` row (keyed by its first call). */
export function groupSubagentCalls<T extends { kind: string; key: string }>(rows: readonly T[]): (T | AgentsRow)[] {
  const out: (T | AgentsRow)[] = [];
  for (const row of rows) {
    const item = row as unknown as Item;
    if (item.kind === 'tool' && isSubagentCall(item)) {
      const last = out[out.length - 1];
      if (last && last.kind === 'agents') (last as AgentsRow).calls.push(item);
      else out.push({ kind: 'agents', key: `agents:${row.key}`, calls: [item] });
    } else {
      out.push(row);
    }
  }
  return out;
}
