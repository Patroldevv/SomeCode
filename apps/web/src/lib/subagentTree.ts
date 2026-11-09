import type { Subagent } from './subagents.ts';

export type SubagentNode = { agent: Subagent; children: SubagentNode[] };

/**
 * The sub-agents as a tree: one that names a parent (another sub-agent in the list) hangs under it, the rest hang
 * under the main agent. The order of the list is kept at every level.
 */
export function buildSubagentTree(agents: readonly Subagent[]): SubagentNode[] {
  const nodes = new Map<string, SubagentNode>(agents.map((agent) => [agent.id, { agent, children: [] }]));
  const roots: SubagentNode[] = [];
  for (const agent of agents) {
    const node = nodes.get(agent.id)!;
    const parent = agent.parentId !== undefined && agent.parentId !== agent.id ? nodes.get(agent.parentId) : undefined;
    // A parent that is itself below this node would make a loop: treat that one as a root.
    if (parent && !isBelow(parent, node)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function isBelow(candidate: SubagentNode, ancestor: SubagentNode): boolean {
  return ancestor.children.some((child) => child === candidate || isBelow(candidate, child));
}

export type SubagentCounts = { running: number; completed: number; failed: number; total: number; depth: number };

export function countSubagents(roots: readonly SubagentNode[]): SubagentCounts {
  const counts: SubagentCounts = { running: 0, completed: 0, failed: 0, total: 0, depth: 0 };
  const visit = (nodes: readonly SubagentNode[], depth: number) => {
    for (const node of nodes) {
      counts[node.agent.status] += 1;
      counts.total += 1;
      counts.depth = Math.max(counts.depth, depth);
      visit(node.children, depth + 1);
    }
  };
  visit(roots, 1);
  return counts;
}
