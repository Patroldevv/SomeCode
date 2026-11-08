import type { ConfigOption } from '@somecode/protocol';
import { runHandshake } from '../launcher/handshake.ts';
import type { AgentDriver } from './types.ts';

const TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 20_000;

/**
 * The model/mode/effort options an agent offers, learnt once with a prompt-free handshake (it starts the agent and
 * opens a session but sends no prompt, so it costs no quota) and remembered for a while. This is what lets the
 * new-chat screen offer a model before any session exists. Concurrent asks share one handshake; a failure is only
 * remembered briefly and yields no options.
 */
export function createOptionsProbe(handshake: typeof runHandshake = runHandshake, now: () => number = Date.now) {
  const cache = new Map<string, { at: number; ttl: number; options: ConfigOption[] }>();
  const inflight = new Map<string, Promise<ConfigOption[]>>();
  return {
    async options(driver: AgentDriver, cwd: string): Promise<ConfigOption[]> {
      const hit = cache.get(driver.id);
      if (hit && now() - hit.at < hit.ttl) return hit.options;
      const running = inflight.get(driver.id);
      if (running) return running;
      const run = handshake(driver, cwd, 25_000)
        .then((result) => {
          const options = result.ok ? (result.options ?? []) : [];
          cache.set(driver.id, { at: now(), ttl: result.ok ? TTL_MS : FAILURE_TTL_MS, options });
          return options;
        })
        .catch(() => {
          cache.set(driver.id, { at: now(), ttl: FAILURE_TTL_MS, options: [] });
          return [] as ConfigOption[];
        })
        .finally(() => inflight.delete(driver.id));
      inflight.set(driver.id, run);
      return run;
    },
  };
}

export type OptionsProbe = ReturnType<typeof createOptionsProbe>;
