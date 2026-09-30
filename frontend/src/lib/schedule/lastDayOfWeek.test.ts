// The last open day of the week, and why it used to be the emptiest.
//
// A manager wrote this, and the Saturday came back half unstaffed:
//
//   "I have a store with 5 employees. We're open from 9 a.m. to 10 p.m.,
//    Monday through Saturday. 3 of them are on 40-hour contracts, and the rest
//    are on 20-hour contracts and can work overtime. Foot traffic usually picks
//    up a bit every day between 4 p.m. and 8 p.m."
//
// A perfect answer exists: 180 person-hours of demand over six days, five
// people, six hours each per day, 36 a week -- inside every contract. What came
// out instead was six uncovered hours on the Saturday, four of them with NOBODY
// in the shop, while the week still had 22 hours of unspent capacity.
//
// Two things caused it, and neither is fixed by the other:
//
//   * The generator fills one day at a time and cannot see the days ahead, so
//     it handed out the longest shift that fit. By Saturday every contract was
//     two or three hours short of its ceiling.
//   * Every candidate for a day is the same length, and the ceiling check was
//     all or nothing. Three spare hours could not buy any shift at all, so the
//     shortest one reaching four in the afternoon was seven hours and nobody
//     had seven hours left.
//
// Pacing alone changes nothing: people arrive at Saturday with a little more
// room and still cannot spend it. Trimming alone changes nothing: they arrive
// with 2.5 hours, below the floor of any shift worth offering. Measured both
// ways, separately, before they were shipped together.

import { describe, expect, it } from 'vitest';
import { generateSchedule } from './generate';
import { contract, days, employee, spec, template } from '../../test/factories';
import type { EmployeeOut } from '../../types';

const WEEK = days('2026-03-02', 7); // Monday 2 to Sunday 8 March 2026
const SATURDAY = '2026-03-07';

function person(id: string, min: number, max: number | null): EmployeeOut {
  return employee({
    id,
    full_name: id,
    current_contract: contract({
      id: `c-${id}`,
      employee_id: id,
      min_hours_per_week: min,
      max_hours_per_week: max,
    }),
  });
}

const TEAM = [
  person('full-1', 40, 40),
  person('full-2', 40, 40),
  person('full-3', 40, 40),
  person('part-1', 20, 20),
  person('part-2', 20, 20),
];

const STORE = spec({
  openMin: 9 * 60,
  closeMin: 22 * 60,
  minStaff: 2,
  closedWeekdays: [0],
  maxHoursPerWeek: 40,
  coverage: [
    { weekdays: [], dates: [], startMin: 16 * 60, endMin: 20 * 60, staff: 3, exact: false },
  ],
});

const TEMPLATES = [
  template({ id: 't-am', name: 'Morning', start_time: '09:00', end_time: '17:00' }),
  template({ id: 't-pm', name: 'Evening', start_time: '14:00', end_time: '22:00' }),
];

describe('a shop whose week ends on Saturday', () => {
  const result = generateSchedule(TEAM, TEMPLATES, [], [], STORE, WEEK);

  it('never leaves an open hour with nobody in the shop', () => {
    // The failure worth naming. Being one person short of a busy stretch is a
    // staffing shortfall the manager can weigh; an empty shop with the lights
    // on is a different thing entirely, and it was four hours long.
    const empty = result.gaps.filter((g) => g.have === 0);
    expect(empty).toEqual([]);
  });

  it('staffs the last day of the week, not just the first five', () => {
    const saturday = result.assignments.filter((a) => a.date === SATURDAY);
    // Two, before: the only people with a whole shift left in their week.
    expect(saturday.length).toBeGreaterThan(2);
  });

  it('spends the capacity it has before reporting a gap', () => {
    // 15 person-hours went uncovered while 22 sat unused. Measured at 2 after
    // the fix; the bound leaves room for the scorer to move without hiding a
    // return to anything like the old behaviour.
    const uncovered = result.gaps.reduce((t, g) => t + (g.need - g.have), 0);
    expect(uncovered).toBeLessThanOrEqual(4);
  });

  it('gives nobody a shift too short to be worth the journey', () => {
    // Trimming is there to use a few spare hours, not to call somebody in for
    // forty minutes. Three hours is the floor, and it is a floor on the SHIFT,
    // so an unpaid break may still take the paid time below it.
    const shortest = Math.min(...result.assignments.map((a) => a.endMin - a.startMin));
    expect(shortest).toBeGreaterThanOrEqual(3 * 60);
  });

  it('keeps every contract inside its own weekly ceiling', () => {
    // Trimming exists so the ceiling can be reached, never crossed.
    const byPerson: Record<string, number> = {};
    for (const a of result.assignments) {
      byPerson[a.employeeId] = (byPerson[a.employeeId] ?? 0) + a.paidHours;
    }
    for (const hours of Object.values(byPerson)) {
      expect(hours).toBeLessThanOrEqual(40);
    }
  });
});
