import { firstLine, runBounded } from './exec.ts';
import type { AgentDriver } from './types.ts';

/** `env` decides which PATH `agy` is resolved against (injectable for tests). */
export function createAntigravityDriver(env: NodeJS.ProcessEnv = process.env): AgentDriver {
  return {
    id: 'agy',
    label: 'Antigravity',
    // Never add a permission-skipping flag here: approvals must reach the user.
    launch: () => ({ command: 'agy', args: ['acp'] }),
    detect: async () => {
      const version = await runBounded('agy', ['--version'], env);
      if (!version.ok) return { installed: false };
      const label = firstLine(version.stdout);
      // No status command exists: a missing sign-in surfaces as `auth_required` when a session starts.
      return { installed: true, ...(label ? { version: label } : {}), auth: 'unknown' as const };
    },
  };
}

export const antigravityDriver: AgentDriver = createAntigravityDriver();
