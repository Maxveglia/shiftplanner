// Pressing an open hour: a new shift, or a longer one.
//
// It used to be only the first. `manualShift` placed an hour wherever the
// manager pressed, without looking at what was already there, so pressing
// inside somebody's own shift laid a second one on top of it. Two shifts, one
// person, the same minutes -- which the coverage strip then read as two people
// (see ./coverage) and which the server refuses outright, because
// `assignment_no_overlap` does not allow one person to be in two places.
//
// So a press inside a person's own shift now means what it looks like it
// means: make that shift reach here. The two intervals become one.
//
// THE CEILING. A merged shift may not pass `spec.maxDailyHours` -- nine in
// Spain, art. 34.3 ET -- and the figure is read from the spec rather than
// written here, because it comes from the rules table and a convenio can move
// it (see backend services/labour_floor). Where a jurisdiction states none,
// there is no ceiling and the union applies whole: the same contract every
// other reader of these fields keeps.
//
// The start is the earlier of the two and the end is what the ceiling allows,
// which makes the rule one sentence: a shift begins where it begins and lasts
// as long as the law permits. When it cannot grow at all -- already at the
// ceiling -- nothing changes, rather than a shift being created that could
// never be saved.

import { resizedShift } from './resize';
import type { Assignment, SchedulingSpec } from './types';

/** How long a press proposes, when it lands on empty hours. */
export const PRESSED_SHIFT_MIN = 60;

/**
 * What a press should do. Returns the assignments as they should now be, and
 * which shift the caller has to pin -- the manager's instruction either way.
 *
 * Pure: the caller pins, records history and rebuilds. Deciding here what a
 * press MEANS and leaving what it costs to the page is the same split
 * `resize.ts` already makes.
 */
export function placeShift(args: {
  assignments: Assignment[];
  employeeId: string;
  date: string;
  /** Where the press landed, in minutes from the track's midnight. */
  startAt: number;
  spec: SchedulingSpec;
  /** Builds the shift when there is nothing to merge with. */
  create: (startMin: number) => Assignment;
}): { assignments: Assignment[]; changed: Assignment | null } {
  const { assignments, employeeId, date, startAt, spec, create } = args;

  const startMin = Math.max(startAt, spec.openMin);
  const endMin = startMin + PRESSED_SHIFT_MIN;

  // The person's own shifts that day, in the order they run.
  const own = assignments
    .filter((a) => a.employeeId === employeeId && a.date === date)
    .sort((a, b) => a.startMin - b.startMin);

  // Touching counts as overlapping: pressing the hour right after a shift
  // ends is asking for that shift to reach one hour further, not for a second
  // shift that begins the minute the first one stops.
  const hit = own.find((a) => a.startMin <= endMin && a.endMin >= startMin);

  if (!hit) {
    const made = create(startMin);
    return { assignments: [...assignments, made], changed: made };
  }

  const ceilingMin =
    spec.maxDailyHours != null ? spec.maxDailyHours * 60 : Infinity;

  const mergedStart = Math.min(hit.startMin, startMin);
  const wanted = Math.max(hit.endMin, endMin);
  const mergedEnd = Math.min(wanted, mergedStart + ceilingMin);

  // Already as long as it may be, and the press asked for more: leave it
  // exactly as it was. Silently doing nothing beats silently creating an
  // overlap, and the day limit is reported by the validator either way.
  if (mergedStart === hit.startMin && mergedEnd === hit.endMin) {
    return { assignments, changed: null };
  }

  // `resizedShift` and not a local copy: changing a bar's hours already means
  // four things moving together -- the paid hours less the unpaid break, the
  // band it is coloured by, whether it counts as night work, and the source
  // becoming manual. A second implementation of that is a second answer, and
  // the day they disagree is the day a merged shift is priced one way on
  // screen and another on the payslip.
  const merged = resizedShift(hit, { startMin: mergedStart, endMin: mergedEnd });
  return {
    assignments: assignments.map((a) => (a.id === hit.id ? merged : a)),
    changed: merged,
  };
}
