import { CLAUDE_SUBAGENT_MARKER } from './runner.ts';

export { CLAUDE_SUBAGENT_MARKER };

const COMMAND_KEYS = ['command', 'CommandLine', 'cmd', 'commandLine', 'toolSummary'];

/** Whether a tool call runs the somecode-claude command. */
export function isClaudeSubagentRun(title: string, rawInput: unknown): boolean {
  if (/^(?:run\s+|bash:?\s+|\$\s*)?somecode-claude(?:\s|$)/i.test(title.trim())) return true;
  if (typeof rawInput !== 'object' || rawInput === null) return false;
  const input = rawInput as Record<string, unknown>;
  return COMMAND_KEYS.some((key) => {
    const v = input[key];
    return typeof v === 'string' && /(?:^|[\s;&|(`'"])somecode-claude(?:\s|$)/i.test(v) && !/^(?:cat|less|head|tail|grep|rg|ls|which|type)\s/i.test(v.trim());
  });
}
