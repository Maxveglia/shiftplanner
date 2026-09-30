// The manager's accumulated intent, kept apart from the schedule it produced.
//
// WHY THIS EXISTS: a calendar used to be an array of shifts that each prompt
// patched. That broke the moment a prompt changed a REQUIREMENT — the generator
// re-ran from scratch and silently threw away every earlier adjustment. The
// manager would say "give Sarah Friday off", then "open until 11pm", and Sarah
// would have her Friday back with no warning.
//
// So the calendar becomes a function of versioned inputs instead:
//
//     result = generate(roster, templates, absences, spec, overlay, days)
//
// `spec` is what the BUSINESS requires. `overlay` is what the MANAGER has
// decided on top of it. Regenerating replays both, so intent survives.

import type { Assignment } from './types';

export interface ScheduleOverlay {
  /** Shifts the manager placed or kept by hand. Replayed on every rebuild. */
  pinned: Assignment[];
  /**
   * `${employeeId}|${date}` slots the manager deliberately emptied. The
   * generator never refills them — "Sarah is off on Friday" has to mean it
   * even after the opening hours change.
   */
  blackouts: string[];
  /** Per-employee weekly hour ceilings asked for by prompt. */
  caps: Record<string, number>;
}

export const EMPTY_OVERLAY: ScheduleOverlay = {
  pinned: [],
  blackouts: [],
  caps: {},
};

export function blackoutKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

/** Add blackouts, ignoring duplicates. Returns a new overlay. */
export function withBlackouts(
  overlay: ScheduleOverlay,
  entries: { employeeId: string; date: string }[],
): ScheduleOverlay {
  const set = new Set(overlay.blackouts);
  for (const e of entries) set.add(blackoutKey(e.employeeId, e.date));
  // A blacked-out slot cannot also be pinned; the later instruction wins.
  const pinned = overlay.pinned.filter(
    (a) => !set.has(blackoutKey(a.employeeId, a.date)),
  );
  return { ...overlay, blackouts: [...set], pinned };
}

/** Pin a shift, replacing any existing pin for the same employee and day. */
export function withPinned(
  overlay: ScheduleOverlay,
  shifts: Assignment[],
): ScheduleOverlay {
  const replaced = new Set(shifts.map((s) => blackoutKey(s.employeeId, s.date)));
  const blackouts = overlay.blackouts.filter((k) => !replaced.has(k));
  const pinned = [
    ...overlay.pinned.filter((a) => !replaced.has(blackoutKey(a.employeeId, a.date))),
    ...shifts,
  ];
  return { ...overlay, pinned, blackouts };
}

/** Drop a pin (used when the manager removes a shift they had placed). */
export function withoutPinned(
  overlay: ScheduleOverlay,
  predicate: (a: Assignment) => boolean,
): ScheduleOverlay {
  return { ...overlay, pinned: overlay.pinned.filter((a) => !predicate(a)) };
}

export function withCap(
  overlay: ScheduleOverlay,
  employeeId: string,
  hours: number,
): ScheduleOverlay {
  return { ...overlay, caps: { ...overlay.caps, [employeeId]: hours } };
}
