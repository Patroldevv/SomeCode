import { describe, expect, it } from 'vitest';
import { describeSpec, firstRun, nextRun, parseSpec } from './schedule.ts';

const at = (h: number, m: number, day = 10) => new Date(2026, 10, day, h, m, 0, 0).getTime();

describe('parseSpec', () => {
  const now = at(12, 0);
  it('accepts the three kinds and cleans them', () => {
    expect(parseSpec({ kind: 'once', at: '2026-11-12T09:00:00' }, now)).toEqual({ ok: true, spec: { kind: 'once', at: new Date('2026-11-12T09:00:00').getTime() } });
    expect(parseSpec({ kind: 'every', minutes: 30 }, now)).toEqual({ ok: true, spec: { kind: 'every', minutes: 30 } });
    expect(parseSpec({ kind: 'daily', at: '9:05' }, now)).toEqual({ ok: true, spec: { kind: 'daily', at: '09:05' } });
  });
  it('refuses the past, too-short intervals, bad times and anything else', () => {
    for (const bad of [{ kind: 'once', at: '2020-01-01' }, { kind: 'once', at: 'soon' }, { kind: 'every', minutes: 1 }, { kind: 'every', minutes: 2.5 }, { kind: 'daily', at: '25:00' }, { kind: 'weekly' }, null, 'x']) {
      expect(parseSpec(bad, now)).toMatchObject({ ok: false });
    }
  });
});

describe('nextRun', () => {
  it('runs a once-task at its time and then never again', () => {
    expect(firstRun({ kind: 'once', at: at(15, 0) }, at(12, 0))).toBe(at(15, 0));
    expect(nextRun({ kind: 'once', at: at(15, 0) }, at(15, 0))).toBeNull();
  });
  it('steps an interval from the last run', () => {
    expect(nextRun({ kind: 'every', minutes: 15 }, at(12, 0))).toBe(at(12, 15));
  });
  it('picks today for a daily time still ahead and tomorrow for one that has passed', () => {
    expect(nextRun({ kind: 'daily', at: '18:30' }, at(12, 0))).toBe(at(18, 30));
    expect(nextRun({ kind: 'daily', at: '09:00' }, at(12, 0))).toBe(at(9, 0, 11));
    expect(nextRun({ kind: 'daily', at: '12:00' }, at(12, 0))).toBe(at(12, 0, 11));
  });
  it('describes a spec in plain words', () => {
    expect(describeSpec({ kind: 'every', minutes: 120 })).toBe('every 2 h');
    expect(describeSpec({ kind: 'every', minutes: 45 })).toBe('every 45 min');
    expect(describeSpec({ kind: 'daily', at: '09:00' })).toBe('every day at 09:00');
  });
});
