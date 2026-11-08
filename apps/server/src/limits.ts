import type { Store } from './store/store.ts';

/** One usage window of an agent's subscription (Claude: `five_hour`, `seven_day`, ...), as the agent last reported it. */
export type LimitEntry = {
  /** The agent's own name for the window. */
  type: string;
  /** What the window is about when the agent has several groups ("Gemini Models"). */
  label?: string;
  /** How much of the window is used, 0..1; null when the report carried no figure. */
  used: number | null;
  /** When the window renews (ms since the epoch); null when unknown. */
  resetsAt: number | null;
  status: string;
  /** When the agent told us (ms since the epoch). */
  updatedAt: number;
};

const key = (agentId: string) => `limits:${agentId}`;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads a rate-limit report as the Claude SDK sends it (`rateLimitType`, `utilization`, `resetsAt`, `status`).
 * `utilization` is taken as a fraction up to 1 and as a percentage above it; `resetsAt` as seconds or milliseconds.
 * Anything that does not name a window is ignored: we only keep what an agent really told us.
 */
export function parseRateLimit(info: unknown, now = Date.now()): LimitEntry | null {
  if (!isRecord(info) || typeof info['rateLimitType'] !== 'string') return null;
  const u = info['utilization'];
  const used = typeof u === 'number' && Number.isFinite(u) && u >= 0 ? Math.min(1, u > 1 ? u / 100 : u) : null;
  const r = info['resetsAt'];
  const resetsAt = typeof r === 'number' && Number.isFinite(r) && r > 0 ? (r < 1e12 ? r * 1000 : r) : null;
  return { type: info['rateLimitType'], used, resetsAt, status: typeof info['status'] === 'string' ? info['status'] : 'allowed', updatedAt: now };
}

export function readLimits(store: Pick<Store, 'getSetting'>, agentId: string): LimitEntry[] {
  try {
    const raw = JSON.parse(store.getSetting(key(agentId)) ?? '{}') as unknown;
    return isRecord(raw) ? (Object.values(raw).filter((e) => isRecord(e) && typeof e['type'] === 'string') as LimitEntry[]) : [];
  } catch {
    return [];
  }
}

/** Keeps the newest report per window; a report with no usable window is dropped. */
export function recordRateLimit(store: Pick<Store, 'getSetting' | 'setSetting'>, agentId: string, info: unknown, now = Date.now()): void {
  const entry = parseRateLimit(info, now);
  if (!entry) return;
  const all = Object.fromEntries(readLimits(store, agentId).map((e) => [e.type, e]));
  // A report without a figure keeps the figure we already had for the window.
  const before = all[entry.type];
  all[entry.type] = { ...entry, used: entry.used ?? before?.used ?? null, resetsAt: entry.resetsAt ?? before?.resetsAt ?? null };
  store.setSetting(key(agentId), JSON.stringify(all));
}
