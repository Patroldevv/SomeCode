import type { SessionState } from '@somecode/protocol';
import type { AgentLimit, AgentUsage } from './api.ts';

/** What changed in a chat that the user may want to hear about. */
export type AttentionKind = 'done' | 'ask' | 'error';

/** The parts of a chat's state that tell these things apart. */
export type AttentionSnapshot = { running: boolean; ask: string | null; error: string | null; loaded: boolean };

export function attentionSnapshot(state: SessionState): AttentionSnapshot {
  const last = state.items[state.items.length - 1];
  const pending = [...state.items].reverse().find((i) => i.kind === 'permission' && !i.resolved);
  return {
    running: state.status === 'running',
    ask: pending?.key ?? null,
    error: last?.kind === 'error' ? last.key : null,
    // The first state a chat shows is the replay of its history, not something that just happened.
    loaded: state.lastSeq > 0,
  };
}

/** What happened between two snapshots of the same chat (nothing for the first one, and nothing for a replay). */
export function attentionBetween(prev: AttentionSnapshot | undefined, next: AttentionSnapshot): AttentionKind | null {
  if (!prev || !prev.loaded) return null;
  if (next.ask && next.ask !== prev.ask) return 'ask';
  if (next.error && next.error !== prev.error) return 'error';
  if (prev.running && !next.running && !next.ask) return 'done';
  return null;
}

export type LowLimit = { key: string; agent: string; limit: AgentLimit; left: number };

/** Limits at or below `threshold` that were not announced yet; the announced ones are remembered in `seen`. */
export function lowLimits(usage: AgentUsage[], seen: Set<string>, now = Date.now(), threshold = 0.1): LowLimit[] {
  const found: LowLimit[] = [];
  for (const agent of usage) {
    for (const limit of agent.limits) {
      if (limit.used === null || (limit.resetsAt !== null && limit.resetsAt < now)) continue;
      const left = 1 - limit.used;
      const key = `${agent.id}:${limit.type}:${limit.resetsAt ?? ''}`;
      if (left > threshold) {
        // Back above the line (the window renewed): announce again next time it drops.
        seen.delete(key);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ key, agent: agent.label, limit, left: Math.max(0, Math.round(left * 100)) });
    }
  }
  return found;
}
