import type { ConfigOption } from '@somecode/protocol';
import type { ErrorCode } from '@somecode/protocol';

export type AgentLimit = { type: string; label?: string; used: number | null; resetsAt: number | null; status: string; updatedAt: number };
export type AgentUsage = {
  id: string;
  label: string;
  limits: AgentLimit[];
  /** Plain figures for an agent with no limit to show. */
  stats?: { key: string; value: number }[];
  error?: 'signed_out' | 'unavailable';
};
export type PluginInfo = {
  id: string;
  name: string;
  marketplace: string;
  description: string;
  category?: string;
  author?: string;
  homepage?: string;
  owner?: string;
  components?: { skills: number; commands: number; agents: number; hooks: boolean; mcp: boolean };
  installed: boolean;
  enabled?: boolean;
  version?: string;
};
export type ServiceInfo = {
  id: string;
  name: string;
  description: string;
  url: string;
  transport: 'http' | 'sse';
  owner?: string;
  category: string;
  /** Also takes an access token (an API key); without one it asks for a sign-in on first use. */
  token?: 'optional';
  connected: boolean;
  custom?: boolean;
};
export type SkillInfo = { agent: 'claude' | 'agy'; name: string; description: string; source: 'user' | 'plugin' | 'builtin'; removable: boolean; owner?: string };
export type PluginsOverview = { plugins: PluginInfo[]; skills: SkillInfo[] };
export type ServerSettings = { planAutoApprove: boolean; defaultApproval: 'ask' | 'auto' | 'full'; agentGuide: boolean };

export type AgentInfo = {
  id: string;
  label: string;
  installed: boolean;
  version?: string;
  /** `unknown` when the agent has no way to tell; a missing sign-in then shows up as an `auth_required` failure. */
  auth?: 'signed_in' | 'signed_out' | 'unknown';
  /** Fixed shell commands from the server, shown as text. */
  signInHint?: string;
  installHint?: string;
};
export type ProjectInfo = { id: string; name: string; path: string };
/** A session row as the server stores it (`createdAt` in ms since the epoch). */
export type SessionInfo = { id: string; projectId: string; agentId: string; createdAt: number; title: string | null };

/** A failed request, reduced to a code the UI can map to a message. */
export class ApiError extends Error {
  readonly code: ErrorCode | 'network';
  constructor(code: ErrorCode | 'network') {
    super(code);
    this.name = 'ApiError';
    this.code = code;
  }
}

export function createApi(token: string) {
  const icons = new Map<string, Promise<string | null>>();
  /** The last plugin lists, so the page can open on them at once while it asks again. */
  let lastPlugins: PluginsOverview | null = null;
  let lastServices: ServiceInfo[] = [];
  async function call<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, {
        method: init?.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(init ? { 'content-type': 'application/json' } : {}),
        },
        ...(init ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new ApiError('network');
    }
    if (!res.ok) {
      let code: ErrorCode = 'internal';
      try {
        const body = (await res.json()) as { error?: { code?: ErrorCode } };
        if (body.error?.code) code = body.error.code;
      } catch {
        // Non-JSON error body: keep the generic code.
      }
      throw new ApiError(code);
    }
    return (await res.json()) as T;
  }

    /** A plugin's logo as an object URL (null when it has none). The request needs the token, so an <img src> cannot fetch it. */
  const pluginIcon = (owner: string): Promise<string | null> => {
      let hit = icons.get(owner);
      if (!hit) {
        hit = fetch(`/api/plugins/icon/${encodeURIComponent(owner)}`, { headers: { authorization: `Bearer ${token}` } })
          .then(async (res) => (res.ok ? URL.createObjectURL(await res.blob()) : null))
          .catch(() => null);
        icons.set(owner, hit);
        // A logo that was not there is asked for again the next time (the server remembers a failure for a while).
        void hit.then((url) => url === null && icons.get(owner) === hit && icons.delete(owner));
      }
      return hit;
    };

  return {
    agents: () => call<AgentInfo[]>('/api/agents'),
    renameSession: (id: string, title: string) => call<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: { title } }),
    deleteSession: (id: string) => call<{ ok: true }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', body: undefined }),
    renameProject: (id: string, name: string) => call<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } }),
    deleteProject: (id: string) => call<{ ok: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE', body: undefined }),
    plugins: () => call<PluginsOverview>('/api/plugins').then((o) => (lastPlugins = o)),
    services: () => call<ServiceInfo[]>('/api/services').then((s) => (lastServices = s)),
    /** What the last plugins/services requests returned (null before the first one finished). */
    cachedPlugins: () => (lastPlugins ? { overview: lastPlugins, services: lastServices } : null),
    /** Ask for the lists and the first screen of logos in the background, before the page is opened. */
    prefetchPlugins: async (): Promise<void> => {
      const [overview, services] = await Promise.all([call<PluginsOverview>('/api/plugins'), call<ServiceInfo[]>('/api/services').catch(() => lastServices)]);
      lastPlugins = overview;
      lastServices = services;
      const owners = [
        ...overview.plugins.filter((p) => p.installed),
        ...overview.skills,
        ...services,
        ...overview.plugins,
      ].flatMap((x) => (x.owner ? [x.owner] : []));
      await Promise.all([...new Set(owners)].slice(0, 60).map((o) => pluginIcon(o)));
    },
    connectService: (input: { name: string; url: string; transport: string; token?: string }) => call<{ ok: true }>('/api/services', { method: 'POST', body: input }),
    disconnectService: (name: string) => call<{ ok: true }>(`/api/services/${encodeURIComponent(name)}`, { method: 'DELETE', body: undefined }),
    pluginIcon,
    pluginAction: (action: 'install' | 'uninstall' | 'enable' | 'disable', id: string) => call<{ ok: true }>(`/api/plugins/${action}`, { method: 'POST', body: { id } }),
    addSkill: (input: { agent: string; name: string; description: string; content: string }) => call<{ ok: true }>('/api/skills', { method: 'POST', body: input }),
    addSkillsFromGit: (agent: string, url: string) => call<{ added: string[] }>('/api/skills/git', { method: 'POST', body: { agent, url } }),
    removeSkill: (agent: string, name: string) => call<{ ok: true }>(`/api/skills/${encodeURIComponent(agent)}/${encodeURIComponent(name)}`, { method: 'DELETE', body: undefined }),
    /** What each agent last reported about its subscription limits. */
    usage: (refresh = false) => call<AgentUsage[]>(refresh ? '/api/usage?refresh=1' : '/api/usage'),
    /** Preferences the server acts on. */
    settings: () => call<ServerSettings>('/api/settings'),
    updateSettings: (patch: Partial<ServerSettings>) => call<ServerSettings>('/api/settings', { method: 'PUT', body: patch }),
    /** The model/mode/effort options the agent offers (empty when it cannot be asked), before any session exists. */
    agentOptions: (agentId: string, path: string) =>
      call<{ options: ConfigOption[] }>(`/api/agents/${encodeURIComponent(agentId)}/options?path=${encodeURIComponent(path)}`).then(
        (r) => r.options,
      ),
    projects: () => call<ProjectInfo[]>('/api/projects'),
    addProject: (name: string, path: string) =>
      call<ProjectInfo>('/api/projects', { method: 'POST', body: { name, path } }),
    /** The project's sessions, oldest first. */
    projectSessions: (projectId: string) =>
      call<SessionInfo[]>(`/api/projects/${encodeURIComponent(projectId)}/sessions`),
    createSession: (projectId: string, agentId: string) =>
      call<SessionInfo>('/api/sessions', { method: 'POST', body: { projectId, agentId } }),
  };
}

export type Api = ReturnType<typeof createApi>;
