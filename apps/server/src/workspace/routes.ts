import type { Hono, Context } from 'hono';
import { z } from 'zod';
import { SomeCodeError } from '@somecode/protocol';
import { homedir } from 'node:os';
import type { Store } from '../store/store.ts';
import type { AgentRegistry } from '../agents/registry.ts';
import { browseFolders, listFiles, previewFile, projectPath, searchFiles } from './files.ts';
import type { TerminalService } from './terminals.ts';

export type WorkspaceDeps = { store: Store; registry: AgentRegistry; terminals: TerminalService };
async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try { value = JSON.parse(await c.req.text()); } catch { throw new SomeCodeError('bad_request', 'request body must be valid JSON'); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SomeCodeError('bad_request', 'invalid request body');
  return parsed.data;
}
const createBody = z.object({ agentId: z.string().min(1).max(100).optional() });
const inputBody = z.object({ data: z.string().max(65536) });
const resizeBody = z.object({ cols: z.number().int(), rows: z.number().int() });
const LOGIN = new Map<string, { command: string; args: string[] }>([
  ['claude', { command: 'claude', args: ['auth', 'login'] }],
  ['opencode', { command: 'opencode', args: ['auth', 'login'] }],
]);

/** Mount after the application's API authentication and body limit middleware. */
export function mountWorkspaceRoutes(app: Hono, { store, registry, terminals }: WorkspaceDeps): void {
  const project = (id: string) => {
    const value = store.getProject(id);
    if (!value) throw new SomeCodeError('not_found', 'project not found');
    return value;
  };
  const loginTerminal = async (agentId: string, cwd: string, shellFallback = false) => {
    const driver = registry.get(agentId);
    if (!driver) throw new SomeCodeError('not_found', 'agent not found');
    const login = LOGIN.get(agentId);
    if (!login && !shellFallback) throw new SomeCodeError('bad_request', 'This agent has no supported automatic login command. Follow its CLI documentation to sign in.');
    const status = await driver.detect();
    if (!status.installed) throw new SomeCodeError('agent_not_installed', 'agent is not installed');
    return terminals.create({ cwd, ...login });
  };
  app.get('/api/folders', async (c) => c.json(await browseFolders(c.req.query('path'))));
  app.post('/api/agents/:id/login', async (c) => c.json(await loginTerminal(c.req.param('id'), homedir(), true), 201));
  app.get('/api/projects/:id/files', async (c) => c.json(await listFiles(project(c.req.param('id')).path, c.req.query('path'))));
  app.get('/api/projects/:id/file', async (c) => {
    const path = c.req.query('path');
    if (!path) throw new SomeCodeError('bad_request', 'file path is required');
    return c.json(await previewFile(project(c.req.param('id')).path, path));
  });
  app.get('/api/projects/:id/search', async (c) => c.json(await searchFiles(project(c.req.param('id')).path, c.req.query('q') ?? '')));
  app.post('/api/projects/:id/terminals', async (c) => {
    const { root } = await projectPath(project(c.req.param('id')).path);
    const { agentId } = await body(c, createBody);
    if (agentId) {
      return c.json(await loginTerminal(agentId, root), 201);
    }
    return c.json(terminals.create({ cwd: root }), 201);
  });
  app.get('/api/terminals/:id', (c) => {
    const after = c.req.query('after') ?? '0';
    if (!/^\d+$/.test(after)) throw new SomeCodeError('bad_request', 'after must be a nonnegative integer');
    return c.json(terminals.read(c.req.param('id'), Number(after)));
  });
  app.post('/api/terminals/:id/input', async (c) => {
    const { data } = await body(c, inputBody);
    terminals.write(c.req.param('id'), data);
    return c.json({ ok: true });
  });
  app.post('/api/terminals/:id/resize', async (c) => {
    const { cols, rows } = await body(c, resizeBody);
    terminals.resize(c.req.param('id'), cols, rows);
    return c.json({ ok: true });
  });
  app.delete('/api/terminals/:id', async (c) => {
    await terminals.remove(c.req.param('id'));
    return c.json({ ok: true });
  });
}
