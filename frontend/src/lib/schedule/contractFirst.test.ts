// The full-timers' week is the fixed one; the part-timers' is the one that flexes.
//
// A bar open 17:00-03:00 (04:00 at weekends), two people always, four on forty
// hours and two part-timers, under the Spanish floor. The coverage pass
// charged every hour as a cost, so it closed each gap with the shortest shift
// that would do -- 23:00-03:00 rather than 19:00-03:00 -- and the forty-hour
// people ended every week at 35.5-38, built of four-hour shifts. An hour inside
// somebody's contract is paid anyway; it now costs nothing extra.

import { describe, expect, it } from 'vitest';
import { contract, days, employee, spec } from '../../test/factories';
import { generateSchedule, weekKey } from './generate';
import { OBJECTIVES } from './objective';

const TEAM = [
  ['max', 40], ['enzo', 40], ['alberto', 40], ['arnau', 40], ['luka', 20], ['diego', 16],
] as const;
const FULL = ['max', 'enzo', 'alberto', 'arnau'];
const roster = TEAM.map(([id, h]) =>
  employee({ id, full_name: id, current_contract: contract({ employee_id: id, min_hours_per_week: h }) }),
);
const bar = spec({
  openMin: 17 * 60,
  closeMin: 27 * 60,
  minStaff: 2,
  maxHoursPerWeek: 40,
  dayHours: [0, 6].map((weekday) => ({ weekday, openMin: 17 * 60, closeMin: 28 * 60 })),
  minRestHours: 12,
  maxDailyHours: 9,
  weeklyRestHours: 36,
  nightAverageMax: 8,
  nightWindow: { startHour: 22, endHour: 6 },
  weeklyAverageHours: 40,
});
// Four whole Sunday-to-Saturday weeks of October 2026.
const result = generateSchedule(roster, [], [], [], bar, days('2026-10-05', 28));

function weeks(id: string, of = result): number[] {
  const out: Record<string, number> = {};
  for (const a of of.assignments) {
    if (a.employeeId === id) out[weekKey(a.date)] = (out[weekKey(a.date)] ?? 0) + a.paidHours;
  }
  return Object.values(out);
}

describe('a forty-hour contract in a bar that closes at three', () => {
  it('works close to forty every week, never above', () => {
    for (const id of FULL) {
      const w = weeks(id);
      expect(w).toHaveLength(4);
      for (const hours of w) {
        // Before: 35.5-38. Thirty-eight is where a six-shift week lands when
        // one of the six is the short closing shift, and that is allowed.
        expect(hours, `${id}: ${w.join(', ')}`).toBeGreaterThanOrEqual(38);
        expect(hours, `${id}: ${w.join(', ')}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it('keeps the part-timers near their contracts, not near the full-timers', () => {
    for (const hours of weeks('diego')) expect(hours).toBeLessThanOrEqual(20);
    for (const hours of weeks('luka')) expect(hours).toBeLessThanOrEqual(24);
  });

  it('still covers every hour', () => {
    expect(result.gaps).toEqual([]);
  });
});

// The same bar under `fair`, which shares hours out five times harder than the
// default. It gave Diego 24 hours every week on a 16-hour contract and Luka up
// to 29.5 on 20, while the full-timers still reached forty: two of them spent
// a Sunday's padding hours on 21:00-03:00 alongside people already on until
// 23:30, and left the 03:00-04:00 close to a part-timer on a five-hour shift.
// Sharing out is a preference between people inside their contracts; it does
// not get to push somebody past theirs when a full-timer could have closed the
// same hole (see `pick` and `padding` in the coverage pass).
describe('the same bar under the fair objective', () => {
  const fair = generateSchedule(
    roster,
    [],
    [],
    [],
    { ...bar, objective: OBJECTIVES.fair },
    days('2026-10-05', 28),
  );

  it('keeps the part-timers near their contracts every week', () => {
    for (const [id, cap] of [['diego', 20], ['luka', 24]] as const) {
      const w = weeks(id, fair);
      expect(w, id).toHaveLength(4);
      for (const hours of w) {
        expect(hours, `${id}: ${w.join(', ')}`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it('still fills the full-timers and covers every hour', () => {
    for (const id of FULL) {
      const w = weeks(id, fair);
      expect(w).toHaveLength(4);
      for (const hours of w) {
        expect(hours, `${id}: ${w.join(', ')}`).toBeGreaterThanOrEqual(38);
        expect(hours, `${id}: ${w.join(', ')}`).toBeLessThanOrEqual(40);
      }
    }
    expect(fair.gaps).toEqual([]);
  });
});
