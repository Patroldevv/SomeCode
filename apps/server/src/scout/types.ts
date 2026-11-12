export type ScoutQuery = {
  /** The exploration, search or analysis prompt for the scout subagent. */
  task: string;
  /** Working directory (defaults to process.cwd()). */
  cwd?: string;
  /** Model to run; defaults to 'gemini-3.8-flash'. */
  model?: string;
  /** Reasoning effort (low|medium|high|xhigh|max); the agent's own when absent. */
  effort?: string;
  /** Timeout in ms; defaults to 180,000 (3 minutes). */
  timeoutMs?: number;
  /** Specific files to inspect and analyze. */
  files?: string[];
};

export type ScoutResult = {
  ok: boolean;
  output: string;
  model: string;
  durationMs: number;
  error?: string;
};
