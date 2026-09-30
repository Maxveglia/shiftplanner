// The week's opening hours as a thing you drag, not a thing you type.
//
// The first question the interview asks is "when are you open, each day?",
// and it is the one question a chat is bad at: the answer is seven pairs of
// times, a manager types them seven different ways, and a model that hears
// "de nueve a ocho" has to guess which eight. So it is a form: one row per
// day, Monday to Sunday, and along each row a bar over the hours of the day
// that the manager stretches over the hours the business is open. Dragging
// an hour to the right IS the answer; nothing has to be spelled.
//
// This module is the arithmetic of that bar, with no DOM in it: where a
// pointer at some fraction of the track lands in minutes, what each kind of
// drag does to a day's range, and how the week is written down afterwards --
// for Gemini as a sentence in the manager's language, for the server as
// minutes. The component in components/onboarding/OpeningHoursGrid.tsx does
// nothing but call this with pointer positions.
//
// Minutes are from the day's own midnight, and a day may run past it: a bar
// that opens at 18:00 and closes at 03:00 is open until 1620, which is how
// the spec and the server already write a late close (see `DayHours` in
// lib/schedule/types.ts). The track therefore runs to six in the morning of
// the next day, the same boundary `NIGHT_DAY_BOUNDARY_MIN` gives a night
// business, and no further: past that it is not a late night but another day.

import { WEEK_READING_ORDER, type DaySchedule } from './firstRun';

/** Minutes in a civil day. */
const DAY_MIN = 24 * 60;

/** The track: from midnight to six the next morning. */
export const TRACK_START_MIN = 0;
export const TRACK_END_MIN = DAY_MIN + 6 * 60;

/** Dragging snaps to this. Half an hour is as fine as any opening time gets. */
export const STEP_MIN = 30;

/** A day cannot be open for less than this: a thinner bar cannot be grabbed. */
export const MIN_SPAN_MIN = 60;

/** One day's hours, or null for a day the business is closed. */
export type DayRange = { openMin: number; closeMin: number } | null;

/** Weekday (0 = Sunday) -> that day's range. Always all seven days. */
export type WeekHours = Record<number, DayRange>;

/** Where the week starts before anyone touches it: nine to eight, every day. */
export function defaultWeek(): WeekHours {
  const week: WeekHours = {};
  for (const weekday of WEEK_READING_ORDER) {
    week[weekday] = { openMin: 9 * 60, closeMin: 20 * 60 };
  }
  return week;
}

/** The nearest step, kept on the track. */
export function snap(min: number): number {
  const stepped = Math.round(min / STEP_MIN) * STEP_MIN;
  return Math.min(TRACK_END_MIN, Math.max(TRACK_START_MIN, stepped));
}

/** A pointer at `fraction` (0 = left edge, 1 = right edge) of the track, in minutes. */
export function minutesAtFraction(fraction: number): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return snap(TRACK_START_MIN + clamped * (TRACK_END_MIN - TRACK_START_MIN));
}

/** Minutes as a fraction of the track, for placing a bar. */
export function fractionAt(min: number): number {
  return (min - TRACK_START_MIN) / (TRACK_END_MIN - TRACK_START_MIN);
}

/**
 * What a press began: drawing a new bar on an empty day, sliding a whole bar,
 * or pulling one of its ends.
 */
export type DragKind = 'create' | 'move' | 'start' | 'end';

export interface DragState {
  kind: DragKind;
  weekday: number;
  /** Where the press landed, in minutes. */
  anchorMin: number;
  /** The day's range when the press began. */
  origin: DayRange;
}

/**
 * The day's range with the pointer now at `atMin`.
 *
 * Every branch keeps the bar at least `MIN_SPAN_MIN` wide and inside the
 * track, so there is no pointer position that produces a day the server
 * would refuse. A create that has not moved yet is an hour wide from the
 * press, so a tap on an empty day opens it rather than doing nothing.
 */
export function dragTo(state: DragState, atMin: number): DayRange {
  const at = snap(atMin);
  const { anchorMin, origin } = state;
  switch (state.kind) {
    case 'create': {
      const lo = Math.min(anchorMin, at);
      const hi = Math.max(anchorMin, at);
      return widen({ openMin: lo, closeMin: hi });
    }
    case 'move': {
      if (!origin) return origin;
      const span = origin.closeMin - origin.openMin;
      let open = origin.openMin + (at - anchorMin);
      open = Math.max(TRACK_START_MIN, Math.min(TRACK_END_MIN - span, open));
      return { openMin: open, closeMin: open + span };
    }
    case 'start': {
      if (!origin) return origin;
      const open = Math.min(at, origin.closeMin - MIN_SPAN_MIN);
      return { openMin: Math.max(TRACK_START_MIN, open), closeMin: origin.closeMin };
    }
    case 'end': {
      if (!origin) return origin;
      const close = Math.max(at, origin.openMin + MIN_SPAN_MIN);
      return { openMin: origin.openMin, closeMin: Math.min(TRACK_END_MIN, close) };
    }
  }
}

/** A bar too thin to grab, pushed out to the minimum -- rightwards if it fits. */
function widen(range: { openMin: number; closeMin: number }): DayRange {
  if (range.closeMin - range.openMin >= MIN_SPAN_MIN) return range;
  const close = Math.min(TRACK_END_MIN, range.openMin + MIN_SPAN_MIN);
  return { openMin: close - MIN_SPAN_MIN, closeMin: close };
}

/** Move one step left or right by keyboard; the same bounds as a drag. */
export function nudge(range: DayRange, edge: 'start' | 'end', steps: number): DayRange {
  if (!range) return range;
  const state: DragState = { kind: edge, weekday: -1, anchorMin: 0, origin: range };
  const from = edge === 'start' ? range.openMin : range.closeMin;
  return dragTo(state, from + steps * STEP_MIN);
}

/** The same hours on every day, from one day the manager got right. */
export function copyToAll(week: WeekHours, weekday: number): WeekHours {
  const source = week[weekday] ?? null;
  const out: WeekHours = {};
  for (const wd of WEEK_READING_ORDER) {
    out[wd] = source ? { ...source } : null;
  }
  return out;
}

/** The week as `DaySchedule` rows, which is what the brief composer reads. */
export function toDaySchedules(week: WeekHours): DaySchedule[] {
  return WEEK_READING_ORDER.map((weekday) => {
    const range = week[weekday] ?? null;
    return range
      ? { weekday, openMin: range.openMin, closeMin: range.closeMin, closed: false }
      : { weekday, openMin: 0, closeMin: 0, closed: true };
  });
}

/** The week as the server's `open_hours`: weekday -> [open, close], or null when closed. */
export function toPayload(week: WeekHours): Record<string, [number, number] | null> {
  const out: Record<string, [number, number] | null> = {};
  for (const weekday of WEEK_READING_ORDER) {
    const range = week[weekday] ?? null;
    out[String(weekday)] = range ? [range.openMin, range.closeMin] : null;
  }
  return out;
}

/** Whether a close runs into the next day, for the "+1" the bar shows. */
export function closesNextDay(range: DayRange): boolean {
  return !!range && range.closeMin > DAY_MIN;
}

/** Whether every day is closed -- a week that says nothing usable. */
export function isAllClosed(week: WeekHours): boolean {
  return WEEK_READING_ORDER.every((wd) => !week[wd]);
}
