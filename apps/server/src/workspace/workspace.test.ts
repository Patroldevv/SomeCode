import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, rename } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SomeCodeError } from '@somecode/protocol';
import { createRegistry } from '../agents/registry.ts';
import type { AgentRegistry } from '../agents/registry.ts';
import { openStore, type Store } from '../store/store.ts';
import { mountWorkspaceRoutes, TerminalService } from './index.ts';
import { listFiles, searchFiles } from './files.ts';

let root: string;
let store: Store;
let terminals: TerminalService;
let app: Hono;
let prefix: string;
let registry: AgentRegistry;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'somecode-workspace-'));
  await mkdir(join(root, 'project'));
  store = openStore(':memory:');
  const project = store.addProject({ name: 'Project', path: join(root, 'project') });
  prefix = `/api/projects/${project.id}`;
  terminals = new TerminalService();
  registry = createRegistry(['claude', 'opencode', 'agy', '__proto__'].map((id) => ({ id, label: id, launch: () => ({ command: id, args: [] }), detect: async () => ({ installed: true }) })));
  app = new Hono();
  app.onError((err, c) => c.json({ error: { message: err.message } }, err instanceof SomeCodeError && err.code === 'forbidden' ? 403 : err instanceof SomeCodeError && err.code === 'not_found' ? 404 : 400));
  mountWorkspaceRoutes(app, { store, registry, terminals });
});
afterEach(async () => {
  await terminals.closeAll();
  vi.unstubAllEnvs();
  store.close();
  await rm(root, { recursive: true, force: true });
});
const get = (url: string) => app.request(url);

describe('workspace files', () => {
  it('rejects a registered project root replaced by an outside symlink', async () => {
    const project = join(root, 'project');
    const outside = join(root, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'external-marker.txt'), 'outside secret');
    await rename(project, join(root, 'original-project'));
    await symlink(outside, project);
    expect((await get(`${prefix}/files`)).status).toBe(403);
    expect((await get(`${prefix}/file?path=external-marker.txt`)).status).toBe(403);
    expect((await get(`${prefix}/search?q=external-marker`)).status).toBe(403);
    expect((await app.request(`${prefix}/terminals`, { method: 'POST', body: '{}' })).status).toBe(403);
  });
  it('never exposes outside names while a directory is swapped with an escaping symlink', async () => {
    const project = join(root, 'project');
    const inside = join(project, 'inside');
    const outside = join(root, 'outside');
    await mkdir(inside);
    await mkdir(outside);
    await writeFile(join(outside, 'external-secret-name.txt'), 'secret');
    const worker = new Worker(`
      import { renameSync, symlinkSync, unlinkSync } from 'node:fs';
      import { workerData, parentPort } from 'node:worker_threads';
      const { inside, outside, held } = workerData;
      parentPort.postMessage('ready');
      while (true) {
        try { renameSync(inside, held); symlinkSync(outside, inside); unlinkSync(inside); renameSync(held, inside); } catch {}
      }
    `, { eval: true, workerData: { inside, outside, held: join(root, 'held') } });
    try {
      await new Promise((resolve) => worker.once('message', resolve));
      for (let attempt = 0; attempt < 750; attempt++) {
        try {
          const result = await listFiles(project, 'inside');
          expect(result.entries.some((entry) => entry.name === 'external-secret-name.txt')).toBe(false);
          const search = await searchFiles(project, 'external-secret');
          expect(search.paths).toEqual([]);
        } catch (error) {
          if (!(error instanceof SomeCodeError)) throw error;
        }
      }
    } finally { await worker.terminate(); }
  });
  it('browses real absolute folders, excludes files, and defaults to home', async () => {
    await writeFile(join(root, 'not-folder'), 'x');
    const response = await get(`/api/folders?path=${encodeURIComponent(root)}`);
    expect(await response.json()).toEqual({ path: root, parent: tmpdir(), entries: [{ name: 'project', path: join(root, 'project') }] });
    expect((await (await get('/api/folders')).json()).path).toBe(homedir());
    expect((await get('/api/folders?path=relative')).status).toBe(400);
  });
  it('lists project paths and previews text with bounded reads', async () => {
    await mkdir(join(root, 'project', 'src'));
    await writeFile(join(root, 'project', 'src', 'hello.ts'), 'hello world');
    expect(await (await get(`${prefix}/files`)).json()).toEqual({ entries: [{ name: 'src', path: 'src', type: 'directory' }] });
    expect(await (await get(`${prefix}/file?path=src/hello.ts`)).json()).toEqual({ path: 'src/hello.ts', text: 'hello world', truncated: false });
    await writeFile(join(root, 'project', 'huge.txt'), 'x'.repeat(400_000));
    const large = await (await get(`${prefix}/file?path=huge.txt`)).json();
    expect(large.truncated).toBe(true);
    expect(large.text.length).toBeLessThanOrEqual(262_144);
    await writeFile(join(root, 'project', 'binary'), Buffer.from([1, 0, 2]));
    expect((await get(`${prefix}/file?path=binary`)).status).toBe(400);
  });
  it('denies traversal, absolute paths, symlink escapes and unknown projects', async () => {
    await writeFile(join(root, 'secret'), 'secret');
    await symlink(root, join(root, 'project', 'escape'));
    for (const path of ['../secret', join(root, 'secret'), 'escape/secret', 'escape']) {
      expect((await get(`${prefix}/file?path=${encodeURIComponent(path)}`)).status).toBe(403);
      expect((await get(`${prefix}/files?path=${encodeURIComponent(path)}`)).status).toBe(403);
    }
    expect((await get('/api/projects/missing/files')).status).toBe(404);
    expect((await get(`${prefix}/file?path=${'x'.repeat(5000)}`)).status).toBe(400);
  });
  it('searches bounded file paths without exposing ignored or escaping directories', async () => {
    for (const dir of ['src', '.git', 'node_modules']) {
      await mkdir(join(root, 'project', dir));
      await writeFile(join(root, 'project', dir, 'match.ts'), dir);
    }
    await symlink(root, join(root, 'project', 'escape'));
    expect(await (await get(`${prefix}/search?q=match`)).json()).toEqual({ paths: ['src/match.ts'] });
    expect((await get(`${prefix}/search?q=${'x'.repeat(1000)}`)).status).toBe(400);
    await Promise.all(Array.from({ length: 150 }, (_, i) => writeFile(join(root, 'project', `match-${i}.txt`), '')));
    expect((await (await get(`${prefix}/search?q=match`)).json()).paths.length).toBeLessThanOrEqual(100);
  });
  it('bounds directory results and refuses arbitrary agent login commands', async () => {
    await Promise.all(Array.from({ length: 550 }, (_, i) => mkdir(join(root, 'project', `dir-${i}`))));
    expect((await (await get(`${prefix}/files`)).json()).entries.length).toBeLessThanOrEqual(500);
    const response = await app.request(`${prefix}/terminals`, { method: 'POST', body: JSON.stringify({ agentId: 'anything; touch secret' }) });
    expect(response.status).toBe(404);
  });
  it('excludes escaping symlinks from listings and rejects invalid UTF-8', async () => {
    await writeFile(join(root, 'secret'), 'secret');
    await symlink(join(root, 'secret'), join(root, 'project', 'outside'));
    await writeFile(join(root, 'project', 'invalid.txt'), Buffer.from([0xff, 0xfe, 0xfd]));
    expect((await (await get(`${prefix}/files`)).json()).entries).toEqual([{ name: 'invalid.txt', path: 'invalid.txt', type: 'file' }]);
    expect((await get(`${prefix}/file?path=invalid.txt`)).status).toBe(400);
    expect((await get(`${prefix}/file?path=%00`)).status).toBe(400);
  });
});

async function untilExited(id: string): Promise<any> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const state = await (await get(`/api/terminals/${id}`)).json();
    if (state.exited) return state;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('terminal did not exit');
}

describe('workspace terminal routes', () => {
  it('opens fixed login in home without requiring any project', async () => {
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'opencode'), '#!/bin/sh\nprintf "%s\\n" "$@"\npwd\n', { mode: 0o755 });
    vi.stubEnv('PATH', bin);
    vi.stubEnv('SHELL', '/bin/sh');
    const response = await app.request('/api/agents/opencode/login', { method: 'POST' });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    const state = await untilExited(id);
    expect(state.output.replaceAll('\r', '')).toBe(`auth\nlogin\n${homedir()}\n`);
    const unsupported = await app.request('/api/agents/agy/login', { method: 'POST' });
    expect(unsupported.status).toBe(201);
    const { id: shellId } = await unsupported.json();
    expect((await app.request(`/api/terminals/${shellId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request('/api/agents/unknown/login', { method: 'POST' })).status).toBe(404);
  });
  it('runs a project shell through authenticated-app-compatible HTTP routes', async () => {
    vi.stubEnv('SHELL', '/bin/sh');
    const created = await app.request(`${prefix}/terminals`, { method: 'POST', body: '{}' });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await app.request(`/api/terminals/${id}/resize`, { method: 'POST', body: JSON.stringify({ cols: 90, rows: 25 }) })).status).toBe(200);
    expect((await app.request(`/api/terminals/${id}/input`, { method: 'POST', body: JSON.stringify({ data: 'pwd; exit 0\n' }) })).status).toBe(200);
    const state = await untilExited(id);
    expect(state.output).toContain(join(root, 'project'));
    expect((await (await get(`/api/terminals/${id}?after=${state.cursor}`)).json()).output).toBe('');
    for (const after of ['-1', 'NaN', '9007199254740992', String(state.cursor + 1)]) expect((await get(`/api/terminals/${id}?after=${after}`)).status).toBe(400);
    expect((await app.request(`/api/terminals/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await get(`/api/terminals/${id}`)).status).toBe(404);
  });
  it('launches only fixed agent login commands on explicit POST', async () => {
    const bin = join(root, 'bin');
    await mkdir(bin);
    const marker = join(root, 'launched');
    for (const command of ['claude', 'opencode']) {
      await writeFile(join(bin, command), `#!/bin/sh\nprintf '%s\\n' "$@"\nprintf launched > '${marker}'\n`, { mode: 0o755 });
    }
    vi.stubEnv('PATH', bin);
    await expect(readFile(marker)).rejects.toThrow();
    for (const agentId of ['claude', 'opencode']) {
      const response = await app.request(`${prefix}/terminals`, { method: 'POST', body: JSON.stringify({ agentId }) });
      expect(response.status).toBe(201);
      const { id } = await response.json();
      const state = await untilExited(id);
      expect(state.output.replaceAll('\r', '')).toBe('auth\nlogin\n');
      expect(await readFile(marker, 'utf8')).toBe('launched');
    }
    const unsupported = await app.request(`${prefix}/terminals`, { method: 'POST', body: JSON.stringify({ agentId: 'agy' }) });
    expect(unsupported.status).toBe(400);
    expect((await unsupported.json()).error.message).toContain('no supported automatic login');
    const inheritedName = await app.request(`${prefix}/terminals`, { method: 'POST', body: JSON.stringify({ agentId: '__proto__' }) });
    expect(inheritedName.status).toBe(400);
  });

  it('reverts modified and created files via POST /api/projects/:id/revert', async () => {
    const projectDir = join(root, 'project');
    const fileA = join(projectDir, 'src', 'index.ts');
    await mkdir(join(projectDir, 'src'));
    await writeFile(fileA, 'function test() { return "modified"; }');

    const fileB = join(projectDir, 'src', 'newFile.ts');
    await writeFile(fileB, 'new file content');

    // 1. Revert index.ts to original content and newFile.ts to null (deleted)
    const res = await app.request(`${prefix}/revert`, {
      method: 'POST',
      body: JSON.stringify({
        files: [
          { path: 'src/index.ts', content: 'function test() { return "original"; }' },
          { path: 'src/newFile.ts', content: null },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.reverted).toEqual(['src/index.ts', 'src/newFile.ts']);

    // Check disk content
    expect(await readFile(fileA, 'utf8')).toBe('function test() { return "original"; }');
    await expect(readFile(fileB, 'utf8')).rejects.toThrow();
  });

  it('strictly forbids path traversal during revert', async () => {
    const res = await app.request(`${prefix}/revert`, {
      method: 'POST',
      body: JSON.stringify({
        files: [{ path: '../outside.txt', content: 'evil' }],
      }),
    });
    expect(res.status).toBe(403);
  });
});
