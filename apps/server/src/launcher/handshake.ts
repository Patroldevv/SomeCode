import { SomeCodeError, type ConfigOption, type NormalizedEvent } from '@somecode/protocol';
import { AcpSession, type AgentInfo } from '../acp/session.ts';
import type { AgentDriver } from '../agents/types.ts';

export type HandshakeResult = {
  ok: boolean;
  agentInfo?: AgentInfo['agentInfo'];
  authMethods?: AgentInfo['authMethods'];
  loadSession?: boolean;
  options?: ConfigOption[];
  error?: { code: string; message: string };
};

/**
 * Starts the agent, runs `initialize` + `session/new` and closes it again. It never sends a prompt,
 * so it costs no model quota; use it to check that an agent is wired up and signed in.
 */
export async function runHandshake(driver: AgentDriver, cwd: string, timeoutMs = 30_000): Promise<HandshakeResult> {
  const events: NormalizedEvent[] = [];
  let session: AcpSession;
  try {
    session = await AcpSession.start({ driver, cwd, onEvent: (e) => events.push(e), timeoutMs });
  } catch (err) {
    const code = err instanceof SomeCodeError ? err.code : 'internal';
    return { ok: false, error: { code, message: err instanceof Error ? err.message : String(err) } };
  }
  try {
    const last = events.findLast((e) => e.type === 'config_options');
    return {
      ok: true,
      ...(session.info.agentInfo ? { agentInfo: session.info.agentInfo } : {}),
      authMethods: session.info.authMethods,
      loadSession: session.info.loadSession,
      options: last?.type === 'config_options' ? last.options : [],
    };
  } finally {
    await session.close();
  }
}
