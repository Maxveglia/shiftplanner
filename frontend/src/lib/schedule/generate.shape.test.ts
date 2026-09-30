// The SHAPE of the shifts a brief asks for, not just how many people are on.
//
// Two requirements a manager can state that the generator used to accept and
// then quietly ignore, both from the same real brief: "turnos de cuatro horas"
// and "siempre alguien al cierre". Coverage looked right, so nothing reported
// a problem — the shifts were simply the wrong shape, and a shift of the wrong
// shape is how the lunch dip the manager asked for got staffed anyway.

import { describe, expect, it } from 'vitest';
import { generateSchedule } from './generate';
import { needAt } from './demand';
import { days, employee, spec, template } from '../../test/factories';

/** A shop open 9:00–22:00, six days, with the usual 8-hour templates. */
const TEMPLATES = [
  template({ name: 'Morning', start_time: '09:00', end_time: '17:00' }),
  template({ name: 'Evening', start_time: '15:00', end_time: '23:00' }),
];

const TEAM = ['Hugo', 'Adri', 'Aldridge', 'Ethan', 'Uri'].map((n) =>
  employee({ full_name: n }),
);

const WEEK = days('2026-09-07', 7); // Monday-first week

/*
 * Two people may work a split day.
 *
 * These tests are about the SHAPE of the shifts, so the roster has to be able
 * to cover the day at all — and thirteen open hours at two on the floor needs
 * six four-hour shifts from five people. Two splits is what makes that
 * possible; one leaves real gaps, which is a true answer to a different
 * question (see splitShifts.test.ts, where the allowance itself is the
 * subject).
 */
function shopSpec(over = {}) {
  return spec({
    openMin: 9 * 60,
    closeMin: 22 * 60,
    minStaff: 2,
    closedWeekdays: [0],
    splitShiftPeople: 2,
    ...over,
  });
}

/** How many people are on the floor at `minute` on `date`. */
function onFloor(
  assignments: { date: string; startMin: number; endMin: number }[],
  date: string,
  minute: number,
): number {
  return assignments.filter(
    (a) => a.date === date && a.startMin <= minute && a.endMin > minute,
  ).length;
}

describe('a stated shift length is a requirement, not a hint', () => {
  it('does not hand out eight-hour shifts when the brief asked for four', () => {
    // The templates are eight hours and the score prefers them — they resolve
    // more uncovered hours at once. The manager's sentence has to outrank that
    // preference, or asking for four hours does nothing at all.
    const s = shopSpec({ shiftLengthHours: 4 });
    const r = generateSchedule(TEAM, TEMPLATES, [], [], s, WEEK);

    expect(r.assignments.length).toBeGreaterThan(0);
    const longest = Math.max(...r.assignments.map((a) => a.endMin - a.startMin));
    expect(longest).toBeLessThanOrEqual(4 * 60);
  });

  it('leaves the templates alone when the brief never mentions a length', () => {
    // A business that said nothing about shift length expects its own
    // templates to be used as written. Capping unconditionally would rewrite
    // every existing customer's calendar.
    const s = shopSpec({ shiftLengthHours: null });
    const r = generateSchedule(TEAM, TEMPLATES, [], [], s, WEEK);

    const longest = Math.max(...r.assignments.map((a) => a.endMin - a.startMin));
    expect(longest).toBeGreaterThan(4 * 60);
  });

  it('lets a midday dip actually happen', () => {
    // The point of short shifts here: "two on the floor, but only one between
    // 13:00 and 15:00". With eight-hour shifts spanning lunch, the second
    // person is already there and the dip is unstaffable — the manager's
    // saving never materialises even though the requirement was understood.
    const s = shopSpec({
      shiftLengthHours: 4,
      coverage: [
        {
          weekdays: [],
          dates: [],
          startMin: 13 * 60,
          endMin: 15 * 60,
          staff: 1,
          exact: true,
        },
      ],
    });
    const monday = WEEK[0].date;
    const r = generateSchedule(TEAM, TEMPLATES, [], [], s, WEEK);

    expect(needAt(s, WEEK[0], 14)).toBe(1);
    expect(onFloor(r.assignments, monday, 14 * 60)).toBe(1);
    // And the hours either side are still fully covered.
    expect(onFloor(r.assignments, monday, 11 * 60)).toBe(2);
    expect(onFloor(r.assignments, monday, 16 * 60)).toBe(2);
  });
});

describe('the closing hour always has a shift that can reach it', () => {
  it('covers the last hour of a day that is not a whole number of shifts', () => {
    // 9:00–22:00 is thirteen hours; four-hour shifts stepping from opening end
    // at 21:00, and the leftover hour is too short to be synthesised. It used
    // to be covered only by accident, when a long template clipped to the
    // close happened to reach it — so capping shift length left the shop
    // unattended at closing time.
    const s = shopSpec({ shiftLengthHours: 4 });
    const r = generateSchedule(TEAM, TEMPLATES, [], [], s, WEEK);

    for (const d of WEEK.filter((x) => x.weekday !== 0)) {
      expect(onFloor(r.assignments, d.date, 21 * 60 + 30)).toBeGreaterThan(0);
    }
  });

  it('reports no coverage gaps for a brief its roster can actually staff', () => {
    const s = shopSpec({
      shiftLengthHours: 4,
      coverage: [
        {
          weekdays: [],
          dates: [],
          startMin: 13 * 60,
          endMin: 15 * 60,
          staff: 1,
          exact: true,
        },
      ],
    });
    const r = generateSchedule(TEAM, TEMPLATES, [], [], s, WEEK);
    expect(r.gaps).toEqual([]);
  });
});
