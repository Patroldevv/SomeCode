import { firstLine, runBounded } from './exec.ts';
import type { AgentDriver } from './types.ts';

/** `env` decides which PATH `opencode` is resolved against (injectable for tests). */
export function createOpenCodeDriver(env: NodeJS.ProcessEnv = process.env): AgentDriver {
  return {
    id: 'opencode',
    label: 'OpenCode',
    launch: () => ({ command: 'opencode', args: ['acp'] }),
    detect: async () => {
      const version = await runBounded('opencode', ['--version'], env);
      if (!version.ok) return { installed: false };
      const label = firstLine(version.stdout);
      return {
        installed: true,
        ...(label ? { version: label } : {}),
        auth: 'unknown' as const,
        signInHint: 'opencode acp --login',
      };
    },
  };
}

export const openCodeDriver: AgentDriver = createOpenCodeDriver();
