import type { SessionHistoryPage } from "@somecode/protocol";
import { ApiError } from "./api.ts";
export type Folder = {
  path: string;
  parent: string | null;
  entries: { name: string; path: string }[];
};
export type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};
export type FilePreview = { path: string; text: string; truncated: boolean };
export function createWorkspaceApi(token: string) {
  async function call<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError("network");
    }
    if (!res.ok) {
      let code = "internal";
      try {
        code = (await res.json()).error.code;
      } catch {}
      throw new ApiError(code as ConstructorParameters<typeof ApiError>[0]);
    }
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }
  return {
    folders: (path?: string) =>
      call<Folder>(
        `/api/folders${path ? `?path=${encodeURIComponent(path)}` : ""}`,
      ),
    files: (id: string, path = "") =>
      call<{ entries: FileEntry[] }>(
        `/api/projects/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`,
      ),
    file: (id: string, path: string) =>
      call<FilePreview>(
        `/api/projects/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`,
      ),
    search: (id: string, q: string) =>
      call<{ paths: string[] }>(
        `/api/projects/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`,
      ),
    login: (agentId: string) =>
      call<{ id: string }>(
        `/api/agents/${encodeURIComponent(agentId)}/login`,
        "POST",
        {},
      ),
    terminal: (id: string, agentId?: string) =>
      call<{ id: string }>(
        `/api/projects/${encodeURIComponent(id)}/terminals`,
        "POST",
        agentId ? { agentId } : {},
      ),
    output: (id: string, after: number) =>
      call<{
        output: string;
        cursor: number;
        exited: boolean;
        exitCode: number | null;
        truncated: boolean;
      }>(`/api/terminals/${encodeURIComponent(id)}?after=${after}`),
    input: (id: string, data: string) =>
      call<void>(`/api/terminals/${encodeURIComponent(id)}/input`, "POST", {
        data,
      }),
    resize: (id: string, cols: number, rows: number) =>
      call<void>(`/api/terminals/${encodeURIComponent(id)}/resize`, "POST", {
        cols,
        rows,
      }),
    closeTerminal: (id: string) =>
      call<void>(`/api/terminals/${encodeURIComponent(id)}`, "DELETE"),
    history: (id: string, beforeSeq?: number) =>
      call<SessionHistoryPage>(
        `/api/sessions/${encodeURIComponent(id)}/history${beforeSeq !== undefined ? `?beforeSeq=${beforeSeq}` : ""}`,
      ),
    resume: (id: string) =>
      call<unknown>(
        `/api/sessions/${encodeURIComponent(id)}/resume`,
        "POST",
        {},
      ),
    rewindSession: (sessionId: string, beforeSeq: number) =>
      call<{ ok: boolean }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/rewind`,
        "POST",
        { beforeSeq },
      ),
    revert: (id: string, req?: { files?: Array<{ path: string; content?: string | null }>; paths?: string[] }) =>
      call<{ ok: boolean; reverted: string[] }>(
        `/api/projects/${encodeURIComponent(id)}/revert`,
        "POST",
        req ?? {},
      ),
  };
}
export type WorkspaceApi = ReturnType<typeof createWorkspaceApi>;
