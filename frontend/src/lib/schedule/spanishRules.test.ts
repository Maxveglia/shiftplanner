// The three rules a Spanish rota breaks that an American one does not.
//
// A bar in Barcelona is the case that motivated all of this: open 17:00-03:00
// four nights and 18:00-04:00 two more, six people, no dates in the brief. The
// rota the product built for it — ten-hour closing shifts, every week, for the
// same people — is a lawful American schedule and an unlawful Spanish one, in
// three separate ways at once.
//
// Each rule is checked twice: that it fires on a rota that breaks it, and that
// it stays silent for a business whose jurisdiction has no such rule seeded,
// which is every customer this product had before Spain.

import { describe, expect, it } from 'vitest';
import { generateSchedule } from './generate';
import { validateSchedule } from './validate';
import { contract, days, employee, spec } from '../../test/factories';
import type { Assignment, SchedulingSpec } from './types';

/** What the server sends for a business in Catalonia. */
const SPAIN: Partial<SchedulingSpec> = {
  minRestHours: 12,
  maxDailyHours: 9,
  weeklyRestHours: 36,
  nightAverageMax: 8,
  nightWindow: { startHour: 22, endHour: 6 },
  overtimeMultiplier: null,
  // The field that says the week is an ANNUAL AVERAGE rather than a ceiling.
  weeklyAverageHours: 40,
};

/** The bar: open late, closed Sunday. */
function bar(over: Partial<SchedulingSpec> = {}): SchedulingSpec {
  return spec({
    openMin: 17 * 60,
    closeMin: 27 * 60,
    minStaff: 2,
    closedWeekdays: [0],
    dayHours: [
      { weekday: 5, openMin: 18 * 60, closeMin: 28 * 60 },
      { weekday: 6, openMin: 18 * 60, closeMin: 28 * 60 },
    ],
    ...over,
  });
}

const TEAM = [
  ['Ori', 40], ['Aldric', 35], ['Hugo', 16], ['Izan', 18], ['Max', 20], ['Ylli', 40],
] as const;

function roster() {
  return TEAM.map(([name, h], i) =>
    employee({
      id: `e${i}`,
      full_name: name,
      current_contract: contract({
        employee_id: `e${i}`,
        min_hours_per_week: h,
        max_hours_per_week: h,
      }),
    }),
  );
}

/** One shift, written the way the calendar holds them. */
function shift(over: Partial<Assignment>): Assignment {
  const startMin = over.startMin ?? 17 * 60;
  const endMin = over.endMin ?? 27 * 60;
  return {
    id: over.id ?? 'a1',
    employeeId: over.employeeId ?? 'e0',
    date: over.date ?? '2026-10-05',
    startMin,
    endMin,
    // The id a synthesised shift carries; the validator knows the prefix.
    templateId: 'band-evening',
    templateName: 'Evening',
    color: 'blue',
    isNight: true,
    paidHours: (endMin - startMin) / 60,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'ai',
    ...over,
  } as Assignment;
}

// Monday 5 October to Sunday 25 October 2026: three whole weeks, and they
// are whole under a Monday anchor, which is the one the product uses.
const PERIOD = days('2026-10-05', 21);

describe('the nine-hour day (art. 34.3 ET)', () => {
  it('reports a ten-hour shift', () => {
    const result = validateSchedule(
      [shift({})],
      roster(),
      [],
      [],
      [],
      bar(SPAIN),
      PERIOD,
    );
    const found = result.violations.filter((v) => v.kind === 'daily_hours');
    expect(found).toHaveLength(1);
    expect(found[0].hard).toBe(true);
    expect(found[0].detail).toMatchObject({ hours: 10, allowed: 9 });
  });

  it('says nothing where no such rule is seeded', () => {
    const result = validateSchedule([shift({})], roster(), [], [], [], bar(), PERIOD);
    expect(result.violations.filter((v) => v.kind === 'daily_hours')).toHaveLength(0);
  });

  it('is never generated in the first place', () => {
    const result = generateSchedule(roster(), [], [], [], bar(SPAIN), PERIOD);
    const tooLong = result.assignments.filter(
      (a) => (a.endMin - a.startMin) / 60 > 9,
    );
    expect(tooLong).toEqual([]);
  });
});

describe('the day and a half off (art. 37.1 ET)', () => {
  it('reports a week worked straight through', () => {
    // The whole week, Monday 12 to Sunday 18 October: every gap is the 19
    // hours between one 22:00 finish and the next 17:00 start, and none of
    // them is the day and a half owed.
    //
    // The days either side are worked too, and that is not decoration: the
    // rest around a week is measured to the NEIGHBOURING SHIFT, so a week
    // with nothing before or after it is a week whose rest runs off the edge
    // of what was handed in -- unbounded, and not a breach.
    const week = [
      '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14',
      '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19',
    ]
      .map((date, i) =>
        shift({ id: `a${i}`, date, startMin: 17 * 60, endMin: 22 * 60 }),
      );
    const result = validateSchedule(week, roster(), [], [], [], bar(SPAIN), PERIOD);
    const found = result.violations.filter((v) => v.kind === 'weekly_rest');
    expect(found).toHaveLength(1);
    expect(found[0].detail.required).toBe(36);
  });

  it('accepts a week with a clear day and a half in it', () => {
    // Monday to Friday of the same week: the Saturday and Sunday after are
    // free, which is the rest the article asks for.
    const week = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']
      .map((date, i) =>
        shift({ id: `a${i}`, date, startMin: 17 * 60, endMin: 22 * 60 }),
      );
    const result = validateSchedule(week, roster(), [], [], [], bar(SPAIN), PERIOD);
    expect(result.violations.filter((v) => v.kind === 'weekly_rest')).toHaveLength(0);
  });

  it('does not cut a rest in half at the week boundary', () => {
    // The bug that moving the week to Monday was only half of, and the one
    // that cost money: Monday to Friday, 09:00-17:00, three weeks running.
    // That is 64 unbroken hours every weekend and the plainest lawful rota
    // there is -- and it used to be reported as a breach of 33 hours against
    // 36, because the rest was measured only INSIDE the week and the boundary
    // sliced the weekend in two.
    //
    // What followed was not a spare warning. `repair.ts` drops the last shift
    // of a week it believes owes rest, and `planRetry.ts` scores a month with
    // a hard violation as failed and pays for a second model call to replan
    // it. Both fired on a rota that was correct.
    const weeks = [5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23].map((d, i) =>
      shift({
        id: `a${i}`,
        date: `2026-10-${String(d).padStart(2, '0')}`,
        startMin: 9 * 60,
        endMin: 17 * 60,
        isNight: false,
      }),
    );
    const result = validateSchedule(weeks, roster(), [], [], [], bar(SPAIN), PERIOD);
    expect(result.violations.filter((v) => v.kind === 'weekly_rest')).toEqual([]);
  });

  it('is never generated in the first place', () => {
    const result = generateSchedule(roster(), [], [], [], bar(SPAIN), PERIOD);
    const breaches = validateSchedule(
      result.assignments,
      roster(),
      [],
      [],
      [],
      bar(SPAIN),
      PERIOD,
    ).violations.filter((v) => v.kind === 'weekly_rest');
    expect(breaches).toEqual([]);
  });
});

describe('the night worker average (art. 36.1 ET)', () => {
  it('reports ten-hour nights as a habit', () => {
    const nights = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']
      .map((date, i) => shift({ id: `a${i}`, date }));
    const result = validateSchedule(nights, roster(), [], [], [], bar(SPAIN), PERIOD);
    const found = result.violations.filter((v) => v.kind === 'night_average');
    expect(found).toHaveLength(1);
    expect(found[0].detail.allowed).toBe(8);
  });

  it('leaves a day worker alone', () => {
    // Ten hours, none of them after 22:00: long, but not night work.
    const daytime = ['2026-10-05', '2026-10-06'].map((date, i) =>
      shift({ id: `a${i}`, date, startMin: 9 * 60, endMin: 19 * 60, isNight: false }),
    );
    const result = validateSchedule(daytime, roster(), [], [], [], bar(SPAIN), PERIOD);
    expect(result.violations.filter((v) => v.kind === 'night_average')).toHaveLength(0);
  });

  it('is never generated in the first place', () => {
    const result = generateSchedule(roster(), [], [], [], bar(SPAIN), PERIOD);
    const breaches = validateSchedule(
      result.assignments,
      roster(),
      [],
      [],
      [],
      bar(SPAIN),
      PERIOD,
    ).violations.filter((v) => v.kind === 'night_average');
    expect(breaches).toEqual([]);
  });
});

describe('the week as an annual average (art. 34.1 ET)', () => {
  // The rule that is easiest to state and was hardest to find, because
  // getting it wrong produces no error message -- it produces an error
  // message that should not be there.
  //
  // A 45-hour week is lawful in Spain when the year averages forty. The
  // validator used to report it as `weekly_ceiling` regardless, which is the
  // FLSA reading: forty is a wall, and an hour past it is a finding. For a
  // Barcelona bar that meant a legal rota came up red, and came up red for
  // everybody at once on any busy week.

  /** Six shifts of 7.5 h in one week: 45 hours, no day over nine. */
  function longWeek(): Assignment[] {
    return [0, 1, 2, 3, 4, 5].map((d) =>
      shift({
        id: `w${d}`,
        employeeId: 'e0',
        date: `2026-10-${String(5 + d).padStart(2, '0')}`,
        startMin: 17 * 60,
        endMin: 17 * 60 + 450, // 7.5 h, well inside the nine-hour day
      }),
    );
  }

  function kinds(spec_: SchedulingSpec): string[] {
    return validateSchedule(
      longWeek(),
      roster(),
      [],
      [],
      [],
      spec_,
      PERIOD,
    ).violations.map((v) => v.kind);
  }

  it('does not report a 45-hour week where the year is the unit', () => {
    expect(kinds(bar(SPAIN))).not.toContain('weekly_ceiling');
  });

  it('still reports it where the week IS the ceiling', () => {
    // The same rota, the same hours, judged by a jurisdiction that has not
    // said the week is an average. Nothing changes for them.
    const weekly = bar({ ...SPAIN, weeklyAverageHours: null });
    expect(kinds(weekly)).toContain('weekly_ceiling');
  });

  it('never excuses the nine-hour day', () => {
    // The annual average is about the WEEK. A ten-hour shift is still a
    // ten-hour shift, and art. 34.3 does not average anything.
    const tenHours = [
      shift({ id: 'long', employeeId: 'e0', startMin: 17 * 60, endMin: 27 * 60 }),
    ];
    const found = validateSchedule(
      tenHours,
      roster(),
      [],
      [],
      [],
      bar(SPAIN),
      PERIOD,
    ).violations.map((v) => v.kind);
    expect(found).toContain('daily_hours');
  });
});

describe('the rota as a whole', () => {
  it('breaks nothing hard for the bar that started this', () => {
    const result = generateSchedule(roster(), [], [], [], bar(SPAIN), PERIOD);
    const hard = validateSchedule(
      result.assignments,
      roster(),
      [],
      [],
      [],
      bar(SPAIN),
      PERIOD,
    ).violations.filter((v) => v.hard);
    expect(hard).toEqual([]);
  });
});
