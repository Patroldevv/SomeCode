export type ClaudeToolCallEvent = {
  id: string;
  name: string;
  title: string;
  kind: 'read' | 'edit' | 'execute' | 'search' | 'think' | 'other';
  rawInput?: unknown;
  status: 'in_progress' | 'completed' | 'failed';
  content?: Array<{ type: 'text'; text: string }>;
};

export type ClaudeSubagentQuery = {
  /** The reasoning, analysis, or coding task for the Claude subagent. */
  task: string;
  /** Working directory (defaults to process.cwd()). */
  cwd?: string;
  /** Model to run; e.g. 'sonnet', 'opus', 'haiku'. */
  model?: string;
  /** Effort level: 'default', 'low', 'medium', 'high', 'xhigh', 'max'. */
  effort?: string;
  /** Timeout in ms; defaults to 180,000 (3 minutes). */
  timeoutMs?: number;
  /** Target files to inspect or modify. */
  files?: string[];
  /** Session ID when running within a SomeCode session. */
  sessionId?: string;
  /** Parent tool call ID in the primary session. */
  parentToolCallId?: string;
  /** Live callback whenever Claude invokes or finishes a tool call. */
  onToolCall?: (event: ClaudeToolCallEvent) => void;
  /** Live callback for streaming assistant text chunks. */
  onTextChunk?: (chunk: string) => void;
};

export type ClaudeSubagentResult = {
  ok: boolean;
  output: string;
  model: string;
  durationMs: number;
  error?: string;
};
