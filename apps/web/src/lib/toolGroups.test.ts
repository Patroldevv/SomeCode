import { describe, expect, it } from 'vitest';
import { groupToolCalls, summarizeToolGroup } from './toolGroups.ts';
import type { ToolItem, Item } from './sessionState.ts';

function makeTool(key: string, title: string, status: ToolItem['status'] = 'completed', toolKind: ToolItem['toolKind'] = 'read', rawInput?: unknown): ToolItem {
  return {
    kind: 'tool',
    key,
    id: `call_${key}`,
    title,
    toolKind,
    status,
    content: [],
    ...(rawInput !== undefined ? { rawInput } : {}),
  };
}

describe('groupToolCalls', () => {
  it('leaves empty or non-tool rows untouched', () => {
    const user: Item = { kind: 'user', key: 'u1', text: 'hi' };
    const agent: Item = { kind: 'agent', key: 'a1', text: 'hello' };
    expect(groupToolCalls([user, agent])).toEqual([user, agent]);
  });

  it('leaves a single isolated tool call un-grouped', () => {
    const user: Item = { kind: 'user', key: 'u1', text: 'hi' };
    const tool = makeTool('t1', 'read_file foo.ts');
    const agent: Item = { kind: 'agent', key: 'a1', text: 'hello' };

    const result = groupToolCalls([user, tool, agent]);
    expect(result).toHaveLength(3);
    expect(result[1]).toBe(tool);
  });

  it('groups 2 or more consecutive tool calls into a tool_group row', () => {
    const user: Item = { kind: 'user', key: 'u1', text: 'hi' };
    const t1 = makeTool('t1', 'File src/a.ts');
    const t2 = makeTool('t2', 'File src/b.ts');
    const t3 = makeTool('t3', 'File src/c.ts');
    const agent: Item = { kind: 'agent', key: 'a1', text: 'hello' };

    const result = groupToolCalls([user, t1, t2, t3, agent]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(user);
    expect(result[1]).toEqual({
      kind: 'tool_group',
      key: 'tool_group:t1',
      calls: [t1, t2, t3],
    });
    expect(result[2]).toBe(agent);
  });

  it('keeps subagent hand-off calls separate from regular tool group', () => {
    const t1 = makeTool('t1', 'read_file a.ts');
    const subagentCall = makeTool('s1', 'invoke_subagent', 'completed', 'other', { Role: 'Researcher', Prompt: 'survey' });
    const t2 = makeTool('t2', 'read_file b.ts');

    const result = groupToolCalls([t1, subagentCall, t2]);
    // Since subagentCall splits t1 and t2, neither has >= 2 consecutive regular tools
    expect(result).toEqual([t1, subagentCall, t2]);
  });
});

describe('summarizeToolGroup', () => {
  it('summarizes running tools with the active tool action', () => {
    const t1 = makeTool('t1', 'File src/a.ts', 'completed', 'read', { Path: 'src/a.ts' });
    const t2 = makeTool('t2', 'File src/b.ts', 'in_progress', 'read', { Path: 'src/b.ts' });

    const summary = summarizeToolGroup([t1, t2]);
    expect(summary.status).toBe('in_progress');
    expect(summary.count).toBe(2);
    expect(summary.title).toContain('2 işlem');
  });

  it('summarizes completed reads', () => {
    const t1 = makeTool('t1', 'File src/a.ts', 'completed', 'read', { Path: 'src/a.ts' });
    const t2 = makeTool('t2', 'File src/b.ts', 'completed', 'read', { Path: 'src/b.ts' });

    const summary = summarizeToolGroup([t1, t2]);
    expect(summary.status).toBe('completed');
    expect(summary.count).toBe(2);
    expect(summary.title).toContain('2 işlem');
    expect(summary.title).toContain('Dosyalar incelendi');
  });

  it('summarizes mixed reads and executions', () => {
    const t1 = makeTool('t1', 'ls -la', 'completed', 'execute', { CommandLine: 'ls -la' });
    const t2 = makeTool('t2', 'File src/b.ts', 'completed', 'read', { Path: 'src/b.ts' });

    const summary = summarizeToolGroup([t1, t2]);
    expect(summary.status).toBe('completed');
    expect(summary.title).toContain('Dosyalar incelendi, komutlar çalıştırıldı');
  });
});

describe('screenshots are not grouped away', () => {
  it('keeps a tool call that returned a picture as a row of its own', () => {
    const plain = (key: string) => ({ kind: 'tool' as const, key, id: key, title: key, toolKind: 'other', status: 'completed', content: [] });
    const shot = { ...plain('s'), content: [{ type: 'image' as const, data: 'A', mimeType: 'image/jpeg' }] };
    const rows = groupToolCalls([plain('a'), plain('b'), shot, plain('c'), plain('d')]);
    expect(rows.map((r) => r.kind)).toEqual(['tool_group', 'tool', 'tool_group']);
  });
});
