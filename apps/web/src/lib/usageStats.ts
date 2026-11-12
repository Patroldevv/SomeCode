export type DayTokens = { input: number; output: number; cacheWrite: number; cacheRead: number };
export type UsageDay = { date: string; agents: Record<string, DayTokens> };
export type HistorySource = { id: string; label: string; state: 'ok' | 'empty' | 'unsupported'; note?: string };
export type UsageHistory = { from: string; to: string; days: UsageDay[]; sources: HistorySource[]; generatedAt: number };

export const totalOf = (t: DayTokens): number => t.input + t.output + t.cacheWrite + t.cacheRead;

/** The tokens of one day for the chosen agents (`null` = all of them). */
export function dayTotals(day: UsageDay | undefined, agent: string | null): DayTokens {
  const sum: DayTokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  if (!day) return sum;
  for (const [id, t] of Object.entries(day.agents)) {
    if (agent !== null && id !== agent) continue;
    sum.input += t.input;
    sum.output += t.output;
    sum.cacheWrite += t.cacheWrite;
    sum.cacheRead += t.cacheRead;
  }
  return sum;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A calendar day from its key, at noon so that a clock change never moves it. */
export const fromKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};
const addDays = (d: Date, n: number): Date => {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
};

export type Cell = { date: string; total: number; level: 0 | 1 | 2 | 3 | 4; tokens: DayTokens; today: boolean; future: boolean };

/**
 * The heatmap: columns are weeks (Monday first), rows the days of the week, ending with the week of `today`.
 * Levels 1-4 split the used days by how busy they were (a square-root scale, so one huge day does not wash the rest out).
 */
export function buildGrid(days: readonly UsageDay[], agent: string | null, today: Date, weeks = 53): { columns: Cell[][]; max: number } {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const first = addDays(monday, -(weeks - 1) * 7);
  const todayKey = dayKey(today);
  const cells: Cell[] = [];
  let max = 0;
  for (let i = 0; i < weeks * 7; i += 1) {
    const date = dayKey(addDays(first, i));
    const tokens = dayTotals(byDate.get(date), agent);
    const total = totalOf(tokens);
    max = Math.max(max, total);
    cells.push({ date, total, level: 0, tokens, today: date === todayKey, future: date > todayKey });
  }
  for (const c of cells) {
    if (c.total <= 0 || max <= 0) continue;
    const ratio = Math.sqrt(c.total / max);
    c.level = ratio > 0.75 ? 4 : ratio > 0.5 ? 3 : ratio > 0.25 ? 2 : 1;
  }
  const columns: Cell[][] = [];
  for (let w = 0; w < weeks; w += 1) columns.push(cells.slice(w * 7, w * 7 + 7));
  return { columns, max };
}

/** Months along the grid: the column where each month's first week starts. */
export function monthMarks(columns: readonly Cell[][]): { column: number; month: number }[] {
  const marks: { column: number; month: number }[] = [];
  let last = -1;
  columns.forEach((col, i) => {
    const month = fromKey(col[0]!.date).getMonth();
    if (month !== last) {
      // The first column only gets a label when there is room for it before the next month's.
      if (i > 0 || fromKey(col[0]!.date).getDate() <= 7) marks.push({ column: i, month });
      last = month;
    }
  });
  return marks;
}

/** Tokens per week (Monday first) for the last `weeks` weeks. */
export function weeklyTotals(days: readonly UsageDay[], agent: string | null, today: Date, weeks = 52): { start: string; total: number }[] {
  const { columns } = buildGrid(days, agent, today, weeks);
  return columns.map((col) => ({ start: col[0]!.date, total: col.reduce((s, c) => s + c.total, 0) }));
}

/** The running total over the last `span` days (one point per day). */
export function cumulative(days: readonly UsageDay[], agent: string | null, today: Date, span = 365): { date: string; total: number }[] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: { date: string; total: number }[] = [];
  let running = 0;
  for (let i = span - 1; i >= 0; i -= 1) {
    const date = dayKey(addDays(today, -i));
    running += totalOf(dayTotals(byDate.get(date), agent));
    out.push({ date, total: running });
  }
  return out;
}

export type Summary = { total: number; activeDays: number; busiest: { date: string; total: number } | null; streak: number; longestStreak: number; average: number };

export function summarize(days: readonly UsageDay[], agent: string | null, today: Date): Summary {
  const totals = days.map((d) => ({ date: d.date, total: totalOf(dayTotals(d, agent)) })).filter((d) => d.total > 0);
  const total = totals.reduce((s, d) => s + d.total, 0);
  const active = new Set(totals.map((d) => d.date));
  let longest = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const d of totals.map((t) => fromKey(t.date)).sort((a, b) => a.getTime() - b.getTime())) {
    run = previous && dayKey(addDays(previous, 1)) === dayKey(d) ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = d;
  }
  // The current streak counts back from today (or from yesterday, when today has not started yet).
  let streak = 0;
  let cursor = active.has(dayKey(today)) ? today : addDays(today, -1);
  while (active.has(dayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  const busiest = totals.reduce<{ date: string; total: number } | null>((best, d) => (!best || d.total > best.total ? d : best), null);
  return { total, activeDays: active.size, busiest, streak, longestStreak: longest, average: active.size > 0 ? total / active.size : 0 };
}

/** 1.2B, 224M, 12k: the way token counts are written. */
export function compactTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}
