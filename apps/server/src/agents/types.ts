/** How to spawn an ACP agent process speaking JSON-RPC over stdio. */
export type AgentLaunch = {
  command: string;
  args: string[];
  /** Extra variables merged over the server's own environment. */
  env?: Record<string, string>;
};

export type AgentStatus = {
  installed: boolean;
  version?: string;
};

export interface AgentDriver {
  id: string;
  label: string;
  launch(): AgentLaunch;
  detect(): Promise<AgentStatus>;
}
