import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const MAX_BYTES = 300 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const FAIL_MS = 60 * 60_000;

/** The GitHub account a plugin lives under (from its repository or homepage address), whose avatar serves as its logo. */
export function githubOwnerOf(...addresses: (string | undefined)[]): string | undefined {
  for (const address of addresses) {
    const match = address ? /^(?:https:\/\/(?:www\.)?github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\//.exec(address) : null;
    if (match && OWNER.test(match[1]!)) return match[1];
  }
  return undefined;
}

export type Icon = { bytes: Uint8Array; type: string };

/**
 * Logos for the catalogue: a GitHub account's avatar, fetched by the server from `github.com/<name>.png` (a fixed
 * address; only the account name varies and it is checked) and kept on disk, so each is downloaded once. A failure
 * is remembered for an hour.
 */
export function createIconCache(dir: string, fetchFn: typeof fetch = globalThis.fetch.bind(globalThis), now: () => number = Date.now) {
  const failed = new Map<string, number>();
  const inflight = new Map<string, Promise<Icon | null>>();
  const file = (owner: string) => join(dir, `${owner.toLowerCase()}.img`);
  const typeFile = (owner: string) => join(dir, `${owner.toLowerCase()}.type`);

  const load = async (owner: string): Promise<Icon | null> => {
    try {
      return { bytes: await readFile(file(owner)), type: (await readFile(typeFile(owner), 'utf8')).trim() };
    } catch {
      // Not on disk yet.
    }
    if ((failed.get(owner) ?? 0) > now()) return null;
    try {
      const res = await fetchFn(`https://github.com/${owner}.png?size=96`, { signal: AbortSignal.timeout(8_000) });
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!res.ok || !TYPES.has(type)) throw new Error('no image');
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error('bad size');
      await mkdir(dir, { recursive: true });
      await writeFile(file(owner), bytes);
      await writeFile(typeFile(owner), type);
      return { bytes, type };
    } catch {
      failed.set(owner, now() + FAIL_MS);
      return null;
    }
  };

  return {
    async get(owner: string): Promise<Icon | null> {
      if (!OWNER.test(owner)) return null;
      const running = inflight.get(owner);
      if (running) return running;
      const run = load(owner).finally(() => inflight.delete(owner));
      inflight.set(owner, run);
      return run;
    },
    /** Fetch the logos that are not on disk yet, a few at a time, in the background (never rejects). */
    async warm(owners: Iterable<string>, concurrency = 6): Promise<void> {
      const queue = [...new Set([...owners].filter((o) => OWNER.test(o)))];
      const worker = async () => {
        for (let owner = queue.shift(); owner !== undefined; owner = queue.shift()) await this.get(owner);
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
    },
  };
}
export type IconCache = ReturnType<typeof createIconCache>;
