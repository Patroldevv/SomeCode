import { realpathSync, statSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { SomeCodeError } from '@somecode/protocol';
import { createOptionsProbe, type OptionsProbe } from '../agents/optionsProbe.ts';
import type { AgentRegistry } from '../agents/registry.ts';
import { dataDir } from '../config.ts';
import { createIconCache, type IconCache } from '../plugins/icons.ts';
import { createPluginService, type PluginService } from '../plugins/service.ts';
import { disableScoutSkill, ensureScoutSkill } from '../scout/skill.ts';
import { runScout } from '../scout/runner.ts';
import { disableClaudeSkill, ensureClaudeSkill } from '../claude-subagent/skill.ts';
import { runClaudeSubagent } from '../claude-subagent/runner.ts';
import { createUsageHistory, type UsageHistoryService } from '../usage/history.ts';
import { createUsageService, type UsageService } from '../usage/service.ts';
import { homedir } from 'node:os';
import { approvalOption, trimModeOption } from '../permissions/approval.ts';
import { defaultApprovalLevel, readSettings, settingsPatchSchema, updateSettings } from '../settings.ts';
import type { SessionManager } from '../sessions/manager.ts';
import type { Store } from '../store/store.ts';
import { bearerToken, originAllowed, tokenMatches } from './auth.ts';
import type { LaunchCodes } from './launch.ts';
import { mountWorkspaceRoutes, TerminalService } from '../workspace/index.ts';
import { describeIssues, statusFor, toWireError } from './errors.ts';
import { mountAgentToolRoutes } from './agentTools.ts';
import { withResearchMode } from '../research/mode.ts';
import type { Scheduler } from '../scheduler/scheduler.ts';

export type AppDeps = {
  store: Store;
  registry: AgentRegistry;
  manager: SessionManager;
  token: string;
  /** The only Origin a browser may send: `http://127.0.0.1:<bound port>`. */
  origin: () => string;
  staticDir?: string;
  terminals?: TerminalService;
  /** One-time codes that the interface trades for the token (see `launch.ts`). */
  launchCodes?: LaunchCodes;
  /** Test seam: the cache behind `GET /api/agents/:id/options`. */
  optionsProbe?: OptionsProbe;
  /** Test seam: where `GET /api/usage` gets its figures. */
  usage?: UsageService;
  /** Test seam: where `GET /api/usage/history` reads token use from. */
  usageHistory?: UsageHistoryService;
  /** Test seam: plugins and skills (rooted at a throw-away home folder). */
  plugins?: PluginService;
  /** Test seam: the logo cache behind `GET /api/plugins/icon/:owner`. */
  icons?: IconCache;
  /** Starts scheduled tasks (and "run now" for one). */
  scheduler?: Scheduler;
  /** Test seam: scout subagent runner. */
  scoutRunner?: typeof runScout;
};

const MAX_BODY_BYTES = 1024 * 1024;

const projectBody = z.object({
  name: z.string().trim().min(1).max(200),
  path: z.string().min(1).max(4096),
});
const sessionBody = z.object({ projectId: z.string().min(1), agentId: z.string().min(1) });

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const isApi = (path: string): boolean => path === '/api' || path.startsWith('/api/');

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function readJson<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
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

function parseAfterSeq(value: string | undefined): number {
  if (value === undefined) return 0;
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n)) {
    throw new SomeCodeError('bad_request', 'afterSeq must be an integer >= 0');
  }
  return n;
}

/** Whitelisted fields only: whatever else a driver's detect() returns never reaches the client. */
async function agentStatuses(registry: AgentRegistry) {
  return (await registry.statuses()).map((s) => ({
    id: s.id,
    label: s.label,
    installed: s.installed === true,
    ...(s.version !== undefined ? { version: s.version } : {}),
    ...(s.auth !== undefined ? { auth: s.auth } : {}),
    ...(s.signInHint !== undefined ? { signInHint: s.signInHint } : {}),
    ...(s.installHint !== undefined ? { installHint: s.installHint } : {}),
  }));
}

function contains(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Maps a raw (still percent-encoded) URL path to a regular file inside `root`, or null. */
async function staticFile(root: string, rawPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const candidate = resolve(root, `.${decoded}`);
  if (!contains(root, candidate)) return null;
  try {
    // Re-check after resolving symlinks so a link cannot point outside the directory.
    const real = await realpath(candidate);
    return contains(root, real) && (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

export function createApp(deps: AppDeps): Hono {
  const { store, registry, manager, token } = deps;
  const probe = deps.optionsProbe ?? createOptionsProbe();
  const usage = deps.usage ?? createUsageService(store);
  const usageHistory = deps.usageHistory ?? createUsageHistory({ home: homedir() });
  const plugins = deps.plugins ?? createPluginService();
  const icons = deps.icons ?? createIconCache(join(dataDir(process.env), 'icons'));
  const scout = deps.scoutRunner ?? runScout;
  const app = new Hono();

  app.onError((err, c) => {
    const error = toWireError(err);
    return c.json({ error }, statusFor(error.code));
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'not found' } }, 404));

  // Origin first (403 regardless of the token), then the token for everything under /api.
  app.use('*', async (c, next) => {
    if (!originAllowed(c.req.header('origin'), deps.origin())) {
      throw new SomeCodeError('forbidden', 'origin not allowed');
    }
    const isLaunch = c.req.method === 'POST' && c.req.path === '/api/launch';
    if (isApi(c.req.path) && !isLaunch && !tokenMatches(token, bearerToken(c.req.header('authorization')))) {
      throw new SomeCodeError('unauthorized', 'missing or invalid token');
    }
    await next();
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new SomeCodeError('bad_request', 'request body too large');
      },
    }),
  );

  if(deps.terminals) mountWorkspaceRoutes(app, {store,registry,terminals:deps.terminals});
  mountAgentToolRoutes(app, { store, manager, ...(deps.scheduler ? { scheduler: deps.scheduler } : {}), agents: () => registry.list().map((d) => d.id) });

  app.get('/api/agents', async (c) => c.json(await agentStatuses(registry)));

  // What the agent offers (model, mode, effort), so the new-chat screen can show it before a session exists.
  app.get('/api/agents/:id/options', async (c) => {
    const id = c.req.param('id');
    const driver = registry.get(id);
    if (!driver) throw new SomeCodeError('not_found', `unknown agent: ${id}`);
    const path = c.req.query('path') ?? '';
    if (!isAbsolute(path) || !isDirectory(resolve(path))) {
      throw new SomeCodeError('bad_request', 'path must be an existing absolute directory');
    }
    const options = await probe.options(driver, realpathSync(resolve(path)));
    // The same additions a live session makes: no self-approving modes, plus the access level (the default one).
    return c.json({ options: [...withResearchMode(options.map(trimModeOption), false), approvalOption(defaultApprovalLevel(readSettings(store)))] });
  });

  // The page trades the one-time code in its address for the token. The only call that needs no token.
  app.post('/api/launch', async (c) => {
    const { code } = await readJson(c, z.object({ code: z.string().min(8).max(100) }));
    if (!deps.launchCodes?.redeem(code)) throw new SomeCodeError('unauthorized', 'unknown or used launch code');
    return c.json({ token });
  });

  app.get('/api/settings', (c) => c.json(readSettings(store)));
  app.put('/api/settings', async (c) => {
    const patch = await readJson(c, settingsPatchSchema);
    const updated = updateSettings(store, patch);
    if (patch.scoutSubagent !== undefined) {
      if (patch.scoutSubagent) void ensureScoutSkill().catch(() => {});
      else void disableScoutSkill().catch(() => {});
    }
    if (patch.claudeSubagent !== undefined) {
      if (patch.claudeSubagent) void ensureClaudeSkill().catch(() => {});
      else void disableClaudeSkill().catch(() => {});
    }
    return c.json(updated);
  });

  // What each agent last reported about its subscription limits (only what it really sent).
  app.get('/api/usage/history', async (c) => c.json(await usageHistory.get(Number(c.req.query('days') ?? 365) || 365, c.req.query('refresh') === '1')));
  app.get('/api/usage', async (c) => c.json(await usage.all(registry.list().map((d) => ({ id: d.id, label: d.label })), c.req.query('refresh') === '1')));

  // Plugins (Claude's marketplace) and skills (SKILL.md folders) of the agents on this computer.
  app.get('/api/plugins', async (c) => {
    const overview = await plugins.overview();
    // Fetch the logos in the background now, so they are ready by the time the page asks for them.
    void icons.warm([...overview.plugins, ...overview.skills].flatMap((x) => (x.owner ? [x.owner] : [])));
    return c.json(overview);
  });
  // A plugin's logo: the avatar of the GitHub account it lives under, fetched once and kept.
  app.get('/api/plugins/icon/:owner', async (c) => {
    const icon = await icons.get(c.req.param('owner'));
    if (!icon) throw new SomeCodeError('not_found', 'no logo');
    return new Response(icon.bytes as BodyInit, { headers: { 'content-type': icon.type, 'cache-control': 'private, max-age=86400' } });
  });
  // Remote services (MCP servers) that Claude can be connected to.
  app.get('/api/services', async (c) => {
    const list = await plugins.services();
    void icons.warm(list.flatMap((s) => (s.owner ? [s.owner] : [])));
    return c.json(list);
  });
  app.post('/api/services', async (c) => {
    await plugins.connect(await readJson(c, z.object({ name: z.string().max(60), url: z.string().max(500), transport: z.string().max(10), token: z.string().max(600).optional() })));
    return c.json({ ok: true }, 201);
  });
  app.delete('/api/services/:name', async (c) => {
    await plugins.disconnect(c.req.param('name'));
    return c.json({ ok: true });
  });
  app.post('/api/plugins/:action', async (c) => {
    const action = c.req.param('action');
    if (action !== 'install' && action !== 'uninstall' && action !== 'enable' && action !== 'disable') throw new SomeCodeError('not_found', 'not found');
    const { id } = await readJson(c, z.object({ id: z.string().min(1).max(250) }));
    await plugins.plugin(action, id);
    return c.json({ ok: true });
  });
  app.post('/api/skills', async (c) => {
    await plugins.addSkill(await readJson(c, z.object({ agent: z.string(), name: z.string().max(100), description: z.string().max(1000), content: z.string().max(200_000) })));
    return c.json({ ok: true }, 201);
  });
  app.post('/api/skills/git', async (c) => {
    const { agent, url } = await readJson(c, z.object({ agent: z.string(), url: z.string().max(300) }));
    return c.json({ added: await plugins.addSkillsFromGit(agent, url) }, 201);
  });
  app.delete('/api/skills/:agent/:name', async (c) => {
    await plugins.removeSkill(c.req.param('agent'), c.req.param('name'));
    return c.json({ ok: true });
  });

  app.post('/api/scout', async (c) => {
    const settings = readSettings(store);
    if (!settings.scoutSubagent) {
      throw new SomeCodeError('forbidden', 'Scout subagent is disabled in settings');
    }
    const query = await readJson(
      c,
      z.object({
        task: z.string().min(1).max(10_000),
        cwd: z.string().optional(),
        model: z.string().optional(),
        timeoutMs: z.number().int().min(1000).max(600_000).optional(),
        files: z.array(z.string()).optional(),
      }),
    );
    const result = await scout({
      ...query,
      model: query.model || settings.scoutModel,
      effort: settings.scoutEffort,
    });
    return c.json(result);
  });

  app.post('/api/claude-subagent', async (c) => {
    const settings = readSettings(store);
    if (!settings.claudeSubagent) {
      throw new SomeCodeError('forbidden', 'Claude subagent is disabled in settings');
    }
    const query = await readJson(
      c,
      z.object({
        task: z.string().min(1).max(10_000),
        cwd: z.string().optional(),
        model: z.string().optional(),
        effort: z.string().optional(),
        timeoutMs: z.number().int().min(1000).max(600_000).optional(),
        files: z.array(z.string()).optional(),
        sessionId: z.string().optional(),
        parentToolCallId: z.string().optional(),
      }),
    );
    const sessionId = query.sessionId;
    const parentToolCallId = query.parentToolCallId;
    const result = await runClaudeSubagent({
      ...query,
      model: query.model || settings.claudeModel,
      effort: query.effort || (settings.claudeEffort !== 'default' ? settings.claudeEffort : undefined),
      onToolCall: (child) => {
        if (sessionId) {
          try {
            deps.manager.emitClaudeChildCall(sessionId, {
              ...child,
              parentToolCallId,
            });
          } catch {
            // ignore if session closed or invalid
          }
        }
      },
    });
    return c.json(result);
  });

  app.get('/api/projects', (c) => c.json(store.listProjects()));

  app.post('/api/projects', async (c) => {
    const { name, path } = await readJson(c, projectBody);
    if (!isAbsolute(path)) throw new SomeCodeError('bad_request', 'path must be absolute');
    const resolved = resolve(path);
    if (!isDirectory(resolved)) {
      throw new SomeCodeError('bad_request', 'path is not an existing directory');
    }
    return c.json(store.addProject({ name, path: realpathSync(resolved) }), 201);
  });

  app.get('/api/projects/:id/sessions', (c) => {
    const id = c.req.param('id');
    if (!store.getProject(id)) throw new SomeCodeError('not_found', `unknown project: ${id}`);
    return c.json(store.listSessions(id));
  });

  app.patch('/api/sessions/:id', async (c) => {
    const { title } = await readJson(c, z.object({ title: z.string().min(1).max(400) }));
    manager.renameSession(c.req.param('id'), title);
    return c.json({ ok: true });
  });

  app.delete('/api/sessions/:id', async (c) => {
    await manager.deleteSession(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.patch('/api/projects/:id', async (c) => {
    const { name } = await readJson(c, z.object({ name: z.string().trim().min(1).max(200) }));
    if (!store.renameProject(c.req.param('id'), name)) throw new SomeCodeError('not_found', 'unknown project');
    return c.json({ ok: true });
  });

  app.delete('/api/projects/:id', async (c) => {
    const id = c.req.param('id');
    if (!store.getProject(id)) throw new SomeCodeError('not_found', `unknown project: ${id}`);
    await manager.deleteProject(id, store.listSessions(id).map((s) => s.id));
    return c.json({ ok: true });
  });

  app.post('/api/sessions', async (c) => {
    const { projectId, agentId } = await readJson(c, sessionBody);
    return c.json(await manager.createSession(projectId, agentId), 201);
  });

  app.post('/api/sessions/:id/resume', async c => c.json(await manager.resumeSession(c.req.param('id'))));
  app.post('/api/sessions/:id/rewind', async (c) => {
    const { beforeSeq } = await readJson(
      c,
      z.object({ beforeSeq: z.number().int().min(1) }),
    );
    await manager.rewindSession(c.req.param('id'), beforeSeq);
    return c.json({ ok: true });
  });
  app.get('/api/sessions/:id/history', c => c.json(manager.history(c.req.param('id'), c.req.query('beforeSeq') === undefined ? undefined : Number(c.req.query('beforeSeq')), c.req.query('limit') === undefined ? undefined : Number(c.req.query('limit')))));

  app.get('/api/sessions/:id/events', (c) => {
    const id = c.req.param('id');
    const afterSeq = parseAfterSeq(c.req.query('afterSeq'));
    if (!store.getSession(id)) throw new SomeCodeError('not_found', `unknown session: ${id}`);
    const events=store.eventsSince(id, afterSeq);
    c.header('X-Next-After-Seq',String(events.at(-1)?.seq??afterSeq));
    c.header('X-Last-Seq',String(store.lastSeq(id)));
    return c.json(events);
  });

  if (deps.staticDir !== undefined) {
    // Real path, so the containment check matches the real paths of the files it serves.
    const root = realpathSync(resolve(deps.staticDir));
    // GET also answers HEAD. Static files carry no secrets, so no token is required.
    app.get('*', async (c) => {
      if (isApi(c.req.path) || c.req.path === '/ws') return c.notFound();
      const file =
        (await staticFile(root, new URL(c.req.url).pathname)) ?? (await staticFile(root, '/index.html'));
      if (!file) return c.notFound();
      return c.body(new Uint8Array(await readFile(file)), 200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      });
    });
  }

  return app;
}
