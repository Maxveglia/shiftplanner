// Judging a calendar we did not build.
//
// `generateSchedule` checks every rule as it places a shift, with mutable state
// that only makes sense mid-loop. That is the right shape for a generator and
// the wrong one for a JUDGE: nothing in this codebase could take a finished set
// of assignments and say whether it is legal, because until now nothing ever
// had to. Everything we drew, we drew ourselves.
//
// A model proposing the calendar changes that. What comes back is a set of
// shifts with no provenance and no guarantees, and the ONLY thing standing
// between it and an employee's week is this file.
//
// TWO RULES GOVERN IT:
//
// 1. It never re-derives a limit. `weeklyCeiling`, `contractCeiling`,
//    `SPLIT_MIN_GAP`, `availability`, `needAt`, `windowFor` and `isClosedOn`
//    are imported from where the generator gets them. A validator with its own
//    copy of the rest rule is two answers to "was this person given enough
//    rest?", and the day they disagree is the day somebody finishes at four and
//    is called back at six.
//
// 2. It reports, it does not repair. Deciding what to do about a violation --
//    drop the shift, ask the model again, hand it to the manager -- depends on
//    which violation it is and how many there are. Mixing that judgement in
//    here would make the check itself unverifiable.

import type {
  AbsenceOut,
  AbsenceTypeOut,
  EmployeeOut,
  ShiftTemplateOut,
} from '../../types';
import { availability } from './availability';
import {
  SPLIT_MIN_GAP,
  toDateKey,
  weekKey,
  weeklyCeiling,
} from './generate';
import { isClosedOn, needAt, windowFor } from './demand';
import { peopleAtHour } from './coverage';
import { NIGHT_WORKER_MIN_HOURS, nightHoursIn } from './night';
import { EMPTY_OVERLAY, blackoutKey, type ScheduleOverlay } from './overlay';
import type {
  Assignment,
  CoverageGap,
  DayRef,
  SchedulingSpec,
} from './types';

/**
 * What a proposed calendar got wrong.
 *
 * `hard` violations are the ones a rota may never carry: they break the law,
 * a contract, or a fact about a person (they do not work here, they are on
 * leave). `soft` ones are defensible but worth surfacing -- the manager may
 * have reasons the model does not know.
 */
export type ViolationKind =
  /** An employee id that is not on this org's live roster. */
  | 'unknown_employee'
  /** Not employed yet, no longer employed, on leave, or absent that day. */
  | 'unavailable'
  /** A slot the manager deliberately emptied. */
  | 'blackout'
  /** The business is shut that day. */
  | 'closed_day'
  /** Wholly or partly outside the hours the business is open. */
  | 'outside_hours'
  /** The same person in two places at once. */
  | 'overlap'
  /** Less than the required break since their previous shift. */
  | 'rest'
  /** A second shift in one day where splits are not allowed. */
  | 'split_not_allowed'
  /** More people working a split day than the brief permits. */
  | 'split_cap'
  /** More than three shifts in one day -- never a split, always an error. */
  | 'too_many_shifts'
  /** Beyond this employee's weekly ceiling. */
  | 'weekly_ceiling'
  /** More hours in one day than the law allows (Spain: 9). */
  | 'daily_hours'
  /** No unbroken day and a half off in a week (Spain: 36 h, art. 37.1 ET). */
  | 'weekly_rest'
  /** A night worker's days averaging past the cap (Spain: 8 h, art. 36.1 ET). */
  | 'night_average'
  /** A shift template that does not exist. */
  | 'unknown_template';

const HARD: ReadonlySet<ViolationKind> = new Set<ViolationKind>([
  'unknown_employee',
  'unavailable',
  'blackout',
  'closed_day',
  'overlap',
  'rest',
  'split_not_allowed',
  'too_many_shifts',
  'unknown_template',
  // The statutory three. Hard, because unlike a weekly ceiling -- which a
  // manager may knowingly exceed and pay for -- none of these can be bought:
  // a rota that breaks them is one the Inspección de Trabajo would fine, and
  // showing it as merely "worth a look" would be the product lying politely.
  'daily_hours',
  'weekly_rest',
  'night_average',
]);

export interface Violation {
  kind: ViolationKind;
  /** True when the schedule may not be shown to anyone with this in it. */
  hard: boolean;
  employeeId: string | null;
  /** The day the offending shift STARTS on, or the day a cap was exceeded. */
  date: string;
  /** Which assignments are implicated. Two, for an overlap or a rest breach. */
  assignmentIds: string[];
  /**
   * Numbers the UI interpolates into a translated sentence.
   *
   * NEVER prose. The same reason `assumptions.ts` builds its own sentences:
   * a validator emitting English would either ship untranslated text to a
   * Spanish manager or tempt somebody into branching on it.
   */
  detail: Record<string, number | string>;
}

export interface ValidationResult {
  violations: Violation[];
  /** Hours where the proposal leaves the business under-staffed. */
  gaps: CoverageGap[];
  /** True when nothing hard was broken -- the only gate that matters. */
  ok: boolean;
}

/** Absolute minutes from midnight of `anchorDate`, for cross-day comparison. */
function abs(anchorDate: string, min: number): number {
  const [y, m, d] = anchorDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 60000 + min;
}



/**
 * Validate a proposed calendar against the same rules that generate it.
 *
 * `days` is the period being judged. Assignments outside it are IGNORED rather
 * than flagged: a month being regenerated must not be told off for the
 * neighbouring month's shifts, which it can neither see nor fix.
 */
export function validateSchedule(
  assignments: Assignment[],
  employees: EmployeeOut[],
  templates: ShiftTemplateOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  spec: SchedulingSpec,
  days: DayRef[],
  overlay: ScheduleOverlay = EMPTY_OVERLAY,
): ValidationResult {
  const violations: Violation[] = [];
  const add = (
    kind: ViolationKind,
    employeeId: string | null,
    date: string,
    assignmentIds: string[],
    detail: Record<string, number | string> = {},
  ) => {
    violations.push({
      kind,
      hard: HARD.has(kind),
      employeeId,
      date,
      assignmentIds,
      detail,
    });
  };

  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const inPeriod = assignments.filter((a) => dayByDate.has(a.date));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const templateIds = new Set(templates.map((t) => t.id));
  const blackouts = new Set(overlay.blackouts);

  const splitCap = Math.max(
    0,
    spec.splitShiftPeople ?? (spec.allowSplitShifts === true ? 1 : 0),
  );

  // ---- per-shift checks -------------------------------------------------

  for (const a of inPeriod) {
    const day = dayByDate.get(a.date) as DayRef;
    const emp = empById.get(a.employeeId);

    if (!emp) {
      // Everything below reads the contract, so there is nothing further to
      // say about a shift given to somebody who does not work here.
      add('unknown_employee', a.employeeId, a.date, [a.id]);
      continue;
    }

    const avail = availability(emp, absences, absenceTypes, a.date);
    if (!avail.ok) {
      add('unavailable', emp.id, a.date, [a.id], { reason: avail.kind });
    }

    if (blackouts.has(blackoutKey(emp.id, a.date))) {
      add('blackout', emp.id, a.date, [a.id]);
    }

    // A `band-*` id is not a template that went missing: it is what the
    // generator emits for an org with no templates of its own, named after the
    // time band the shift falls in (`generate.ts` -> `band-${look.bandKey}`).
    // Rejecting those would fail every calendar built for a business that
    // never defined a shift template -- which is most of them on day one.
    if (!templateIds.has(a.templateId) && !a.templateId.startsWith('band-')) {
      add('unknown_template', emp.id, a.date, [a.id], {
        templateId: a.templateId,
      });
    }

    if (isClosedOn(spec, day)) {
      add('closed_day', emp.id, a.date, [a.id]);
      continue; // an open window on a closed day is not a meaningful comparison
    }

    // A shift may start at the open and finish at the close, and an overnight
    // close is already expressed past 1440 by `windowFor` -- so this compares
    // like with like and does not need its own midnight rule.
    const w = windowFor(spec, day);
    if (a.startMin < w.openMin || a.endMin > w.closeMin) {
      add('outside_hours', emp.id, a.date, [a.id], {
        startMin: a.startMin,
        endMin: a.endMin,
        openMin: w.openMin,
        closeMin: w.closeMin,
      });
    }
  }

  // ---- per-employee, across the period ----------------------------------

  const byEmployee = new Map<string, Assignment[]>();
  for (const a of inPeriod) {
    if (!empById.has(a.employeeId)) continue;
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(a);
    byEmployee.set(a.employeeId, list);
  }

  /** `${date}` -> how many people worked a split that day. */
  const splitDays = new Map<string, number>();

  /**
   * The weeks every one of whose seven days is in the period.
   *
   * A weekly rest is measured across a whole week, and the period being
   * judged usually starts mid-week: the first week's rest is partly in the
   * week before, which this call cannot see. Judging it anyway would report a
   * breach on every rota whose period does not begin on a Monday.
   */
  const wholeWeeks = new Set<string>();
  {
    const present = new Set(days.map((d) => d.date));
    for (const day of days) {
      const k = weekKey(day.date);
      if (wholeWeeks.has(k)) continue;
      const start = new Date(`${k}T00:00:00Z`);
      let all = true;
      for (let i = 0; i < 7; i += 1) {
        const at = new Date(start);
        at.setUTCDate(start.getUTCDate() + i);
        if (!present.has(at.toISOString().slice(0, 10))) {
          all = false;
          break;
        }
      }
      if (all) wholeWeeks.add(k);
    }
  }

  for (const [empId, list] of byEmployee) {
    const emp = empById.get(empId) as EmployeeOut;

    // Sorted by absolute start, so "previous shift" means what it says even
    // when one of them runs past midnight into the next date.
    const sorted = [...list].sort(
      (x, y) => abs(x.date, x.startMin) - abs(y.date, y.startMin),
    );

    const perDay = new Map<string, Assignment[]>();
    for (const a of sorted) {
      const same = perDay.get(a.date) ?? [];
      same.push(a);
      perDay.set(a.date, same);
    }

    for (const [date, shifts] of perDay) {
      if (shifts.length <= 1) continue;
      if (shifts.length > 2) {
        add('too_many_shifts', empId, date, shifts.map((s) => s.id), {
          count: shifts.length,
        });
      }
      if (splitCap === 0) {
        add('split_not_allowed', empId, date, shifts.map((s) => s.id));
      } else {
        splitDays.set(date, (splitDays.get(date) ?? 0) + 1);
      }
    }

    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const prevEnd = abs(prev.date, prev.endMin);
      const curStart = abs(cur.date, cur.startMin);

      if (curStart < prevEnd) {
        add('overlap', empId, cur.date, [prev.id, cur.id], {
          gapMin: curStart - prevEnd,
        });
        continue; // an overlap is already the worse finding; rest is moot
      }

      // The same question the generator asks, asked the same way: is this the
      // SECOND half of one day, or the first shift of a new one? Keyed on the
      // date a shift starts, never on the clock -- a night that ends at four
      // begins after the new day did, and reading that as a split would buy
      // eleven hours of rest down to sixty minutes.
      const isSecondHalfOfDay = cur.date === prev.date;
      const requiredGap =
        splitCap > 0 && isSecondHalfOfDay ? SPLIT_MIN_GAP : spec.minRestHours * 60;

      if (curStart - prevEnd < requiredGap) {
        add('rest', empId, cur.date, [prev.id, cur.id], {
          gapMin: curStart - prevEnd,
          requiredMin: requiredGap,
        });
      }
    }

    // Weekly hours, Monday-anchored like the generator's own accumulator.
    //
    // Counted from `paidHours` as PROPOSED. When the caller has priced the
    // shifts itself -- which is the intended flow, since a model must not be
    // trusted with arithmetic -- these are the real figures. When it has not,
    // a proposal that lies about its own hours is exactly what should trip
    // this check rather than slip past it.
    const perWeek = new Map<string, number>();
    const perWeekShifts = new Map<string, Assignment[]>();
    for (const a of sorted) {
      const k = weekKey(a.date);
      perWeek.set(k, (perWeek.get(k) ?? 0) + a.paidHours);
      perWeekShifts.set(k, [...(perWeekShifts.get(k) ?? []), a]);
    }
    // A WEEKLY ceiling is only a ceiling where the law reads the week as one.
    //
    // Spain does not (art. 34.1 ET): the contracted week is an annual average,
    // so 45 hours one week answered by 35 the next is forty a week and neither
    // is a breach. Reporting the long week regardless is how this product told
    // a Barcelona manager that a legal rota was illegal -- and it was the
    // loudest finding on the screen, because a busy week trips it for every
    // person at once.
    //
    // So where `weeklyAverageHours` is stated, the week stops being judged
    // here and the year is judged instead, by `backend/app/services/workday.py`
    // -- which can see the whole year, as this function cannot. Nothing else
    // moves: the nine-hour day, the twelve hours between shifts and the weekly
    // rest are DAILY and WEEKLY limits that an annual average never buys its
    // way past, and they are checked below exactly as before.
    const annualAverage = spec.weeklyAverageHours != null;
    if (!annualAverage) {
      const ceiling = weeklyCeiling(spec, emp, overlay);
      for (const [k, hours] of perWeek) {
        if (hours > ceiling) {
          add('weekly_ceiling', empId, k, [], {
            hours: Math.round(hours * 100) / 100,
            ceiling,
          });
        }
      }
    }

    // ---- what the law where this business is requires --------------------
    // Each of these runs only when the spec carries the figure, which it does
    // only for a jurisdiction whose rules are seeded. Nothing here fires for
    // a business whose profile says nothing, which is every customer this
    // product had before Spain.

    // A day may not be longer than the statute allows. Summed per day rather
    // than per shift: two halves of a split day are one day's work, and the
    // limit is on the day.
    if (spec.maxDailyHours) {
      for (const [date, shifts] of perDay) {
        const hours = shifts.reduce((sum, a) => sum + a.paidHours, 0);
        // Rounded before comparing: a shift priced at 9.000000000000002 hours
        // is nine hours, and reporting it as a breach would be arithmetic
        // noise wearing the clothes of a legal finding.
        if (Math.round(hours * 100) / 100 > spec.maxDailyHours) {
          add('daily_hours', empId, date, shifts.map((a) => a.id), {
            hours: Math.round(hours * 100) / 100,
            allowed: spec.maxDailyHours,
          });
        }
      }
    }

    // A day and a half off, unbroken, every week.
    //
    // Measured as the longest gap between two shifts around the week -- NOT
    // cropped at the week's own edges, which is how this used to invent
    // breaches that were not there.
    //
    // The bug it replaces is worth writing down, because the fix looks like a
    // detail and is not. A rest was measured only inside [week, week+7d), so
    // any rest lying across a boundary was cut and the smaller half judged.
    // Somebody working Monday to Friday rests from Friday night to Monday
    // morning -- 64 hours -- and was read as 33, a breach that does not
    // exist. And the product ACTED on it: `repair.ts` dropped their Friday
    // shift to "give back" rest they already had, and `planRetry.ts` scored
    // the month as failed and paid for a second model call to redo it.
    // Moving the week to Monday does not cure that on its own: it only moves
    // who it happens to. A bar closed on Sundays has its rest running from
    // Saturday night to Monday evening, straight across the Monday boundary.
    //
    // So the two ends are measured to the NEIGHBOURING SHIFT, the one before
    // the week and the one after it, wherever the calendar holds them. When
    // there is none -- the edge of what was handed to this function -- the
    // rest is unbounded as far as anyone here can see, and an unbounded rest
    // is not a breach. That is the same caution `wholeWeeks` already takes:
    // this function reports what it can see and never guesses against the
    // person.
    if (spec.weeklyRestHours) {
      const required = spec.weeklyRestHours * 60;
      // Every shift of this person as one timeline, already in start order.
      const spans = sorted.map((a) => ({
        id: a.id,
        start: abs(a.date, a.startMin),
        end: abs(a.date, a.endMin),
      }));
      for (const k of perWeekShifts.keys()) {
        if (!wholeWeeks.has(k)) continue;
        const weekStart = abs(k, 0);
        const weekEnd = weekStart + 7 * 24 * 60;
        // The run of shifts that START inside this week. A shift that began
        // on Sunday night and runs into Monday belongs to the week it began
        // in, which is the same rule the hour totals use.
        const first = spans.findIndex((s) => s.start >= weekStart && s.start < weekEnd);
        if (first < 0) continue;
        let last = first;
        while (last + 1 < spans.length && spans[last + 1].start < weekEnd) last += 1;

        // Before the first: to the previous shift, or unbounded.
        let longest = first > 0 ? spans[first].start - spans[first - 1].end : Infinity;
        let previousEnd = spans[first].end;
        for (let i = first + 1; i <= last; i += 1) {
          longest = Math.max(longest, spans[i].start - previousEnd);
          previousEnd = Math.max(previousEnd, spans[i].end);
        }
        // After the last: to the next shift, or unbounded.
        const next = last + 1 < spans.length ? spans[last + 1].start : Infinity;
        longest = Math.max(longest, next - previousEnd);

        if (longest < required) {
          add('weekly_rest', empId, k, spans.slice(first, last + 1).map((s) => s.id), {
            hours: Math.round((longest / 60) * 10) / 10,
            required: spec.weeklyRestHours,
          });
        }
      }
    }

    // A night worker's day, averaged over fifteen.
    //
    // Only for the people the statute calls night workers -- three hours or
    // more of the daily shift inside the night window -- and only over their
    // NIGHT days: a barman who does a day shift on Tuesday has not bought
    // himself a longer Friday. Every fifteen-day window that fits in the
    // period is checked, because the statute says "a reference period of 15
    // days" and a rota can hide a bad fortnight inside a good month.
    if (spec.nightAverageMax && spec.nightWindow) {
      const nightDays = [...perDay.entries()]
        .map(([date, shifts]) => ({
          date,
          hours: shifts.reduce((sum, a) => sum + a.paidHours, 0),
          night: shifts.reduce(
            (sum, a) => sum + nightHoursIn(a.startMin, a.endMin, spec.nightWindow!),
            0,
          ),
        }))
        .filter((d) => d.night >= NIGHT_WORKER_MIN_HOURS)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      for (let i = 0; i < nightDays.length; i += 1) {
        const from = abs(nightDays[i].date, 0);
        const window = nightDays.filter((d) => {
          const at = abs(d.date, 0);
          return at >= from && at < from + 15 * 24 * 60;
        });
        const average =
          window.reduce((sum, d) => sum + d.hours, 0) / window.length;
        if (Math.round(average * 100) / 100 > spec.nightAverageMax) {
          add('night_average', empId, nightDays[i].date, [], {
            average: Math.round(average * 10) / 10,
            allowed: spec.nightAverageMax,
            days: window.length,
          });
          break; // one finding per person: the fortnight, not every day in it
        }
      }
    }
  }

  for (const [date, people] of splitDays) {
    if (people > splitCap) {
      add('split_cap', null, date, [], { people, cap: splitCap });
    }
  }

  // ---- coverage ---------------------------------------------------------

  const gaps: CoverageGap[] = [];
  for (const day of days) {
    if (isClosedOn(spec, day)) continue;
    const w = windowFor(spec, day);
    const openHour = Math.floor(w.openMin / 60);
    const closeHour = Math.ceil(w.closeMin / 60);
    const onDay = inPeriod.filter((a) => a.date === day.date);
    for (let h = openHour; h < closeHour; h += 1) {
      const need = needAt(spec, day, h);
      if (need <= 0) continue;
      // PEOPLE, not shifts: one person cannot cover two of the places a rota
      // needs filled, however many bars they have over that minute. See
      // ./coverage, which is the one answer all three counters now share.
      const have = peopleAtHour(onDay, h, w);
      if (have < need) gaps.push({ date: day.date, hour: h, have, need });
    }
  }

  return {
    violations,
    gaps,
    ok: !violations.some((v) => v.hard),
  };
}

/** Re-exported so callers need one import to judge and to key a week. */
export { toDateKey, weekKey };
