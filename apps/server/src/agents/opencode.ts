import { execFile } from 'node:child_process';
import type { AgentDriver, AgentStatus } from './types.ts';

const DETECT_TIMEOUT_MS = 5_000;

function runVersion(command: string, env: NodeJS.ProcessEnv): Promise<AgentStatus> {
  return new Promise((resolve) => {
    execFile(command, ['--version'], { timeout: DETECT_TIMEOUT_MS, env }, (error, stdout) => {
      // Spawn failure (e.g. ENOENT), non-zero exit and timeout all mean "not usable".
      if (error) {
        resolve({ installed: false });
        return;
      }
      const version = String(stdout)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      resolve(version === undefined ? { installed: true } : { installed: true, version });
    });
  });
}

/** `env` decides which PATH `opencode` is resolved against (injectable for tests). */
export function createOpenCodeDriver(env: NodeJS.ProcessEnv = process.env): AgentDriver {
  return {
    id: 'opencode',
    label: 'OpenCode',
    launch: () => ({ command: 'opencode', args: ['acp'] }),
    detect: () => runVersion('opencode', env),
  };
}

export const openCodeDriver: AgentDriver = createOpenCodeDriver();
