import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIconCache, githubOwnerOf } from './icons.ts';

describe('githubOwnerOf', () => {
  it('finds the account in the first address that has one', () => {
    expect(githubOwnerOf('https://github.com/42Crunch-AI/claude-plugins.git')).toBe('42Crunch-AI');
    expect(githubOwnerOf(undefined, 'https://example.com', 'https://github.com/anthropics/x/tree/main')).toBe('anthropics');
    expect(githubOwnerOf('git@github.com:obra/superpowers.git')).toBe('obra');
    expect(githubOwnerOf('https://gitlab.com/a/b', 'https://github.com/')).toBeUndefined();
    expect(githubOwnerOf('https://github.com/-bad-/x/')).toBeUndefined();
  });
});

describe('icon cache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'somecode-icons-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const png = () => new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': 'image/png' } });

  it('downloads an avatar once, keeps it on disk, and asks only github.com', async () => {
    const fetchMock = vi.fn(async (_url: string) => png());
    const cache = createIconCache(dir, fetchMock as unknown as typeof fetch);
    const first = await cache.get('Acme');
    expect(first).toMatchObject({ type: 'image/png' });
    expect(Array.from(first!.bytes)).toEqual([1, 2, 3, 4]);
    await cache.get('Acme');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://github.com/Acme.png?size=96');
    expect((await readdir(dir)).sort()).toEqual(['acme.img', 'acme.type']);
    // A new cache (a restart) reads it from disk.
    const again = createIconCache(dir, vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    expect((await again.get('acme'))?.type).toBe('image/png');
  });

  it('warms many logos in the background, a few at a time, skipping bad names and what is on disk', async () => {
    let running = 0;
    let peak = 0;
    const fetchMock = vi.fn(async (_url: string) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return png();
    });
    const cache = createIconCache(dir, fetchMock as unknown as typeof fetch);
    await cache.get('already');
    fetchMock.mockClear();
    const owners = Array.from({ length: 12 }, (_, i) => `acct${i}`);
    await cache.warm([...owners, 'acct1', 'already', '../evil']);
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(6);
    expect((await readdir(dir)).filter((f) => f.endsWith('.img'))).toHaveLength(13);
  });

  it('refuses names that are not accounts, and anything that is not a small image', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    const cache = createIconCache(dir, fetchMock as unknown as typeof fetch);
    for (const bad of ['../etc', 'a/b', '', 'x'.repeat(60), 'a b']) expect(await cache.get(bad)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await cache.get('ok')).toBeNull();
    const big = createIconCache(dir, vi.fn(async () => new Response(new Uint8Array(400 * 1024), { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch);
    expect(await big.get('huge')).toBeNull();
  });

  it('does not ask again for an hour after a failure', async () => {
    let clock = 0;
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    const cache = createIconCache(dir, fetchMock as unknown as typeof fetch, () => clock);
    expect(await cache.get('ghost')).toBeNull();
    expect(await cache.get('ghost')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clock = 61 * 60_000;
    await cache.get('ghost');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
