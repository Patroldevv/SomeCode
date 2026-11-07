import { fileURLToPath } from 'node:url';
import type { AgentDriver } from '../src/agents/types.ts';

const FAKE_AGENT = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));

/** An installed driver that launches the scripted fake ACP agent with the given scenario. */
export function fakeDriver(scenario: string, id = 'fake'): AgentDriver {
  return {
    id,
    label: 'Fake agent',
    launch: () => ({ command: process.execPath, args: [FAKE_AGENT], env: { FAKE_SCENARIO: scenario } }),
    detect: async () => ({ installed: true, version: '0' }),
  };
}
