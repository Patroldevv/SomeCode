import { describe, expect, it, vi } from 'vitest';
import { createUsageService } from './service.ts';
import { antigravityUsage, claudeUsage, openCodeUsage, type Sources } from './sources.ts';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const sources = (over: Partial<Sources> = {}): Sources => ({
  fetch: vi.fn(async () => new Response('{}')) as unknown as typeof fetch,
  readFile: async () => '{}',
  run: async () => '',
  home: '/home/u',
  now: () => NOW,
  ...over,
});
const credentials = (over: Record<string, unknown> = {}) => JSON.stringify({ claudeAiOauth: { accessToken: 'SECRET-TOKEN', expiresAt: NOW + 3_600_000, ...over } });

describe('claudeUsage', () => {
  it('reads the windows Claude reports (percent used, renewal time) with the stored login, and asks only Anthropic', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        five_hour: { utilization: 24.0, resets_at: '2026-11-08T21:40:00.702823+00:00' },
        seven_day: { utilization: 88, resets_at: '2026-11-13T00:00:00+00:00' },
        seven_day_opus: null,
        tangelo: { utilization: 5 },
      }),
    );
    const report = await claudeUsage(sources({ readFile: async (p) => (p === '/home/u/.claude/.credentials.json' ? credentials() : '{}'), fetch: fetchMock as unknown as typeof fetch }));
    expect(report.error).toBeUndefined();
    expect(report.limits.map((l) => [l.type, l.used, l.resetsAt])).toEqual([
      ['five_hour', 0.24, Date.parse('2026-11-08T21:40:00.702823+00:00')],
      ['seven_day', 0.88, Date.parse('2026-11-13T00:00:00+00:00')],
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer SECRET-TOKEN');
    expect(JSON.stringify(report)).not.toContain('SECRET-TOKEN');
  });

  it('says signed out for a missing, broken or expired login, and for a refused token', async () => {
    for (const readFile of [async () => { throw new Error('no file'); }, async () => 'nope', async () => credentials({ expiresAt: NOW - 1 }), async () => '{}']) {
      expect((await claudeUsage(sources({ readFile }))).error).toBe('signed_out');
    }
    const refused = vi.fn(async () => new Response('', { status: 401 }));
    expect((await claudeUsage(sources({ readFile: async () => credentials(), fetch: refused as unknown as typeof fetch }))).error).toBe('signed_out');
  });

  it('says unavailable when the service fails or the network is down', async () => {
    const down = vi.fn(async () => { throw new Error('offline'); });
    expect((await claudeUsage(sources({ readFile: async () => credentials(), fetch: down as unknown as typeof fetch }))).error).toBe('unavailable');
    const broken = vi.fn(async () => new Response('', { status: 500 }));
    expect((await claudeUsage(sources({ readFile: async () => credentials(), fetch: broken as unknown as typeof fetch }))).error).toBe('unavailable');
  });
});

describe('antigravityUsage', () => {
  const out = [
    'Gemini Models\tWeekly Limit Remaining\t53%\t2026-11-14T05:04:17Z',
    'Gemini Models\tFive Hour Limit Remaining\t78%\t2026-11-08T20:23:59Z',
    'Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t91%\t2026-11-15T00:55:17Z',
    'noise without tabs',
  ].join('\n');

  it('turns the quota lines of `agy /usage` into windows (percent remaining becomes used)', async () => {
    const run = vi.fn(async () => out);
    const report = await antigravityUsage(sources({ run }));
    expect(run).toHaveBeenCalledWith('agy', ['-p', '/usage'], expect.any(Number));
    expect(report.limits.map((l) => [l.label, l.type.split('|')[1], Math.round(l.used! * 100)])).toEqual([
      ['Gemini Models', 'seven_day', 47],
      ['Gemini Models', 'five_hour', 22],
      ['Gemini 4 Argon', 'seven_day', 9],
    ]);
    expect(report.limits[1]!.resetsAt).toBe(Date.parse('2026-11-08T20:23:59Z'));
  });

  it('says unavailable when agy fails or prints nothing usable', async () => {
    expect((await antigravityUsage(sources({ run: async () => { throw new Error('x'); } }))).error).toBe('unavailable');
    expect((await antigravityUsage(sources({ run: async () => 'hello' }))).error).toBe('unavailable');
  });
});

describe('openCodeUsage', () => {
  it('reports prompts and all tokens of the last week as plain figures (there is no limit)', async () => {
    const run = vi.fn(async () => JSON.stringify({ prompts: 48, tokens: { input: 100, output: 20, reasoning: 30, cache: { read: 850, write: 0 } } }));
    const report = await openCodeUsage(sources({ run }));
    expect(run).toHaveBeenCalledWith('opencode', ['stats', '--days', '7', '--json'], expect.any(Number));
    expect(report).toEqual({ limits: [], stats: [{ key: 'prompts7d', value: 48 }, { key: 'tokens7d', value: 1000 }] });
    expect((await openCodeUsage(sources({ run: async () => 'not json' }))).error).toBe('unavailable');
  });
});

describe('usage service', () => {
  const store = { getSetting: (k: string) => (k === 'limits:claude' ? JSON.stringify({ five_hour: { type: 'five_hour', used: 0.4, resetsAt: 1, status: 'allowed', updatedAt: 1 } }) : null) };

  it('remembers an answer for a while, and refreshes on request', async () => {
    let clock = NOW;
    const run = vi.fn(async () => JSON.stringify({ prompts: 1, tokens: {} }));
    const service = createUsageService(store, sources({ run, now: () => clock }));
    const agents = [{ id: 'opencode', label: 'OpenCode' }];
    await service.all(agents);
    await service.all(agents);
    expect(run).toHaveBeenCalledTimes(1);
    await service.all(agents, true);
    expect(run).toHaveBeenCalledTimes(2);
    clock += 61_000;
    await service.all(agents);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('falls back to what an agent reported while working when it cannot be asked, and keeps the error', async () => {
    const service = createUsageService(store, sources({ readFile: async () => { throw new Error('no file'); } }));
    const [claude, other] = await service.all([{ id: 'claude', label: 'Claude' }, { id: 'unknown', label: 'Other' }]);
    expect(claude).toMatchObject({ id: 'claude', error: 'signed_out' });
    expect(claude!.limits.map((l) => l.type)).toEqual(['five_hour']);
    expect(other).toMatchObject({ id: 'unknown', limits: [] });
    expect(other).not.toHaveProperty('error');
  });
});
