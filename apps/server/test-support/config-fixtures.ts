// Real `configOptions` shapes returned by `session/new` (probed 2026-11-08, handshake only), trimmed.
import type { SessionConfigOption } from '@agentclientprotocol/sdk';

const select = (
  id: string,
  name: string,
  category: string | undefined,
  currentValue: string,
  values: string[],
): SessionConfigOption =>
  ({
    id,
    name,
    type: 'select',
    ...(category ? { category } : {}),
    currentValue,
    options: values.map((value) => ({ value, name: value })),
  }) as unknown as SessionConfigOption;

/** `@agentclientprotocol/claude-agent-acp` 0.101.0 */
export const CLAUDE_OPTIONS: SessionConfigOption[] = [
  select('mode', 'Mode', 'mode', 'auto', ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']),
  select('model', 'Model', 'model', 'sonnet', ['default', 'opus', 'sonnet', 'fable', 'haiku']),
  select('effort', 'Effort', 'thought_level', 'high', ['default', 'low', 'medium', 'high', 'xhigh', 'max']),
  select('agent', 'Agent', undefined, 'default', ['default', 'claude-code-guide']),
];

/** `agy acp` 1.5.3 */
export const AGY_OPTIONS: SessionConfigOption[] = [
  select('model', 'Model', 'model', 'gemini-4-argon', ['gemini-4-argon', 'gemini-3.8-flash', 'claude-opus-5-5']),
  select('thought_level', 'Thinking Level', 'thought_level', 'medium', ['low', 'medium', 'high']),
  select('mode', 'Mode', 'mode', 'default', ['default', 'accept-edits', 'plan']),
];
