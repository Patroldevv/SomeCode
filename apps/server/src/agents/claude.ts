import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { SomeCodeError } from '@somecode/protocol';
import { firstLine, runBounded } from './exec.ts';
import type { AgentDriver, AgentStatus } from './types.ts';

const require = createRequire(import.meta.url);
const SIGN_IN_HINT = 'claude auth login';
const INSTALL_HINT = 'npm install -g @anthropic-ai/claude-code';

/** The ACP adapter ships as a dependency; resolve it from there, never from PATH. */
function adapterEntry(): string | null {
  try {
    const pkg = require.resolve('@agentclientprotocol/claude-agent-acp/package.json');
    return join(dirname(pkg), 'dist', 'index.js');
  } catch {
    return null;
  }
}

async function authFromCli(env: NodeJS.ProcessEnv): Promise<AgentStatus['auth']> {
  const status = await runBounded('claude', ['auth', 'status', '--json'], env);
  if (!status.ok) return 'unknown';
  try {
    const parsed = JSON.parse(status.stdout) as { loggedIn?: unknown };
    if (parsed.loggedIn === true) return 'signed_in';
    if (parsed.loggedIn === false) return 'signed_out';
  } catch {
    // fall through: unreadable output means we cannot tell
  }
  return 'unknown';
}

/** `env` decides which PATH `claude` is resolved against (injectable for tests). */
export function createClaudeDriver(env: NodeJS.ProcessEnv = process.env): AgentDriver {
  return {
    id: 'claude',
    label: 'Claude',
    launch: () => {
      const entry = adapterEntry();
      if (!entry) throw new SomeCodeError('agent_not_installed', 'the Claude ACP adapter is not installed');
      return { command: process.execPath, args: [entry] };
    },
    detect: async (): Promise<AgentStatus> => {
      const version = await runBounded('claude', ['--version'], env);
      if (!version.ok || adapterEntry() === null) return { installed: false, installHint: INSTALL_HINT };
      const label = firstLine(version.stdout);
      return {
        installed: true,
        ...(label ? { version: label } : {}),
        auth: await authFromCli(env),
        signInHint: SIGN_IN_HINT,
      };
    },
  };
}

export const claudeDriver: AgentDriver = createClaudeDriver();
