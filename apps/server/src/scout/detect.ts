/** The phrase every scout prompt starts with; how a run is found among the agent's own conversations. */
export const SCOUT_MARKER = 'You are a fast Scout Subagent';

const COMMAND_KEYS = ['command', 'CommandLine', 'cmd', 'commandLine', 'toolSummary'];

/** Whether a tool call runs the scout command (not merely mentions it, as loading the scout skill does). */
export function isScoutRun(title: string, rawInput: unknown): boolean {
  if (/^(?:run\s+|bash:?\s+|\$\s*)?somecode-scout(?:\s|$)/i.test(title.trim())) return true;
  if (typeof rawInput !== 'object' || rawInput === null) return false;
  const input = rawInput as Record<string, unknown>;
  // The scout as a tool of its own (SomeCode's MCP server): a call named for the scout that carries a task.
  if (/scout/i.test(title) && typeof input['task'] === 'string') return true;
  return COMMAND_KEYS.some((key) => {
    const v = input[key];
    return typeof v === 'string' && /(?:^|[\s;&|(`'"])somecode-scout(?:\s|$)/i.test(v) && !/^(?:cat|less|head|tail|grep|rg|ls|which|type)\s/i.test(v.trim());
  });
}
