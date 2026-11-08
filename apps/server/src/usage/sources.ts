import type { LimitEntry } from '../limits.ts';

/** What one agent can tell about its usage right now: subscription windows, plain figures, or why it cannot. */
export type AgentUsageReport = {
  limits: LimitEntry[];
  /** Plain numbers where there is no limit to show (OpenCode has none), keyed for the UI to word. */
  stats?: { key: string; value: number }[];
  /** `signed_out`: the agent's login is missing or has run out; `unavailable`: it could not be asked. */
  error?: 'signed_out' | 'unavailable';
};

export type Run = (command: string, args: string[], timeoutMs: number) => Promise<string>;
export type Sources = {
  fetch: typeof fetch;
  readFile: (path: string) => Promise<string>;
  run: Run;
  home: string;
  now: () => number;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
/** The windows of a Claude subscription worth showing (the usage reply has many more, mostly empty). */
const CLAUDE_WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const;

/**
 * Claude's real limits, from the usage service the Claude app itself uses. It is asked with the login Claude already
 * keeps in `~/.claude/.credentials.json`: that token is read only to make this one request to Anthropic, is never
 * logged and never leaves this function. A login that has run out is reported, not refreshed (Claude does that
 * itself the next time it runs).
 */
export async function claudeUsage(s: Sources): Promise<AgentUsageReport> {
  let token: string;
  try {
    const raw = JSON.parse(await s.readFile(`${s.home}/.claude/.credentials.json`)) as unknown;
    const oauth = isRecord(raw) && isRecord(raw['claudeAiOauth']) ? raw['claudeAiOauth'] : null;
    if (!oauth || typeof oauth['accessToken'] !== 'string') return { limits: [], error: 'signed_out' };
    if (typeof oauth['expiresAt'] === 'number' && oauth['expiresAt'] < s.now()) return { limits: [], error: 'signed_out' };
    token = oauth['accessToken'];
  } catch {
    return { limits: [], error: 'signed_out' };
  }
  try {
    const res = await s.fetch(CLAUDE_USAGE_URL, {
      headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'user-agent': 'somecode' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) return { limits: [], error: 'signed_out' };
    if (!res.ok) return { limits: [], error: 'unavailable' };
    const body = (await res.json()) as unknown;
    if (!isRecord(body)) return { limits: [], error: 'unavailable' };
    const limits: LimitEntry[] = [];
    for (const type of CLAUDE_WINDOWS) {
      const w = body[type];
      if (!isRecord(w) || typeof w['utilization'] !== 'number') continue;
      const reset = typeof w['resets_at'] === 'string' ? Date.parse(w['resets_at']) : NaN;
      limits.push({
        type,
        used: Math.min(1, Math.max(0, w['utilization'] / 100)),
        resetsAt: Number.isFinite(reset) ? reset : null,
        status: 'allowed',
        updatedAt: s.now(),
      });
    }
    return { limits };
  } catch {
    return { limits: [], error: 'unavailable' };
  }
}

/** agy prints its quotas for `/usage`: tab-separated "<group>, <name>, <percent remaining>%, <renews at>". */
export async function antigravityUsage(s: Sources): Promise<AgentUsageReport> {
  let out: string;
  try {
    out = await s.run('agy', ['-p', '/usage'], 30_000);
  } catch {
    return { limits: [], error: 'unavailable' };
  }
  const limits: LimitEntry[] = [];
  for (const line of out.split('\n')) {
    const [group, name, left, renews] = line.split('\t').map((p) => p.trim());
    const percent = left ? /^(\d+(?:\.\d+)?)%$/.exec(left) : null;
    if (!group || !name || !percent) continue;
    const reset = renews ? Date.parse(renews) : NaN;
    const five = /five hour/i.test(name);
    const weekly = /weekly/i.test(name);
    // "Gemini Models / Five Hour Limit Remaining" is the group's own window; "Gemini 4 Argon / Gemini 4 Argon Weekly Limit" a model's.
    const window = five ? 'five_hour' : weekly ? 'seven_day' : name;
    limits.push({
      type: `${group}|${window}`,
      label: group,
      used: Math.min(1, Math.max(0, 1 - Number(percent[1]) / 100)),
      resetsAt: Number.isFinite(reset) ? reset : null,
      status: 'allowed',
      updatedAt: s.now(),
    });
  }
  return limits.length > 0 ? { limits } : { limits: [], error: 'unavailable' };
}

/** OpenCode has no subscription to run out of here (its models are free or billed by the provider): its own usage stats instead. */
export async function openCodeUsage(s: Sources): Promise<AgentUsageReport> {
  try {
    const stats = JSON.parse(await s.run('opencode', ['stats', '--days', '7', '--json'], 30_000)) as unknown;
    if (!isRecord(stats)) return { limits: [], error: 'unavailable' };
    const tokens = isRecord(stats['tokens']) ? stats['tokens'] : {};
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const cache = isRecord(tokens['cache']) ? tokens['cache'] : {};
    const total = num(tokens['input']) + num(tokens['output']) + num(tokens['reasoning']) + num(cache['read']) + num(cache['write']);
    return { limits: [], stats: [{ key: 'prompts7d', value: num(stats['prompts']) }, { key: 'tokens7d', value: total }] };
  } catch {
    return { limits: [], error: 'unavailable' };
  }
}
