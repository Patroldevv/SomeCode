import { describe, expect, it } from 'vitest';
import type { Item, ToolItem } from './sessionState.ts';
import { describeSubagentCall, groupSubagentCalls, isSubagentCall, subagentsOf } from './subagents.ts';

const tool = (id: string, over: Partial<ToolItem> = {}): ToolItem => ({ kind: 'tool', key: id, id, title: id, toolKind: 'other', status: 'completed', content: [], ...over });

const invoke = (id: string, role: string, over: Partial<ToolItem> = {}) =>
  tool(id, { title: 'Run invoke_subagent', rawInput: { Model: 'inherit', Prompt: `Analyze ${role}`, Role: role, TypeName: 'research' }, ...over });

describe('subagentsOf', () => {
  it('reads a Claude Task call as a sub-agent with the calls made under it', () => {
    const items: Item[] = [
      tool('task1', { status: 'in_progress', rawInput: { subagent_type: 'explore', description: 'Explore the repo', prompt: 'Look' } }),
      tool('c1', { parent: { id: 'task1' }, status: 'completed' }),
      tool('c2', { parent: { id: 'task1' }, status: 'in_progress' }),
      tool('plain'),
    ];
    const [agent] = subagentsOf(items);
    expect(subagentsOf(items)).toHaveLength(1);
    expect(agent).toMatchObject({ id: 'task1', name: 'explore', description: 'Explore the repo', prompt: 'Look', status: 'running' });
    expect(agent!.calls.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('carries the result of a finished hand-off and its failure', () => {
    const done = tool('t', { rawInput: { subagent_type: 'plan' }, content: [{ type: 'text', text: ' All good ' }] });
    expect(subagentsOf([done])[0]).toMatchObject({ status: 'completed', output: 'All good' });
    expect(subagentsOf([tool('t', { rawInput: { subagent_type: 'plan' }, status: 'failed' })])[0]!.status).toBe('failed');
  });

  it('groups OpenCode child-session calls into sub-agents named after the session, in place of the hand-off call', () => {
    const items: Item[] = [
      tool('task', { rawInput: { subagent_type: 'explore', description: 'x' } }),
      tool('a', { parent: { id: 'session:s1', title: 'Find usages' }, status: 'completed' }),
      tool('b', { parent: { id: 'session:s1', title: 'Find usages' }, status: 'running' }),
      tool('c', { parent: { id: 'session:s2', title: 'Read docs' }, status: 'failed' }),
      tool('d', { parent: { id: 'session:s3', title: 'Mixed' }, status: 'failed' }),
      tool('e', { parent: { id: 'session:s3', title: 'Mixed' }, status: 'completed' }),
    ];
    const agents = subagentsOf(items);
    expect(agents.map((a) => [a.name, a.status, a.calls.length])).toEqual([
      ['Find usages', 'running', 2],
      ['Read docs', 'failed', 1],
      ['Mixed', 'completed', 2],
    ]);
  });

  it('keeps subagent running even if an intermediate child tool call failed', () => {
    const invokeCall = invoke('inv1', 'Test & Integration Analyst', { status: 'in_progress' });
    const child1 = tool('c1', { parent: { id: 'inv1' }, status: 'failed', title: 'List project root files' });
    const child2 = tool('c2', { parent: { id: 'inv1' }, status: 'in_progress', title: 'read_file package.json' });

    const [agent] = subagentsOf([invokeCall, child1, child2]);
    expect(agent).toMatchObject({
      name: 'Test & Integration Analyst',
      status: 'running',
    });
  });

  it('marks subagent completed when output arrives even if one child tool failed', () => {
    const invokeCall = invoke('inv1', 'Test & Integration Analyst', {
      status: 'completed',
      rawOutput: { message: 'All analysis finished.' },
    });
    const child1 = tool('c1', { parent: { id: 'inv1' }, status: 'failed', title: 'List files' });
    const child2 = tool('c2', { parent: { id: 'inv1' }, status: 'completed', title: 'read_file package.json' });

    const [agent] = subagentsOf([invokeCall, child1, child2]);
    expect(agent).toMatchObject({
      name: 'Test & Integration Analyst',
      status: 'completed',
      output: 'All analysis finished.',
    });
  });

  it('is empty when nothing was delegated', () => {
    expect(subagentsOf([tool('x')])).toEqual([]);
  });
});

describe('Antigravity invoke_subagent', () => {
  it('is recognised and described by its role, type and prompt', () => {
    const call = invoke('a', 'Feature Systems Specialist');
    expect(isSubagentCall(call)).toBe(true);
    expect(describeSubagentCall(call)).toEqual({ name: 'Feature Systems Specialist', description: 'research', prompt: 'Analyze Feature Systems Specialist' });
    // Newly launched subagent without output is running
    expect(subagentsOf([call])[0]).toMatchObject({ name: 'Feature Systems Specialist', status: 'running' });
    // When output report arrives, it is completed
    const doneCall = invoke('b', 'Feature Systems Specialist', { rawOutput: { message: 'Analysis complete.' } });
    expect(subagentsOf([doneCall])[0]).toMatchObject({ name: 'Feature Systems Specialist', status: 'completed', output: 'Analysis complete.' });
    expect(isSubagentCall(tool('x', { title: 'Run ls', rawInput: { Prompt: 'p' } }))).toBe(false);
  });

  it('collapses a run of hand-offs into one row and leaves the rest alone', () => {
    const rows = groupSubagentCalls([tool('t1'), invoke('a', 'A'), invoke('b', 'B'), tool('t2'), invoke('c', 'C')]);
    expect(rows.map((r) => r.key)).toEqual(['t1', 'agents:a', 't2', 'agents:c']);
    const group = rows[1];
    expect(group && group.kind === 'agents' && group.calls.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('nested hand-offs', () => {
  it('keeps a hand-off made by a sub-agent as its own sub-agent with the parent noted, not as one of the parent\'s calls', () => {
    const outer = tool('outer', { rawInput: { subagent_type: 'explore', description: 'Outer', prompt: 'x' } });
    const inner = tool('inner', { parent: { id: 'outer' }, rawInput: { subagent_type: 'plan', description: 'Inner', prompt: 'y' } });
    const read = tool('read1', { parent: { id: 'outer' }, title: 'Read a.ts', rawInput: { path: 'a.ts' } });
    const agents = subagentsOf([outer, inner, read]);
    expect(agents.map((a) => [a.id, a.parentId])).toEqual([['outer', undefined], ['inner', 'outer']]);
    expect(agents[0]!.calls.map((c) => c.id)).toEqual(['read1']);
  });
});
