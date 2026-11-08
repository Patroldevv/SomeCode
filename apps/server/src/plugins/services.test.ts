import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectService, disconnectService, listServices, SERVICE_CATALOGUE } from './services.ts';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'somecode-svc-'));
});
afterEach(() => rm(home, { recursive: true, force: true }));

describe('listServices', () => {
  it('offers the catalogue with nothing connected on a fresh install', async () => {
    const list = await listServices(home);
    expect(list).toHaveLength(SERVICE_CATALOGUE.length);
    expect(list.every((s) => !s.connected && !s.custom)).toBe(true);
    expect(list.every((s) => s.url.startsWith('https://'))).toBe(true);
  });

  it('marks what Claude has connected and lists servers the user added themselves', async () => {
    await writeFile(join(home, '.claude.json'), JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' }, mine: { type: 'sse', url: 'https://x.example/sse' }, local: { command: 'node' } } }));
    const list = await listServices(home);
    expect(list.find((s) => s.id === 'github')).toMatchObject({ connected: true });
    expect(list.find((s) => s.id === 'supabase')).toMatchObject({ connected: false });
    expect(list.filter((s) => s.custom).map((s) => [s.id, s.transport, s.url])).toEqual([['mine', 'sse', 'https://x.example/sse'], ['local', 'http', '']]);
  });

  it('survives an unreadable config', async () => {
    await mkdir(home, { recursive: true });
    await writeFile(join(home, '.claude.json'), 'not json');
    expect((await listServices(home)).every((s) => !s.connected)).toBe(true);
  });
});

describe('connectService / disconnectService', () => {
  it('adds a remote server at user scope and removes it again, passing only checked values', async () => {
    const run = vi.fn(async () => '');
    await connectService(run, { name: 'context7', url: 'https://mcp.context7.com/mcp', transport: 'http' });
    expect(run).toHaveBeenCalledWith('claude', ['mcp', 'add', '--transport', 'http', '-s', 'user', 'context7', 'https://mcp.context7.com/mcp'], expect.any(Number));
    await disconnectService(run, 'context7');
    expect(run).toHaveBeenLastCalledWith('claude', ['mcp', 'remove', '-s', 'user', 'context7'], expect.any(Number));
  });

  it('refuses a bad name, transport or address before running anything', async () => {
    const run = vi.fn(async () => '');
    const ok = { name: 'svc', url: 'https://svc.example/mcp', transport: 'http' };
    for (const bad of [{ name: '--evil' }, { name: 'Has Space' }, { name: '' }, { transport: 'stdio' }, { url: 'http://svc.example/mcp' }, { url: 'https://localhost/mcp' }, { url: 'https://127.0.0.1/mcp' }, { url: 'https://user:pw@svc.example/' }, { url: 'ftp://x.example' }, { url: 'nonsense' }, { url: 'https://intranet/mcp' }]) {
      await expect(connectService(run, { ...ok, ...bad })).rejects.toMatchObject({ code: 'bad_request' });
    }
    await expect(disconnectService(run, '--all')).rejects.toMatchObject({ code: 'bad_request' });
    expect(run).not.toHaveBeenCalled();
  });

  it('sends an access token as one bearer header and keeps it out of errors', async () => {
    const run = vi.fn(async () => '');
    await connectService(run, { name: 'neon', url: 'https://mcp.neon.tech/mcp', transport: 'http', token: ' napi_abcdef123456 ' });
    expect(run).toHaveBeenCalledWith('claude', ['mcp', 'add', '--transport', 'http', '-s', 'user', 'neon', 'https://mcp.neon.tech/mcp', '--header', 'Authorization: Bearer napi_abcdef123456'], expect.any(Number));
    await expect(connectService(async () => { throw new Error('failed --header Authorization: Bearer napi_abcdef123456'); }, { name: 'neon', url: 'https://mcp.neon.tech/mcp', transport: 'http', token: 'napi_abcdef123456' })).rejects.toMatchObject({ message: expect.not.stringContaining('napi_abcdef123456') });
    for (const token of ['short', 'has space inside', 'line\nbreak123', 'x'.repeat(501)]) {
      await expect(connectService(run, { name: 'neon', url: 'https://mcp.neon.tech/mcp', transport: 'http', token })).rejects.toMatchObject({ code: 'bad_request' });
    }
  });

  it('keeps the catalogue well formed', () => {
    const ids = SERVICE_CATALOGUE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SERVICE_CATALOGUE) {
      expect(s.id).toMatch(/^[a-z0-9][a-z0-9-]{0,40}$/);
      expect(() => new URL(s.url)).not.toThrow();
      expect(s.url.startsWith('https://')).toBe(true);
    }
  });

  it('turns a failed CLI run into an error', async () => {
    await expect(connectService(async () => { throw new Error('boom'); }, { name: 'a', url: 'https://a.example/mcp', transport: 'sse' })).rejects.toMatchObject({ code: 'internal' });
  });
});
