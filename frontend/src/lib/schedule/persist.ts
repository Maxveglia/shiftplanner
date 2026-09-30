// Translating shifts between the browser's shape and the server's shape.
//
// The two disagree on purpose. The server stores an INTERVAL (two instants),
// which is what a database can index and guard against overlap. The grid works
// in "minutes from local midnight of this date", which is what a column layout
// needs and which lets an overnight shift keep the day it belongs to.
//
// All conversion goes through the local-time Date constructor rather than
// millisecond arithmetic, so a shift written as 22:00-06:00 is still 22:00-06:00
// on the night the clocks change.

import { translate } from '../i18n/core';
import { shiftTemplateLabel } from '../format';
import type {
  AbsenceOut,
  AbsenceTypeOut,
  AssignmentOut,
  EmployeeOut,
  ShiftTemplateOut,
} from '../../types';
import type { Assignment, DayRef, ScheduleResult, SchedulingSpec } from './types';
import { summarize } from './generate';
import type { PayPolicy } from './payroll';
import { NO_REQUIREMENTS_SPEC } from './spec';
import { EMPTY_OVERLAY, type ScheduleOverlay } from './overlay';

/**
 * Neutral identity for a shift whose template has since been deleted.
 *
 * Built on every call rather than held as a module constant: the name is shown
 * to the manager, so it has to be read in the language selected now and not the
 * one that happened to be active when this module was first imported.
 */
function orphanTemplate() {
  return {
    templateId: 'unknown',
    templateName: translate('roster.shift.untitled'),
    color: '#64748B',
    isNight: false,
  };
}

/** Local wall-clock instant at `dateKey` 00:00 plus `minutes`. */
export function minutesToDate(dateKey: string, minutes: number): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Minute overflow rolls into hours and days as local wall-clock fields, so
  // endMin > 1440 lands on the next day at the right hour.
  return new Date(y, m - 1, d, 0, minutes);
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Whole local days from `a` to `b`, ignoring the time of day. */
function dayOffset(a: Date, b: Date): number {
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** The unpaid break implied by a shift's span and its paid hours. */
export function breakMinutes(a: Assignment): number {
  return Math.max(0, Math.round(a.endMin - a.startMin - a.paidHours * 60));
}

/** Browser shift -> the payload the publish endpoint expects. */
export function toShiftPayload(a: Assignment) {
  return {
    employee_id: a.employeeId,
    start_at: minutesToDate(a.date, a.startMin).toISOString(),
    end_at: minutesToDate(a.date, a.endMin).toISOString(),
    // 'synth', 'manual' and 'unknown' are frontend placeholders, not real
    // template rows -- send null rather than a foreign key that does not exist.
    shift_template_id: /^[0-9a-f-]{36}$/i.test(a.templateId) ? a.templateId : null,
    unpaid_break_minutes: breakMinutes(a),
    source: a.source,
    is_overtime: a.overtimeHours > 0,
    is_premium: a.isNight,
    computed_cost: Math.round(a.cost * 100) / 100,
  };
}

/**
 * Server shift -> the browser's shape.
 *
 * `overtimeHours` and `cost` come back as 0: they are not read from the row but
 * re-derived by `priceAssignments`, so a stored figure can never drift away
 * from the rule that produced it.
 */
export function fromAssignmentOut(
  row: AssignmentOut,
  templates: ShiftTemplateOut[],
): Assignment {
  const start = new Date(row.start_at);
  const end = new Date(row.end_at);
  const date = toDateKey(start);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin =
    dayOffset(start, end) * 1440 + end.getHours() * 60 + end.getMinutes();

  const template = templates.find((t) => t.id === row.shift_template_id);
  const identity = template
    ? {
        templateId: template.id,
        templateName: shiftTemplateLabel(template),
        color: template.color,
        isNight: template.is_night,
      }
    : orphanTemplate();

  return {
    id: row.id,
    employeeId: row.employee_id,
    date,
    startMin,
    endMin,
    ...identity,
    paidHours: Math.max(0, (endMin - startMin - row.unpaid_break_minutes) / 60),
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: row.source,
    // Carried, not derived. Everything else on this object is recomputed from
    // the rule that produced it; this one is a fact about what the team was
    // told and the browser has no way to work it out.
    publishedAt: row.published_at ?? undefined,
  };
}

export function fromAssignmentOutList(
  rows: AssignmentOut[],
  templates: ShiftTemplateOut[],
): Assignment[] {
  return rows.map((row) => fromAssignmentOut(row, templates));
}

/**
 * What the team already has, as the draft to start from.
 *
 * Opening a period with no draft used to mean an empty calendar and a brief
 * box, even when the team had a published rota for those weeks -- on a
 * phone, on a second laptop, after clearing the browser. Now the published
 * shifts are the draft. Three things come back:
 *
 * - `result`: the shifts, priced by `summarize` with the same rule as
 *   everything else, and no gaps -- nobody stated a requirement on this
 *   browser, so a gap here would be the default's opinion.
 * - `overlay`: every seeded shift PINNED. The generator runs on a period
 *   change, an objective change, a requirement spoken later; a pinned shift
 *   survives all of them, and under a spec that asks for nobody the pins
 *   are the whole result (see `statesRequirement`).
 * - `spec`: no requirement, with the hours the rota actually spans so the
 *   coverage strip is drawn over the day this business works and not over
 *   a 24-hour one. Nothing else is read into it: which weekdays are closed
 *   is not something one rota can say.
 */
export interface SeededDraft {
  result: ScheduleResult;
  spec: SchedulingSpec;
  overlay: ScheduleOverlay;
}

export function seedFromPublished(
  rows: AssignmentOut[],
  employees: EmployeeOut[],
  templates: ShiftTemplateOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  days: DayRef[],
): SeededDraft {
  return seedFromRows(rows, employees, templates, absences, absenceTypes, days);
}

/**
 * Any set of server rows as the draft to start from.
 *
 * The same seed whether the rows are the team's published rota or the draft
 * another browser saved: nobody stated a requirement HERE, so the rows are
 * pinned under a spec that asks for nobody and no rebuild can invent anything
 * around them. `seedFromPublished` is this function under its older name.
 */
export function seedFromRows(
  rows: AssignmentOut[],
  employees: EmployeeOut[],
  templates: ShiftTemplateOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  days: DayRef[],
  /** The business's pay policy, so the seeded totals are what payroll pays. */
  payPolicy?: PayPolicy,
): SeededDraft {
  const shifts = fromAssignmentOutList(rows, templates);
  const spec = specFromShifts(shifts);
  const result = summarize(shifts, employees, absences, absenceTypes, spec, days, payPolicy);
  return { result, spec, overlay: { ...EMPTY_OVERLAY, pinned: result.assignments } };
}

/**
 * No requirement, over the hours the rota spans -- per WEEKDAY. Exported for tests.
 *
 * It used to be one window for the whole month: the earliest start and the
 * latest end of any shift in it. For a bar open 17:00-03:00 on weekdays and
 * until 04:00 at weekends, one shift starting at three in the morning
 * somewhere in October made every day of the month 03:00-04:00, and the day
 * view drew twenty-five columns, fourteen of them empty, before a bar that
 * opens at five. Each weekday now gets the span of its own shifts; the
 * standing window is the whole rota's, for a weekday with none.
 */
export function specFromShifts(shifts: Assignment[]): SchedulingSpec {
  if (shifts.length === 0) return NO_REQUIREMENTS_SPEC;
  let openMin = Infinity;
  let closeMin = -Infinity;
  const byWeekday = new Map<number, { openMin: number; closeMin: number }>();
  for (const a of shifts) {
    if (a.startMin < openMin) openMin = a.startMin;
    if (a.endMin > closeMin) closeMin = a.endMin;
    const [y, m, d] = a.date.split('-').map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const span = byWeekday.get(weekday);
    byWeekday.set(weekday, {
      openMin: Math.min(span?.openMin ?? Infinity, a.startMin),
      closeMin: Math.max(span?.closeMin ?? -Infinity, a.endMin),
    });
  }
  const dayHours = [...byWeekday]
    .sort(([a], [b]) => a - b)
    .map(([weekday, span]) => ({ weekday, ...span }));
  return { ...NO_REQUIREMENTS_SPEC, openMin, closeMin, dayHours };
}
