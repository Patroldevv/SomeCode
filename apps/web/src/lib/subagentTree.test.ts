import { describe, expect, it } from 'vitest';
import { buildSubagentTree, countSubagents } from './subagentTree.ts';
import type { Subagent } from './subagents.ts';

const agent = (id: string, over: Partial<Subagent> = {}): Subagent => ({ id, name: id, status: 'running', calls: [], ...over });

describe('buildSubagentTree', () => {
  it('hangs a sub-agent under the one that started it and the rest under the main agent', () => {
    const tree = buildSubagentTree([agent('a'), agent('b', { parentId: 'a' }), agent('c', { parentId: 'b' }), agent('d')]);
    expect(tree.map((n) => n.agent.id)).toEqual(['a', 'd']);
    expect(tree[0]!.children[0]!.agent.id).toBe('b');
    expect(tree[0]!.children[0]!.children[0]!.agent.id).toBe('c');
  });

  it('treats an unknown parent, itself or a loop as the main agent\'s own', () => {
    const tree = buildSubagentTree([agent('a', { parentId: 'nope' }), agent('b', { parentId: 'b' }), agent('x', { parentId: 'y' }), agent('y', { parentId: 'x' })]);
    expect(tree.map((n) => n.agent.id)).toEqual(['a', 'b', 'y']);
    expect(tree[2]!.children.map((n) => n.agent.id)).toEqual(['x']);
  });
});

describe('countSubagents', () => {
  it('counts by status and depth', () => {
    const tree = buildSubagentTree([agent('a', { status: 'completed' }), agent('b', { parentId: 'a', status: 'failed' }), agent('c', { parentId: 'b' })]);
    expect(countSubagents(tree)).toEqual({ running: 1, completed: 1, failed: 1, total: 3, depth: 3 });
  });
});
