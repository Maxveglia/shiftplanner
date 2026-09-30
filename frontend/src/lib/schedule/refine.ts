// Refining an existing calendar by talking to it.
//
// The manager's first prompt BUILDS a calendar. Every prompt after that ADJUSTS
// the one on screen -- "give Sarah Friday off", "I need three people on
// Saturdays" -- until it is right. Only "New calendar" starts over.
//
// The model never writes shifts. It emits OPERATIONS from the closed list
// below, and this module applies them deterministically, refusing any that
// would break availability. That is the same LLM -> validated IR -> engine
// discipline the initial brief uses.

import type { AbsenceOut, AbsenceTypeOut, EmployeeOut, ShiftTemplateOut } from '../../types';
import type { Assignment, DayRef, ScheduleResult, SchedulingSpec } from './types';
import { availability } from './availability';
import { DAY_MIN } from './demand';
import { bandForShift, shiftAppearance } from './bands';
import { withBlackouts, withPinned, type ScheduleOverlay } from './overlay';
import { generateSchedule, summarize } from './generate';
import type { PayPolicy } from './payroll';
import { weekdayName } from './spec';
import { plural, translate } from '../i18n/core';
import { formatDate, formatTime } from '../format';
import { APP_LOCALE } from '../locale';
import { slotKey } from './diff';

// --- The closed operation set ---------------------------------------------

export type EditOp =
  /**
   * Clear someone's shifts and keep them clear.
   *
   * On one date, on every occurrence of a weekday, or -- with `dateTo` -- over
   * a stretch of days, both ends included. The stretch is why this is one
   * operation: a week off asked for as seven day_offs is seven chances for the
   * model to drop one, and the manager reads "Juanito is off Tuesday" six
   * times instead of "Juanito is off that week".
   */
  | {
      op: 'day_off';
      employee: string;
      date?: string;
      dateTo?: string;
      weekday?: number;
    }
  /** Remove shifts matching the filter (any employee if none given). */
  | {
      op: 'remove_shifts';
      employee?: string;
      date?: string;
      dateTo?: string;
      weekday?: number;
    }
  /** Place a specific shift. */
  | { op: 'add_shift'; employee: string; date: string; start: string; end: string }
  /** Re-time someone's shift on a date. */
  | { op: 'move_shift'; employee: string; date: string; start: string; end?: string }
  /** Exchange two people's shifts on a date. */
  | { op: 'swap'; employeeA: string; employeeB: string; date: string }
  /**
   * More cover in a window WITHOUT naming who — "one more person on Saturday
   * evening". The most common thing a manager actually asks for, so the engine
   * picks: available, not already on that day, fairest by hours so far.
   */
  | {
      op: 'add_coverage';
      date?: string;
      weekday?: number;
      start: string;
      end: string;
      staff: number;
    }
  /** Requirement changes -- these re-run the generator. */
  | { op: 'set_min_staff'; staff: number }
  | { op: 'set_peak'; start: string; end: string; staff: number }
  | { op: 'set_hours'; open: string; close: string }
  | { op: 'set_closed_day'; weekday: number; closed: boolean }
  | { op: 'set_max_weekly_hours'; hours: number };

export interface RefineOutcome {
  result: ScheduleResult;
  spec: SchedulingSpec;
  /** The manager's accumulated intent, so it survives the next rebuild. */
  overlay: ScheduleOverlay;
  /** Human-readable log of what happened, shown back to the manager. */
  applied: string[];
  /**
   * The operations that actually LANDED, for the adaptive layer to learn from.
   *
   * Deliberately not `ops`: an operation the manager asked for and this
   * function refused (nobody was free, the range was invalid) describes
   * something that never happened to their business, so learning from it would
   * mean learning from our own rejected suggestion. Only requirement changes
   * and cover that was really placed appear here.
   */
  appliedOps: EditOp[];
  /** Operations that could not be honoured, each with the reason. */
  skipped: string[];
  /** True when the requirements changed and the calendar was rebuilt. */
  regenerated: boolean;
}

// --- Helpers ---------------------------------------------------------------

// Weekday names for the MODEL, not for the manager. `buildRefineContext`
// writes a prompt, and a prompt is wire: it stays in one language whatever the
// interface speaks, so the operations that come back keep parsing. Anything a
// human reads goes through `weekdayName` instead.
const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

function toMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const v = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return v >= 0 && v <= 24 * 60 ? v : null;
}

/**
 * A time for the model's prompt: one fixed shape, never localised.
 *
 * The wrap at 1440 is what makes a night readable at all -- 28:00 is four in
 * the morning, not hour twenty-eight -- but on its own it was also a lie. A
 * bar's shift came out as "6:00 PM-4:00 AM" with nothing to say the four
 * o'clock belongs to the next day, so every line describing that calendar read
 * as a shift that ends ten hours before it starts. Asked to move it, the model
 * either produced times the caller then refused, or gave up and said it could
 * not express the request. The manager saw an error and blamed the sentence
 * they had typed.
 *
 * The marker is `(+1)` and it only ever appears past midnight, so a daytime
 * business's context is byte-for-byte what it was.
 */
function clock(min: number): string {
  const t = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const nextDay = min >= 1440 ? ' (+1)' : '';
  return `${h12}:${String(t % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}${nextDay}`;
}

/** The same time for a human: "9:00 AM" in English, "9:00" in Spanish. */
function clockLabel(min: number): string {
  return formatTime(min);
}

/**
 * "on 2026-09-14" / "every Tuesday" / "from the 15th to the 22nd".
 *
 * Each carries its own preposition, because Spanish and English disagree about
 * where it goes. A range is named as a range rather than as its first day: a
 * manager who asked for a week off and reads "Juanito is off on the 15th" has
 * no way to tell whether the other six days landed.
 */
function whenText(date?: string, weekday?: number, dateTo?: string): string {
  const [from, to] = orderedRange(date, dateTo);
  if (to) {
    return weekday != null
      ? translate('domain.refine.when.weekdayInRange', {
          day: weekdayName(weekday),
          from,
          to,
        })
      : translate('domain.refine.when.range', { from, to });
  }
  return weekday != null
    ? translate('domain.refine.when.everyWeekday', { day: weekdayName(weekday) })
    : translate('domain.refine.when.onDate', { date: date ?? '' });
}

/**
 * A range put the right way round, or no range at all.
 *
 * "From the 22nd to the 15th" is somebody saying the days in the order they
 * came to mind, not a request for nothing: read literally it matches no day,
 * which is the one outcome that looks exactly like a working edit. The second
 * element is null when there is no range to speak of -- no `dateTo`, no
 * `date`, or a `dateTo` equal to `date`, which is a single day said twice.
 */
function orderedRange(
  date?: string,
  dateTo?: string,
): [string, string | null] {
  if (!date || !dateTo || dateTo === date) return [date ?? '', null];
  return dateTo < date ? [dateTo, date] : [date, dateTo];
}

/** Resolve "Sarah", "sarah chen", "EMP-001" or "#3" to one employee. */
export function resolveEmployee(
  ref: string,
  employees: EmployeeOut[],
): EmployeeOut | null {
  const q = ref.trim().toLowerCase();
  if (!q) return null;
  const byNumber = /^#?(\d+)$/.exec(q);
  if (byNumber) {
    const n = parseInt(byNumber[1], 10);
    return employees.find((e) => (e.display_number ?? 0) === n) ?? null;
  }
  return (
    employees.find((e) => e.full_name.toLowerCase() === q) ??
    employees.find((e) => e.external_id.toLowerCase() === q) ??
    employees.find((e) => e.full_name.toLowerCase().startsWith(q)) ??
    employees.find((e) => e.full_name.toLowerCase().includes(q)) ??
    null
  );
}

/**
 * Days the op targets: one date, a stretch of dates, or a weekday.
 *
 * ALWAYS INTERSECTED WITH THE HORIZON, which is what makes a range safe to
 * accept from a model: `days` is the period on screen, so a `dateTo` that runs
 * away into next year clears the days the manager can see and nothing else.
 *
 * A weekday NARROWS a range rather than replacing it -- "the Fridays of
 * October" -- and stands on its own when there is no range. That is the only
 * combination of the three where both are meant.
 */
function targetDates(
  days: DayRef[],
  date?: string,
  weekday?: number,
  dateTo?: string,
): DayRef[] {
  const [from, to] = orderedRange(date, dateTo);
  if (to) {
    const within = days.filter((d) => d.date >= from && d.date <= to);
    return weekday != null ? within.filter((d) => d.weekday === weekday) : within;
  }
  if (date) return days.filter((d) => d.date === date);
  if (weekday != null) return days.filter((d) => d.weekday === weekday);
  return [];
}

/**
 * The period on screen, named the way the manager reads it: "octubre de 2026",
 * or "octubre de 2026 – diciembre de 2026" for a brief that spans three.
 */
export function periodLabel(days: DayRef[]): string {
  if (days.length === 0) return '';
  const month = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(APP_LOCALE, {
      month: 'long',
      year: 'numeric',
    });
  };
  const first = month(days[0].date);
  const last = month(days[days.length - 1].date);
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Why a shift starting on `date` cannot be placed: it is outside the period
 * on screen. The one sentence for a refinement and for a hand edit alike.
 */
export function outsidePeriodNotice(date: string, days: DayRef[]): string {
  return translate('domain.refine.outsidePeriod', {
    date: formatDate(date),
    period: periodLabel(days),
  });
}

/**
 * Reject a hand-placed shift that breaks an employee's ramp-up limits.
 * Returns a reason, or null when the shift is fine.
 */
function onboardingGuard(
  emp: EmployeeOut,
  avail: Extract<ReturnType<typeof availability>, { ok: true }>,
  startMin: number,
  endMin: number,
): string | null {
  const paidHours = (endMin - startMin) / 60;
  if (avail.maxHoursToday != null && paidHours > avail.maxHoursToday) {
    return translate('domain.refine.onboarding.maxHours', {
      name: emp.full_name,
      max: avail.maxHoursToday,
      hours: paidHours,
    });
  }
  if (!avail.nightsAllowed && bandForShift(startMin, endMin).key === 'night') {
    return translate('domain.refine.onboarding.noNights', { name: emp.full_name });
  }
  return null;
}

// --- Applying operations ---------------------------------------------------

export function applyOps(
  ops: EditOp[],
  current: ScheduleResult,
  spec: SchedulingSpec,
  overlay: ScheduleOverlay,
  employees: EmployeeOut[],
  templates: ShiftTemplateOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  days: DayRef[],
  /** The business's pay policy, for the rebuild and the re-costing below. */
  payPolicy?: PayPolicy,
): RefineOutcome {
  let assignments = [...current.assignments];
  let nextSpec: SchedulingSpec = { ...spec };
  let nextOverlay: ScheduleOverlay = overlay;
  const applied: string[] = [];
  const skipped: string[] = [];
  const appliedOps: EditOp[] = [];
  let regenerate = false;
  let seq = 0;
  // Days where a surgical edit left coverage short: a day off, a cleared
  // shift, a shift moved out of its hours. After the loop, and only if
  // nothing rebuilt the calendar, these days -- these alone -- are refilled.
  const vacated = new Set<string>();

  // `opKey` names the operation in the dictionary, so the prefix of the
  // refusal is translated with the rest of it.
  const needEmployee = (ref: string, opKey: string): EmployeeOut | null => {
    const emp = resolveEmployee(ref, employees);
    if (!emp) {
      skipped.push(
        translate('domain.refine.noEmployee', { op: translate(opKey), ref }),
      );
    }
    return emp;
  };

  // A single date named by the operation must fall inside the period on
  // screen. The server owns a shift by the window it starts in and refuses
  // the whole draft when one starts outside it -- so a shift placed on the
  // 3rd of next month used to read "added" here and then fail every save and
  // every publish after it. The ranges and weekdays are already safe: they go
  // through `targetDates`, which intersects with `days`.
  //
  // From the 1st of the first month rather than from `days[0]`: a first
  // calendar planned from a floor (the 22nd) still shows, saves and accepts
  // the days before it, and a shift put there by hand lifts the floor.
  const periodFrom = days.length > 0 ? `${days[0].date.slice(0, 8)}01` : '';
  const periodTo = days.length > 0 ? days[days.length - 1].date : '';
  const outsidePeriod = (date: string): boolean => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= periodFrom && date <= periodTo) {
      return false;
    }
    skipped.push(outsidePeriodNotice(date, days));
    return true;
  };

  for (const op of ops) {
    switch (op.op) {
      case 'day_off':
      case 'remove_shifts': {
        const ref = op.op === 'day_off' ? op.employee : op.employee;
        const emp = ref ? needEmployee(ref, 'domain.refine.op.remove') : null;
        if (ref && !emp) break;
        const targets = targetDates(days, op.date, op.weekday, op.dateTo);
        if (targets.length === 0) {
          skipped.push(translate('domain.refine.remove.noDay'));
          break;
        }
        const dates = new Set(targets.map((d) => d.date));
        const before = assignments.length;
        const cleared = assignments.filter(
          (a) => dates.has(a.date) && (!emp || a.employeeId === emp.id),
        );
        assignments = assignments.filter(
          (a) => !(dates.has(a.date) && (!emp || a.employeeId === emp.id)),
        );
        const removed = before - assignments.length;
        for (const a of cleared) vacated.add(a.date);
        // Record the intent, not just the deletion: a later change of
        // requirements must not quietly hand the day back.
        const affected = emp
          ? [...dates].map((date) => ({ employeeId: emp.id, date }))
          : cleared.map((a) => ({ employeeId: a.employeeId, date: a.date }));
        nextOverlay = withBlackouts(nextOverlay, affected);
        const who = emp ? emp.full_name : translate('domain.refine.everyone');
        const when = whenText(op.date, op.weekday, op.dateTo);
        applied.push(
          removed > 0
            ? translate(
                removed === 1
                  ? 'domain.refine.cleared.one'
                  : 'domain.refine.cleared.other',
                { count: removed, who, when },
              )
            : translate('domain.refine.cleared.none', { who, when }),
        );
        break;
      }

      case 'add_shift': {
        if (outsidePeriod(op.date)) break;
        const emp = needEmployee(op.employee, 'domain.refine.op.addShift');
        if (!emp) break;
        const start = toMin(op.start);
        let end = toMin(op.end);
        if (start == null || end == null) {
          skipped.push(
            translate('domain.refine.addShift.badTime', {
              from: op.start,
              to: op.end,
            }),
          );
          break;
        }
        if (end <= start) end += 24 * 60; // crosses midnight
        if (end - start > 16 * 60) {
          skipped.push(
            translate('domain.refine.addShift.tooLong', {
              from: clockLabel(start),
              to: clockLabel(end),
            }),
          );
          break;
        }
        const avail = availability(emp, absences, absenceTypes, op.date);
        if (!avail.ok) {
          skipped.push(
            translate('domain.refine.cannotWork', {
              name: emp.full_name,
              date: op.date,
              reason: avail.reason,
            }),
          );
          break;
        }
        if (assignments.some((a) => a.employeeId === emp.id && a.date === op.date)) {
          skipped.push(
            translate('domain.refine.alreadyOnShift', {
              name: emp.full_name,
              date: op.date,
            }),
          );
          break;
        }
        // The same ramp-up limits the generator honours must apply to a shift
        // placed by prompt — otherwise the rule depends on who placed it.
        const guard = onboardingGuard(emp, avail, start, end);
        if (guard) {
          skipped.push(guard);
          break;
        }
        seq += 1;
        const look = shiftAppearance(start, end);
        const added: Assignment = {
          id: `r${Date.parse(op.date) || 0}-${seq}`,
          employeeId: emp.id,
          date: op.date,
          startMin: start,
          endMin: end,
          templateId: `band-${look.bandKey}`,
          templateName: look.label,
          color: look.color,
          isNight: look.isNight,
          paidHours: (end - start) / 60,
          overtimeHours: 0,
    extraHours: 0,
          cost: 0,
          source: 'manual',
        };
        assignments.push(added);
        nextOverlay = withPinned(nextOverlay, [added]);
        applied.push(
          translate('domain.refine.added', {
            name: emp.full_name,
            date: op.date,
            from: clockLabel(start),
            to: clockLabel(end),
          }),
        );
        break;
      }

      case 'move_shift': {
        if (outsidePeriod(op.date)) break;
        const emp = needEmployee(op.employee, 'domain.refine.op.moveShift');
        if (!emp) break;
        const start = toMin(op.start);
        if (start == null) {
          skipped.push(
            translate('domain.refine.moveShift.badTime', { time: op.start }),
          );
          break;
        }
        const idx = assignments.findIndex(
          (a) => a.employeeId === emp.id && a.date === op.date,
        );
        if (idx < 0) {
          skipped.push(
            translate('domain.refine.moveShift.noShift', {
              name: emp.full_name,
              date: op.date,
            }),
          );
          break;
        }
        const old = assignments[idx];
        const span = old.endMin - old.startMin;
        let end = op.end ? (toMin(op.end) ?? start + span) : start + span;
        // Read like add_shift's: "from 22:00 to 02:00" is a night, not minus
        // twenty hours -- which reached the server as a shift ending before
        // it starts and failed every save of the draft after it.
        if (end <= start) end += 24 * 60;
        if (end - start > 16 * 60) {
          skipped.push(
            translate('domain.refine.moveShift.tooLong', {
              from: clockLabel(start),
              to: clockLabel(end),
            }),
          );
          break;
        }
        const availMove = availability(emp, absences, absenceTypes, op.date);
        if (availMove.ok) {
          const guard = onboardingGuard(emp, availMove, start, end);
          if (guard) {
            skipped.push(guard);
            break;
          }
        }
        const look = shiftAppearance(start, end);
        const moved: Assignment = {
          ...old,
          startMin: start,
          endMin: end,
          paidHours: (end - start) / 60 - (span / 60 - old.paidHours),
          templateId: `band-${look.bandKey}`,
          templateName: look.label,
          color: look.color,
          isNight: look.isNight,
          source: 'manual',
        };
        assignments[idx] = moved;
        vacated.add(op.date);
        nextOverlay = withPinned(nextOverlay, [moved]);
        applied.push(
          translate('domain.refine.moved', {
            name: emp.full_name,
            from: clockLabel(start),
            to: clockLabel(end),
            date: op.date,
          }),
        );
        break;
      }

      case 'swap': {
        if (outsidePeriod(op.date)) break;
        const a = needEmployee(op.employeeA, 'domain.refine.op.swap');
        const b = needEmployee(op.employeeB, 'domain.refine.op.swap');
        if (!a || !b) break;
        const ia = assignments.findIndex(
          (x) => x.employeeId === a.id && x.date === op.date,
        );
        const ib = assignments.findIndex(
          (x) => x.employeeId === b.id && x.date === op.date,
        );
        if (ia < 0 && ib < 0) {
          skipped.push(translate('domain.refine.swap.neither', { date: op.date }));
          break;
        }
        // Each must be able to take the other's slot.
        const availA = availability(a, absences, absenceTypes, op.date);
        const availB = availability(b, absences, absenceTypes, op.date);
        if (ib >= 0 && !availA.ok) {
          skipped.push(
            translate('domain.refine.cannotWork', {
              name: a.full_name,
              date: op.date,
              reason: availA.reason,
            }),
          );
          break;
        }
        if (ia >= 0 && !availB.ok) {
          skipped.push(
            translate('domain.refine.cannotWork', {
              name: b.full_name,
              date: op.date,
              reason: availB.reason,
            }),
          );
          break;
        }
        const swapped: Assignment[] = [];
        if (ia >= 0) {
          assignments[ia] = { ...assignments[ia], employeeId: b.id, source: 'manual' };
          swapped.push(assignments[ia]);
        }
        if (ib >= 0) {
          assignments[ib] = { ...assignments[ib], employeeId: a.id, source: 'manual' };
          swapped.push(assignments[ib]);
        }
        nextOverlay = withPinned(nextOverlay, swapped);
        applied.push(
          translate('domain.refine.swapped', {
            a: a.full_name,
            b: b.full_name,
            date: op.date,
          }),
        );
        break;
      }

      case 'add_coverage': {
        const start = toMin(op.start);
        let end = toMin(op.end);
        if (start == null || end == null) {
          skipped.push(
            translate('domain.refine.cover.badTime', {
              from: op.start,
              to: op.end,
            }),
          );
          break;
        }
        if (end <= start) end += 24 * 60;
        const targets = targetDates(days, op.date, op.weekday);
        if (targets.length === 0) {
          skipped.push(translate('domain.refine.cover.noDay'));
          break;
        }
        const want = Math.max(1, op.staff);
        let placed = 0;
        for (const day of targets) {
          const busy = new Set(
            assignments.filter((a) => a.date === day.date).map((a) => a.employeeId),
          );
          // Fairest first: whoever has the fewest hours so far this period.
          const hoursSoFar = (id: string) =>
            assignments
              .filter((a) => a.employeeId === id)
              .reduce((sum, a) => sum + a.paidHours, 0);
          const eligible = employees
            .filter((e) => !busy.has(e.id))
            .filter((e) => {
              const av = availability(e, absences, absenceTypes, day.date);
              return av.ok && !onboardingGuard(e, av, start, end!);
            })
            .sort((a, b) => hoursSoFar(a.id) - hoursSoFar(b.id));

          for (const emp of eligible.slice(0, want)) {
            seq += 1;
            const look = shiftAppearance(start, end!);
            const extra: Assignment = {
              id: `c${Date.parse(day.date) || 0}-${seq}`,
              employeeId: emp.id,
              date: day.date,
              startMin: start,
              endMin: end!,
              templateId: `band-${look.bandKey}`,
              templateName: look.label,
              color: look.color,
              isNight: look.isNight,
              paidHours: (end! - start) / 60,
              overtimeHours: 0,
    extraHours: 0,
              cost: 0,
              source: 'manual',
            };
            assignments.push(extra);
            nextOverlay = withPinned(nextOverlay, [extra]);
            placed += 1;
          }
          if (eligible.length < want) {
            skipped.push(
              translate('domain.refine.cover.partial', {
                date: day.date,
                placed: eligible.length,
                want,
              }),
            );
          }
        }
        if (placed > 0) {
          applied.push(
            translate(
              placed === 1
                ? 'domain.refine.cover.added.one'
                : 'domain.refine.cover.added.other',
              { count: placed, from: clockLabel(start), to: clockLabel(end!) },
            ),
          );
          appliedOps.push(op);
        }
        break;
      }

      // --- Requirement changes: these rebuild the calendar ----------------
    case 'set_min_staff': {
        if (op.staff < 1 || op.staff > 50) {
          skipped.push(
            translate('domain.refine.minStaff.range', { count: op.staff }),
          );
          break;
        }
        nextSpec = { ...nextSpec, minStaff: op.staff };
        regenerate = true;
        applied.push(
          translate('domain.refine.minStaff.set', { count: op.staff }),
        );
        appliedOps.push(op);
        break;
      }
      case 'set_peak': {
        const s = toMin(op.start);
        const e = toMin(op.end);
        if (s == null || e == null || e <= s) {
          skipped.push(translate('domain.refine.peak.badRange'));
          break;
        }
        nextSpec = { ...nextSpec, peak: { startMin: s, endMin: e, staff: op.staff } };
        regenerate = true;
        applied.push(
          translate('domain.refine.peak.set', {
            count: op.staff,
            from: clockLabel(s),
            to: clockLabel(e),
          }),
        );
        appliedOps.push(op);
        break;
      }
      case 'set_hours': {
        const o = toMin(op.open);
        // A close BEFORE the open is a night, not a typo. "Abrimos de seis de
        // la tarde a cuatro" used to be refused outright, which left a bar
        // unable to state its own hours through any route the product offers.
        // It now rolls into the next day, the same reading a shift template has
        // always been given. Equal open and close is still nothing, still
        // refused.
        const rawClose = toMin(op.close);
        const c =
          o != null && rawClose != null && rawClose < o ? rawClose + DAY_MIN : rawClose;
        if (o == null || c == null || c <= o) {
          skipped.push(translate('domain.refine.hours.badRange'));
          break;
        }
        nextSpec = { ...nextSpec, openMin: o, closeMin: c };
        regenerate = true;
        applied.push(
          translate('domain.refine.hours.set', {
            from: clockLabel(o),
            to: clockLabel(c),
          }),
        );
        appliedOps.push(op);
        break;
      }
      case 'set_closed_day': {
        const set = new Set(nextSpec.closedWeekdays);
        if (op.closed) set.add(op.weekday);
        else set.delete(op.weekday);
        nextSpec = { ...nextSpec, closedWeekdays: [...set].sort() };
        regenerate = true;
        applied.push(
          translate(
            op.closed
              ? 'domain.refine.closedDay.closed'
              : 'domain.refine.closedDay.open',
            { day: weekdayName(op.weekday) },
          ),
        );
        appliedOps.push(op);
        break;
      }
      case 'set_max_weekly_hours': {
        if (op.hours < 1 || op.hours > 80) {
          skipped.push(
            translate('domain.refine.maxHours.range', { count: op.hours }),
          );
          break;
        }
        nextSpec = { ...nextSpec, maxHoursPerWeek: op.hours };
        regenerate = true;
        applied.push(
          translate('domain.refine.maxHours.set', { count: op.hours }),
        );
        appliedOps.push(op);
        break;
      }
    }
  }

  // A requirement change means the whole draft is rebuilt from the new spec.
  // Surgical edits are re-costed in place, so totals always match the shifts.
  // A requirement change rebuilds the draft, but REPLAYS the overlay, so every
  // earlier adjustment is still there afterwards.
  // A surgical edit that leaves a hole gets the hole covered -- and ONLY the
  // hole. The generator is run with every current shift pinned, so it cannot
  // move anybody; whatever it adds on the vacated days is kept, whatever it
  // would add elsewhere (an older gap the manager may be living with on
  // purpose) is thrown away. "Give Sarah Friday off" therefore changes
  // Sarah's Friday and whoever now covers it, and nothing else. The day-off
  // blackout above is what keeps Sarah herself out of the refill.
  if (!regenerate && vacated.size > 0) {
    const refilled = generateSchedule(
      employees,
      templates,
      absences,
      absenceTypes,
      nextSpec,
      days,
      { ...nextOverlay, pinned: assignments },
      payPolicy,
    );
    const have = new Set(assignments.map(slotKey));
    const added = refilled.assignments.filter(
      (a) => vacated.has(a.date) && !have.has(slotKey(a)),
    );
    if (added.length > 0) {
      assignments = [...assignments, ...added];
      applied.push(
        plural(added.length, 'domain.refine.covered.one', 'domain.refine.covered.other'),
      );
    }
  }

  const result = regenerate
    ? generateSchedule(
        employees,
        templates,
        absences,
        absenceTypes,
        nextSpec,
        days,
        nextOverlay,
        payPolicy,
      )
    : summarize(assignments, employees, absences, absenceTypes, nextSpec, days, payPolicy);

  return {
    result,
    spec: nextSpec,
    overlay: nextOverlay,
    applied,
    appliedOps,
    skipped,
    regenerated: regenerate,
  };
}

// --- Local intent parser ---------------------------------------------------
//
// The deterministic stand-in for Claude, and the offline fallback. It is far
// more reliable than generic language parsing for one reason: it does not have
// to GUESS who was mentioned. It has the actual roster, so it looks for the
// names that exist.

const WEEKDAY_WORDS: Record<string, number> = {
  domingo: 0, domingos: 0, sunday: 0, sundays: 0,
  lunes: 1, monday: 1, mondays: 1,
  martes: 2, tuesday: 2, tuesdays: 2,
  miercoles: 3, 'miércoles': 3, wednesday: 3, wednesdays: 3,
  jueves: 4, thursday: 4, thursdays: 4,
  viernes: 5, friday: 5, fridays: 5,
  sabado: 6, 'sábado': 6, sabados: 6, 'sábados': 6, saturday: 6, saturdays: 6,
};

function findWeekdays(text: string): number[] {
  const out: number[] = [];
  for (const [word, idx] of Object.entries(WEEKDAY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(text) && !out.includes(idx)) {
      out.push(idx);
    }
  }
  return out;
}

/** Employees mentioned in the text, in the order they appear. */
function findEmployees(text: string, employees: EmployeeOut[]): EmployeeOut[] {
  const lower = text.toLowerCase();
  const hits: { emp: EmployeeOut; at: number }[] = [];
  for (const e of employees) {
    const candidates = [
      e.full_name.toLowerCase(),
      e.full_name.split(' ')[0].toLowerCase(),
      e.external_id.toLowerCase(),
    ];
    let at = -1;
    for (const c of candidates) {
      if (c.length < 3) continue;
      const i = lower.indexOf(c);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at >= 0) hits.push({ emp: e, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.emp);
}

/** "de 9 a 5", "from 9 to 5", "9-17" -> ["09:00","17:00"] */
function findRange(text: string): [string, string] | null {
  const m = text.match(
    /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:a|al|-|–|hasta|to|till)\s*(?:las\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!m) return null;
  const norm = (h: string, mm: string | undefined, sfx: string | undefined) => {
    let hh = parseInt(h, 10);
    const sf = (sfx ?? '').toLowerCase();
    if (sf.startsWith('p') && hh < 12) hh += 12;
    if (sf.startsWith('a') && hh === 12) hh = 0;
    return { hh, mm: mm ? parseInt(mm, 10) : 0 };
  };
  const a = norm(m[1], m[2], m[3]);
  let b = norm(m[4], m[5], m[6]);
  // "de 9 a 5" means 9:00-17:00, but only when reading the end as PM actually
  // produces a forward daytime range. "de 22:00 a 8:00" is an overnight shift
  // and must stay 8:00 — applyOps rolls it to the next day.
  if (b.hh * 60 + b.mm <= a.hh * 60 + a.mm && !m[6] && a.hh < 12) {
    const pm = { ...b, hh: b.hh + 12 };
    if (pm.hh * 60 + pm.mm > a.hh * 60 + a.mm && pm.hh < 24) b = pm;
  }
  const fmt = (v: { hh: number; mm: number }) =>
    `${String(v.hh % 24).padStart(2, '0')}:${String(v.mm).padStart(2, '0')}`;
  return [fmt(a), fmt(b)];
}

/**
 * "del 15 al 22", "from the 15th to the 22nd" -> both dates in the horizon.
 *
 * NOT `findRange`, which reads the SAME WORDS as hours: "de 9 a 5" is a
 * working day, and reading it as the 9th to the 5th would clear four weeks
 * because somebody asked about an afternoon. So the article is required --
 * "del 15 al 22", "from the 15th to the 22nd", "entre el 15 y el 22" -- and a
 * bare "from 15 to 22" falls through to the single-date reading instead. A
 * narrower parser that is never wrong beats a wider one that sometimes empties
 * a month: this is the offline fallback, and Claude reads the loose phrasings.
 *
 * Both numbers are resolved against the horizon, and the second one against
 * the FIRST: "del 28 al 3" is the end of one month and the start of the next,
 * which is the shape of half the holidays anybody asks for.
 */
function findDateSpan(text: string, days: DayRef[]): [string, string] | null {
  const m = text.match(
    /\b(?:del|desde\s+el|entre\s+el|from\s+the|between\s+the)\s+(\d{1,2})(?:º|th|st|nd|rd)?\s*(?:al|a|y\s+el|hasta\s+el|hasta|to|until|and|-|–)\s*(?:(?:el|the)\s+)?(\d{1,2})(?:º|th|st|nd|rd)?\b/i,
  );
  if (!m) return null;
  const first = parseInt(m[1], 10);
  const second = parseInt(m[2], 10);
  const dayNumber = (d: DayRef) => Number(d.date.split('-')[2]);
  const from = days.find((d) => dayNumber(d) === first)?.date;
  if (!from) return null;
  // Searched forward from `from`, so a range that crosses a month boundary
  // lands on the next occurrence rather than on a day already behind us.
  const to = days.find((d) => d.date > from && dayNumber(d) === second)?.date;
  return to ? [from, to] : null;
}

/**
 * Turn a refinement sentence into operations. Returns an empty list when
 * nothing was understood, so the caller can say so instead of silently doing
 * nothing.
 */
export function parseRefinement(
  text: string,
  employees: EmployeeOut[],
  days: DayRef[],
): EditOp[] {
  const t = text.toLowerCase();
  const ops: EditOp[] = [];
  const people = findEmployees(text, employees);
  const weekdays = findWeekdays(t);
  const range = findRange(t);

  let explicitDate: string | undefined;
  const dayNum = t.match(/\bel\s+(\d{1,2})\b|\bon\s+the\s+(\d{1,2})\b/);
  if (dayNum) {
    const n = parseInt(dayNum[1] ?? dayNum[2], 10);
    explicitDate = days.find((d) => Number(d.date.split('-')[2]) === n)?.date;
  }

  const person = (i = 0) => people[i]?.full_name ?? '';

  // --- Requirement-level changes (these rebuild the calendar) -------------
  if (/(cierr|cerrar|cerrado|closed|no abr)/.test(t) && weekdays.length) {
    for (const w of weekdays) ops.push({ op: 'set_closed_day', weekday: w, closed: true });
    return ops;
  }
  if (/(abre|abrir|open)\b/.test(t) && weekdays.length && !range) {
    for (const w of weekdays) ops.push({ op: 'set_closed_day', weekday: w, closed: false });
    return ops;
  }
  if (range && /(horario|abrimos|abrir|opening|open)/.test(t) && !people.length) {
    ops.push({ op: 'set_hours', open: range[0], close: range[1] });
    return ops;
  }
  if (/(refuerzo|pico|punta|peak|rush)/.test(t) && range) {
    const n = t.match(/(?:con|with)\s*(\d{1,2})|(\d{1,2})\s*(?:personas|people|staff)/);
    ops.push({
      op: 'set_peak',
      start: range[0],
      end: range[1],
      staff: n ? parseInt(n[1] ?? n[2], 10) : 3,
    });
    return ops;
  }
  const maxH = t.match(/(?:m[áa]ximo|max|no m[áa]s de|no more than)\D{0,12}(\d{1,2})\s*(?:horas|hours|h)\b/);
  if (maxH) {
    ops.push({ op: 'set_max_weekly_hours', hours: parseInt(maxH[1], 10) });
    return ops;
  }
  const minStaff = t.match(
    /(?:necesito|quiero|pon|minimo|mínimo|at least|i need|need)\D{0,12}(\d{1,2})\s*(?:personas|empleados|people|staff|trabajadores)?/,
  );
  if (minStaff && !people.length) {
    ops.push({ op: 'set_min_staff', staff: parseInt(minStaff[1], 10) });
    return ops;
  }

  // --- Surgical edits ----------------------------------------------------
  if (people.length >= 2 && /(cambia|intercambia|swap|switch|permuta)/.test(t)) {
    const date = explicitDate ?? days.find((d) => weekdays.includes(d.weekday))?.date;
    if (date) {
      ops.push({ op: 'swap', employeeA: person(0), employeeB: person(1), date });
      return ops;
    }
  }

  // A stretch of days, read only where a stretch of days is what the sentence
  // can mean. See `findDateSpan`: the same words are also a pair of hours.
  const span = findDateSpan(t, days);

  if (people.length && /(libre|descans|day off|off|no trabaja|fuera)/.test(t)) {
    if (span) {
      ops.push({ op: 'day_off', employee: person(), date: span[0], dateTo: span[1] });
    } else if (explicitDate) {
      ops.push({ op: 'day_off', employee: person(), date: explicitDate });
    } else {
      for (const w of weekdays) ops.push({ op: 'day_off', employee: person(), weekday: w });
    }
    if (ops.length) return ops;
  }

  if (people.length && /(quita|quitar|elimina|saca|remove|drop)/.test(t)) {
    if (span) {
      ops.push({
        op: 'remove_shifts',
        employee: person(),
        date: span[0],
        dateTo: span[1],
      });
    } else if (explicitDate) {
      ops.push({ op: 'remove_shifts', employee: person(), date: explicitDate });
    } else {
      for (const w of weekdays) {
        ops.push({ op: 'remove_shifts', employee: person(), weekday: w });
      }
    }
    if (ops.length) return ops;
  }

  if (people.length && range && /(mueve|mover|cambia|move)/.test(t)) {
    const date = explicitDate ?? days.find((d) => weekdays.includes(d.weekday))?.date;
    if (date) {
      ops.push({ op: 'move_shift', employee: person(), date, start: range[0], end: range[1] });
      return ops;
    }
  }

  // "one more person from 6 to 9 on Saturday" — extra cover, nobody named.
  if (!people.length && range && /(m[áa]s|extra|refuerz|another|one more|add)/.test(t)) {
    const n = t.match(/(\d{1,2})\s*(?:personas|empleados|people|staff)/);
    const staff = n ? parseInt(n[1], 10) : 1;
    if (explicitDate) {
      ops.push({ op: 'add_coverage', date: explicitDate, start: range[0], end: range[1], staff });
    } else {
      for (const w of weekdays) {
        ops.push({ op: 'add_coverage', weekday: w, start: range[0], end: range[1], staff });
      }
    }
    if (ops.length) return ops;
  }

  if (people.length && range && /(a[ñn]ade|agrega|pon|mete|add|put|schedule)/.test(t)) {
    const dates = explicitDate
      ? [explicitDate]
      : days.filter((d) => weekdays.includes(d.weekday)).map((d) => d.date);
    for (const date of dates) {
      ops.push({ op: 'add_shift', employee: person(), date, start: range[0], end: range[1] });
    }
    if (ops.length) return ops;
  }

  return ops;
}

// --- Context for the model -------------------------------------------------

/**
 * A compact snapshot of the draft for the LLM.
 *
 * Written as lines rather than nested JSON: 200 assignments as JSON costs
 * several times more tokens than this, and the model reads it more reliably.
 *
 * PRIVACY: no pay rates and no absence reasons. The model is told WHO cannot
 * work, never WHY — the same boundary the initial brief respects.
 */
/**
 * The requirements, written the way the model reads them best.
 *
 * Shared with the calendar planner (`planContext.ts`). Two descriptions of one
 * spec is two chances to tell the model something the other half contradicts --
 * and the half that goes stale is always the one nobody is looking at.
 */
export function specSummaryLines(
  spec: SchedulingSpec,
  days: DayRef[],
  jurisdiction: string,
  today: Date = new Date(),
): string[] {
  const first = days[0]?.date ?? '';
  const last = days[days.length - 1]?.date ?? '';
  const closed = spec.closedWeekdays.length
    ? spec.closedWeekdays.map((d) => WEEKDAY_NAMES[d]).join(', ')
    : 'none';
  // Every standing coverage rule, in the model's own vocabulary. Leaving these
  // out told it the requirements were flatter than they are, and adjustments
  // came back contradicting the brief the manager had already given.
  const coverParts: string[] = [];
  if (spec.peak) {
    coverParts.push(
      `${clock(spec.peak.startMin)}-${clock(spec.peak.endMin)} x${spec.peak.staff}`,
    );
  }
  for (const c of spec.coverage ?? []) {
    const when = c.weekdays.length
      ? c.weekdays.map((d) => WEEKDAY_NAMES[d]).join('/')
      : c.dates.length
        ? c.dates.join('/')
        : 'every day';
    const window =
      c.startMin != null && c.endMin != null
        ? ` ${clock(c.startMin)}-${clock(c.endMin)}`
        : ' all day';
    coverParts.push(`${when}${window} x${c.staff}`);
  }
  const peak = coverParts.length ? coverParts.join('; ') : 'none';

  const dayHours = (spec.dayHours ?? [])
    .map((d) => `${WEEKDAY_NAMES[d.weekday]} ${clock(d.openMin)}-${clock(d.closeMin)}`)
    .join('; ');
  const closedDates = (spec.closedDates ?? []).join(', ');

  // Without today's date, "next Saturday" is unanswerable and the model has to
  // guess. Give it the anchor.
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayName = WEEKDAY_NAMES[today.getDay()];

  return [
    `TODAY: ${todayKey} (${todayName})`,
    `PERIOD: ${first} .. ${last} (${days.length} days), jurisdiction ${jurisdiction}`,
    `REQUIREMENTS: open ${clock(spec.openMin)}-${clock(spec.closeMin)} | min ${spec.minStaff} on shift | extra cover: ${peak} | closed: ${closed} | max ${spec.maxHoursPerWeek}h/week`,
    ...(dayHours ? [`HOURS THAT DIFFER BY WEEKDAY: ${dayHours}`] : []),
    ...(closedDates ? [`CLOSED ON THESE DATES: ${closedDates}`] : []),
    ...(spec.shiftLengthHours ? [`PREFERRED SHIFT LENGTH: ${spec.shiftLengthHours} h`] : []),
  ];
}

export function buildRefineContext(
  employees: EmployeeOut[],
  assignments: Assignment[],
  spec: SchedulingSpec,
  days: DayRef[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  jurisdiction: string,
  today: Date = new Date(),
): string {
  const lines: string[] = [
    ...specSummaryLines(spec, days, jurisdiction, today),
    '',
    'TEAM (#number | name | status | hours planned | days unavailable in this period).',
    'Refer to someone by name, or by "#number" when the manager means a position',
    'or a placeholder they have not named yet. The roster can be changed too:',
    'add_employee / rename_employee / set_employee_terms / set_employee_status.',
  ];

  for (const e of employees) {
    const mine = assignments.filter((a) => a.employeeId === e.id);
    const hours = mine.reduce((s, a) => s + a.paidHours, 0);
    const off = days
      .filter((d) => !availability(e, absences, absenceTypes, d.date).ok)
      .map((d) => d.date);
    const offText =
      off.length === 0
        ? 'none'
        : off.length > 6
          ? `${off.length} days incl. ${off.slice(0, 3).join(', ')}`
          : off.join(', ');
    lines.push(
      `  #${e.display_number ?? '?'} | ${e.full_name} | ${e.employment_status} | ${Math.round(hours)}h | ${offText}`,
    );
  }

  if (employees.length === 0) {
    lines.push('  (nobody on the roster yet — add_employee is how one gets there)');
  }

  lines.push('', 'SHIFTS PLANNED (date, employee, start-end):');
  const sorted = [...assignments].sort((a, b) =>
    a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date),
  );
  const nameOf = new Map(employees.map((e) => [e.id, e.full_name]));
  // Cap the listing so a long month cannot crowd out the instructions, and say
  // so out loud — a truncated list that pretends to be complete would make the
  // model plan against days it never saw.
  const LIMIT = 160;
  for (const a of sorted.slice(0, LIMIT)) {
    lines.push(
      `  ${a.date} ${nameOf.get(a.employeeId) ?? '?'} ${clock(a.startMin)}-${clock(a.endMin)}`,
    );
  }
  if (sorted.length > LIMIT) {
    lines.push(
      `  ...and ${sorted.length - LIMIT} more shifts not listed. Prefer weekday-based operations over per-date ones for anything covering the whole period.`,
    );
  }

  return lines.join('\n');
}

/** Narrow a flat operation from the model into the typed union. */
export function toEditOp(raw: Record<string, unknown>): EditOp | null {
  const op = String(raw.op ?? '');
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined);
  const num = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : undefined);

  switch (op) {
    case 'day_off':
      return str('employee')
        ? {
            op,
            employee: str('employee')!,
            date: str('date'),
            dateTo: str('date_to'),
            weekday: num('weekday'),
          }
        : null;
    case 'remove_shifts':
      return {
        op,
        employee: str('employee'),
        date: str('date'),
        dateTo: str('date_to'),
        weekday: num('weekday'),
      };
    case 'add_shift':
      return str('employee') && str('date') && str('start') && str('end')
        ? {
            op,
            employee: str('employee')!,
            date: str('date')!,
            start: str('start')!,
            end: str('end')!,
          }
        : null;
    case 'move_shift':
      return str('employee') && str('date') && str('start')
        ? {
            op,
            employee: str('employee')!,
            date: str('date')!,
            start: str('start')!,
            end: str('end'),
          }
        : null;
    case 'swap':
      return str('employee') && str('employee_b') && str('date')
        ? {
            op,
            employeeA: str('employee')!,
            employeeB: str('employee_b')!,
            date: str('date')!,
          }
        : null;
      case 'add_coverage':
      return str('start') && str('end')
        ? {
            op,
            date: str('date'),
            weekday: num('weekday'),
            start: str('start')!,
            end: str('end')!,
            staff: num('staff') ?? 1,
          }
        : null;
    case 'set_min_staff':
      return num('staff') != null ? { op, staff: num('staff')! } : null;
    case 'set_peak':
      return str('start') && str('end') && num('staff') != null
        ? { op, start: str('start')!, end: str('end')!, staff: num('staff')! }
        : null;
    case 'set_hours':
      return str('start') && str('end')
        ? { op, open: str('start')!, close: str('end')! }
        : null;
    case 'set_closed_day':
      return num('weekday') != null
        ? { op, weekday: num('weekday')!, closed: raw.closed !== false }
        : null;
    case 'set_max_weekly_hours':
      return num('hours') != null ? { op, hours: num('hours')! } : null;
    default:
      return null;
  }
}
