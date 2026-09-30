// What the working-year table actually says, worked out away from the markup.
//
// WHY THIS FILE EXISTS. The screen it feeds (WorkdayView.tsx) was a weekly
// table under an annual title: five rows per person, seven columns, most of
// them dashes, and the same breach printed once per week. The owner's verdict
// was "no se entiende". What it is now is one row per person with their weeks
// folded underneath, and the three things that decision turns on are all
// judgements rather than layout:
//
//   which figure the balance is measured against,
//   what the hours above a contract are CALLED,
//   which of the weekly columns are worth drawing for this person.
//
// All three produce a plausible wrong answer rather than a broken screen when
// they are wrong, so they live here, free of React, and under test. The test
// environment is `node` with no DOM (see vitest.config.ts), which is also why
// none of this may touch a component.
//
// THE BALANCE IS AGAINST THE CONTRACT OF THE PERIOD, NOT THE ANNUAL PACE.
// The old column compared the week to the year's average -- 1.783 h a year is
// 34,3 h a week -- and told somebody who had just worked 36,5 hours that they
// were "20,9 h por detrás". Both true and unreadable: it is a statement about
// February measured against a ruler nobody can see. `period_expected` is what
// this person's contract asks for over exactly the dates on screen, so the
// balance is a subtraction the manager can check in his head. It is also the
// figure the planner's balance column and the employees list already show,
// which is the second half of the bug: three screens, three numbers, one
// question.

import type {
  EmployeeWorkday,
  WeekReport,
  WorkdayError,
  WorkdayFinding,
  WorkdayOut,
} from '../../types';
import { formatHours } from '../../lib/format';
import { DEAD_BAND_HOURS, dayBefore } from '../../lib/schedule/projectedBalance';

/**
 * How far off the contract still counts as level, in hours.
 *
 * Without a dead band the column flickers between "over" and "short" on
 * rounding alone, which reads as instability in the rota rather than in the
 * arithmetic. The same quarter of an hour as `HoursBalance` on the employees
 * page and `projectedBalance`; they are answering the same question.
 */
export const LEVEL_BAND = 0.25;

/**
 * Which way a balance leans. Three directions, and deliberately not a verdict.
 *
 * The repository has made this call twice before (`HoursBalance`,
 * `HoursBalanceCard`) and makes it the same way here: under an annual average,
 * hours over and hours short are two DIRECTIONS, not a pass and a fail. A
 * manager who reads one colour as an alarm will "fix" a rota that was working
 * exactly as intended. Red is spent on findings only.
 */
export type BalanceLean = 'over' | 'short' | 'level';

export function balanceLean(deviation: number): BalanceLean {
  if (Math.abs(deviation) < LEVEL_BAND) return 'level';
  return deviation > 0 ? 'over' : 'short';
}

/**
 * "+13h", "−20,5h", "0h" -- a balance, with the direction in front of it.
 *
 * A real minus sign (U+2212), not a hyphen: at this size a hyphen in front of
 * a digit reads as a dash between two of them. Same function, same reasoning,
 * as `signed` in DraftBalanceColumn; the two columns now show the same figure
 * and must not write it two ways.
 *
 * Anything inside the dead band prints as an unsigned zero. "+0,1h over" is
 * noise dressed as precision, and the tone is already grey there.
 */
export function signedHours(hours: number): string {
  if (Math.abs(hours) < LEVEL_BAND) return formatHours(0);
  return `${hours > 0 ? '+' : '−'}${formatHours(Math.abs(hours))}`;
}

// ---- What is measured, and what is merely asked for -----------------------
//
// THE TWO SCREENS HAVE TO CUT THE MONTH IN THE SAME PLACE. This view reports
// whole weeks, so a November planned to the hour comes back as "1 Nov to 6
// Dec" -- and the five days of December in that span are days nobody has
// written a rota for. Charged against the contract they turned a balance of
// 0 h into −28,6 h, while the planner's "If you publish" column, which stops
// where the rota stops, said 0 h for the same person in the same month. Two
// screens, one question, two answers, and no way for a manager to tell which
// one was lying.
//
// The server now cuts both the same way: `period_expected` stops at
// `period_measured_to`, and what the contract asks for beyond it travels as
// `period_pending` -- to be SHOWN, in the same words the column uses, and
// never folded into a balance. This is the client's half of that.

/**
 * Hours the contract still has to hand out over this period, never negative.
 *
 * Zero for a server that does not send the field, which is what keeps this
 * screen on an older API exactly as it was: no pending hours to report, and a
 * period measured end to end.
 */
export function pendingHours(
  person: Pick<EmployeeWorkday, 'period_pending'>,
): number {
  return Math.max(0, person.period_pending ?? 0);
}

/**
 * Whether the hours still to plan are worth a line of their own.
 *
 * The same band as the planner's column (`DEAD_BAND_HOURS`, an hour) and
 * deliberately not this file's `LEVEL_BAND` of a quarter of an hour: that one
 * decides whether a BALANCE leans, where a few minutes either way is rounding.
 * This one decides whether to say a sentence about work still to be scheduled,
 * and half an hour of it is not news on either screen.
 */
export function hasPending(
  person: Pick<EmployeeWorkday, 'period_pending'>,
): boolean {
  return pendingHours(person) >= DEAD_BAND_HOURS;
}

/**
 * The last day the figures on this screen actually cover, inclusive, or null.
 *
 * What the header must print. `period_end` is the end of the window that was
 * ASKED for, rounded out to whole weeks; `period_measured_to` is where the
 * rota stops, exclusive, and is what the figures were computed to. Printing
 * the first while measuring to the second is the header claiming a week of
 * December it never looked at.
 *
 * Falls back to `period_end` when the server does not send the new field --
 * the reading this header always had. Null when the measured part ends before
 * the period even begins, which is a period with nothing planned in it: there
 * is no range to state, and the header says nothing rather than naming a day
 * outside the window.
 */
export function measuredTo(data: WorkdayOut | null): string | null {
  if (!data) return null;
  if (data.period_measured_to === undefined) return data.period_end;
  const through = dayBefore(data.period_measured_to);
  if (!through) return null;
  if (data.period_start && through < data.period_start) return null;
  return through;
}

/**
 * The hours above the contract, under the name the law gives them.
 *
 * THREE NOUNS, ONE COLUMN, AND THE LAW PICKS.
 *
 *   horas complementarias (art. 12.5) on a part-time contract. What a
 *   part-timer works above their hours may NOT be called overtime at all --
 *   art. 12.4.c forbids extra hours on a part-time contract -- so this is
 *   either complementary hours under a written pact or hours that could not
 *   lawfully be asked for. Printing "overtime" here would be the friendlier
 *   column and the wrong one: the name decides which ceiling applies, whether
 *   the hours were lawful, and how payroll pays them.
 *
 *   horas extraordinarias (art. 35) on a full-time one. The two above never
 *   coexist: a contract is part-time or full-time, never both.
 *
 *   horas movidas (art. 34.2) -- and this is the one the first version of the
 *   column missed. Under the irregular distribution a full-timer can work
 *   46 h a week for five weeks and have a +30 h balance with ZERO overtime,
 *   because the tenth of the year art. 34.2 allows swallows all of it. Those
 *   30 hours are ORDINARY hours worked early that a shorter week will give
 *   back. A column that only looks for extra hours shows that person "+30h"
 *   of balance and a dash beside it, which leaves the balance unexplained --
 *   exactly the sin this redesign exists to fix. So they are named, in grey,
 *   because they are information and not a problem.
 *
 * Moved hours can coexist with extra ones (they are different hours). When
 * both are there the extra ones are the figure and the moved ones the line
 * underneath: one of the two is a cost and a ceiling, the other is bookkeeping.
 *
 * Returns message KEYS rather than sentences, so the choice can be tested
 * without a dictionary and without a language.
 */
export interface ExcessHours {
  /**
   * Which noun won. 'moved' is the only one drawn in grey: art. 34.2 hours are
   * ordinary, and colouring them would call a lawful rota a breach.
   */
  kind: 'complementary' | 'overtime' | 'moved';
  /** 'workday.extra.complementary' | '.overtime' | '.moved'. */
  key: string;
  hours: number;
  /** Moved hours to state under the figure, or null when there are none to add. */
  moved: number | null;
}

export function excessHours(
  person: Pick<
    EmployeeWorkday,
    'part_time' | 'overtime_hours' | 'complementary_hours' | 'irregular_hours'
  >,
): ExcessHours | null {
  const moved = person.irregular_hours > 0 ? person.irregular_hours : null;
  // Order matters and is the order of the law, not of the numbers: the name a
  // contract gives its own excess comes first, and moved hours are what is
  // left to say when there is no excess to name.
  if (person.part_time && person.complementary_hours > 0) {
    return {
      kind: 'complementary',
      key: 'workday.extra.complementary',
      hours: person.complementary_hours,
      moved,
    };
  }
  if (!person.part_time && person.overtime_hours > 0) {
    return {
      kind: 'overtime',
      key: 'workday.extra.overtime',
      hours: person.overtime_hours,
      moved,
    };
  }
  if (moved !== null) {
    return { kind: 'moved', key: 'workday.extra.moved', hours: moved, moved: null };
  }
  return null;
}

/**
 * The sentence a finding is written from.
 *
 * One key per `rule` the server sends, with one exception that is not a
 * special case for its own sake. `short_notice` carries the days of notice
 * given, and a rota published retroactively -- a shift entered after it was
 * worked -- sends that number NEGATIVE. The arithmetic is right and the
 * sentence is absurd: "announced 140 days ahead" with a minus sign in front of
 * it. Dirty data is not this screen's to fix, but it is this screen's not to
 * read out nonsense, so a negative notice says what actually happened.
 */
export function findingKey(
  finding: Pick<WorkdayFinding, 'rule' | 'detail'>,
): string {
  if (finding.rule === 'short_notice' && (finding.detail.days ?? 0) < 0) {
    return 'workday.error.short_notice_after';
  }
  return `workday.error.${finding.rule}`;
}

// ---- The drawer's columns -------------------------------------------------

/**
 * The weekly columns, in the order they are drawn.
 *
 * `week` and `hours` are the drawer's spine and always there. The rest are
 * drawn only when this person has something in them: a part-timer who never
 * recovered a day off and never had an hour moved does not need two columns of
 * dashes to prove it, and four people times three empty columns is the noise
 * that buried the figures that were not empty.
 *
 * `annual` and `deviation` are the year's pace, which is real but is no longer
 * the headline -- the person's own row carries the balance now. They are also
 * meaningless outside an annual-average regime, where there is no year to be
 * ahead of, so the regime drops them rather than printing a column of zeroes.
 */
export type WeekColumn =
  | 'week'
  | 'hours'
  | 'annual'
  | 'deviation'
  | 'recovery'
  | 'moved'
  | 'extra';

const COLUMN_ORDER: WeekColumn[] = [
  'week',
  'hours',
  'annual',
  'deviation',
  'recovery',
  'moved',
  'extra',
];

/** Does any of this person's weeks have something to put in that column? */
const HAS_SOMETHING: Record<WeekColumn, (week: WeekReport) => boolean> = {
  week: () => true,
  hours: () => true,
  annual: (w) => w.annual_hours_to_date > 0,
  deviation: () => true,
  recovery: (w) => w.recovery_hours > 0,
  moved: (w) => w.irregular_hours > 0,
  extra: (w) => (w.part_time ? w.complementary_hours : w.overtime_hours) > 0,
};

/** Only the annual regime has a year to be ahead or behind of. */
const ANNUAL_ONLY: WeekColumn[] = ['annual', 'deviation'];

export function weekColumns(
  weeks: WeekReport[],
  regime: WorkdayOut['regime'],
): WeekColumn[] {
  return COLUMN_ORDER.filter((column) => {
    if (regime !== 'annual_average' && ANNUAL_ONLY.includes(column)) {
      return false;
    }
    return weeks.some(HAS_SOMETHING[column]);
  });
}

// ---- The rows -------------------------------------------------------------

/** One person, their period figures, and the weeks that add up to them. */
export interface WorkdayRow {
  person: EmployeeWorkday;
  weeks: WeekReport[];
}

/**
 * The same rule, however many times it happened, said once.
 *
 * The server groups findings itself; this is the same fold for the weeks-only
 * shape below, and the reason it keeps the LAST detail rather than the first is
 * that the numbers in it are cumulative -- "84 extra hours this year" is the
 * state of things now, and the first occurrence would report the moment the
 * ceiling was crossed, which is older news than the manager needs.
 *
 * Rule order is first-seen, not alphabetical: the earliest problem reads first.
 */
export function groupFindings(errors: WorkdayError[]): WorkdayFinding[] {
  const out = new Map<string, WorkdayFinding>();
  // The date the current `detail` came from, which is not the one shown: the
  // entry shows the EARLIEST day and the LATEST numbers, so the two have to be
  // tracked apart or an out-of-order week overwrites the wrong one.
  const newest = new Map<string, string>();
  for (const error of errors) {
    const seen = out.get(error.rule);
    if (!seen) {
      out.set(error.rule, {
        rule: error.rule,
        day: error.day,
        detail: error.detail,
        count: 1,
      });
      newest.set(error.rule, error.day);
      continue;
    }
    seen.count += 1;
    if (error.day < seen.day) seen.day = error.day;
    if (error.day >= (newest.get(error.rule) ?? error.day)) {
      seen.detail = error.detail;
      newest.set(error.rule, error.day);
    }
  }
  return [...out.values()];
}

/**
 * Fold the week rows into one row per person.
 *
 * ONLY A FALLBACK, and deliberately a narrow one. The server sends `employees`
 * and its figures win whenever they are there; this covers the window where a
 * browser still holding the old bundle -- or a deployment where the API has not
 * caught up -- would otherwise show an empty screen on a view that used to
 * work.
 *
 * It sums what is a sum and nothing else. `period_expected` is the contracted
 * week times the number of weeks reported, which is exactly what it means for
 * a window made of whole weeks (the only kind this endpoint reports). Nothing
 * here re-derives a ceiling, a cap or a breach: those are the server's, and a
 * second implementation of them in the browser is how two screens start
 * disagreeing about the law.
 */
function foldWeeks(weeks: WeekReport[]): EmployeeWorkday[] {
  const out = new Map<string, EmployeeWorkday>();
  const counted = new Map<string, number>();
  const errors = new Map<string, WorkdayError[]>();
  for (const week of weeks) {
    let person = out.get(week.employee_id);
    if (!person) {
      person = {
        employee_id: week.employee_id,
        employee_name: week.employee_name,
        contracted_weekly: week.contracted_weekly,
        part_time: week.part_time,
        period_hours: 0,
        period_expected: 0,
        period_deviation: 0,
        recovery_hours: 0,
        irregular_hours: 0,
        overtime_hours: 0,
        complementary_hours: 0,
        compensated_hours: 0,
        findings: [],
      };
      out.set(week.employee_id, person);
      errors.set(week.employee_id, []);
    }
    counted.set(week.employee_id, (counted.get(week.employee_id) ?? 0) + 1);
    person.period_hours += week.week_hours;
    person.recovery_hours += week.recovery_hours;
    person.irregular_hours += week.irregular_hours;
    person.overtime_hours += week.overtime_hours;
    person.complementary_hours += week.complementary_hours;
    person.compensated_hours += week.compensated_hours;
    errors.get(week.employee_id)?.push(...week.errors);
  }
  return [...out.values()].map((person) => {
    const expected =
      person.contracted_weekly * (counted.get(person.employee_id) ?? 0);
    return {
      ...person,
      period_expected: expected,
      period_deviation: person.period_hours - expected,
      findings: groupFindings(errors.get(person.employee_id) ?? []),
    };
  });
}

/**
 * One row per person, in the order the server sent them, each carrying its own
 * weeks for the drawer.
 *
 * A person with no hours, no findings and nothing recovered is dropped: an
 * empty row for somebody who was not scheduled is noise, and the calendar is
 * where an absence is read. Note that a finding alone keeps a row -- somebody
 * can breach a rule in a period they barely worked, and that row is the one
 * the manager most needs to see.
 */
export function workdayRows(data: WorkdayOut | null): WorkdayRow[] {
  if (!data) return [];
  const byEmployee = new Map<string, WeekReport[]>();
  for (const week of data.weeks ?? []) {
    const weeks = byEmployee.get(week.employee_id) ?? [];
    weeks.push(week);
    byEmployee.set(week.employee_id, weeks);
  }
  const people =
    data.employees && data.employees.length > 0
      ? data.employees
      : foldWeeks(data.weeks ?? []);
  return people
    .map((person) => ({
      person,
      weeks: byEmployee.get(person.employee_id) ?? [],
    }))
    .filter(
      ({ person }) =>
        person.period_hours > 0 ||
        person.recovery_hours > 0 ||
        person.findings.length > 0,
    );
}
