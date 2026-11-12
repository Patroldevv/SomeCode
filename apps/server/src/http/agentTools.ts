import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, isAbsolute, resolve, sep } from 'node:path';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { SomeCodeError } from '@somecode/protocol';
import type { Scheduler } from '../scheduler/scheduler.ts';
import type { SessionManager } from '../sessions/manager.ts';
import { zip } from './zip.ts';
import { readVerify, suggestChecks, verifyConfigSchema, writeVerify } from '../verify/config.ts';
import { describeSpec, firstRun, parseSpec } from '../store/schedule.ts';
import type { Project, Store } from '../store/store.ts';
import { describeIssues } from './errors.ts';

const MAX_MEMORIES = 60;
const MAX_MEMORY_CHARS = 600;
const MAX_TASKS = 30;

async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(await c.req.text());
  } catch {
    throw new SomeCodeError('bad_request', 'request body must be valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new SomeCodeError('bad_request', describeIssues(parsed.error));
  return parsed.data;
}

const real = (path: string): string => {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
};

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/**
 * An image file an agent mentioned in its answer (Antigravity saves its screenshots under its own folder and writes the
 * path), if it is a picture in a place agents work in: a project folder, an agent's own folder or the temp folder.
 */
export function readAgentImage(projects: readonly Project[], raw: string): { bytes: Buffer; type: string } {
  const path = raw.startsWith('file://') ? decodeURIComponent(raw.slice('file://'.length)) : raw;
  const type = IMAGE_TYPES[extname(path).toLowerCase()];
  if (!type || !isAbsolute(path) || path.includes('\0')) throw new SomeCodeError('bad_request', 'not an image path');
  let file: string;
  try {
    file = realpathSync(path);
  } catch {
    throw new SomeCodeError('not_found', 'no such image');
  }
  const home = real(homedir());
  const roots = [...projects.map((p) => real(p.path)), `${home}${sep}.gemini`, `${home}${sep}.claude`, `${home}${sep}.config${sep}opencode`, real(tmpdir())];
  if (!roots.some((root) => file === root || file.startsWith(root.endsWith(sep) ? root : root + sep))) throw new SomeCodeError('forbidden', 'that image is outside the places agents work in');
  if (!statSync(file).isFile() || statSync(file).size > MAX_IMAGE_BYTES) throw new SomeCodeError('bad_request', 'image too large');
  return { bytes: readFileSync(file), type };
}

/** The project a folder belongs to: the one whose path is the folder or the closest one above it. */
export function projectOfFolder(projects: readonly Project[], folder: string): Project | undefined {
  const dir = real(folder);
  let best: Project | undefined;
  for (const p of projects) {
    const root = real(p.path);
    if ((dir === root || dir.startsWith(root.endsWith(sep) ? root : root + sep)) && (!best || root.length > real(best.path).length)) best = p;
  }
  return best;
}

/**
 * What agents (through SomeCode's MCP server) and the Settings page use to look things up and set things up: search
 * of past chats, project memory and scheduled tasks. A project is named by `projectId`, by the `sessionId` of the chat
 * that is asking or by the `cwd` the agent works in.
 */
export function mountAgentToolRoutes(app: Hono, deps: { store: Store; manager?: Pick<SessionManager, 'proposeResearchPlan' | 'researchPlanState' | 'researchProgress' | 'verifyNow' | 'proposeChecks' | 'checksProposalState' | 'askAgentForChecks'>; scheduler?: Scheduler; agents: () => string[] }): void {
  const { store } = deps;

  const resolveProject = (ref: { projectId?: string | undefined; sessionId?: string | undefined; cwd?: string | undefined }): { project: Project; agentId: string | null } => {
    if (ref.sessionId) {
      const session = store.getSession(ref.sessionId);
      const project = session && store.getProject(session.projectId);
      if (session && project) return { project, agentId: session.agentId };
    }
    if (ref.projectId) {
      const project = store.getProject(ref.projectId);
      if (project) return { project, agentId: null };
    }
    if (ref.cwd) {
      const project = projectOfFolder(store.listProjects(), ref.cwd);
      if (project) return { project, agentId: null };
    }
    throw new SomeCodeError('not_found', 'no project found for this request');
  };
  const refOf = (c: Context) => ({ projectId: c.req.query('projectId'), sessionId: c.req.query('sessionId'), cwd: c.req.query('cwd') });
  const ref = z.object({ projectId: z.string().optional(), sessionId: z.string().optional(), cwd: z.string().max(4096).optional() });

  // ---- search and reading of past chats
  app.get('/api/search', (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) throw new SomeCodeError('bad_request', 'the search needs at least two letters');
    const scope = c.req.query('scope');
    const where = scope === 'all' ? {} : (() => {
      try {
        return { projectId: resolveProject(refOf(c)).project.id };
      } catch {
        return {};
      }
    })();
    const limit = Number(c.req.query('limit') ?? 10);
    return c.json({ hits: store.searchHistory(q, { ...where, limit: Number.isFinite(limit) ? limit : 10 }) });
  });
  app.get('/api/transcript/:sessionId', (c) => {
    const id = c.req.param('sessionId');
    if (!store.getSession(id)) throw new SomeCodeError('not_found', `unknown session: ${id}`);
    const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : undefined);
    const afterSeq = num(c.req.query('afterSeq'));
    const maxChars = num(c.req.query('maxChars'));
    return c.json(store.transcript(id, { ...(afterSeq !== undefined ? { afterSeq } : {}), ...(maxChars !== undefined ? { maxChars } : {}) }));
  });

  // A picture an agent referred to by its file path (the chat shows it in place of the bare markdown image).
  app.get('/api/local-image', (c) => {
    const path = c.req.query('path');
    if (!path) throw new SomeCodeError('bad_request', 'path is required');
    const { bytes, type } = readAgentImage(store.listProjects(), path);
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=300' } });
  });

  // ---- project memory
  app.get('/api/memory', (c) => {
    const { project } = resolveProject(refOf(c));
    return c.json({ projectId: project.id, project: project.name, memories: store.listMemories(project.id) });
  });
  app.post('/api/memory', async (c) => {
    const input = await body(c, ref.extend({ text: z.string().trim().min(3).max(MAX_MEMORY_CHARS) }));
    const { project } = resolveProject(input);
    const existing = store.listMemories(project.id);
    if (existing.some((m) => m.text.toLowerCase() === input.text.toLowerCase())) return c.json({ memory: existing.find((m) => m.text.toLowerCase() === input.text.toLowerCase()), duplicate: true });
    if (existing.length >= MAX_MEMORIES) throw new SomeCodeError('bad_request', `the project already has ${MAX_MEMORIES} notes; forget some first`);
    return c.json({ memory: store.addMemory(project.id, input.text) }, 201);
  });
  // Every project's notes and the scheduled tasks, as Markdown files in a .zip (the Settings page offers it as a download).
  app.get('/api/memory-export', (c) => {
    const projects = store.listProjects();
    const files = projects
      .map((p) => ({ p, notes: store.listMemories(p.id) }))
      .filter((x) => x.notes.length > 0)
      .map(({ p, notes }) => ({ name: `memory/${p.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 60) || 'project'}.md`, content: `# ${p.name}\n\n${notes.map((n) => `- ${n.text.replace(/\n+/g, ' ')}`).join('\n')}\n` }));
    const tasks = store.listTasks();
    if (tasks.length > 0) {
      const names = new Map(projects.map((p) => [p.id, p.name]));
      files.push({ name: 'scheduled-tasks.md', content: `# Scheduled tasks\n\n${tasks.map((t) => `## ${t.title}\n\n- project: ${names.get(t.projectId) ?? ''}\n- when: ${describeSpec(t.spec)}\n\n${t.prompt}\n`).join('\n')}` });
    }
    if (files.length === 0) files.push({ name: 'README.md', content: '# SomeCode memory\n\nNothing saved yet.\n' });
    return new Response(new Uint8Array(zip(files)), { headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="somecode-memory.zip"' } });
  });
  // Notes from a Markdown or text list (one note per line or bullet).
  app.post('/api/memory-import', async (c) => {
    const input = await body(c, ref.extend({ text: z.string().max(100_000) }));
    const { project } = resolveProject(input);
    const existing = store.listMemories(project.id);
    const known = new Set(existing.map((m) => m.text.toLowerCase()));
    let count = existing.length;
    let added = 0;
    let skipped = 0;
    for (const line of input.text.split(/\r?\n/)) {
      const note = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
      if (note.length < 3 || /^#{1,6}\s/.test(note)) continue;
      const clipped = note.slice(0, MAX_MEMORY_CHARS);
      if (known.has(clipped.toLowerCase()) || count >= MAX_MEMORIES) {
        skipped += 1;
        continue;
      }
      known.add(clipped.toLowerCase());
      store.addMemory(project.id, clipped);
      count += 1;
      added += 1;
    }
    return c.json({ added, skipped });
  });
  app.delete('/api/memory/:id', (c) => {
    if (!store.deleteMemory(c.req.param('id'))) throw new SomeCodeError('not_found', 'no such note');
    return c.json({ ok: true });
  });

  // ---- deep research: the plan the user approves, and its progress
  app.post('/api/research/plan', async (c) => {
    if (!deps.manager) throw new SomeCodeError('not_found', 'research is not available');
    const input = await body(c, z.object({ sessionId: z.string().min(1), title: z.string().trim().min(3).max(140), steps: z.array(z.string().trim().min(1).max(400)).min(1).max(20), ask: z.boolean().optional() }));
    return c.json(await deps.manager.proposeResearchPlan(input.sessionId, input.title, input.steps, input.ask !== false));
  });
  app.get('/api/research/plan/:requestId', async (c) => {
    if (!deps.manager) throw new SomeCodeError('not_found', 'research is not available');
    const wait = Math.min(Math.max(Number(c.req.query('wait') ?? 0) || 0, 0), 25);
    return c.json(await deps.manager.researchPlanState(c.req.param('requestId'), wait * 1000));
  });
  app.post('/api/research/progress', async (c) => {
    if (!deps.manager) throw new SomeCodeError('not_found', 'research is not available');
    const input = await body(c, z.object({ sessionId: z.string().min(1), step: z.number().int().min(1).max(20), status: z.enum(['in_progress', 'completed']) }));
    return c.json(deps.manager.researchProgress(input.sessionId, input.step, input.status));
  });

  // ---- checks (tests, typecheck, lint) that run after the agent changed files
  app.get('/api/projects/:id/verify', (c) => {
    const project = store.getProject(c.req.param('id'));
    if (!project) throw new SomeCodeError('not_found', 'unknown project');
    return c.json({ config: readVerify(store, project.id), suggested: suggestChecks(project.path) });
  });
  app.put('/api/projects/:id/verify', async (c) => {
    const project = store.getProject(c.req.param('id'));
    if (!project) throw new SomeCodeError('not_found', 'unknown project');
    const config = await body(c, verifyConfigSchema);
    writeVerify(store, project.id, config);
    return c.json({ config });
  });
  // For agents: the project's checks and what the folder suggests, and a proposal the user must approve in the chat.
  app.get('/api/checks', (c) => {
    const { project } = resolveProject(refOf(c));
    return c.json({ project: project.name, config: readVerify(store, project.id), suggested: suggestChecks(project.path) });
  });
  app.post('/api/checks/propose', async (c) => {
    if (!deps.manager) throw new SomeCodeError('not_found', 'checks are not available');
    const input = await body(c, z.object({ sessionId: z.string().min(1), checks: z.array(z.unknown()).min(1).max(8), mode: z.enum(['add', 'replace']).default('add'), reason: z.string().max(600).optional() }));
    return c.json(await deps.manager.proposeChecks(input.sessionId, { checks: input.checks as never, mode: input.mode, ...(input.reason ? { reason: input.reason } : {}) }));
  });
  app.get('/api/checks/propose/:requestId', async (c) => {
    if (!deps.manager) throw new SomeCodeError('not_found', 'checks are not available');
    const wait = Math.min(Math.max(Number(c.req.query('wait') ?? 0) || 0, 0), 25);
    return c.json(await deps.manager.checksProposalState(c.req.param('requestId'), wait * 1000));
  });
  // "Fill with an agent": a new chat in the project where the agent works the checks out and proposes them.
  app.post('/api/projects/:id/verify/ask', async (c) => {
    if (!deps.manager) throw new SomeCodeError('not_found', 'checks are not available');
    const project = store.getProject(c.req.param('id'));
    if (!project) throw new SomeCodeError('not_found', 'unknown project');
    const input = await body(c, z.object({ agentId: z.string().min(1).max(60), prompt: z.string().min(10).max(4000) }));
    if (!deps.agents().includes(input.agentId)) throw new SomeCodeError('not_found', `unknown agent: ${input.agentId}`);
    const row = await deps.manager.askAgentForChecks(project.id, input.agentId, input.prompt);
    return c.json({ sessionId: row.id }, 201);
  });
  app.post('/api/sessions/:id/verify', (c) => {
    if (!deps.manager) throw new SomeCodeError('not_found', 'checks are not available');
    deps.manager.verifyNow(c.req.param('id'));
    return c.json({ ok: true }, 202);
  });

  // ---- scheduled tasks
  app.get('/api/tasks', (c) => {
    const projects = new Map(store.listProjects().map((p) => [p.id, p.name]));
    return c.json({ tasks: store.listTasks().map((t) => ({ ...t, project: projects.get(t.projectId) ?? '', when: describeSpec(t.spec) })) });
  });
  app.post('/api/tasks', async (c) => {
    const input = await body(c, ref.extend({ agentId: z.string().max(60).optional(), title: z.string().trim().min(1).max(80), prompt: z.string().trim().min(3).max(4000), spec: z.unknown() }));
    const { project, agentId: fromSession } = resolveProject(input);
    const agentId = input.agentId ?? fromSession ?? deps.agents()[0];
    if (!agentId || !deps.agents().includes(agentId)) throw new SomeCodeError('not_found', `unknown agent: ${agentId ?? '(none)'}`);
    const parsed = parseSpec(input.spec, Date.now());
    if (!parsed.ok) throw new SomeCodeError('bad_request', parsed.reason);
    if (store.listTasks().length >= MAX_TASKS) throw new SomeCodeError('bad_request', `there are already ${MAX_TASKS} scheduled tasks; remove some first`);
    const task = store.addTask({ projectId: project.id, agentId, title: input.title, prompt: input.prompt, spec: parsed.spec, nextRun: firstRun(parsed.spec, Date.now()) });
    return c.json({ task: { ...task, project: project.name, when: describeSpec(task.spec) } }, 201);
  });
  app.patch('/api/tasks/:id', async (c) => {
    const input = await body(c, z.object({ enabled: z.boolean().optional(), title: z.string().trim().min(1).max(80).optional() }));
    const task = store.getTask(c.req.param('id'));
    if (!task) throw new SomeCodeError('not_found', 'no such task');
    // Switching a finished or paused repeating task back on gives it a next time again.
    const patch: { enabled?: boolean; title?: string; nextRun?: number | null } = { ...input };
    if (input.enabled === true && task.nextRun === null && task.spec.kind !== 'once') patch.nextRun = firstRun(task.spec, Date.now());
    store.updateTask(task.id, patch);
    return c.json({ ok: true });
  });
  app.delete('/api/tasks/:id', (c) => {
    if (!store.deleteTask(c.req.param('id'))) throw new SomeCodeError('not_found', 'no such task');
    return c.json({ ok: true });
  });
  app.post('/api/tasks/:id/run', async (c) => {
    if (!deps.scheduler) throw new SomeCodeError('internal', 'the scheduler is not running');
    if (!store.getTask(c.req.param('id'))) throw new SomeCodeError('not_found', 'no such task');
    const sessionId = await deps.scheduler.runNow(c.req.param('id'));
    if (!sessionId) throw new SomeCodeError('internal', 'the task could not be started (is its agent installed?)');
    return c.json({ sessionId });
  });
}
