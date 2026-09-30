// The three judgements the working-year table makes, pinned.
//
// Every one of them fails QUIETLY when it is wrong: a balance measured against
// the wrong ruler, a part-timer's hours called by a name the law forbids, or a
// drawer of empty columns all render perfectly and say something untrue. That
// is the class of bug this file exists for; the markup around them is not
// tested because there is no DOM here (see vitest.config.ts) and because a
// column moving is visible the moment anybody opens the screen.

import { afterEach, describe, expect, it } from 'vitest';
import {
  balanceLean,
  excessHours,
  findingKey,
  groupFindings,
  hasPending,
  measuredTo,
  pendingHours,
  signedHours,
  weekColumns,
  workdayRows,
} from './workdayRows';
import { projectRows } from '../../lib/schedule/projectedBalance';
import { setLanguage } from '../../lib/i18n/core';
import type {
  EmployeeWorkday,
  WeekReport,
  WorkdayError,
  WorkdayOut,
} from '../../types';

function person(over: Partial<EmployeeWorkday> = {}): EmployeeWorkday {
  return {
    employee_id: 'e1',
    employee_name: 'Aldric',
    contracted_weekly: 40,
    part_time: false,
    period_hours: 171,
    period_expected: 171,
    period_deviation: 0,
    recovery_hours: 0,
    irregular_hours: 0,
    overtime_hours: 0,
    complementary_hours: 0,
    compensated_hours: 0,
    findings: [],
    ...over,
  };
}

function week(over: Partial<WeekReport> = {}): WeekReport {
  return {
    employee_id: 'e1',
    employee_name: 'Aldric',
    week_start: '2026-09-07',
    week_hours: 40,
    annual_hours_to_date: 0,
    deviation_vs_average: 0,
    contracted_weekly: 40,
    part_time: false,
    overtime_cap: 80,
    recovery_hours: 0,
    irregular_hours: 0,
    overtime_hours: 0,
    complementary_hours: 0,
    compensated_hours: 0,
    errors: [],
    recovery_credits: [],
    ...over,
  };
}

function report(over: Partial<WorkdayOut> = {}): WorkdayOut {
  return {
    regime: 'annual_average',
    weekly_average_hours: 40,
    annual_hours: 1783,
    irregular_pct: 0.1,
    irregular_notice_days: 5,
    annual_overtime_cap: 80,
    overtime_compensation_months: 4,
    part_time_overtime_allowed: false,
    year_start: '2026-01-01',
    period_start: '2026-09-07',
    period_end: '2026-10-11',
    cycle_start: '2026-09-01',
    employees: [],
    weeks: [],
    ...over,
  };
}

function error(over: Partial<WorkdayError> = {}): WorkdayError {
  return {
    rule: 'short_notice',
    day: '2026-09-10',
    employee_id: 'e1',
    detail: { days: 2, required: 5 },
    ...over,
  };
}

describe('signedHours — a balance carries its direction', () => {
  afterEach(() => setLanguage('en'));

  it('writes the sign, and a real minus sign rather than a hyphen', () => {
    setLanguage('es');
    expect(signedHours(13)).toBe('+13h');
    expect(signedHours(-20.5)).toBe('−20,5h');
    // U+2212, not U+002D: at this size a hyphen before a digit reads as a dash
    // between two of them.
    expect(signedHours(-20.5).charCodeAt(0)).toBe(0x2212);
  });

  it('writes the decimal mark of the language, like every other figure', () => {
    setLanguage('en');
    expect(signedHours(-36.5)).toBe('−36.5h');
    setLanguage('es');
    expect(signedHours(-36.5)).toBe('−36,5h');
  });

  it('prints an unsigned zero inside the dead band', () => {
    // "+0,1h over contract" is noise dressed as precision, and the column is
    // already grey there.
    expect(signedHours(0)).toBe('0h');
    expect(signedHours(0.2)).toBe('0h');
    expect(signedHours(-0.2)).toBe('0h');
  });
});

describe('balanceLean — a direction, never a verdict', () => {
  it('leans over, leans under, or is level', () => {
    expect(balanceLean(13)).toBe('over');
    expect(balanceLean(-20.5)).toBe('short');
    expect(balanceLean(0)).toBe('level');
  });

  it('holds still inside a quarter of an hour', () => {
    // Without the dead band the column flickers between two words on rounding
    // alone, which reads as instability in the rota.
    expect(balanceLean(0.24)).toBe('level');
    expect(balanceLean(-0.24)).toBe('level');
    expect(balanceLean(0.25)).toBe('over');
  });
});

describe('excessHours — the law names the hours, not the number', () => {
  it('calls a full-timer’s excess extraordinarias (art. 35)', () => {
    const excess = excessHours(person({ overtime_hours: 13 }));
    expect(excess).toEqual({
      kind: 'overtime',
      key: 'workday.extra.overtime',
      hours: 13,
      moved: null,
    });
  });

  it('never calls a part-timer’s excess that (art. 12.4.c)', () => {
    // 20 h contract working 35 h/week for four months: real figures from the
    // backend. Extra hours are unlawful on a part-time contract, so what these
    // hours ARE is complementary (art. 12.5) -- and the name is what decides
    // which ceiling applies and how payroll pays them.
    const excess = excessHours(
      person({ part_time: true, complementary_hours: 159.8 }),
    );
    expect(excess?.kind).toBe('complementary');
    expect(excess?.key).toBe('workday.extra.complementary');
    expect(excess?.hours).toBe(159.8);
  });

  it('ignores an overtime figure on a part-time contract', () => {
    // Belt and braces: the server should never send one, and if it does, the
    // screen may not print a word art. 12.4.c forbids.
    const excess = excessHours(
      person({ part_time: true, overtime_hours: 9, complementary_hours: 0 }),
    );
    expect(excess).toBeNull();
  });

  it('names moved hours when there are no extra ones to name', () => {
    // A 40 h contract working 46 h for five weeks: +30 h of balance and ZERO
    // overtime, because the tenth of the year art. 34.2 allows swallows all of
    // it. Those hours are ORDINARY and a shorter week gives them back -- but
    // if the column says "—" the +30 h balance beside it is unexplained, which
    // is the exact sin this screen was rebuilt to fix.
    const excess = excessHours(person({ irregular_hours: 30 }));
    expect(excess).toEqual({
      kind: 'moved',
      key: 'workday.extra.moved',
      hours: 30,
      moved: null,
    });
  });

  it('puts the extra hours first and the moved ones underneath', () => {
    // Different hours, both real. One is a cost and a ceiling, the other is
    // bookkeeping, so only one of them can be the figure.
    const excess = excessHours(person({ overtime_hours: 4, irregular_hours: 30 }));
    expect(excess?.kind).toBe('overtime');
    expect(excess?.hours).toBe(4);
    expect(excess?.moved).toBe(30);
  });

  it('says nothing when nobody went above their contract', () => {
    expect(excessHours(person())).toBeNull();
  });
});

describe('weekColumns — a drawer of dashes proves nothing', () => {
  const plain = [week(), week({ week_start: '2026-09-14' })];

  it('drops the columns this person has nothing in', () => {
    expect(weekColumns(plain, 'annual_average')).toEqual([
      'week',
      'hours',
      'deviation',
    ]);
  });

  it('keeps a column as soon as ONE week has something in it', () => {
    const weeks = [
      week(),
      week({ week_start: '2026-09-14', recovery_hours: 8 }),
    ];
    expect(weekColumns(weeks, 'annual_average')).toContain('recovery');
    expect(weekColumns(weeks, 'annual_average')).not.toContain('moved');
  });

  it('names the extra column for whatever the contract calls its excess', () => {
    const fullTime = [week({ overtime_hours: 3 })];
    const partTime = [week({ part_time: true, complementary_hours: 3 })];
    // A part-timer's complementary hours are not in `overtime_hours`, and a
    // column keyed off the wrong field would be empty for exactly the people
    // whose excess matters most.
    expect(weekColumns(fullTime, 'annual_average')).toContain('extra');
    expect(weekColumns(partTime, 'annual_average')).toContain('extra');
    expect(weekColumns([week()], 'annual_average')).not.toContain('extra');
  });

  it('hides the year’s pace where there is no year to be ahead of', () => {
    const weeks = [week({ annual_hours_to_date: 400 })];
    expect(weekColumns(weeks, 'annual_average')).toEqual([
      'week',
      'hours',
      'annual',
      'deviation',
    ]);
    expect(weekColumns(weeks, 'weekly_ceiling')).toEqual(['week', 'hours']);
  });

  it('always keeps the spine, even for a week of nothing', () => {
    expect(weekColumns([week({ week_hours: 0 })], 'weekly_ceiling')).toEqual([
      'week',
      'hours',
    ]);
  });
});

describe('findingKey — the sentence a finding is written from', () => {
  it('is the rule, for every rule', () => {
    expect(findingKey({ rule: 'irregular_share_exceeded', detail: {} })).toBe(
      'workday.error.irregular_share_exceeded',
    );
    expect(findingKey({ rule: 'short_notice', detail: { days: 2 } })).toBe(
      'workday.error.short_notice',
    );
  });

  it('does not read out a negative notice as a notice', () => {
    // A rota published retroactively sends `days` negative. The arithmetic is
    // right and "announced −140 days ahead" is absurd; the data is not ours to
    // fix, but the sentence is.
    expect(
      findingKey({ rule: 'short_notice', detail: { days: -140, required: 5 } }),
    ).toBe('workday.error.short_notice_after');
  });
});

describe('groupFindings — one entry per rule, however many weeks it touched', () => {
  it('counts the repeats and keeps the earliest date', () => {
    const grouped = groupFindings([
      error({ day: '2026-09-10' }),
      error({ day: '2026-09-17' }),
      error({ rule: 'irregular_share_exceeded', day: '2026-09-17', detail: {} }),
      error({ day: '2026-09-24' }),
    ]);
    expect(grouped.map((f) => [f.rule, f.count, f.day])).toEqual([
      ['short_notice', 3, '2026-09-10'],
      ['irregular_share_exceeded', 1, '2026-09-17'],
    ]);
  });

  it('keeps the MOST RECENT numbers, whatever order the weeks arrive in', () => {
    // The figures in `detail` are cumulative: "84 extra hours this year" is
    // the state of things now, and the first occurrence reports the moment the
    // ceiling was crossed, which is older news than the manager needs.
    const grouped = groupFindings([
      error({ rule: 'overtime_cap_exceeded', day: '2026-09-24', detail: { worked: 92 } }),
      error({ rule: 'overtime_cap_exceeded', day: '2026-09-10', detail: { worked: 84 } }),
    ]);
    expect(grouped[0]?.detail).toEqual({ worked: 92 });
    expect(grouped[0]?.day).toBe('2026-09-10');
  });
});

describe('workdayRows — one row per person', () => {
  it('takes the server’s figures and hangs the weeks off them', () => {
    const rows = workdayRows(
      report({
        employees: [
          person({ employee_id: 'e1', period_hours: 150.5, period_deviation: -20.5 }),
          person({ employee_id: 'e2', employee_name: 'izan', period_hours: 184, period_deviation: 13 }),
        ],
        weeks: [
          week({ employee_id: 'e1' }),
          week({ employee_id: 'e1', week_start: '2026-09-14' }),
          week({ employee_id: 'e2' }),
        ],
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.person.employee_id).toBe('e1');
    expect(rows[0]?.weeks).toHaveLength(2);
    expect(rows[1]?.weeks).toHaveLength(1);
  });

  it('drops somebody who was simply not scheduled', () => {
    // An empty row per person who did not work is noise, and the calendar is
    // where an absence is read.
    const rows = workdayRows(
      report({
        employees: [person({ period_hours: 0, period_expected: 0 })],
        weeks: [week({ week_hours: 0 })],
      }),
    );
    expect(rows).toEqual([]);
  });

  it('keeps a row that has a finding and barely any hours', () => {
    // The row a manager most needs to see: a rule broken in a period somebody
    // hardly worked.
    const rows = workdayRows(
      report({
        employees: [
          person({
            period_hours: 0,
            findings: [
              { rule: 'short_notice', day: '2026-09-10', detail: {}, count: 2 },
            ],
          }),
        ],
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it('folds the weeks itself while the server has not caught up', () => {
    // The fallback, and only that: the API adds `employees` and its figures
    // win whenever they are there. Without this, a browser on the old API --
    // or on the old bundle's cached response -- shows an empty screen on a
    // view that used to work.
    const rows = workdayRows(
      report({
        employees: [],
        weeks: [
          week({ week_hours: 46, irregular_hours: 6, errors: [error()] }),
          week({
            week_start: '2026-09-14',
            week_hours: 46,
            irregular_hours: 6,
            errors: [error({ day: '2026-09-17' })],
          }),
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    const folded = rows[0]?.person;
    expect(folded?.period_hours).toBe(92);
    // Two weeks of a 40 h contract is what the contract asks for over those
    // dates -- the same subtraction the server makes, and no re-derivation of
    // any ceiling, cap or breach.
    expect(folded?.period_expected).toBe(80);
    expect(folded?.period_deviation).toBe(12);
    expect(folded?.irregular_hours).toBe(12);
    expect(folded?.findings).toEqual([
      { rule: 'short_notice', day: '2026-09-10', detail: { days: 2, required: 5 }, count: 2 },
    ]);
  });

  it('has nothing to say before the first request lands', () => {
    expect(workdayRows(null)).toEqual([]);
  });
});

// --- The five days of December nobody planned ------------------------------
//
// From the running app. November was drafted to the hour. The planner's "If
// you publish" column said 0h; this screen said −28,6h for the same person in
// the same month, because it reports whole weeks and its period ran "1 Nov to
// 6 Dec" -- five days of a December with no rota in it, charged to everybody's
// contract. Both screens were arithmetically right and one of them had to be
// wrong to a manager, who has only one November.
//
// The fix is the horizon the balance column already uses: measure to where the
// rota stops (`period_measured_to`), say so in the header, and report what the
// contract asks for beyond it (`period_pending`) as hours still to plan.

describe('the part of the period nobody has planned', () => {
  it('reads a missing field as nothing pending', () => {
    // An older server sends neither figure. Nothing to report, and the screen
    // is exactly what it was.
    expect(pendingHours(person())).toBe(0);
    expect(hasPending(person())).toBe(false);
  });

  it('never reports a negative amount left to plan', () => {
    // A period planned past its own end is not "−3 hours to plan".
    expect(pendingHours(person({ period_pending: -3 }))).toBe(0);
  });

  it('uses the same band as the planner column, not the balance band', () => {
    // LEVEL_BAND (0,25 h) decides whether a BALANCE leans; half an hour of
    // work still to schedule is not worth a sentence on either screen.
    expect(hasPending(person({ period_pending: 0.9 }))).toBe(false);
    expect(hasPending(person({ period_pending: 1 }))).toBe(true);
    expect(pendingHours(person({ period_pending: 28.57 }))).toBe(28.57);
  });

  it('states the day the figures really stop on, not the end of the window', () => {
    // THE BUG. The window was rounded out to whole weeks and ended on the 6th
    // of December; the rota ended with November. The header must say the 30th
    // of November -- `period_measured_to` is exclusive, like every horizon in
    // this codebase.
    expect(
      measuredTo(
        report({
          period_start: '2026-11-01',
          period_end: '2026-12-06',
          period_measured_to: '2026-12-01',
        }),
      ),
    ).toBe('2026-11-30');
  });

  it('keeps the old header against a server that does not send the field', () => {
    expect(measuredTo(report())).toBe('2026-10-11');
    expect(measuredTo(null)).toBeNull();
  });

  it('says nothing rather than naming a day outside the window', () => {
    // Nothing planned at all: there is no measured range to state, and the
    // day before the period opened is not one.
    expect(
      measuredTo(report({ period_start: '2026-11-01', period_measured_to: null })),
    ).toBeNull();
    expect(
      measuredTo(
        report({ period_start: '2026-11-01', period_measured_to: '2026-11-01' }),
      ),
    ).toBeNull();
  });
});

describe('the two screens answer the same month the same way', () => {
  // November on the rota to the hour, under a 40-hour contract: 145,71 h of
  // contract in November (40 × 30/7), and the five days of December the
  // weekly rounding drags in are 28,57 h that nobody has planned.
  const NOVEMBER = 145.71;
  const DECEMBER_TAIL = 28.57;

  it('shows the same balance and the same hours left to plan', () => {
    const row = person({
      period_hours: NOVEMBER,
      period_expected: NOVEMBER,
      period_deviation: 0,
      period_pending: DECEMBER_TAIL,
    });
    // The planner's column, given the same month: November measured, the tail
    // reported as pending rather than charged.
    const column = projectRows(
      {
        employees: [
          {
            employee_id: 'e1',
            employee_name: 'Aldric',
            month: {
              planned: NOVEMBER,
              total: NOVEMBER,
              published_in_window: 0,
              pending: DECEMBER_TAIL,
              horizon: '2026-12-01',
              start: '2026-11-01',
            },
            quarter: { planned: 0, total: 0, published_in_window: 0 },
            year: { planned: 0, total: 0, published_in_window: 0 },
          },
        ],
      },
      {},
      'month',
    )[0];

    // The figure: 0h on both screens, and never the −28,6h of the screenshot.
    expect(signedHours(row.period_deviation)).toBe(signedHours(column.projected));
    expect(signedHours(row.period_deviation)).toBe('0h');
    // The sentence under it: the same hours, so the same words.
    expect(pendingHours(row)).toBe(column.pending);
    // And the day each screen says it measured to.
    expect(
      measuredTo(
        report({
          period_start: '2026-11-01',
          period_end: '2026-12-06',
          period_measured_to: '2026-12-01',
        }),
      ),
    ).toBe(column.through);
  });
});
