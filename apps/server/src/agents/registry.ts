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
        ordered.map(async (driver) => ({
          id: driver.id,
          label: driver.label,
          ...(await driver.detect()),
        })),
      ),
  };
}

export function defaultRegistry(): AgentRegistry {
  return createRegistry([openCodeDriver]);
}
