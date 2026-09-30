// Edits made by hand while the AI was working.
//
// An adjustment is a round trip: the sentence goes out with the calendar as
// it was, and the answer -- operations applied, a repair, a replan -- comes
// back seconds or half a minute later. The calendar stays editable in
// between, and it has to: a manager who is made to wait on a spinner will
// click anyway. What used to happen is that the answer was built on the
// calendar AS IT WAS and written over the one on screen, so the shift the
// manager dragged in while waiting simply vanished when the AI came back.
//
// So the answer lands on the calendar as it is NOW. The unit is one person on
// one day -- a cell -- because that is the unit a hand edit has: adding,
// resizing or removing a shift touches one cell, moving it to somebody else
// touches two. A cell the manager touched keeps exactly what they left in it,
// shifts and pins and blackouts alike; every other cell takes the AI's answer.
// The hand wins because it is the later instruction, and because it is the
// one the manager can see: an AI change quietly undoing a click is the worse
// surprise. Where the AI had ALSO changed a cell the manager touched, its
// change there is dropped, and that is said out loud rather than left for
// the manager to find.
//
// Keyed on `slotKey`, not on ids, for the reason the diff is: a rebuild hands
// out fresh ids, and the same person at the same hours is the same shift.

import type { AbsenceOut, AbsenceTypeOut, EmployeeOut } from '../../types';
import type { Assignment } from './types';
import { blackoutKey, type ScheduleOverlay } from './overlay';
import { slotKey } from './diff';
import { plural } from '../i18n/core';
import { formatDate } from '../format';
import { availability } from './availability';

export interface HandEditCell {
  employeeId: string;
  date: string;
}

export interface KeptHandEdits {
  assignments: Assignment[];
  /** Only meaningful when overlays were given; otherwise `nextOverlay`. */
  overlay: ScheduleOverlay | null;
  /** Cells where the AI's change was dropped in favour of the hand edit. */
  conflicts: HandEditCell[];
  /**
   * Cells edited by hand that could NOT be kept -- `mayKeep` said no -- and
   * took the AI's answer instead.
   */
  refused: HandEditCell[];
  /** Whether anything was edited by hand at all. */
  touched: boolean;
}

function cellsOf(assignments: Assignment[]): Map<string, string[]> {
  const cells = new Map<string, string[]>();
  for (const a of assignments) {
    const k = blackoutKey(a.employeeId, a.date);
    const list = cells.get(k);
    if (list) list.push(slotKey(a));
    else cells.set(k, [slotKey(a)]);
  }
  for (const list of cells.values()) list.sort();
  return cells;
}

function sameCell(x: string[] | undefined, y: string[] | undefined): boolean {
  const a = x ?? [];
  const b = y ?? [];
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/**
 * Land an answer built on `base` onto `current`, keeping what was done by
 * hand in between.
 *
 * `base` is the calendar the AI was shown, `current` the one on screen when
 * it answered, `next` its answer. With no hand edits this returns `next`
 * untouched -- the same array, so the ordinary case costs nothing.
 */
export function keepHandEdits({
  base,
  current,
  next,
  baseOverlay,
  currentOverlay,
  nextOverlay,
  mayKeep,
}: {
  base: Assignment[];
  current: Assignment[];
  next: Assignment[];
  baseOverlay?: ScheduleOverlay;
  currentOverlay?: ScheduleOverlay;
  nextOverlay?: ScheduleOverlay;
  /**
   * Whether a hand edit on this person-day may stand at all. Some answers
   * settle a day beyond argument: the person the sentence let go is no longer
   * on the team, and a day the sentence made an absence is one the calendar
   * must leave empty (the absence takes the shift -- see `summarize`). A hand
   * edit there does not win; the AI's answer does, and the caller says so.
   */
  mayKeep?: (employeeId: string, date: string) => boolean;
}): KeptHandEdits {
  const baseCells = cellsOf(base);
  const currentCells = cellsOf(current);
  const nextCells = cellsOf(next);

  const touched = new Set<string>();
  for (const k of new Set([...baseCells.keys(), ...currentCells.keys()])) {
    if (!sameCell(baseCells.get(k), currentCells.get(k))) touched.add(k);
  }
  // A blackout or a pin can change without a shift changing -- removing a
  // shift that was already off the calendar, say. Those cells are the
  // manager's too.
  if (baseOverlay && currentOverlay) {
    const baseBlack = new Set(baseOverlay.blackouts);
    const curBlack = new Set(currentOverlay.blackouts);
    for (const k of baseBlack) if (!curBlack.has(k)) touched.add(k);
    for (const k of curBlack) if (!baseBlack.has(k)) touched.add(k);
    const basePins = cellsOf(baseOverlay.pinned);
    const curPins = cellsOf(currentOverlay.pinned);
    for (const k of new Set([...basePins.keys(), ...curPins.keys()])) {
      if (!sameCell(basePins.get(k), curPins.get(k))) touched.add(k);
    }
  }

  const overlayOut = nextOverlay ?? null;
  if (touched.size === 0) {
    return { assignments: next, overlay: overlayOut, conflicts: [], refused: [], touched: false };
  }

  const cellOf = (k: string): HandEditCell => {
    const [employeeId, date] = k.split('|');
    return { employeeId, date };
  };
  const byDate = (x: HandEditCell, y: HandEditCell) =>
    x.date.localeCompare(y.date) || x.employeeId.localeCompare(y.employeeId);

  // Hand edits the answer overrules go back to being the answer's cells.
  const refused: HandEditCell[] = [];
  if (mayKeep) {
    for (const k of [...touched]) {
      const cell = cellOf(k);
      if (!mayKeep(cell.employeeId, cell.date)) {
        touched.delete(k);
        refused.push(cell);
      }
    }
    refused.sort(byDate);
  }

  // What the AI decided about a cell is its shifts AND its blackout: a day
  // off on a day with nothing on it changes no shift, only the overlay.
  const blackoutDiffers = (x: ScheduleOverlay | undefined, y: ScheduleOverlay | undefined, k: string) =>
    !!x && !!y && x.blackouts.includes(k) !== y.blackouts.includes(k);
  // A conflict is a day both changed AND left differently. When the hand and
  // the AI arrived at the same day -- both took Sarah off Wednesday -- nothing
  // of the answer was lost, and saying otherwise sends the manager to check a
  // day that is exactly as they wanted it.
  const conflicts: HandEditCell[] = [];
  for (const k of touched) {
    const aiChanged =
      !sameCell(baseCells.get(k), nextCells.get(k)) || blackoutDiffers(baseOverlay, nextOverlay, k);
    const agree =
      sameCell(currentCells.get(k), nextCells.get(k)) && !blackoutDiffers(currentOverlay, nextOverlay, k);
    if (aiChanged && !agree) conflicts.push(cellOf(k));
  }
  conflicts.sort(byDate);

  const inTouched = (a: { employeeId: string; date: string }) =>
    touched.has(blackoutKey(a.employeeId, a.date));
  const assignments = [
    ...next.filter((a) => !inTouched(a)),
    ...current.filter(inTouched),
  ];

  let overlay: ScheduleOverlay | null = overlayOut;
  if (nextOverlay && currentOverlay) {
    overlay = {
      ...nextOverlay,
      pinned: [
        ...nextOverlay.pinned.filter((a) => !inTouched(a)),
        ...currentOverlay.pinned.filter(inTouched),
      ],
      blackouts: [
        ...nextOverlay.blackouts.filter((k) => !touched.has(k)),
        ...currentOverlay.blackouts.filter((k) => touched.has(k)),
      ],
    };
  }
  return { assignments, overlay, conflicts, refused, touched: touched.size > 0 || refused.length > 0 };
}

/**
 * The `mayKeep` an adjustment lands with: a hand edit stands only for
 * somebody still on the team the answer leaves, on a day that is not away.
 *
 * Both halves are about the answer's facts, not the hand's. A shift kept for
 * a person no longer on the roster is a shift `summarize` has nobody to cost
 * -- it threw, and the adjustment never landed -- and one kept over an absence
 * the sentence just wrote is the calendar contradicting its own time off.
 */
export function keepableOn(
  roster: EmployeeOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
): (employeeId: string, date: string) => boolean {
  const byId = new Map(roster.map((e) => [e.id, e]));
  return (employeeId, date) => {
    const emp = byId.get(employeeId);
    if (!emp) return false;
    const av = availability(emp, absences, absenceTypes, date);
    return av.ok || (av.kind !== 'absence' && av.kind !== 'resigned' && av.kind !== 'on_leave');
  };
}

/**
 * The line under the diff when a hand edit won over the AI somewhere, or
 * null when it did not. Names the people and days, because "some of your
 * edits" sends the manager hunting across a month.
 */
export function handEditNote(
  conflicts: HandEditCell[],
  roster: EmployeeOut[],
): string | null {
  if (conflicts.length === 0) return null;
  const names = new Map(roster.map((e) => [e.id, e.full_name]));
  const cells = conflicts
    .slice(0, 5)
    .map((c) => `${names.get(c.employeeId) ?? '?'} (${formatDate(c.date)})`);
  if (conflicts.length > 5) cells.push('…');
  return plural(
    conflicts.length,
    'domain.handEdits.kept.one',
    'domain.handEdits.kept.other',
    { cells: cells.join(', ') },
  );
}

/**
 * The line under the diff when a hand edit could not stand, or null. Said
 * because the manager saw that shift on screen a second ago.
 */
export function refusedHandEditNote(
  refused: HandEditCell[],
  roster: EmployeeOut[],
  /** Names of people no longer on `roster` -- the ones the sentence let go. */
  formerNames: Map<string, string> = new Map(),
): string | null {
  if (refused.length === 0) return null;
  const names = new Map(roster.map((e) => [e.id, e.full_name]));
  const cells = refused
    .slice(0, 5)
    .map(
      (c) =>
        `${names.get(c.employeeId) ?? formerNames.get(c.employeeId) ?? '?'} (${formatDate(c.date)})`,
    );
  if (refused.length > 5) cells.push('…');
  return plural(
    refused.length,
    'domain.handEdits.refused.one',
    'domain.handEdits.refused.other',
    { cells: cells.join(', ') },
  );
}
