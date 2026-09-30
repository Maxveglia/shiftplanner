// The validator, tested against the one thing that would make it worthless:
// disagreeing with the generator.
//
// Every other test here builds a broken calendar by hand and checks it is
// caught. The FIRST describe block is the load-bearing one -- it takes what
// `generateSchedule` actually produces and asserts the validator finds nothing
// hard wrong with it. If that ever fails, one of the two files is wrong about
// the rules, and until now nothing in the codebase could tell us which.

import { describe, expect, it } from 'vitest';
import { generateSchedule } from './generate';
import { validateSchedule, type ViolationKind } from './validate';
import {
  absence,
  absenceType,
  contract,
  days,
  employee,
  spec,
  template,
} from '../../test/factories';
import type { Assignment, DayRef, SchedulingSpec } from './types';
import type { AbsenceOut, EmployeeOut, ShiftTemplateOut } from '../../types';

const WEEK = days('2026-03-02', 7); // Monday 2 March to Sunday 8 March
const VACATION = absenceType({ id: 'vac' });
const TPL: ShiftTemplateOut = template({ id: 'tpl1' });

function team(n: number, over: Partial<EmployeeOut> = {}): EmployeeOut[] {
  return Array.from({ length: n }, (_, i) =>
    employee({ id: `e${i + 1}`, full_name: `Person ${i + 1}`, ...over }),
  );
}

/** One shift, with the derived fields filled the way the pricer will fill them. */
function shift(over: Partial<Assignment> = {}): Assignment {
  const startMin = over.startMin ?? 9 * 60;
  const endMin = over.endMin ?? 17 * 60;
  return {
    id: 'a1',
    employeeId: 'e1',
    date: '2026-03-02',
    startMin,
    endMin,
    templateId: 'tpl1',
    templateName: 'Day',
    color: '#2563EB',
    isNight: false,
    paidHours: (endMin - startMin) / 60,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
    ...over,
  };
}

function check(
  assignments: Assignment[],
  s: SchedulingSpec,
  roster: EmployeeOut[] = team(3),
  period: DayRef[] = WEEK,
  absences: AbsenceOut[] = [],
) {
  return validateSchedule(
    assignments,
    roster,
    [TPL],
    absences,
    [VACATION],
    s,
    period,
  );
}

/** The kinds reported, for terser assertions. */
function kinds(result: { violations: { kind: ViolationKind }[] }): ViolationKind[] {
  return result.violations.map((v) => v.kind);
}

describe('agrees with the generator', () => {
  it('finds nothing hard wrong with a calendar the generator built', () => {
    const s = spec({ minStaff: 2, openMin: 9 * 60, closeMin: 21 * 60 });
    const roster = team(6);
    const built = generateSchedule(roster, [], [], [VACATION], s, WEEK);
    const result = validateSchedule(
      built.assignments,
      roster,
      [],
      [],
      [VACATION],
      s,
      WEEK,
    );
    const hard = result.violations.filter((v) => v.hard);
    expect(hard).toEqual([]);
  });

  it('reports the same coverage gaps the generator admitted to', () => {
    // One person cannot cover a floor of three; both sides must say so.
    const s = spec({ minStaff: 3, openMin: 9 * 60, closeMin: 17 * 60 });
    const roster = team(1);
    const built = generateSchedule(roster, [], [], [VACATION], s, WEEK);
    const result = validateSchedule(
      built.assignments,
      roster,
      [],
      [],
      [VACATION],
      s,
      WEEK,
    );
    expect(result.gaps.length).toBe(built.gaps.length);
  });
});

describe('rejects what a rota may never carry', () => {
  it('catches a shift given to somebody who does not work here', () => {
    const result = check([shift({ employeeId: 'ghost' })], spec());
    expect(kinds(result)).toContain('unknown_employee');
    expect(result.ok).toBe(false);
  });

  it('catches a shift on somebody who is away', () => {
    const away = absence({
      employee_id: 'e1',
      absence_type_id: 'vac',
      start_at: '2026-03-02T00:00:00',
      end_at: '2026-03-02T23:59:00',
    });
    const result = check([shift()], spec(), team(3), WEEK, [away]);
    expect(kinds(result)).toContain('unavailable');
  });

  it('catches the same person in two places at once', () => {
    const result = check(
      [
        shift({ id: 'a1', startMin: 9 * 60, endMin: 17 * 60 }),
        shift({ id: 'a2', startMin: 16 * 60, endMin: 20 * 60 }),
      ],
      spec({ openMin: 9 * 60, closeMin: 21 * 60, allowSplitShifts: true, splitShiftPeople: 2 }),
    );
    expect(kinds(result)).toContain('overlap');
  });

  it('catches too little rest between two days', () => {
    // Finishes 22:00 Monday, back at 06:00 Tuesday: eight hours, not eleven.
    const s = spec({ openMin: 6 * 60, closeMin: 22 * 60, minRestHours: 11 });
    const result = check(
      [
        shift({ id: 'a1', date: '2026-03-02', startMin: 14 * 60, endMin: 22 * 60 }),
        shift({ id: 'a2', date: '2026-03-03', startMin: 6 * 60, endMin: 14 * 60 }),
      ],
      s,
    );
    const rest = result.violations.find((v) => v.kind === 'rest');
    expect(rest).toBeDefined();
    expect(rest?.detail.gapMin).toBe(8 * 60);
    expect(rest?.detail.requiredMin).toBe(11 * 60);
  });

  it('does NOT call a legal split day a rest breach', () => {
    // Two halves of one day, ninety minutes apart: allowed, and the eleven-hour
    // rule must not be applied inside a day.
    const s = spec({
      openMin: 9 * 60,
      closeMin: 21 * 60,
      minRestHours: 11,
      allowSplitShifts: true,
      splitShiftPeople: 1,
    });
    const result = check(
      [
        shift({ id: 'a1', date: '2026-03-02', startMin: 9 * 60, endMin: 13 * 60 }),
        shift({ id: 'a2', date: '2026-03-02', startMin: 14 * 60 + 30, endMin: 19 * 60 }),
      ],
      s,
    );
    expect(kinds(result)).not.toContain('rest');
    expect(result.ok).toBe(true);
  });

  it('does not read a night that ends after midnight as a split', () => {
    // Ends 02:00 Tuesday (26:00 Monday), back 08:00 Tuesday: six hours apart.
    // Keyed on the clock this looks like Tuesday's second shift and would get
    // the sixty-minute break. Keyed on the START DATE -- which is what both
    // files do -- it is a new day and owes the full rest.
    const s = spec({
      openMin: 0,
      closeMin: 24 * 60,
      minRestHours: 11,
      allowSplitShifts: true,
      splitShiftPeople: 2,
    });
    const result = check(
      [
        shift({ id: 'a1', date: '2026-03-02', startMin: 18 * 60, endMin: 26 * 60 }),
        shift({ id: 'a2', date: '2026-03-03', startMin: 8 * 60, endMin: 14 * 60 }),
      ],
      s,
    );
    expect(kinds(result)).toContain('rest');
  });

  it('catches a second shift where splits were never allowed', () => {
    const s = spec({ openMin: 9 * 60, closeMin: 21 * 60 });
    const result = check(
      [
        shift({ id: 'a1', startMin: 9 * 60, endMin: 12 * 60 }),
        shift({ id: 'a2', startMin: 16 * 60, endMin: 20 * 60 }),
      ],
      s,
    );
    expect(kinds(result)).toContain('split_not_allowed');
  });

  it('catches more people on split days than the brief permits', () => {
    const s = spec({
      openMin: 9 * 60,
      closeMin: 21 * 60,
      allowSplitShifts: true,
      splitShiftPeople: 1,
    });
    const result = check(
      [
        shift({ id: 'a1', employeeId: 'e1', startMin: 9 * 60, endMin: 12 * 60 }),
        shift({ id: 'a2', employeeId: 'e1', startMin: 16 * 60, endMin: 20 * 60 }),
        shift({ id: 'a3', employeeId: 'e2', startMin: 9 * 60, endMin: 12 * 60 }),
        shift({ id: 'a4', employeeId: 'e2', startMin: 16 * 60, endMin: 20 * 60 }),
      ],
      s,
    );
    const cap = result.violations.find((v) => v.kind === 'split_cap');
    expect(cap?.detail).toEqual({ people: 2, cap: 1 });
  });

  it('catches a week beyond the ceiling', () => {
    const s = spec({ openMin: 0, closeMin: 24 * 60, maxHoursPerWeek: 40 });
    const long = WEEK.map((d, i) =>
      shift({ id: `a${i}`, date: d.date, startMin: 8 * 60, endMin: 18 * 60 }),
    );
    const result = check(long, s);
    const over = result.violations.find((v) => v.kind === 'weekly_ceiling');
    expect(over?.detail.hours).toBe(70);
    expect(over?.detail.ceiling).toBe(40);
  });

  it('lets a contract lift the ceiling above the standing limit', () => {
    // "Marcus works 80 hours a week" -- his own figure wins, so 70 is fine.
    const marcus = employee({
      id: 'e1',
      current_contract: contract({ employee_id: 'e1', max_hours_per_week: 80 }),
    });
    const s = spec({ openMin: 0, closeMin: 24 * 60, maxHoursPerWeek: 40 });
    const long = WEEK.map((d, i) =>
      shift({ id: `a${i}`, date: d.date, startMin: 8 * 60, endMin: 18 * 60 }),
    );
    const result = check(long, s, [marcus]);
    expect(kinds(result)).not.toContain('weekly_ceiling');
  });

  it('catches a shift on a day the business is shut', () => {
    const s = spec({ closedWeekdays: [1] }); // Mondays
    const result = check([shift({ date: '2026-03-02' })], s); // a Monday
    expect(kinds(result)).toContain('closed_day');
  });

  it('catches a shift that runs past closing', () => {
    const s = spec({ openMin: 9 * 60, closeMin: 17 * 60 });
    const result = check([shift({ startMin: 9 * 60, endMin: 20 * 60 })], s);
    expect(kinds(result)).toContain('outside_hours');
  });

  it('catches a template that does not exist', () => {
    const result = check([shift({ templateId: 'made-up' })], spec());
    expect(kinds(result)).toContain('unknown_template');
  });
});

describe('scope', () => {
  it('ignores shifts outside the period being judged', () => {
    // A neighbouring month's shift is one this regeneration can neither see
    // nor fix, so flagging it would be noise the caller cannot act on.
    const result = check([shift({ date: '2026-04-15', employeeId: 'ghost' })], spec());
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reports coverage the proposal left short', () => {
    const s = spec({ minStaff: 2, openMin: 9 * 60, closeMin: 17 * 60 });
    const result = check([shift()], s); // one person against a floor of two
    // The staffed day is short by one; the other six are empty. Both are gaps,
    // and asserting on the staffed one is what proves cover was counted at all.
    const staffed = result.gaps.filter((g) => g.date === '2026-03-02');
    expect(staffed.length).toBe(8); // 09:00-17:00
    expect(staffed.every((g) => g.have === 1 && g.need === 2)).toBe(true);
  });

  it('a soft finding alone still leaves the schedule usable', () => {
    // Under-coverage is a gap, not a violation: the manager may ship it.
    const s = spec({ minStaff: 2, openMin: 9 * 60, closeMin: 17 * 60 });
    const result = check([shift()], s);
    expect(result.ok).toBe(true);
  });
});
