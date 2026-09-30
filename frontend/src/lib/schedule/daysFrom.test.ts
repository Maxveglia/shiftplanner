// The period a manager means when they ask for a calendar and say no dates.
//
// It used to be the month, which asked on the 14th plans from the 1st: half
// the rota that comes back is a fortnight of history the manager cannot act
// on, and the fortnight they can is the tail of the screen. Four weeks from
// today is the period the question actually meant.

import { describe, expect, it } from 'vitest';
import { daysFrom } from './generate';

describe('daysFrom', () => {
  it('starts on the day it is given, not on a boundary', () => {
    const days = daysFrom(new Date(2026, 8, 14), 28);
    expect(days).toHaveLength(28);
    expect(days[0].date).toBe('2026-09-14');
    expect(days[27].date).toBe('2026-10-11');
  });

  it('carries each day its own weekday, across the month boundary', () => {
    const days = daysFrom(new Date(2026, 8, 14), 28);
    expect(days[0].weekday).toBe(1); // Monday 14 September 2026
    expect(days[27].weekday).toBe(0); // Sunday 11 October
  });

  it('crosses a year end without losing a day', () => {
    const days = daysFrom(new Date(2026, 11, 20), 28);
    expect(days[0].date).toBe('2026-12-20');
    expect(days[11].date).toBe('2026-12-31');
    expect(days[12].date).toBe('2027-01-01');
    expect(new Set(days.map((d) => d.date)).size).toBe(28);
  });

  it('survives the clocks going back', () => {
    // 25 October 2026 is the European DST change. Adding days on a Date is
    // where an hour of drift turns into a repeated or a skipped day.
    const days = daysFrom(new Date(2026, 9, 20), 14);
    expect(new Set(days.map((d) => d.date)).size).toBe(14);
    expect(days[5].date).toBe('2026-10-25');
    expect(days[6].date).toBe('2026-10-26');
  });
});
