// Applying the operations a refine prompt produces.
//
// The property under most pressure here is `appliedOps`. It feeds the adaptive
// layer that learns this business's standing preferences, and it is deliberately
// NOT the list of operations that were asked for: an operation this module
// refused — nobody was free, the range was nonsense — describes something that
// never happened to the business. Learning from one would mean teaching the
// product a preference out of our own rejected suggestion, and then applying it
// silently to every future calendar. `skipped` and `appliedOps` must therefore
// stay disjoint, whatever the operation.

import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from './refine';
import { generateSchedule } from './generate';
import { EMPTY_OVERLAY, blackoutKey } from './overlay';
import { slotKey as slot } from './diff';
import type { ScheduleResult, SchedulingSpec } from './types';
import { absenceType, days, employee, spec } from '../../test/factories';
import type { EmployeeOut } from '../../types';

const WEEK = days('2026-03-01', 7);
const WEDNESDAY = '2026-03-04';
const TYPES = [absenceType({ id: 'vac' })];

const ROSTER: EmployeeOut[] = [
  employee({ id: 'e1', full_name: 'Sarah Chen' }),
  employee({ id: 'e2', full_name: 'Hugo Martín' }),
  employee({ id: 'e3', full_name: 'Adri Blanco' }),
  employee({ id: 'e4', full_name: 'Uri Sanz' }),
];

const BASE = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1 });

function refine(ops: EditOp[], s: SchedulingSpec = BASE, roster = ROSTER) {
  const current: ScheduleResult = generateSchedule(roster, [], [], TYPES, s, WEEK);
  return {
    current,
    outcome: applyOps(ops, current, s, EMPTY_OVERLAY, roster, [], [], TYPES, WEEK),
  };
}

describe('applyOps — appliedOps records only what actually happened', () => {
  it('keeps a refused operation out of what the product learns from', () => {
    // One good instruction and one impossible one in the same sentence. The
    // impossible one must leave no trace anywhere but `skipped`.
    const { outcome } = refine([
      { op: 'set_min_staff', staff: 3 },
      { op: 'set_peak', start: '18:00', end: '10:00', staff: 4 },
    ]);

    expect(outcome.appliedOps).toEqual([{ op: 'set_min_staff', staff: 3 }]);
    expect(outcome.skipped).toHaveLength(1);
  });

  it('never lists the same operation as both applied and skipped', () => {
    const ops: EditOp[] = [
      { op: 'set_min_staff', staff: 2 },
      { op: 'set_min_staff', staff: 99 }, // out of range
      { op: 'set_max_weekly_hours', hours: 35 },
      { op: 'set_max_weekly_hours', hours: 0 }, // out of range
      { op: 'set_hours', open: '08:00', close: '20:00' },
      // Zero minutes long. `20:00` to `08:00` used to sit here as the invalid
      // case and no longer is: a close before an open is a night now, so the
      // only set_hours that says nothing is one that says the same minute
      // twice.
      { op: 'set_hours', open: '20:00', close: '20:00' },
      { op: 'add_shift', employee: 'Nobody At All', date: WEDNESDAY, start: '09:00', end: '17:00' },
    ];
    const { outcome } = refine(ops);

    expect(outcome.appliedOps).toHaveLength(3);
    expect(outcome.skipped).toHaveLength(4);
    for (const op of outcome.appliedOps) {
      expect(ops.indexOf(op)).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses a shift whose hours cannot be read as a time at all', () => {
    const { outcome } = refine([
      { op: 'add_shift', employee: 'Sarah Chen', date: WEDNESDAY, start: 'later', end: '17:00' },
    ]);

    expect(outcome.appliedOps).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(1);
  });

  it('refuses a shift longer than any legal day', () => {
    // 6 AM to 5 AM reads as twenty-three hours once it is rolled over midnight.
    // Placing it would put a shift on the calendar no jurisdiction allows.
    const { outcome } = refine([
      { op: 'add_shift', employee: 'Sarah Chen', date: WEDNESDAY, start: '06:00', end: '05:00' },
    ]);
    expect(outcome.appliedOps).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(1);
    expect(
      outcome.result.assignments.filter(
        (a) => a.employeeId === 'e1' && a.date === WEDNESDAY && a.startMin === 6 * 60,
      ),
    ).toHaveLength(0);
  });

  it('refuses to give somebody a second shift on a day they are already working', () => {
    // Whoever the generator put on that Wednesday: a split day is something a
    // manager offers, not something a prompt should impose by accident.
    const before = generateSchedule(ROSTER, [], [], TYPES, BASE, WEEK);
    const onDuty = before.assignments.find((a) => a.date === WEDNESDAY);
    expect(onDuty).toBeDefined();
    const name = ROSTER.find((e) => e.id === onDuty!.employeeId)!.full_name;

    const outcome = applyOps(
      [{ op: 'add_shift', employee: name, date: WEDNESDAY, start: '09:00', end: '13:00' }],
      before,
      BASE,
      EMPTY_OVERLAY,
      ROSTER,
      [],
      [],
      TYPES,
      WEEK,
    );

    expect(outcome.appliedOps).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(1);
  });

  it('refuses to place a shift on someone who cannot work that day', () => {
    const roster = [employee({ id: 'gone', full_name: 'Gone Away', employment_status: 'resigned' })];
    const { outcome } = refine(
      [{ op: 'add_shift', employee: 'Gone Away', date: WEDNESDAY, start: '09:00', end: '17:00' }],
      BASE,
      roster,
    );

    expect(outcome.appliedOps).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.result.assignments).toHaveLength(0);
  });

  it('records extra cover only when somebody was actually free to take it', () => {
    // "One more person on Wednesday evening" with nobody available is a request
    // the manager has to see refused — and certainly not a preference to learn.
    const roster = [employee({ id: 'gone', full_name: 'Gone Away', employment_status: 'resigned' })];
    const { outcome } = refine(
      [{ op: 'add_coverage', date: WEDNESDAY, start: '18:00', end: '22:00', staff: 1 }],
      BASE,
      roster,
    );

    expect(outcome.appliedOps).toHaveLength(0);
    expect(outcome.skipped).toHaveLength(1);
  });

  it('records extra cover that really was placed', () => {
    const { outcome } = refine([
      { op: 'add_coverage', date: WEDNESDAY, start: '18:00', end: '22:00', staff: 1 },
    ]);

    expect(outcome.appliedOps).toEqual([
      { op: 'add_coverage', date: WEDNESDAY, start: '18:00', end: '22:00', staff: 1 },
    ]);
    expect(
      outcome.result.assignments.filter(
        (a) => a.date === WEDNESDAY && a.startMin === 18 * 60,
      ).length,
    ).toBe(1);
  });
});

describe('applyOps — a change of requirements rebuilds the calendar', () => {
  it('rebuilds after every operation that changes what the business needs', () => {
    const requirementOps: EditOp[] = [
      { op: 'set_min_staff', staff: 2 },
      { op: 'set_peak', start: '18:00', end: '21:00', staff: 3 },
      { op: 'set_hours', open: '08:00', close: '20:00' },
      { op: 'set_closed_day', weekday: 1, closed: true },
      { op: 'set_max_weekly_hours', hours: 32 },
    ];

    for (const op of requirementOps) {
      const { outcome } = refine([op]);
      expect(outcome.regenerated).toBe(true);
      expect(outcome.appliedOps).toEqual([op]);
    }
  });

  it('leaves the calendar alone for an edit that changes no requirement', () => {
    // A surgical edit is re-costed in place. Regenerating for one would throw
    // away the rest of the manager's work to move a single shift.
    const { outcome } = refine([{ op: 'day_off', employee: 'Sarah Chen', date: WEDNESDAY }]);
    expect(outcome.regenerated).toBe(false);
  });

  it('does not rebuild on an instruction it refused', () => {
    const { outcome } = refine([{ op: 'set_min_staff', staff: 0 }]);
    expect(outcome.regenerated).toBe(false);
    expect(outcome.appliedOps).toHaveLength(0);
    expect(outcome.spec.minStaff).toBe(BASE.minStaff);
  });

  it('carries the new requirement into the spec it returns', () => {
    const { outcome } = refine([{ op: 'set_closed_day', weekday: 0, closed: true }]);
    expect(outcome.spec.closedWeekdays).toContain(0);
    expect(outcome.result.assignments.filter((a) => a.date === '2026-03-01')).toHaveLength(0);
  });
});

describe('applyOps — the manager’s decisions survive the rebuild', () => {
  it('remembers a day off as intent, not just as a deletion', () => {
    // "Sarah is off on Friday" then "open until 11 PM" used to hand Sarah her
    // Friday back with no warning, because the second instruction regenerated
    // from scratch. The blackout is what stops that.
    const { outcome } = refine([{ op: 'day_off', employee: 'Sarah Chen', date: WEDNESDAY }]);
    expect(outcome.overlay.blackouts).toContain(blackoutKey('e1', WEDNESDAY));
  });

  it('keeps a day off through a later change of requirements', () => {
    const { outcome } = refine([
      { op: 'day_off', employee: 'Sarah Chen', date: WEDNESDAY },
      { op: 'set_min_staff', staff: 2 },
    ]);

    expect(outcome.regenerated).toBe(true);
    expect(
      outcome.result.assignments.filter(
        (a) => a.employeeId === 'e1' && a.date === WEDNESDAY,
      ),
    ).toHaveLength(0);
    // The rest of the shop is still staffed — the day off cost Sarah her shift,
    // not everybody's.
    expect(
      outcome.result.assignments.filter((a) => a.date === WEDNESDAY).length,
    ).toBeGreaterThan(0);
  });

  it('keeps a hand-placed shift through a later change of requirements', () => {
    const { outcome } = refine([
      { op: 'add_shift', employee: 'Hugo Martín', date: WEDNESDAY, start: '10:00', end: '14:00' },
      { op: 'set_min_staff', staff: 2 },
    ]);

    const pinned = outcome.result.assignments.filter(
      (a) => a.employeeId === 'e2' && a.date === WEDNESDAY && a.startMin === 10 * 60,
    );
    expect(pinned).toHaveLength(1);
  });
});

// --- An adjustment changes what was asked and nothing else ------------------
//
// The reason the product is trusted in week two. "Give Sarah Friday off" must
// leave every other shift exactly where the team already saw it; what it may
// do beyond Sarah's Friday is cover the hole she leaves, on that day only.
// No model is involved in this: it is `applyOps` and the deterministic refill.

describe('applyOps — a surgical edit is surgical', () => {
  const FIVE: EmployeeOut[] = [
    ...ROSTER,
    employee({ id: 'e5', full_name: 'Nora Vidal' }),
  ];
  const FRIDAY = '2026-03-06';

  it('"give Sarah Friday off" touches Sarah’s Friday and the hole she leaves, nothing else', () => {
    // Two on the floor at once, so Sarah's absence leaves a real hole.
    const two = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 2 });
    const { current, outcome } = refine(
      [{ op: 'day_off', employee: 'Sarah Chen', date: FRIDAY }],
      two,
      FIVE,
    );
    const sarahFriday = current.assignments.filter(
      (a) => a.employeeId === 'e1' && a.date === FRIDAY,
    );
    expect(sarahFriday.length).toBeGreaterThan(0);
    expect(outcome.regenerated).toBe(false);

    const before = new Set(current.assignments.map(slot));
    const after = new Set(outcome.result.assignments.map(slot));

    // Everything that was not Sarah's Friday is still there, untouched.
    for (const a of current.assignments) {
      if (a.employeeId === 'e1' && a.date === FRIDAY) continue;
      expect(after.has(slot(a)), `lost ${slot(a)}`).toBe(true);
    }
    // Sarah is off on Friday.
    expect(
      outcome.result.assignments.some((a) => a.employeeId === 'e1' && a.date === FRIDAY),
    ).toBe(false);
    // Whatever is new is on Friday, and it is not Sarah.
    const added = outcome.result.assignments.filter((a) => !before.has(slot(a)));
    expect(added.length).toBeGreaterThan(0);
    for (const a of added) {
      expect(a.date).toBe(FRIDAY);
      expect(a.employeeId).not.toBe('e1');
    }
    // And the day is still covered.
    expect(
      outcome.result.gaps.filter((g) => g.date === FRIDAY),
    ).toHaveLength(0);
  });

  it('an older gap elsewhere is left alone', () => {
    // Three needed, five people on eight-hour days across a week: the
    // generator cannot staff every hour, so the calendar has gaps before
    // Sarah's day off. Those gaps are the manager's business, not this edit's.
    const three = spec({ openMin: 8 * 60, closeMin: 22 * 60, minStaff: 3 });
    const { current, outcome } = refine(
      [{ op: 'day_off', employee: 'Sarah Chen', date: FRIDAY }],
      three,
      FIVE,
    );
    const before = new Set(current.assignments.map(slot));
    const added = outcome.result.assignments.filter((a) => !before.has(slot(a)));
    for (const a of added) expect(a.date).toBe(FRIDAY);
    const gapsBefore = current.gaps.filter((g) => g.date !== FRIDAY).length;
    const gapsAfter = outcome.result.gaps.filter((g) => g.date !== FRIDAY).length;
    expect(gapsAfter).toBe(gapsBefore);
  });
});

describe('applyOps — a stretch of days is one instruction', () => {
  // "Juanito cannot work from the 15th to the 22nd" is the sentence this
  // exists for. It used to arrive as a day_off on the 15th and nothing else:
  // the model had no way to say a range, so it either said one day or said
  // eight operations and dropped some. The manager read "Juanito is off on the
  // 15th", believed the week was handled, and found him on the rota on the
  // 17th.
  const MARCH = days('2026-03-01', 31);
  const BEFORE: ScheduleResult = generateSchedule(ROSTER, [], [], TYPES, BASE, MARCH);
  const WHOLE_MONTH = (ops: EditOp[]) =>
    applyOps(ops, BEFORE, BASE, EMPTY_OVERLAY, ROSTER, [], [], TYPES, MARCH);
  /** One person's shifts as slot keys, so two calendars can be compared. */
  const shiftsOf = (r: ScheduleResult, id: string, from: string, to: string) =>
    r.assignments
      .filter((a) => a.employeeId === id && a.date >= from && a.date <= to)
      .map(slot)
      .sort();

  it('clears every day of the range, not just the first', () => {
    const outcome = WHOLE_MONTH([
      { op: 'day_off', employee: 'Sarah Chen', date: '2026-03-15', dateTo: '2026-03-22' },
    ]);

    expect(shiftsOf(outcome.result, 'e1', '2026-03-15', '2026-03-22')).toEqual([]);
    // BOTH ENDS INCLUDED, and not a day more. A range read as exclusive puts
    // somebody on the rota on the day they told you they could not work, and
    // the two failures look identical until that morning.
    // The range had something to clear, or this test passes on an empty week.
    expect(shiftsOf(BEFORE, 'e1', '2026-03-15', '2026-03-22').length).toBeGreaterThan(0);
    expect(shiftsOf(outcome.result, 'e1', '2026-03-01', '2026-03-14')).toEqual(
      shiftsOf(BEFORE, 'e1', '2026-03-01', '2026-03-14'),
    );
    expect(shiftsOf(outcome.result, 'e1', '2026-03-23', '2026-03-31')).toEqual(
      shiftsOf(BEFORE, 'e1', '2026-03-23', '2026-03-31'),
    );
  });

  it('remembers the whole range as intent, so a later rebuild keeps it', () => {
    const outcome = WHOLE_MONTH([
      { op: 'day_off', employee: 'Sarah Chen', date: '2026-03-15', dateTo: '2026-03-22' },
      { op: 'set_min_staff', staff: 2 },
    ]);

    expect(outcome.regenerated).toBe(true);
    expect(
      outcome.result.assignments.filter(
        (a) => a.employeeId === 'e1' && a.date >= '2026-03-15' && a.date <= '2026-03-22',
      ),
    ).toEqual([]);
  });

  it('reads a range said backwards as the days the manager meant', () => {
    // "from the 22nd to the 15th" is somebody saying the two days in the order
    // they came to mind. Read literally it matches nothing, which looks
    // exactly like a day off that worked.
    const outcome = WHOLE_MONTH([
      { op: 'day_off', employee: 'Sarah Chen', date: '2026-03-22', dateTo: '2026-03-15' },
    ]);

    expect(
      outcome.result.assignments.filter(
        (a) => a.employeeId === 'e1' && a.date >= '2026-03-15' && a.date <= '2026-03-22',
      ),
    ).toEqual([]);
    expect(outcome.skipped).toEqual([]);
  });

  it('narrows a range by weekday when both are given', () => {
    // "the Fridays of this fortnight" — the only time a range and a weekday
    // are both meant.
    const outcome = WHOLE_MONTH([
      {
        op: 'day_off',
        employee: 'Sarah Chen',
        date: '2026-03-01',
        dateTo: '2026-03-31',
        weekday: 5,
      },
    ]);

    const hers = outcome.result.assignments.filter((a) => a.employeeId === 'e1');
    expect(hers.some((a) => a.date === '2026-03-06')).toBe(false); // a Friday
    expect(hers.some((a) => a.date === '2026-03-13')).toBe(false); // and the next
    // The Thursdays are hers exactly as they were: the weekday narrowed the
    // range, it did not clear it.
    expect(shiftsOf(outcome.result, 'e1', '2026-03-05', '2026-03-05')).toEqual(
      shiftsOf(BEFORE, 'e1', '2026-03-05', '2026-03-05'),
    );
  });

  it('keeps a range that runs off the end of the horizon inside it', () => {
    // A `dateTo` the model pushed into next year clears the days on screen and
    // nothing else — the horizon is the guard, so no ceiling is needed here.
    const outcome = WHOLE_MONTH([
      { op: 'day_off', employee: 'Sarah Chen', date: '2026-03-28', dateTo: '2027-01-01' },
    ]);

    expect(
      outcome.result.assignments.filter((a) => a.employeeId === 'e1' && a.date >= '2026-03-28'),
    ).toEqual([]);
    expect(outcome.skipped).toEqual([]);
  });
});
