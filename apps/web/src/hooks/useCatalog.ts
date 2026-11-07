import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectGroup } from '../components/Sidebar.tsx';
import { ApiError, type AgentInfo, type Api } from '../lib/api.ts';

const codeOf = (err: unknown): string => (err instanceof ApiError ? err.code : 'internal');

/** Agents, and every project with its sessions; `reload` refetches the projects (e.g. after creating one). */
export function useCatalog(
  api: Api,
  onError: (code: string) => void,
): { agents: AgentInfo[]; groups: ProjectGroup[]; reload: () => void } {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const onErrorRef = useRef(onError);
  useLayoutEffect(() => {
    onErrorRef.current = onError;
  });
  /** Only the latest reload may write its result, so a slow earlier response never wins. */
  const generation = useRef(0);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    void (async () => {
      try {
        const projects = await api.projects();
        const sessions = await Promise.all(projects.map((p) => api.projectSessions(p.id)));
        if (mine === generation.current) {
          setGroups(projects.map((project, i) => ({ project, sessions: sessions[i] ?? [] })));
        }
      } catch (err) {
        if (mine === generation.current) onErrorRef.current(codeOf(err));
      }
    })();
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api
      .agents()
      .then((list) => {
        if (!cancelled) setAgents(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) onErrorRef.current(codeOf(err));
      });
    reload();
    return () => {
      cancelled = true;
      generation.current++;
    };
  }, [api, reload]);

  return { agents, groups, reload };
}
