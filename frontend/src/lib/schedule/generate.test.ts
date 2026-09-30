// The generator, tested through what a manager can actually see: which days
// have shifts on them, who is on them, how many hours each person ends up with,
// and where the calendar admits it could not cover the shop.
//
// Nothing here asserts a particular shift at a particular time. The greedy pass
// is explicitly a placeholder for a CP-SAT solver behind the same signature, so
// pinning its choices would mean rewriting this file the day the solver lands.
// What must survive that swap is every property below.

import { describe, expect, it } from 'vitest';
import { generateSchedule } from './generate';
import { validateSchedule } from './validate';
import { needAt, windowFor } from './demand';
import { NO_REQUIREMENTS_SPEC } from './spec';
import { EMPTY_OVERLAY } from './overlay';
import type { Assignment, DayRef, SchedulingSpec } from './types';
import {
  absence,
  absenceType,
  contract,
  days,
  employee,
  spec,
} from '../../test/factories';
import type { EmployeeOut } from '../../types';

const WEEK = days('2026-03-02', 7); // Monday 2 March to Sunday 8 March
const VACATION = absenceType({ id: 'vac' });

/** `n` interchangeable, fully available people. */
function team(n: number, over: Partial<EmployeeOut> = {}): EmployeeOut[] {
  return Array.from({ length: n }, (_, i) =>
    employee({ id: `e${i + 1}`, full_name: `Person ${i + 1}`, ...over }),
  );
}

function run(
  roster: EmployeeOut[],
  s: SchedulingSpec,
  period: DayRef[] = WEEK,
  absences = [] as ReturnType<typeof absence>[],
) {
  return generateSchedule(roster, [], absences, [VACATION], s, period);
}

/** People on shift at `hour`, counted the way the coverage strip counts them. */
function coverAt(assignments: Assignment[], date: string, hour: number): number {
  return assignments.filter(
    (a) => a.date === date && a.startMin <= hour * 60 && a.endMin > hour * 60,
  ).length;
}

describe('generateSchedule — days the shop is shut', () => {
  it('puts nobody on a weekday the business is closed', () => {
    const s = spec({ minStaff: 2, closedWeekdays: [0] }); // closed Sundays
    const result = run(team(4), s);

    const sundays = WEEK.filter((d) => d.weekday === 0).map((d) => d.date);
    expect(sundays.length).toBeGreaterThan(0);
    expect(result.assignments.filter((a) => sundays.includes(a.date))).toHaveLength(0);
  });

  it('reports no coverage gap on a closed day, because there is nothing to cover', () => {
    // A closed day showing as a gap would put the manager in front of a problem
    // that does not exist, every week, for ever.
    const s = spec({ minStaff: 2, closedWeekdays: [0] });
    const result = run(team(4), s);
    expect(result.gaps.filter((g) => g.date === '2026-03-01')).toHaveLength(0);
  });

  it('honours a one-off closure such as a public holiday', () => {
    const s = spec({ minStaff: 2, closedDates: ['2026-03-04'] });
    const result = run(team(4), s);

    expect(result.assignments.filter((a) => a.date === '2026-03-04')).toHaveLength(0);
    expect(result.gaps.filter((g) => g.date === '2026-03-04')).toHaveLength(0);
    // The rest of the week is untouched by the closure.
    expect(result.assignments.filter((a) => a.date === '2026-03-05').length)
      .toBeGreaterThan(0);
  });
});

describe('generateSchedule — it only ever schedules people who may work', () => {
  it('leaves out anyone availability refuses, and covers the shop with the rest', () => {
    const roster = [
      employee({ id: 'gone', employment_status: 'resigned' }),
      employee({ id: 'leave', employment_status: 'on_leave' }),
      employee({ id: 'nocontract', current_contract: null }),
      employee({ id: 'later', hire_date: '2026-06-01' }),
      employee({ id: 'ok1' }),
      employee({ id: 'ok2' }),
    ];
    const result = run(roster, spec({ minStaff: 2 }));

    const used = new Set(result.assignments.map((a) => a.employeeId));
    expect([...used].sort()).toEqual(['ok1', 'ok2']);
  });

  it('never schedules over approved time off', () => {
    const roster = team(3);
    const off = absence({
      employee_id: 'e1',
      absence_type_id: VACATION.id,
      start_at: '2026-03-04T00:00:00',
      end_at: '2026-03-04T23:59:00',
    });
    const result = run(roster, spec({ minStaff: 1 }), WEEK, [off]);

    expect(
      result.assignments.filter((a) => a.employeeId === 'e1' && a.date === '2026-03-04'),
    ).toHaveLength(0);
    // Only that one day: an absence must not quietly remove somebody from the
    // whole week, which is what makes the empty-filter above worth asserting.
    expect(
      result.assignments.filter((a) => a.employeeId === 'e1').length,
    ).toBeGreaterThan(0);
  });

  it('keeps a new starter off nights and inside their ramp-up hours', () => {
    // The same limits `availability` reports are the ones the generator obeys,
    // so the reason shown on the row is the reason that was actually used.
    const roster = team(3, { employment_status: 'onboarding' });
    const s = spec({
      openMin: 6 * 60,
      closeMin: 24 * 60,
      minStaff: 1,
      // Five-hour shifts: short enough that a new starter can legally take one,
      // so the ramp-up limits are exercised rather than simply emptying the day.
      shiftLengthHours: 5,
    });
    const result = run(roster, s);

    expect(result.assignments.length).toBeGreaterThan(0);
    for (const a of result.assignments) {
      expect(a.isNight).toBe(false);
      expect(a.paidHours).toBeLessThanOrEqual(6);
    }
  });

  it('reports a gap rather than breaking a ramp-up limit to fill it', () => {
    // Every shift on offer here is 7.5 paid hours, above the 6-hour cap on a
    // new starter's day. Stretching one to cover the shop would break the very
    // limit the row promises the manager is being honoured.
    const roster = team(3, { employment_status: 'onboarding' });
    const s = spec({ openMin: 6 * 60, closeMin: 24 * 60, minStaff: 1 });
    const result = run(roster, s);

    expect(result.assignments).toHaveLength(0);
    expect(result.gaps.length).toBeGreaterThan(0);
  });
});

describe('generateSchedule — coverage', () => {
  it('covers the required headcount at every open hour when the team is big enough', () => {
    const s = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 2 });
    const result = run(team(6), s);

    expect(result.gaps).toHaveLength(0);
    for (const d of WEEK) {
      const win = windowFor(s, d);
      for (let h = Math.floor(win.openMin / 60); h < Math.ceil(win.closeMin / 60); h += 1) {
        expect(coverAt(result.assignments, d.date, h)).toBeGreaterThanOrEqual(
          needAt(s, d, h),
        );
      }
    }
  });

  it('staffs a busy window above the rest of the day', () => {
    const s = spec({
      openMin: 9 * 60,
      closeMin: 21 * 60,
      minStaff: 1,
      coverage: [
        { weekdays: [], dates: [], startMin: 12 * 60, endMin: 15 * 60, staff: 3 },
      ],
    });
    const result = run(team(8), s);

    expect(result.gaps).toHaveLength(0);
    expect(coverAt(result.assignments, '2026-03-04', 13)).toBeGreaterThanOrEqual(3);
  });

  it('reports the shortfall instead of pretending the shop is covered', () => {
    // One person cannot be three. The honest outcome is a calendar with gaps on
    // it, because that is a staffing problem the manager has to see.
    const s = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 3 });
    const result = run(team(1), s);

    expect(result.gaps.length).toBeGreaterThan(0);
    for (const gap of result.gaps) {
      expect(gap.have).toBeLessThan(gap.need);
      // Every gap is a real hour of a real open day, not a rounding artefact.
      expect(coverAt(result.assignments, gap.date, gap.hour)).toBe(gap.have);
    }
  });

  it('finds nobody to schedule when the whole team is unschedulable', () => {
    // The exact production failure, expressed as a property: a roster the
    // generator cannot use produces an empty calendar AND says so in `gaps`.
    const roster = team(5, { current_contract: null });
    const result = run(roster, spec({ minStaff: 2 }));

    expect(result.assignments).toHaveLength(0);
    expect(result.gaps.length).toBeGreaterThan(0);
  });
});

describe('generateSchedule — weekly hours', () => {
  it('never gives anyone more than the week the brief allows', () => {
    // A single person covering an eight-hour day, seven days a week, would run
    // past 50 hours. The ceiling has to bite, and the hours it refuses have to
    // show up as gaps rather than disappearing.
    const s = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1, maxHoursPerWeek: 20 });
    const result = run(team(1), s);

    expect(result.hoursByEmployee.e1).toBeLessThanOrEqual(20);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it('applies the ceiling per week, not across the whole period', () => {
    const s = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1, maxHoursPerWeek: 20 });
    const fortnight = days('2026-03-02', 14);
    const result = run(team(1), s, fortnight);

    const byWeek: Record<string, number> = {};
    for (const a of result.assignments) {
      const week = a.date <= '2026-03-07' ? 'first' : 'second';
      byWeek[week] = (byWeek[week] ?? 0) + a.paidHours;
    }
    expect(byWeek.first).toBeLessThanOrEqual(20);
    expect(byWeek.second).toBeLessThanOrEqual(20);
    // Both weeks are actually used: a per-period cap would have emptied the
    // second one entirely.
    expect(byWeek.second).toBeGreaterThan(0);
  });

  it('lets someone contracted above the standing limit work their own hours', () => {
    // "Marcus works 80 hours a week" arrives as a contracted minimum of 80. The
    // default weekly limit must not quietly cap the very number just asked for.
    const s = spec({
      openMin: 0,
      closeMin: 24 * 60,
      minStaff: 1,
      maxHoursPerWeek: 40,
      minRestHours: 8,
      allowSplitShifts: true,
    });
    const marcus = employee({
      id: 'marcus',
      current_contract: contract({ min_hours_per_week: 60, max_hours_per_week: null }),
    });
    const result = run([marcus], s);

    expect(result.hoursByEmployee.marcus).toBeGreaterThan(40);
  });

  it('gives a part-timer their contracted base without stopping at the coverage minimum', () => {
    // Coverage is met by one person; the 24-hour contract is still a promise the
    // second pass has to keep.
    const s = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1 });
    const roster = [
      employee({ id: 'full', current_contract: contract({ min_hours_per_week: 0 }) }),
      employee({
        id: 'part',
        current_contract: contract({ min_hours_per_week: 24, max_hours_per_week: 30 }),
      }),
    ];
    const result = run(roster, s);

    expect(result.hoursByEmployee.part).toBeGreaterThanOrEqual(20);
    expect(result.hoursByEmployee.part).toBeLessThanOrEqual(30);
  });
});

describe('generateSchedule — the totals tell the truth about the shifts', () => {
  it('reports hours and cost that add up to the shifts it placed', () => {
    const result = run(team(4), spec({ minStaff: 2 }));
    const hours = result.assignments.reduce((s, a) => s + a.paidHours, 0);
    const cost = result.assignments.reduce((s, a) => s + a.cost, 0);

    expect(result.totalHours).toBeCloseTo(hours);
    expect(result.totalCost).toBeCloseTo(cost);
    expect(
      Object.values(result.hoursByEmployee).reduce((s, h) => s + h, 0),
    ).toBeCloseTo(hours);
  });

  it('costs a salaried exempt employee at nothing extra, because they are a sunk cost', () => {
    const salaried = employee({
      id: 'sal',
      current_contract: contract({
        employment_type: 'exempt_salaried',
        hourly_rate: null,
        base_annual_salary: 60000,
      }),
    });
    const result = run([salaried], spec({ minStaff: 1 }));

    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.totalCost).toBe(0);
    // Exempt staff accrue no overtime either — the same rule the seeded US-FED
    // profile states as `exempt_overtime_exclusion`.
    expect(result.overtimeHours).toBe(0);
  });
});

describe('a contract that states hours and no maximum', () => {
  // "dos con 20 horas" arrives as a minimum of 20 and no maximum. That used
  // to count as no agreement at all: nothing given to that person was ever
  // beyond it, so the coverage pass used them like a full-timer.
  it('marks the hours past the stated number as beyond contract', () => {
    const roster: EmployeeOut[] = [
      employee({
        id: 'ft',
        current_contract: contract({ employee_id: 'ft', min_hours_per_week: 40, max_hours_per_week: null }),
      }),
      employee({
        id: 'pt',
        current_contract: contract({ employee_id: 'pt', min_hours_per_week: 20, max_hours_per_week: null }),
      }),
    ];
    // Two on the floor for ten hours, seven days: 140 person-hours against a
    // 60-hour team. Both must go beyond contract, and both overruns must show.
    const result = generateSchedule(
      roster,
      [],
      [],
      [],
      spec({ minStaff: 2, openMin: 9 * 60, closeMin: 19 * 60 }),
      days('2026-03-02', 7),
    );
    const extra = (id: string) =>
      result.assignments.filter((a) => a.employeeId === id).reduce((s, a) => s + a.extraHours, 0);
    const hours = (id: string) => result.hoursByEmployee[id] ?? 0;
    expect(hours('pt')).toBeGreaterThan(20);
    expect(extra('pt')).toBeCloseTo(hours('pt') - 20, 5);
    expect(extra('ft')).toBeCloseTo(Math.max(0, hours('ft') - 40), 5);
  });
});

describe('a spec that asks for nobody', () => {
  // The team's published rota, opened with no brief behind it, is seeded as
  // pinned shifts under NO_REQUIREMENTS_SPEC. The generator must then return
  // exactly those shifts: nothing to cover, and no topping people up toward
  // their contracts -- that floor is for a rota somebody asked for.
  const people: EmployeeOut[] = [
    employee({ id: 'e1', full_name: 'Sarah', current_contract: contract({ min_hours_per_week: 40 }) }),
    employee({ id: 'e2', full_name: 'Luis', current_contract: contract({ min_hours_per_week: 20 }) }),
  ];

  it('produces nothing on its own', () => {
    const result = generateSchedule(people, [], [], [VACATION], NO_REQUIREMENTS_SPEC, WEEK);
    expect(result.assignments).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it('returns exactly the pinned shifts, nothing invented around them', () => {
    const pinned: Assignment[] = [
      {
        id: 'p1', employeeId: 'e1', date: '2026-03-06', startMin: 9 * 60, endMin: 17 * 60,
        templateId: 't', templateName: 'Day', color: '#000', isNight: false,
        paidHours: 8, overtimeHours: 0, extraHours: 0, cost: 0, source: 'manual',
      },
    ];
    const result = generateSchedule(people, [], [], [VACATION], NO_REQUIREMENTS_SPEC, WEEK, {
      ...EMPTY_OVERLAY,
      pinned,
    });
    expect(result.assignments.map((a) => [a.employeeId, a.date, a.startMin, a.endMin])).toEqual([
      ['e1', '2026-03-06', 9 * 60, 17 * 60],
    ]);
  });

  it('still tops people up once the spec asks for anybody', () => {
    const asks = { ...NO_REQUIREMENTS_SPEC, openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1 };
    const result = generateSchedule(people, [], [], [VACATION], asks, WEEK);
    expect(result.assignments.length).toBeGreaterThan(0);
  });
});

describe('opening and closing on the half hour', () => {
  /** People on shift at an exact minute, not just at the top of an hour. */
  function coverAtMin(assignments: Assignment[], date: string, min: number): number {
    return new Set(
      assignments
        .filter((a) => a.date === date && a.startMin <= min && a.endMin > min)
        .map((a) => a.employeeId),
    ).size;
  }

  /** Every quarter hour the shop is open, on every day of the week. */
  function uncoveredQuarters(assignments: Assignment[], s: SchedulingSpec): string[] {
    const holes: string[] = [];
    for (const d of WEEK) {
      for (let m = s.openMin; m < s.closeMin; m += 15) {
        if (coverAtMin(assignments, d.date, m) < s.minStaff) holes.push(`${d.date}@${m}`);
      }
    }
    return holes;
  }

  it('covers the last half hour of a bar that closes at 03:30', () => {
    // Shifts come in whole hours, so the 03:00-03:30 tail is exactly where a
    // rota built from them would leave nobody.
    const s = spec({ openMin: 19 * 60, closeMin: 27 * 60 + 30, minStaff: 1 });
    const result = run(team(4), s);

    expect(result.gaps).toHaveLength(0);
    expect(uncoveredQuarters(result.assignments, s)).toEqual([]);
    for (const d of WEEK) {
      const last = Math.max(...result.assignments.filter((a) => a.date === d.date).map((a) => a.endMin));
      expect(last).toBe(27 * 60 + 30);
    }
  });

  it('staffs a bar that OPENS at 19:30 instead of abandoning every day', () => {
    // Hour 19 used to be asked about at 19:00, half an hour before opening.
    // No shift may start before opening, so the earliest deficit could never
    // be met and the generator gave up on the day: an empty week.
    const s = spec({ openMin: 19 * 60 + 30, closeMin: 27 * 60 + 30, minStaff: 1 });
    const result = run(team(4), s);

    expect(result.gaps).toHaveLength(0);
    expect(uncoveredQuarters(result.assignments, s)).toEqual([]);
    // And nobody is called in before the doors open.
    expect(result.assignments.every((a) => a.startMin >= s.openMin)).toBe(true);
  });

  it('does not report the shut half hour before a 19:30 opening as a gap', () => {
    const s = spec({ openMin: 19 * 60 + 30, closeMin: 27 * 60 + 30, minStaff: 1 });
    const result = run(team(4), s);
    const audit = validateSchedule(result.assignments, team(4), [], [], [VACATION], s, WEEK);
    expect(audit.gaps).toHaveLength(0);
  });

  it('still reports the opening half hour when nobody is there for it', () => {
    // Counting the opening hour at 19:30 must not turn it into an hour nobody
    // checks: a rota that starts at 20:00 leaves the doors open unattended.
    const s = spec({ openMin: 19 * 60 + 30, closeMin: 27 * 60 + 30, minStaff: 1 });
    // Any real assignment will do as a shape; only its times and owner matter.
    const shape = run(team(1), spec({ openMin: 19 * 60, closeMin: 27 * 60 })).assignments[0];
    const late: Assignment[] = WEEK.map((d) => ({
      ...shape,
      date: d.date,
      employeeId: 'e1',
      startMin: 20 * 60,
      endMin: 27 * 60 + 30,
    }));
    const audit = validateSchedule(late, team(1), [], [], [VACATION], s, WEEK);
    expect(audit.gaps.map((g) => g.hour)).toEqual(WEEK.map(() => 19));
  });
});
