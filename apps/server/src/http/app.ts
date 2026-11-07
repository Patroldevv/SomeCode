import { realpathSync, statSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { SomeCodeError } from '@somecode/protocol';
import type { AgentRegistry } from '../agents/registry.ts';
import type { AgentStatus } from '../agents/types.ts';
import type { SessionManager } from '../sessions/manager.ts';
import type { Store } from '../store/store.ts';
import { bearerToken, originAllowed, tokenMatches } from './auth.ts';
import { describeIssues, statusFor, toWireError } from './errors.ts';

export type AppDeps = {
  store: Store;
  registry: AgentRegistry;
  manager: SessionManager;
  token: string;
  /** The only Origin a browser may send: `http://127.0.0.1:<bound port>`. */
  origin: () => string;
  staticDir?: string;
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

/** One driver failing to detect must not fail the whole listing. */
async function agentStatuses(registry: AgentRegistry) {
  return Promise.all(
    registry.list().map(async (driver) => {
      let status: AgentStatus;
      try {
        status = await driver.detect();
      } catch {
        status = { installed: false };
      }
      return {
        id: driver.id,
        label: driver.label,
        installed: status.installed === true,
        ...(status.version !== undefined ? { version: status.version } : {}),
      };
    }),
  );
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
    if (isApi(c.req.path) && !tokenMatches(token, bearerToken(c.req.header('authorization')))) {
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

  app.get('/api/agents', async (c) => c.json(await agentStatuses(registry)));

  app.get('/api/projects', (c) => c.json(store.listProjects()));

  app.post('/api/projects', async (c) => {
    const { name, path } = await readJson(c, projectBody);
    if (!isAbsolute(path)) throw new SomeCodeError('bad_request', 'path must be absolute');
    const resolved = resolve(path);
    if (!isDirectory(resolved)) {
      throw new SomeCodeError('bad_request', 'path is not an existing directory');
    }
    return c.json(store.addProject({ name, path: resolved }), 201);
  });

  app.get('/api/projects/:id/sessions', (c) => {
    const id = c.req.param('id');
    if (!store.getProject(id)) throw new SomeCodeError('not_found', `unknown project: ${id}`);
    return c.json(store.listSessions(id));
  });

  app.post('/api/sessions', async (c) => {
    const { projectId, agentId } = await readJson(c, sessionBody);
    return c.json(await manager.createSession(projectId, agentId), 201);
  });

  app.get('/api/sessions/:id/events', (c) => {
    const id = c.req.param('id');
    const afterSeq = parseAfterSeq(c.req.query('afterSeq'));
    if (!store.getSession(id)) throw new SomeCodeError('not_found', `unknown session: ${id}`);
    return c.json(store.eventsSince(id, afterSeq));
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
