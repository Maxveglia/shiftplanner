// Keeping one draft the same on every browser: the decisions, without React.
//
// The draft is edited here and stored on the server (PUT /schedule/draft),
// and read back from there whenever a window is opened. Two questions come
// up over and over and both are easy to get subtly wrong inside an effect:
//
//   - a load came back: is this NEWS, or what we already know?
//   - the calendar changed: is it worth a PUT, or is the server already there?
//
// Both are answered from one small memory per window, the `SyncMark`: what
// the server's draft held the last time we exchanged it, and what the team's
// published rota looked like. Comparisons are by `slotKey` -- who, when, from
// and to -- never by id, because the generator hands out fresh ids on every
// pass and the server hands out its own.
//
// One rule underneath everything: A DRAFT IDENTICAL TO THE PUBLISHED ROTA IS
// NO DRAFT. The server agrees (publishing clears the draft) and the client
// must too, or the rota the team already has would be re-saved as a draft on
// every browser that opens it.

import { slotKey } from './diff';
import { minutesToDate, toDateKey } from './persist';
import type { Assignment } from './types';

/**
 * The shifts of a calendar as sorted keys: cheap to keep and compare.
 *
 * The slot -- who, when, from, to -- plus the paid hours, because those are
 * what the PUT carries beyond the slot (as the unpaid break) and what comes
 * back; a template's break changed in Settings alters the paid hours of
 * the same slot, and a sync keyed on the slot alone would never send it.
 * Nothing else: the template id does not round-trip (an ad-hoc band goes up
 * as null and comes back as an orphan), and a key that changes on every
 * echo would adopt forever.
 */
export type Snapshot = string[];

export function snapshotOf(assignments: Assignment[]): Snapshot {
  return assignments.map((a) => `${slotKey(a)}|${a.paidHours.toFixed(2)}`).sort();
}

export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The same shifts, as a multiset by slot key, whatever their ids or order. */
export function sameShifts(a: Assignment[], b: Assignment[]): boolean {
  return a.length === b.length && sameSnapshot(snapshotOf(a), snapshotOf(b));
}

/** The window a draft belongs to, as the key it is remembered under. */
export function windowKey(from: Date, to: Date): string {
  return `${from.toISOString()}|${to.toISOString()}`;
}

/**
 * The shifts the server will take for a window, and the ones it would refuse.
 *
 * The server owns a shift by the window it STARTS in and rejects the whole
 * PUT when one starts outside it (`shift_outside_period`), or ends before it
 * starts (`shift_ends_before_start`). The draft is sent whole on every change,
 * so a single such shift -- placed before the refine panel checked the date,
 * and kept since in this browser's storage -- failed every save and every
 * publish that followed. Asked with the same instants `toShiftPayload` sends,
 * so the two can never disagree about a shift that starts at midnight.
 */
export function withinWindow(
  assignments: Assignment[],
  from: Date,
  to: Date,
): { inside: Assignment[]; outside: Assignment[] } {
  const inside: Assignment[] = [];
  const outside: Assignment[] = [];
  for (const a of assignments) {
    const start = minutesToDate(a.date, a.startMin);
    const end = minutesToDate(a.date, a.endMin);
    const ok = start >= from && start < to && end > start;
    (ok ? inside : outside).push(a);
  }
  return { inside, outside };
}

/**
 * The day a hand edit would make a shift START on, when that is outside the
 * window -- or null when the server will take it.
 *
 * The day a shift is filed under is not always the day it starts: pressing
 * "0:00 +1" on the last evening files a shift under the 31st that starts on
 * the 1st of next month, which the server owns by that month and refuses in
 * this one. So the question is asked of the real start, as `withinWindow`.
 */
export function startsOutside(a: Assignment, from: Date, to: Date): string | null {
  if (withinWindow([a], from, to).outside.length === 0) return null;
  return toDateKey(minutesToDate(a.date, a.startMin));
}

/**
 * A draft carrying stray shifts, cleaned: what to put back on screen, or null
 * when there is nothing to clean.
 *
 * Null too when NOTHING is inside the window: that is another period's
 * calendar on its way out (a period change while the new one generates, an
 * undo across months), not strays, and cutting it down would save an empty
 * or a stale draft over the one this window has.
 *
 */
export function cleanStrays(
  assignments: Assignment[],
  from: Date,
  to: Date,
): { assignments: Assignment[]; dropped: number } | null {
  const { inside, outside } = withinWindow(assignments, from, to);
  if (outside.length === 0 || inside.length === 0) return null;
  return { assignments: inside, dropped: outside.length };
}

/**
 * The pins that go with a cleaned draft. The generator replays every pin
 * FILED under a day of the period, so two kinds would come back on each
 * rebuild and are dropped: a shift that ends at or before its start, and one
 * filed under a day of this window that starts outside it (the "0:00 +1" of
 * the last evening). A well-formed pin on another month's day is left alone:
 * the generator ignores it here, and it may be a real decision for that month.
 */
export function validPins(pinned: Assignment[], from: Date, to: Date): Assignment[] {
  return pinned.filter((a) => {
    if (a.endMin <= a.startMin) return false;
    const filed = minutesToDate(a.date, 0);
    const filedHere = filed >= from && filed < to;
    return !filedHere || startsOutside(a, from, to) === null;
  });
}

/**
 * What this browser knows about one window.
 *
 * `server` is the server's draft as it was last loaded or saved; null until
 * a load has succeeded, and while it is null nothing is saved -- a PUT would
 * overwrite a draft we never read. `rota` is the team's published rota as it
 * was last seeded or published from here; null when never seen.
 */
export interface SyncMark {
  server: Snapshot | null;
  rota: Snapshot | null;
}

export const NO_MARK: SyncMark = { server: null, rota: null };

/**
 * The calendar on screen as the DRAFT to save: the same shifts, except that a
 * calendar equal to the published rota is an empty draft (see the rule at the
 * top). Null when there is no calendar.
 */
export function draftOf(
  screen: Assignment[] | null,
  rota: Snapshot | null,
): Assignment[] | null {
  if (screen === null) return null;
  return rota !== null && sameSnapshot(snapshotOf(screen), rota) ? [] : screen;
}

/**
 * What to do with the rows a load returned.
 *
 * - 'keep': nothing new. Either the server holds exactly what we last
 *   exchanged with it -- so anything different on screen is OUR newer edit,
 *   on its way up -- or the screen already shows these rows.
 * - 'adopt': the server has a draft we have not seen. The server wins.
 * - 'clear': the server's draft is gone (another browser cleared it, or
 *   published) and the screen still shows one. The server wins here too --
 *   but only once this browser has exchanged a draft for the window. An
 *   empty server on FIRST contact is not a verdict on what is on screen: a
 *   calendar drafted before the server kept drafts, or generated while the
 *   first load was still out, is kept and sent up rather than wiped.
 *
 * With nothing on screen and nothing on the server there is nothing to do:
 * the caller falls back to the published rota or the brief box as before.
 */
export type LoadAction = 'keep' | 'adopt' | 'clear';

export function resolveLoad(
  server: Assignment[],
  screen: Assignment[] | null,
  mark: SyncMark,
): LoadAction {
  const incoming = snapshotOf(server);
  // Nothing on screen: whatever the server holds is the calendar, echo or
  // not. A window just opened, or just moved to, has no edit of its own to
  // outrank the server's draft.
  if (screen === null) return server.length > 0 ? 'adopt' : 'keep';
  if (mark.server !== null && sameSnapshot(incoming, mark.server)) return 'keep';
  const draft = draftOf(screen, mark.rota);
  if (draft !== null && sameSnapshot(incoming, snapshotOf(draft))) return 'keep';
  if (server.length === 0) {
    return screen !== null && mark.server !== null ? 'clear' : 'keep';
  }
  return 'adopt';
}

/**
 * Whether the calendar on screen is worth a PUT right now.
 *
 * Not while the load for the window is still pending (its answer may replace
 * the screen), not before a load has ever succeeded (see `SyncMark.server`),
 * not with no calendar (an empty draft is saved deliberately, by "New
 * calendar", never by an effect), and not when the server already holds it.
 */
export function shouldSave(
  screen: Assignment[] | null,
  mark: SyncMark,
  loadPending: boolean,
): boolean {
  if (screen === null || loadPending || mark.server === null) return false;
  const draft = draftOf(screen, mark.rota);
  return draft !== null && !sameSnapshot(snapshotOf(draft), mark.server);
}
