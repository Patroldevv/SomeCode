/** How to spawn an ACP agent process speaking JSON-RPC over stdio. */
export type AgentLaunch = {
  command: string;
  args: string[];
  /** Extra variables merged over the server's own environment. */
  env?: Record<string, string>;
};

export type AgentAuth = 'signed_in' | 'signed_out' | 'unknown';

export type AgentStatus = {
  installed: boolean;
  version?: string;
  /** `unknown` when the agent has no cheap way to tell; a failed sign-in then shows up as `auth_required`. */
  auth?: AgentAuth;
  /** Fixed shell commands shown to the user (never built from user input). */
  signInHint?: string;
  installHint?: string;
};

export interface AgentDriver {
  id: string;
  label: string;
  launch(): AgentLaunch;
  detect(): Promise<AgentStatus>;
}
