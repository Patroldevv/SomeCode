import { describe, expect, it } from 'vitest';
import { buildGrid, compactTokens, cumulative, dayKey, monthMarks, summarize, weeklyTotals, type UsageDay } from './usageStats.ts';

const tokens = (n: number) => ({ input: n, output: 0, cacheWrite: 0, cacheRead: 0 });
const today = new Date(2026, 10, 12, 15); // Thursday 12 Nov 2026
const day = (date: string, claude = 0, opencode = 0): UsageDay => ({ date, agents: { ...(claude ? { claude: tokens(claude) } : {}), ...(opencode ? { opencode: tokens(opencode) } : {}) } });

describe('buildGrid', () => {
  it('lays out 53 weeks of 7 days, Monday first, ending with the week of today', () => {
    const { columns } = buildGrid([], null, today);
    expect(columns).toHaveLength(53);
    expect(columns.every((c) => c.length === 7)).toBe(true);
    const last = columns[52]!;
    expect(last[0]!.date).toBe('2026-11-09');
    expect(last.find((c) => c.today)?.date).toBe('2026-11-12');
    expect(last.filter((c) => c.future).map((c) => c.date)).toEqual(['2026-11-13', '2026-11-14', '2026-11-15']);
    expect(dayKey(new Date(2026, 10, 9, 12))).toBe('2026-11-09');
  });

  it('puts days into five levels on a square-root scale and filters by agent', () => {
    const days = [day('2026-11-12', 10_000), day('2026-11-11', 4_900), day('2026-11-10', 1_600), day('2026-11-09', 100), day('2026-11-08', 0, 1_000_000)];
    const all = buildGrid(days, null, today);
    const level = (g: ReturnType<typeof buildGrid>, date: string) => g.columns.flat().find((c) => c.date === date)!.level;
    expect(all.max).toBe(1_000_000);
    expect(level(all, '2026-11-08')).toBe(4);
    const claude = buildGrid(days, 'claude', today);
    expect(claude.max).toBe(10_000);
    expect([level(claude, '2026-11-12'), level(claude, '2026-11-11'), level(claude, '2026-11-10'), level(claude, '2026-11-09'), level(claude, '2026-11-08')]).toEqual([4, 3, 2, 1, 0]);
  });
});

describe('monthMarks', () => {
  it('marks where each month starts along the weeks', () => {
    const marks = monthMarks(buildGrid([], null, today).columns);
    expect(marks.at(-1)).toEqual({ column: 51, month: 10 });
    expect(new Set(marks.map((m) => m.month)).size).toBe(marks.length);
  });
});

describe('weeklyTotals, cumulative and summarize', () => {
  const days = [day('2026-11-12', 100), day('2026-11-11', 50), day('2026-11-10', 25), day('2026-11-04', 10), day('2026-11-03', 5), day('2026-10-01', 1000)];

  it('adds up per week and as a running total', () => {
    const weeks = weeklyTotals(days, null, today);
    expect(weeks).toHaveLength(52);
    expect(weeks.at(-1)).toEqual({ start: '2026-11-09', total: 175 });
    expect(weeks.at(-2)).toEqual({ start: '2026-11-02', total: 15 });
    const running = cumulative(days, null, today, 30);
    expect(running).toHaveLength(30);
    expect(running.at(-1)).toEqual({ date: '2026-11-12', total: 190 });
    expect(running[0]!.total).toBe(0);
  });

  it('counts active days, the busiest day, the current and the longest streak', () => {
    const s = summarize(days, null, today);
    expect(s).toMatchObject({ total: 1190, activeDays: 6, streak: 3, longestStreak: 3 });
    expect(s.busiest).toEqual({ date: '2026-10-01', total: 1000 });
    expect(s.average).toBeCloseTo(1190 / 6);
    expect(summarize([day('2026-11-11', 5)], null, today).streak).toBe(1);
    expect(summarize([day('2026-11-05', 5)], null, today).streak).toBe(0);
    expect(summarize([], null, today)).toMatchObject({ total: 0, busiest: null, streak: 0 });
  });
});

describe('compactTokens', () => {
  it('writes counts short', () => {
    expect([999, 12_400, 224_442_588, 2_413_581_278, 28_700_000].map(compactTokens)).toEqual(['999', '12k', '224M', '2.4B', '28.7M']);
  });
});
