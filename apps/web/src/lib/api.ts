import type { ErrorCode } from '@somecode/protocol';

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

  return {
    agents: () => call<AgentInfo[]>('/api/agents'),
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
