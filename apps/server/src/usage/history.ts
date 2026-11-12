import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** Tokens of one agent on one day, split the way the agents report them. */
export type DayTokens = { input: number; output: number; cacheWrite: number; cacheRead: number };
export type UsageDay = { date: string; agents: Record<string, DayTokens> };
export type HistorySource = { id: string; label: string; state: 'ok' | 'empty' | 'unsupported'; note?: string };
export type UsageHistory = { from: string; to: string; days: UsageDay[]; sources: HistorySource[]; generatedAt: number };

const ZERO = (): DayTokens => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
const DAY_MS = 86_400_000;

/** The local calendar day of a moment (usage is counted per day of the person's own clock). */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const num = (m: RegExpExecArray | null): number => (m ? Number(m[1]) : 0);

/**
 * One line of a Claude Code transcript: the assistant message's id, when it was written and its token use, read with
 * a few patterns instead of parsing the (often huge) JSON line. Null for a line that carries no usage.
 */
export function parseClaudeLine(line: string): { id: string; at: number; tokens: DayTokens } | null {
  if (!line.includes('"usage":{')) return null;
  const id = /"id":"(msg_[A-Za-z0-9_-]+)"/.exec(line)?.[1];
  const stamp = /"timestamp":"([^"]+)"/.exec(line)?.[1];
  if (!id || !stamp) return null;
  const at = Date.parse(stamp);
  if (!Number.isFinite(at)) return null;
  const usage = line.slice(line.indexOf('"usage":{'), line.indexOf('"usage":{') + 900);
  return {
    id,
    at,
    tokens: {
      input: num(/"input_tokens":(\d+)/.exec(usage)),
      output: num(/"output_tokens":(\d+)/.exec(usage)),
      cacheWrite: num(/"cache_creation_input_tokens":(\d+)/.exec(usage)),
      cacheRead: num(/"cache_read_input_tokens":(\d+)/.exec(usage)),
    },
  };
}

async function jsonlFiles(dir: string, depth = 0): Promise<{ path: string; mtimeMs: number; size: number }[]> {
  const out: { path: string; mtimeMs: number; size: number }[] = [];
  let names: import('node:fs').Dirent[];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of names) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && depth < 3) out.push(...(await jsonlFiles(path, depth + 1)));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const s = await stat(path).catch(() => null);
      if (s) out.push({ path, mtimeMs: s.mtimeMs, size: s.size });
    }
  }
  return out;
}

const USAGE_MARK = Buffer.from('"usage":{');

/**
 * The lines of a transcript that carry token use. The file is searched as bytes, and only those lines are turned into
 * text: most of a transcript (tool results, file contents) never is.
 */
async function usageLines(path: string): Promise<string[]> {
  const buffer = await readFile(path);
  const lines: string[] = [];
  let at = 0;
  for (let hit = buffer.indexOf(USAGE_MARK, at); hit !== -1; hit = buffer.indexOf(USAGE_MARK, at)) {
    const start = buffer.lastIndexOf(10, hit) + 1;
    const end = buffer.indexOf(10, hit);
    const stop = end === -1 ? buffer.length : end;
    lines.push(buffer.toString('utf8', start, stop));
    at = stop + 1;
    if (end === -1) break;
  }
  return lines;
}

type FileEntry = Map<string, { at: number; tokens: DayTokens }>;

/**
 * Daily token use of the agents that keep a record of it on this computer: Claude Code (its transcripts under
 * `~/.claude/projects`) and OpenCode (its database). An agent that keeps none (Antigravity) is reported as such.
 * Transcripts are read once and again only when a file changed.
 */
export function createUsageHistory(opts: { home: string; now?: () => number; /** Where what was read is kept between runs, so only changed transcripts are read again. */ cacheFile?: string }) {
  const now = opts.now ?? Date.now;
  const files = new Map<string, { stamp: string; entries: FileEntry }>();
  let cached: { at: number; days: number; result: UsageHistory } | null = null;
  let inflight: Promise<UsageHistory> | null = null;

  let loaded = false;
  async function loadCache(): Promise<void> {
    if (loaded || !opts.cacheFile) return;
    loaded = true;
    try {
      const raw = JSON.parse(await readFile(opts.cacheFile, 'utf8')) as { version?: number; files?: Record<string, { stamp: string; entries: [string, number, number, number, number, number][] }> };
      if (raw.version !== 1 || !raw.files) return;
      for (const [path, f] of Object.entries(raw.files)) {
        files.set(path, { stamp: f.stamp, entries: new Map(f.entries.map(([id, at, input, output, cacheWrite, cacheRead]) => [id, { at, tokens: { input, output, cacheWrite, cacheRead } }])) });
      }
    } catch {
      // No cache yet, or an unreadable one: everything is read once more.
    }
  }
  async function saveCache(): Promise<void> {
    if (!opts.cacheFile) return;
    try {
      const out: Record<string, { stamp: string; entries: [string, number, number, number, number, number][] }> = {};
      for (const [path, f] of files) out[path] = { stamp: f.stamp, entries: [...f.entries].map(([id, e]) => [id, e.at, e.tokens.input, e.tokens.output, e.tokens.cacheWrite, e.tokens.cacheRead]) };
      await mkdir(dirname(opts.cacheFile), { recursive: true });
      const temp = `${opts.cacheFile}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify({ version: 1, files: out }));
      await rename(temp, opts.cacheFile);
    } catch {
      // The cache only saves time: failing to write it costs nothing else.
    }
  }

  async function claudeEntries(cutoff: number): Promise<FileEntry[]> {
    await loadCache();
    const found = (await jsonlFiles(join(opts.home, '.claude', 'projects'))).filter((f) => f.mtimeMs >= cutoff);
    const out: FileEntry[] = [];
    for (const file of found) {
      const stamp = `${file.mtimeMs}:${file.size}`;
      const hit = files.get(file.path);
      if (hit && hit.stamp === stamp) {
        out.push(hit.entries);
        continue;
      }
      const entries: FileEntry = new Map();
      for (const line of await usageLines(file.path)) {
        const parsed = parseClaudeLine(line);
        if (!parsed) continue;
        // A message is written once per content block with the usage so far: the largest figures are the final ones.
        const before = entries.get(parsed.id);
        const t = parsed.tokens;
        entries.set(parsed.id, before ? { at: parsed.at, tokens: { input: Math.max(before.tokens.input, t.input), output: Math.max(before.tokens.output, t.output), cacheWrite: Math.max(before.tokens.cacheWrite, t.cacheWrite), cacheRead: Math.max(before.tokens.cacheRead, t.cacheRead) } } : { at: parsed.at, tokens: t });
      }
      files.set(file.path, { stamp, entries });
      out.push(entries);
    }
    // Files that are gone or too old no longer count.
    const keep = new Set(found.map((f) => f.path));
    for (const path of [...files.keys()]) if (!keep.has(path)) files.delete(path);
    if (out.length > 0) void saveCache();
    return out;
  }

  async function compute(days: number): Promise<UsageHistory> {
    const end = now();
    const cutoff = end - days * DAY_MS;
    const byDay = new Map<string, Record<string, DayTokens>>();
    const add = (date: string, agent: string, t: DayTokens) => {
      const day = byDay.get(date) ?? {};
      const sum = day[agent] ?? ZERO();
      sum.input += t.input;
      sum.output += t.output;
      sum.cacheWrite += t.cacheWrite;
      sum.cacheRead += t.cacheRead;
      day[agent] = sum;
      byDay.set(date, day);
    };
    const sources: HistorySource[] = [];

    try {
      const seen = new Set<string>();
      let counted = 0;
      for (const entries of await claudeEntries(cutoff)) {
        for (const [id, e] of entries) {
          if (e.at < cutoff || seen.has(id)) continue;
          seen.add(id);
          counted += 1;
          add(localDay(e.at), 'claude', e.tokens);
        }
      }
      sources.push({ id: 'claude', label: 'Claude', state: counted > 0 ? 'ok' : 'empty' });
    } catch {
      sources.push({ id: 'claude', label: 'Claude', state: 'empty' });
    }

    try {
      const db = new DatabaseSync(join(opts.home, '.local', 'share', 'opencode', 'opencode.db'), { readOnly: true });
      try {
        const rows = db
          .prepare(
            `SELECT date(time_created / 1000, 'unixepoch', 'localtime') AS d,
                    COALESCE(SUM(json_extract(data, '$.tokens.input')), 0) AS i,
                    COALESCE(SUM(json_extract(data, '$.tokens.output')), 0) + COALESCE(SUM(json_extract(data, '$.tokens.reasoning')), 0) AS o,
                    COALESCE(SUM(json_extract(data, '$.tokens.cache.write')), 0) AS w,
                    COALESCE(SUM(json_extract(data, '$.tokens.cache.read')), 0) AS r
               FROM message WHERE json_extract(data, '$.role') = 'assistant' AND time_created >= ? GROUP BY d`,
          )
          .all(cutoff) as { d: string; i: number; o: number; w: number; r: number }[];
        for (const r of rows) if (r.d) add(r.d, 'opencode', { input: r.i, output: r.o, cacheWrite: r.w, cacheRead: r.r });
        sources.push({ id: 'opencode', label: 'OpenCode', state: rows.some((r) => r.i + r.o + r.w + r.r > 0) ? 'ok' : 'empty' });
      } finally {
        db.close();
      }
    } catch {
      sources.push({ id: 'opencode', label: 'OpenCode', state: 'empty' });
    }

    sources.push({ id: 'agy', label: 'Antigravity', state: 'unsupported', note: 'keeps no token record on this computer' });

    const list = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, agents]) => ({ date, agents }));
    return { from: localDay(cutoff), to: localDay(end), days: list, sources, generatedAt: end };
  }

  return {
    /** The last `days` days (up to 366), reused for a few minutes; `refresh` reads again. */
    async get(days = 365, refresh = false): Promise<UsageHistory> {
      const span = Math.min(Math.max(Math.floor(days), 1), 366);
      if (!refresh && cached && cached.days === span && now() - cached.at < 5 * 60_000) return cached.result;
      if (inflight) return inflight;
      inflight = compute(span)
        .then((result) => {
          cached = { at: now(), days: span, result };
          return result;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
export type UsageHistoryService = ReturnType<typeof createUsageHistory>;
