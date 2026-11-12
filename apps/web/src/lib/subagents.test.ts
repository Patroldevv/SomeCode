import { describe, expect, it } from 'vitest';
import type { Item, ToolItem } from './sessionState.ts';
import { describeSubagentCall, groupSubagentCalls, isScoutCall, isSubagentCall, subagentsOf } from './subagents.ts';

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

describe('Gemini Scout subagent', () => {
  it('recognizes somecode-scout tool calls as subagents and extracts task cleanly', () => {
    const scoutCall = tool('sc1', {
      title: 'somecode-scout "scan auth routes" --timeout 180000',
      rawInput: { command: 'somecode-scout "scan auth routes" --timeout 180000' },
      content: [{ type: 'text', text: 'Auth routes summary: 3 endpoints found.\nexit=0' }],
    });

    expect(isSubagentCall(scoutCall)).toBe(true);
    expect(describeSubagentCall(scoutCall)).toEqual({
      name: 'Gemini Scout',
      description: 'Gemini 3.8 Flash',
      prompt: 'scan auth routes',
    });

    const [agent] = subagentsOf([scoutCall]);
    expect(agent).toMatchObject({
      name: 'Gemini Scout',
      description: 'Gemini 3.8 Flash',
      prompt: 'scan auth routes',
      status: 'completed',
      output: 'Auth routes summary: 3 endpoints found.',
    });
  });

  it('groups consecutive scout calls into an agents row', () => {
    const s1 = tool('s1', { rawInput: { command: 'somecode-scout "task 1"' } });
    const s2 = tool('s2', { rawInput: { command: 'somecode-scout "task 2"' } });
    const rows = groupSubagentCalls([tool('regular'), s1, s2]);
    expect(rows[1]).toMatchObject({
      kind: 'agents',
      key: 'agents:s1',
      calls: [s1, s2],
    });
  });
});

describe('Claude subagent', () => {
  it('recognizes somecode-claude tool calls as subagents and extracts task cleanly', () => {
    const claudeCall = tool('cl1', {
      title: 'somecode-claude "refactor auth logic" --model sonnet',
      rawInput: { command: 'somecode-claude "refactor auth logic" --model sonnet' },
      content: [{ type: 'text', text: 'Refactored auth logic cleanly.' }],
    });

    expect(isSubagentCall(claudeCall)).toBe(true);
    expect(describeSubagentCall(claudeCall)).toEqual({
      name: 'Claude Subagent',
      description: 'Claude Code',
      prompt: 'refactor auth logic',
    });

    const [agent] = subagentsOf([claudeCall]);
    expect(agent).toMatchObject({
      name: 'Claude Subagent',
      description: 'Claude Code',
      prompt: 'refactor auth logic',
      status: 'completed',
      output: 'Refactored auth logic cleanly.',
    });
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

describe('Gemini Scout detection', () => {
  it('does not take loading the scout skill, or reading a file that mentions the command, for a scout run', () => {
    const skill = tool('sk', { title: 'Load skill: scout', toolKind: 'other', rawInput: { name: 'scout', content: 'Run via Bash: somecode-scout "<task>"' }, status: 'completed' });
    const cat = tool('ct', { title: 'cat SKILL.md', toolKind: 'execute', rawInput: { command: 'cat ~/.claude/skills/scout/SKILL.md # somecode-scout' } });
    expect(isScoutCall(skill)).toBe(false);
    expect(isScoutCall(cat)).toBe(false);
    expect(subagentsOf([skill, cat])).toEqual([]);
  });

  it('still recognises a command run after a cd or in a pipeline', () => {
    expect(isScoutCall(tool('r', { toolKind: 'execute', rawInput: { command: 'cd /app && somecode-scout "scan"' } }))).toBe(true);
    expect(isScoutCall(tool('r2', { title: 'Run somecode-scout "x"' }))).toBe(true);
  });
});

describe('Gemini Scout as a tool of its own', () => {
  it('is a sub-agent named Gemini Scout, with the task from the tool input', () => {
    const call = tool('m1', { title: 'mcp__somecode__scout', toolKind: 'other', rawInput: { task: 'map the server', files: ['apps/server'] }, status: 'in_progress' });
    expect(isScoutCall(call)).toBe(true);
    expect(isSubagentCall(call)).toBe(true);
    expect(describeSubagentCall(call)).toMatchObject({ name: 'Gemini Scout', prompt: 'map the server' });
    expect(isScoutCall(tool('m2', { title: 'Task: explore', rawInput: { task: 'x' } }))).toBe(false);
  });
});
