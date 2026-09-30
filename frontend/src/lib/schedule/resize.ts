// Stretching, trimming or carrying one shift by hand: press on a bar, drag,
// let go.
//
// Everything here is measured on the ASSIGNMENT's own axis -- minutes from
// midnight of the date the shift starts on, which run past 1440 for a night
// worked into the small hours. The grid converts pointer pixels into that axis
// and back; this module never sees a pixel, so it can be tested in `node`
// like the rest of the scheduling logic.
//
// Two decisions live here rather than in the grid, because both are about
// what a schedule is allowed to become and not about how it is drawn:
//
//   The edge stops at the walls. A shift cannot grow out of the day's open
//   window (a bar shut at four cannot have somebody until five), cannot cross
//   into the same person's next or previous shift, and cannot shrink below an
//   hour -- below that it would be easier to remove it and start over.
//
//   A resized shift is a MANUAL one. Whatever placed it, the manager has now
//   said "these hours", and that instruction has to survive the next rebuild
//   the same way a shift they dragged in from nothing does.

import { shiftAppearance } from './bands';
import { DAY_MIN } from './demand';
import { syntheticBreakMin } from './generate';
import type { Assignment } from './types';

/** Snap granularity while dragging. Half hours, not hours: a 9:30 opening exists. */
export const RESIZE_STEP_MIN = 30;

/** Shorter than this and the bar has nothing left to say -- remove it instead. */
export const MIN_SHIFT_MIN = 60;

export type ShiftEdge = 'start' | 'end';

export interface ResizeBounds {
  /** Earliest minute the start may reach. */
  minStart: number;
  /** Latest minute the end may reach. */
  maxEnd: number;
}

export interface Interval {
  startMin: number;
  endMin: number;
}

/**
 * The walls a shift may be dragged out to.
 *
 * `window` is the day's open hours on the shift's own axis. `others` are the
 * same person's other shifts, already placed on that axis too (a shift worked
 * the day before sits at negative minutes, one the day after past 1440); the
 * caller does that translation because only it knows the dates.
 */
export function resizeBounds(
  shift: Interval,
  window: Interval,
  others: Interval[],
): ResizeBounds {
  let minStart = window.startMin;
  let maxEnd = window.endMin;
  for (const o of others) {
    // Anything that ends at or before this shift starts fences the left side;
    // anything that starts at or after it ends fences the right. A shift that
    // overlaps already (which the generator never produces) fences neither,
    // rather than pinning the bar in place with no way to fix it.
    if (o.endMin <= shift.startMin) minStart = Math.max(minStart, o.endMin);
    if (o.startMin >= shift.endMin) maxEnd = Math.min(maxEnd, o.startMin);
  }
  // A shift that already sits outside the walls (an AI shift placed before a
  // later change of hours, say) keeps the ground it stands on: dragging must
  // never make the bar jump away from where the pointer picked it up.
  return {
    minStart: Math.min(minStart, shift.startMin),
    maxEnd: Math.max(maxEnd, shift.endMin),
  };
}

/**
 * Where the dragged edge lands for a pointer at `pointerMin`.
 *
 * Snapped to the half hour, held inside the bounds, and never allowed to
 * cross the other edge by less than the minimum length. The untouched edge
 * does not move: dragging the end of a nine-to-five past the start does not
 * flip the shift around, it just stops at ten.
 */
export function draggedInterval(
  shift: Interval,
  edge: ShiftEdge,
  pointerMin: number,
  bounds: ResizeBounds,
): Interval {
  const snapped = Math.round(pointerMin / RESIZE_STEP_MIN) * RESIZE_STEP_MIN;
  const [lo, hi] =
    edge === 'start'
      ? [bounds.minStart, shift.endMin - MIN_SHIFT_MIN]
      : [shift.startMin + MIN_SHIFT_MIN, bounds.maxEnd];
  // No room at all (a shift already shorter than the minimum, hemmed in on
  // both sides): leave it exactly as it is rather than snap it somewhere new.
  if (hi < lo) return { startMin: shift.startMin, endMin: shift.endMin };
  const at = clamp(snapped, lo, hi);
  return edge === 'start'
    ? { startMin: at, endMin: shift.endMin }
    : { startMin: shift.startMin, endMin: at };
}

/**
 * The same shift with new hours, priced and coloured for them.
 *
 * The break is the part that needs care. A shift with a template behind it
 * keeps that template's break: the agreement was "eight hours with half an
 * hour off", and stretching it to nine does not add a second lunch. A shift
 * with no template (a `band-*` one, placed by hand or by the model) has the
 * length decide, the same rule that priced it in the first place. Either way
 * the break can never be longer than the shift itself.
 *
 * Overtime, extra hours and cost are NOT computed here: they depend on the
 * rest of the week, and `summarize` re-derives them for every shift anyway.
 */
export function resizedShift(shift: Assignment, next: Interval): Assignment {
  const span = next.endMin - next.startMin;
  const hadBreak = Math.round(
    shift.endMin - shift.startMin - shift.paidHours * 60,
  );
  const fromTemplate = !shift.templateId.startsWith('band-');
  const breakMin = Math.min(
    span,
    fromTemplate ? Math.max(0, hadBreak) : syntheticBreakMin(span),
  );
  const look = shiftAppearance(
    next.startMin,
    next.endMin,
    fromTemplate ? shift.templateName : null,
  );
  return {
    ...shift,
    startMin: next.startMin,
    endMin: next.endMin,
    paidHours: (span - breakMin) / 60,
    // The band is decided by the hours, so a morning shift dragged into the
    // evening changes colour along with them -- but a template keeps its name.
    templateId: fromTemplate ? shift.templateId : `band-${look.bandKey}`,
    templateName: look.label,
    color: look.color,
    isNight: look.isNight,
    source: 'manual',
  };
}

/**
 * Where a whole shift lands when it is picked up and carried `deltaMin` along
 * its own axis.
 *
 * The length never changes -- that is what makes it a move and not a resize --
 * so the delta is what gets snapped, not either edge: a 9:15-17:15 shift moves
 * to 9:45-17:45, keeping the quarter it had rather than being quietly rounded.
 * The shift stops against the walls of the open window instead of shrinking
 * into them. The same courtesy as `resizeBounds`: a shift that already sits
 * outside the walls keeps the ground it stands on, so picking it up never
 * makes it jump.
 */
export function movedInterval(shift: Interval, deltaMin: number, wall: Interval): Interval {
  const span = shift.endMin - shift.startMin;
  const lo = Math.min(wall.startMin, shift.startMin);
  const hi = Math.max(wall.endMin, shift.endMin);
  const snapped = Math.round(deltaMin / RESIZE_STEP_MIN) * RESIZE_STEP_MIN;
  const startMin = clamp(shift.startMin + snapped, lo, hi - span);
  return { startMin, endMin: startMin + span };
}

/**
 * Does `interval` share a minute with any of `others`? Touching is not
 * overlapping: a shift ending at 17:00 and one starting at 17:00 are a
 * handover, not a double booking.
 */
export function overlapsAny(interval: Interval, others: Interval[]): boolean {
  return others.some((o) => o.startMin < interval.endMin && o.endMin > interval.startMin);
}

/**
 * The same shift, carried to new hours and possibly to somebody else.
 *
 * Built on `resizedShift` so a move is priced and named exactly like any other
 * change of hours -- a band shift carried from the afternoon into the night
 * becomes a night shift. Only the person is added on top.
 */
export function movedShift(shift: Assignment, employeeId: string, next: Interval): Assignment {
  return { ...resizedShift(shift, next), employeeId };
}

/**
 * Whole days from `from` to `to` (negative when `to` is earlier). Both are
 * local dates written YYYY-MM-DD, and both are read as UTC on purpose: the
 * question is how many calendar days apart, and daylight saving must not be
 * allowed to make that 0.96.
 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(...ymd(to)) - Date.UTC(...ymd(from))) / (DAY_MIN * 60_000));
}

/**
 * `assignment` moved onto the axis of a shift dated `axisDate`: yesterday's
 * hours come out negative, tomorrow's past 1440.
 */
export function onAxis(assignment: Assignment, axisDate: string): Interval {
  const shift = daysBetween(axisDate, assignment.date) * DAY_MIN;
  return { startMin: assignment.startMin + shift, endMin: assignment.endMin + shift };
}

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m - 1, d];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
