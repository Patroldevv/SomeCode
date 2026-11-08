import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { readLimits } from '../limits.ts';
import type { Store } from '../store/store.ts';
import { antigravityUsage, claudeUsage, openCodeUsage, type AgentUsageReport, type Run, type Sources } from './sources.ts';

/** How long an answer is reused: asking an agent CLI is slow, and a limit does not move by the second. */
const TTL_MS = 60_000;

const realRun: Run = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, cwd: tmpdir(), maxBuffer: 1 << 20, env: process.env }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });

export const realSources = (): Sources => ({
  fetch: globalThis.fetch.bind(globalThis),
  readFile: (path) => readFile(path, 'utf8'),
  run: realRun,
  home: homedir(),
  now: Date.now,
});

const ASK: Record<string, (s: Sources) => Promise<AgentUsageReport>> = {
  claude: claudeUsage,
  agy: antigravityUsage,
  opencode: openCodeUsage,
};

/**
 * The live usage of every agent, each asked in the way that agent offers (see `sources.ts`), remembered for a minute.
 * When an agent cannot be asked right now, the last limits it reported while working (if any) stand in.
 */
export function createUsageService(store: Pick<Store, 'getSetting'>, sources: Sources = realSources()) {
  const cache = new Map<string, { at: number; report: AgentUsageReport }>();
  const inflight = new Map<string, Promise<AgentUsageReport>>();

  const report = async (agentId: string, refresh: boolean): Promise<AgentUsageReport> => {
    const hit = cache.get(agentId);
    if (!refresh && hit && sources.now() - hit.at < TTL_MS) return hit.report;
    const running = inflight.get(agentId);
    if (running) return running;
    const ask = ASK[agentId];
    // An agent with no way of being asked shows what it reported while working, if anything.
    const run = (ask ? ask(sources) : Promise.resolve<AgentUsageReport>({ limits: readLimits(store, agentId) }))
      .catch((): AgentUsageReport => ({ limits: [], error: 'unavailable' }))
      .then((r) => {
        const withFallback: AgentUsageReport = r.limits.length === 0 && r.error ? { ...r, limits: readLimits(store, agentId) } : r;
        cache.set(agentId, { at: sources.now(), report: withFallback });
        return withFallback;
      })
      .finally(() => inflight.delete(agentId));
    inflight.set(agentId, run);
    return run;
  };

  return {
    async all(agents: { id: string; label: string }[], refresh = false) {
      return Promise.all(agents.map(async (a) => ({ id: a.id, label: a.label, ...(await report(a.id, refresh)) })));
    },
  };
}
export type UsageService = ReturnType<typeof createUsageService>;
