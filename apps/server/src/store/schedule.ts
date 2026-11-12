/** When a scheduled task runs: once at a moment, every so many minutes, or every day at a local time. */
export type ScheduleSpec =
  | { kind: 'once'; at: number }
  | { kind: 'every'; minutes: number }
  | { kind: 'daily'; at: string };

export const MIN_EVERY_MINUTES = 5;
export const MAX_EVERY_MINUTES = 60 * 24 * 31;
const DAILY = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Checks a spec that came from outside (an agent, the API); returns the cleaned spec or the reason it is refused. */
export function parseSpec(input: unknown, now: number): { ok: true; spec: ScheduleSpec } | { ok: false; reason: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, reason: 'say when: once (at), every (minutes) or daily (at HH:MM)' };
  const o = input as Record<string, unknown>;
  if (o['kind'] === 'once') {
    const at = typeof o['at'] === 'number' ? o['at'] : typeof o['at'] === 'string' ? Date.parse(o['at']) : NaN;
    if (!Number.isFinite(at)) return { ok: false, reason: 'the time to run once is not a valid date' };
    if (at < now - 60_000) return { ok: false, reason: 'that time is in the past' };
    return { ok: true, spec: { kind: 'once', at: Math.round(at) } };
  }
  if (o['kind'] === 'every') {
    const minutes = Number(o['minutes']);
    if (!Number.isInteger(minutes) || minutes < MIN_EVERY_MINUTES || minutes > MAX_EVERY_MINUTES) {
      return { ok: false, reason: `"every" takes whole minutes from ${MIN_EVERY_MINUTES} to ${MAX_EVERY_MINUTES}` };
    }
    return { ok: true, spec: { kind: 'every', minutes } };
  }
  if (o['kind'] === 'daily') {
    const m = typeof o['at'] === 'string' ? DAILY.exec(o['at'].trim()) : null;
    if (!m) return { ok: false, reason: '"daily" takes a time like 09:30' };
    return { ok: true, spec: { kind: 'daily', at: `${m[1]!.padStart(2, '0')}:${m[2]}` } };
  }
  return { ok: false, reason: 'say when: once (at), every (minutes) or daily (at HH:MM)' };
}

/** The first run: a once-task at its time, the others from `now`. */
export function firstRun(spec: ScheduleSpec, now: number): number {
  return spec.kind === 'once' ? Math.max(spec.at, now) : nextRun(spec, now)!;
}

/** The next run after `from` (null when a once-task has run). Daily times are in the computer's local time. */
export function nextRun(spec: ScheduleSpec, from: number): number | null {
  switch (spec.kind) {
    case 'once':
      return null;
    case 'every':
      return from + spec.minutes * 60_000;
    case 'daily': {
      const [h, m] = spec.at.split(':').map(Number) as [number, number];
      const next = new Date(from);
      next.setHours(h, m, 0, 0);
      if (next.getTime() <= from) next.setDate(next.getDate() + 1);
      return next.getTime();
    }
  }
}

/** A short plain description for lists and tool answers. */
export function describeSpec(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case 'once':
      return `once, ${new Date(spec.at).toLocaleString('en-GB')}`;
    case 'every':
      return spec.minutes % 60 === 0 ? `every ${spec.minutes / 60} h` : `every ${spec.minutes} min`;
    case 'daily':
      return `every day at ${spec.at}`;
  }
}
