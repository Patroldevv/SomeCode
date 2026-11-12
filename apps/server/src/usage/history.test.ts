import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUsageHistory, localDay, parseClaudeLine } from './history.ts';

let home: string;
beforeEach(() => (home = mkdtempSync(join(tmpdir(), 'somecode-history-'))));
afterEach(() => rmSync(home, { recursive: true, force: true }));

const noon = (daysAgo: number, now = Date.now()) => {
  const d = new Date(now - daysAgo * 86_400_000);
  d.setHours(12, 0, 0, 0);
  return d;
};
const line = (id: string, at: Date, usage: Record<string, number>, extra = '') =>
  `{"parentUuid":null,"message":{"model":"claude-x","id":"${id}","type":"message","role":"assistant","content":[{"type":"text","text":"hi ${extra}"}],"usage":${JSON.stringify({ ...usage, cache_creation: { ephemeral_5m_input_tokens: 5 }, output_tokens_details: { thinking_tokens: 1 } })}},"timestamp":"${at.toISOString()}"}`;

describe('parseClaudeLine', () => {
  it('reads the id, the moment and the four token figures of a message line, and nothing from other lines', () => {
    const at = noon(1);
    const parsed = parseClaudeLine(line('msg_A1', at, { input_tokens: 2, cache_creation_input_tokens: 30, cache_read_input_tokens: 400, output_tokens: 50 }));
    expect(parsed).toEqual({ id: 'msg_A1', at: at.getTime(), tokens: { input: 2, output: 50, cacheWrite: 30, cacheRead: 400 } });
    expect(parseClaudeLine('{"type":"user","message":{"content":"hello"},"timestamp":"2026-01-01T00:00:00Z"}')).toBeNull();
    expect(parseClaudeLine('{"message":{"usage":{"input_tokens":1}}}')).toBeNull();
  });
});

describe('createUsageHistory', () => {
  const write = (name: string, lines: string[]) => {
    mkdirSync(join(home, '.claude', 'projects', 'p'), { recursive: true });
    writeFileSync(join(home, '.claude', 'projects', 'p', name), `${lines.join('\n')}\n`);
  };

  it('adds up Claude\'s tokens per local day, counting a message once however often it was written', async () => {
    const now = Date.now();
    write('a.jsonl', [
      line('msg_1', noon(2, now), { input_tokens: 1, output_tokens: 5 }),
      // The same message again with more output (a later content block), and in a resumed copy of the chat.
      line('msg_1', noon(2, now), { input_tokens: 1, output_tokens: 20, cache_read_input_tokens: 100 }),
      line('msg_2', noon(0, now), { input_tokens: 3, output_tokens: 7, cache_creation_input_tokens: 9 }),
      '{"type":"user","message":{"content":"not usage"}}',
    ]);
    write('b.jsonl', [line('msg_1', noon(2, now), { input_tokens: 1, output_tokens: 20, cache_read_input_tokens: 100 }), line('msg_old', noon(400, now), { input_tokens: 99, output_tokens: 99 })]);
    const history = await createUsageHistory({ home, now: () => now }).get(30);
    expect(history.days).toEqual([
      { date: localDay(noon(2, now).getTime()), agents: { claude: { input: 1, output: 20, cacheWrite: 0, cacheRead: 100 } } },
      { date: localDay(noon(0, now).getTime()), agents: { claude: { input: 3, output: 7, cacheWrite: 9, cacheRead: 0 } } },
    ]);
    expect(history.sources).toEqual([
      { id: 'claude', label: 'Claude', state: 'ok' },
      { id: 'opencode', label: 'OpenCode', state: 'empty' },
      { id: 'agy', label: 'Antigravity', state: 'unsupported', note: expect.any(String) },
    ]);
    expect(history.to).toBe(localDay(now));
  });

  it('reads OpenCode\'s database too, by day, with reasoning counted as output', async () => {
    const now = Date.now();
    const dir = join(home, '.local', 'share', 'opencode');
    mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(join(dir, 'opencode.db'));
    db.exec('CREATE TABLE message (id TEXT, time_created INTEGER, data TEXT)');
    const put = db.prepare('INSERT INTO message VALUES (?, ?, ?)');
    const tokens = (i: number, o: number, r: number, w: number, c: number) => JSON.stringify({ role: 'assistant', tokens: { input: i, output: o, reasoning: r, cache: { write: w, read: c } } });
    put.run('1', noon(1, now).getTime(), tokens(10, 20, 5, 1, 2));
    put.run('2', noon(1, now).getTime() + 1000, tokens(1, 1, 0, 0, 0));
    put.run('3', noon(1, now).getTime(), JSON.stringify({ role: 'user' }));
    put.run('4', noon(500, now).getTime(), tokens(999, 999, 0, 0, 0));
    db.close();
    const history = await createUsageHistory({ home, now: () => now }).get(30);
    expect(history.days).toEqual([{ date: localDay(noon(1, now).getTime()), agents: { opencode: { input: 11, output: 26, cacheWrite: 1, cacheRead: 2 } } }]);
    expect(history.sources.find((s) => s.id === 'opencode')?.state).toBe('ok');
    expect(history.sources.find((s) => s.id === 'claude')?.state).toBe('empty');
  });

  it('survives having no data at all, reuses an answer for a few minutes and reads again when asked', async () => {
    let now = Date.now();
    const service = createUsageHistory({ home, now: () => now });
    const first = await service.get(10);
    expect(first.days).toEqual([]);
    write('late.jsonl', [line('msg_x', new Date(now), { input_tokens: 1, output_tokens: 1 })]);
    expect((await service.get(10)).days).toEqual([]);
    expect((await service.get(10, true)).days).toHaveLength(1);
    now += 6 * 60_000;
    expect((await service.get(10)).generatedAt).toBe(now);
  });

  it('keeps what it read in a cache file, so a new run reads only the transcripts that changed', async () => {
    const now = Date.now();
    write('a.jsonl', [line('msg_1', noon(1, now), { input_tokens: 4, output_tokens: 6 })]);
    const cacheFile = join(home, 'cache', 'usage-history.json');
    await createUsageHistory({ home, now: () => now, cacheFile }).get(30);
    await vi.waitFor(() => expect(existsSync(cacheFile)).toBe(true));
    // A second run trusts the cache for a transcript whose size and time did not change (proved by changing the cache).
    const saved = JSON.parse(readFileSync(cacheFile, 'utf8')) as { files: Record<string, { entries: number[][] }> };
    for (const f of Object.values(saved.files)) f.entries[0]![2] = 777;
    writeFileSync(cacheFile, JSON.stringify(saved));
    const again = await createUsageHistory({ home, now: () => now, cacheFile }).get(30);
    expect(again.days[0]!.agents['claude']).toMatchObject({ input: 777, output: 6 });
    // A bad cache is ignored.
    writeFileSync(cacheFile, 'not json');
    expect((await createUsageHistory({ home, now: () => now, cacheFile }).get(30)).days[0]!.agents['claude']).toMatchObject({ input: 4 });
  });
});
