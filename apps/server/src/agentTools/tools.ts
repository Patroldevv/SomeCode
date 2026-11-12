import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

type Call = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const failure = (error: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] });

/** A fetch client for SomeCode's own API; an error answer becomes the message the agent reads. */
export function apiClient(env: { url: string | undefined; token: string | undefined }): Call {
  return async (method, path, body) => {
    if (!env.url || !env.token) throw new Error('SomeCode is not reachable from here (no address or token).');
    const res = await fetch(`${env.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${env.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? `SomeCode answered ${res.status}`);
    return data;
  };
}

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

/**
 * Tools that give an agent what a person would have: a memory of past chats, notes about the project that outlive a
 * chat, and the means to schedule work for later. They talk to SomeCode's API as the chat they belong to.
 */
export function registerHomeTools(
  server: McpServer,
  call: Call,
  who: { sessionId: string | undefined; cwd: string },
  /** Which groups of tools to offer: history, memory, schedule, verify (all of them when left out). */
  groups: ReadonlySet<string> = new Set(['history', 'memory', 'schedule', 'verify']),
): void {
  const none = { registerTool: () => undefined } as unknown as McpServer;
  const on = (group: string): McpServer => (groups.has(group) ? server : none);
  const here = `sessionId=${encodeURIComponent(who.sessionId ?? '')}&cwd=${encodeURIComponent(who.cwd)}`;
  const run = async (body: () => Promise<string>) => {
    try {
      return text(await body());
    } catch (error) {
      return failure(error);
    }
  };

  on('history').registerTool(
    'history_search',
    {
      title: 'Search past chats',
      description:
        'Searches what the user and agents said in earlier chats (all words must appear). Use it when the user refers to something done before ("like last week", "the way we fixed X") or when you want to know how a problem was solved earlier. Returns matches with a chat id for history_read.',
      inputSchema: {
        query: z.string().min(2).describe('Words to look for.'),
        scope: z.enum(['project', 'all']).optional().describe('This project only (default) or every project.'),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    ({ query, scope, limit }) =>
      run(async () => {
        const data = await call('GET', `/api/search?q=${encodeURIComponent(query)}&scope=${scope ?? 'project'}&limit=${limit ?? 8}&${here}`);
        const hits = data.hits as { sessionId: string; kind: string; snippet: string; sessionTitle: string | null; projectName: string; agentId: string; createdAt: number }[];
        if (hits.length === 0) return 'Nothing found.';
        return hits.map((h) => `- chat ${h.sessionId} · ${h.projectName} · ${h.sessionTitle ?? '(untitled)'} · ${h.agentId} · ${when(h.createdAt)} · ${h.kind === 'user' ? 'user said' : 'agent said'}: ${h.snippet}`).join('\n');
      }),
  );

  on('history').registerTool(
    'history_read',
    {
      title: 'Read a past chat',
      description: 'Reads an earlier chat as plain text (the user\'s and the agent\'s messages and the tools used). Long chats come in pieces: pass afterSeq from the previous answer to continue.',
      inputSchema: { sessionId: z.string().describe('A chat id from history_search.'), afterSeq: z.number().int().min(0).optional() },
    },
    ({ sessionId, afterSeq }) =>
      run(async () => {
        const data = await call('GET', `/api/transcript/${encodeURIComponent(sessionId)}?maxChars=12000${afterSeq !== undefined ? `&afterSeq=${afterSeq}` : ''}`);
        return `${data.text || '(empty chat)'}${data.truncated ? `\n\n[continues: call again with afterSeq=${data.lastSeq}]` : ''}`;
      }),
  );

  on('memory').registerTool(
    'memory_list',
    { title: 'Project memory', description: 'The notes saved for this project (conventions, decisions, things to remember). They are also given to you at the start of a chat.', inputSchema: {} },
    () =>
      run(async () => {
        const data = await call('GET', `/api/memory?${here}`);
        const list = data.memories as { id: string; text: string }[];
        return list.length === 0 ? 'No notes yet.' : list.map((m) => `- [${m.id}] ${m.text}`).join('\n');
      }),
  );

  on('memory').registerTool(
    'memory_add',
    {
      title: 'Remember something',
      description:
        'Saves one short note for this project so that every later chat knows it: a convention ("tests use vitest"), a decision, a gotcha, a preference of the user. One fact per note, written to stand alone. Use it when the user says "remember", types /learn, or you learn something that will matter again. Do not save secrets or things that are already obvious from the code.',
      inputSchema: { note: z.string().min(3).max(600) },
    },
    ({ note }) =>
      run(async () => {
        const data = await call('POST', '/api/memory', { sessionId: who.sessionId, cwd: who.cwd, text: note });
        return data.duplicate ? 'That note already exists.' : `Saved (${data.memory.id}).`;
      }),
  );

  on('memory').registerTool(
    'memory_forget',
    { title: 'Forget a note', description: 'Removes a note by its id (from memory_list), for example when it is wrong or out of date.', inputSchema: { id: z.string() } },
    ({ id }) =>
      run(async () => {
        await call('DELETE', `/api/memory/${encodeURIComponent(id)}`);
        return 'Removed.';
      }),
  );

  on('verify').registerTool(
    'checks_get',
    {
      title: 'Project checks',
      description: 'The commands SomeCode runs to check this project after a turn that changed files (typecheck, lint, tests), whether that is on, how many automatic fix rounds there are, and what the folder suggests (from package.json, Cargo, Go, Python, Makefile files).',
      inputSchema: {},
    },
    () =>
      run(async () => {
        const data = await call('GET', `/api/checks?${here}`);
        const checks = data.config.checks as { name: string; command: string }[];
        const suggested = data.suggested as { name: string; command: string }[];
        return [
          `Project: ${data.project}. Checks are ${data.config.enabled ? 'on' : 'off'}; automatic fixing ${data.config.autoFix ? `on (up to ${data.config.maxFixes} rounds)` : 'off'}.`,
          checks.length === 0 ? 'No checks are set.' : `Set:\n${checks.map((c) => `- ${c.name}: ${c.command}`).join('\n')}`,
          suggested.length === 0 ? 'The folder suggests nothing.' : `Suggested from the folder:\n${suggested.map((c) => `- ${c.name}: ${c.command}`).join('\n')}`,
        ].join('\n');
      }),
  );

  on('verify').registerTool(
    'checks_propose',
    {
      title: 'Propose project checks',
      description:
        'Proposes the commands that should check this project after a change (typecheck, lint, tests; a build only when it is quick). The user sees them in the chat and approves or refuses: nothing runs unless they approve, and this call waits for the answer. Before proposing, look at the project (package.json, Makefile, CI files such as .github/workflows) and run each command once to see that it works and how long it takes: prefer commands that finish within a couple of minutes, and propose a fast subset of a slow suite. Do not propose commands that change anything (deploy, migrate, install, format --write).',
      inputSchema: {
        checks: z.array(z.object({ name: z.string().min(1).max(40), command: z.string().min(1).max(400) })).min(1).max(8),
        mode: z.enum(['add', 'replace']).optional().describe('Add to the existing checks (default) or replace them.'),
        reason: z.string().max(600).optional().describe('One or two sentences on why these commands.'),
      },
    },
    ({ checks, mode, reason }) =>
      run(async () => {
        const started = (await call('POST', '/api/checks/propose', { sessionId: who.sessionId, checks, mode: mode ?? 'add', ...(reason ? { reason } : {}) })) as { requestId: string };
        let state = 'pending';
        // The user may take a while: ask again until they answer (each request waits a little on the server).
        while (state === 'pending') {
          await new Promise((r) => setTimeout(r, 300));
          state = ((await call('GET', `/api/checks/propose/${started.requestId}?wait=20`)) as { state: string }).state;
        }
        return state === 'approved'
          ? 'The user approved: the checks are saved and will run after turns that change files. Do not run them again yourself unless asked.'
          : 'The user refused these checks. Do not propose them again; ask what they would like instead.';
      }),
  );

  on('schedule').registerTool(
    'schedule_create',
    {
      title: 'Schedule a task',
      description:
        'Schedules a prompt to run later in a new chat of this project, by the same kind of agent as this one: once at a time, every N minutes (at least 5), or every day at a time (local time). Give exactly one of once_at, every_minutes, daily_at. The prompt must stand alone: say what to do and what to report. Tell the user what you scheduled; they can pause or delete it in Settings.',
      inputSchema: {
        title: z.string().min(1).max(80),
        prompt: z.string().min(3).max(4000),
        once_at: z.string().optional().describe('A date and time, e.g. 2026-11-12T09:00 (local time).'),
        every_minutes: z.number().int().min(5).optional(),
        daily_at: z.string().optional().describe('HH:MM, local time.'),
      },
    },
    ({ title, prompt, once_at, every_minutes, daily_at }) =>
      run(async () => {
        const given = [once_at, every_minutes, daily_at].filter((v) => v !== undefined).length;
        if (given !== 1) throw new Error('give exactly one of once_at, every_minutes or daily_at');
        const spec = once_at !== undefined ? { kind: 'once', at: once_at } : every_minutes !== undefined ? { kind: 'every', minutes: every_minutes } : { kind: 'daily', at: daily_at };
        const data = await call('POST', '/api/tasks', { sessionId: who.sessionId, cwd: who.cwd, title, prompt, spec });
        return `Scheduled "${data.task.title}" (${data.task.when}); first run ${when(data.task.nextRun)}. Id: ${data.task.id}`;
      }),
  );

  on('schedule').registerTool(
    'schedule_list',
    { title: 'Scheduled tasks', description: 'The scheduled tasks: when each runs next and how often it has run.', inputSchema: {} },
    () =>
      run(async () => {
        const tasks = (await call('GET', '/api/tasks')).tasks as { id: string; title: string; project: string; when: string; enabled: boolean; nextRun: number | null; runs: number }[];
        return tasks.length === 0 ? 'Nothing scheduled.' : tasks.map((t) => `- [${t.id}] ${t.title} (${t.project}) · ${t.when} · ${t.enabled && t.nextRun ? `next ${when(t.nextRun)}` : 'not running'} · ran ${t.runs}×`).join('\n');
      }),
  );

  on('schedule').registerTool(
    'schedule_cancel',
    { title: 'Cancel a scheduled task', description: 'Deletes a scheduled task by its id (from schedule_list).', inputSchema: { id: z.string() } },
    ({ id }) =>
      run(async () => {
        await call('DELETE', `/api/tasks/${encodeURIComponent(id)}`);
        return 'Cancelled.';
      }),
  );
}
