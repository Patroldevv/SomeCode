import { antigravityDriver } from './antigravity.ts';
import { claudeDriver } from './claude.ts';
import { openCodeDriver } from './opencode.ts';
import type { AgentDriver, AgentStatus } from './types.ts';

export type AgentRegistry = {
  list(): AgentDriver[];
  get(id: string): AgentDriver | undefined;
  statuses(): Promise<Array<{ id: string; label: string } & AgentStatus>>;
};

export function createRegistry(drivers: AgentDriver[]): AgentRegistry {
  const byId = new Map<string, AgentDriver>();
  for (const driver of drivers) {
    if (byId.has(driver.id)) throw new Error(`Duplicate agent driver id: ${driver.id}`);
    byId.set(driver.id, driver);
  }
  const ordered = [...drivers];
  return {
    list: () => [...ordered],
    get: (id) => byId.get(id),
    statuses: () =>
      Promise.all(
        ordered.map(async (driver) => {
          // One broken driver must not fail the whole listing.
          const status = await driver.detect().catch((): AgentStatus => ({ installed: false }));
          return { id: driver.id, label: driver.label, ...status };
        }),
      ),
  };
}

export function defaultRegistry(): AgentRegistry {
  return createRegistry([claudeDriver, openCodeDriver, antigravityDriver]);
}
