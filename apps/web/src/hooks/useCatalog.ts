import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ProjectGroup } from '../components/Sidebar.tsx';
import { ApiError, type AgentInfo, type Api } from '../lib/api.ts';

const codeOf = (err: unknown): string => (err instanceof ApiError ? err.code : 'internal');

/** Agents, and every project with its sessions; `reload` refetches the projects (e.g. after creating one). */
export function useCatalog(
  api: Api,
  onError: (code: string) => void,
): { agents: AgentInfo[]; groups: ProjectGroup[]; reload: () => void; reloadAgents: () => void } {
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

  /** Re-reads install/sign-in state (e.g. after the user signed in elsewhere); one request at a time. */
  const agentsInFlight = useRef(false);
  const alive = useRef(true);
  const reloadAgents = useCallback(() => {
    if (agentsInFlight.current) return;
    agentsInFlight.current = true;
    api
      .agents()
      .then((list) => {
        if (alive.current) setAgents(list);
      })
      .catch((err: unknown) => {
        if (alive.current) onErrorRef.current(codeOf(err));
      })
      .finally(() => {
        agentsInFlight.current = false;
      });
  }, [api]);

  useEffect(() => {
    alive.current = true;
    reloadAgents();
    // The usual sign-in path: run the command in a terminal, come back to this window.
    const refresh = () => {
      if (document.visibilityState !== 'hidden') reloadAgents();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    reload();
    return () => {
      alive.current = false;
      generation.current++;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [api, reload, reloadAgents]);

  return { agents, groups, reload, reloadAgents };
}
