// Where the manager is looking, and what that means for what gets saved.
//
// WHY THIS IS A MODULE AND NOT THREE LINES IN THE PAGE. The old answer to
// "what window are we on" was the toolbar: five horizons -- a week, four
// weeks, a month, a year, whatever the brief asked for -- and `bounds` was
// derived from whichever was pressed. That made a VIEWING control decide what
// was written to the server, and it cost a manager their draft: a brief for
// October plans 31 days, the toolbar was on "4 weeks", and the save carried a
// 28-day window with 31 days of shifts in it. The server refused the lot.
//
// The product had already learned this once. `planPeriod.ts` separated what is
// PLANNED from what is LOOKED AT after a toolbar left on "Year" turned a
// 16-cent brief into a dollar and a half. That fix covered generating and
// stopped short of saving.
//
// So the rule is finished here, and it is the whole point of the file: what is
// saved follows the PERIOD, never the view. Looking is free. There is no
// way to be looking at less than a whole month, so there is no way to save
// less than one either.


/**
 * What the manager is looking at.
 *
 * Two shapes and no more. The year is the map; a day is the only thing that
 * opens. Everything the five old horizons did is either one of these or was
 * a way to get the window wrong.
 */
export type Focus =
  | { kind: 'year'; year: number }
  | { kind: 'day'; date: string };

/** Local YYYY-MM-DD, built from the parts so a UTC read cannot shift it. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * A YYYY-MM-DD read as a LOCAL date.
 *
 * `new Date('2026-10-01')` is UTC midnight, which is the previous day west of
 * Greenwich -- the calendar would open September for a manager who pressed
 * October. Built from the parts instead, the same way `parseDayKey` does it
 * on the dashboard.
 */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** The year a focus is showing: its own, or the year of the day it opened. */
export function yearOf(focus: Focus): number {
  return focus.kind === 'year' ? focus.year : Number(focus.date.slice(0, 4));
}

/**
 * The day `step` days away, as a date key.
 *
 * Crosses months and years without a special case, because `Date` already
 * does: 31 December plus one is 1 January, and the grid simply follows it
 * into the next year.
 */
export function shiftDay(date: string, step: number): string {
  const d = fromDateKey(date);
  d.setDate(d.getDate() + step);
  return dateKey(d);
}

/**
 * The window that is planned, and therefore saved: whole months from `start`.
 *
 * `start` is any day inside the first month. The end is EXCLUSIVE and lands on
 * the first day of the month after the last -- so a shift that starts at 23:00
 * on the 31st, and the one that starts at 02:00 on the 1st, each fall in
 * exactly one window and neither is orphaned between two.
 *
 * TAKES A DATE, NOT A FOCUS, and that is the correction of a real bug. The
 * first version of this derived the period from where the manager was looking,
 * which is the very mistake the year view was built to remove: closing a day
 * put the focus back on the YEAR, a year has no month, and the period silently
 * became January. Pressing a day in October then read as leaving the month,
 * which dropped the calendar on screen and reported that none had been made.
 *
 * So the period is now a value the page holds and only ever sets on purpose --
 * when a brief names one, or when a day outside it is opened. Looking cannot
 * reach it.
 */
export function monthWindow(
  start: Date,
  months: number | null,
): { from: Date; to: Date } {
  const span = Math.max(1, months ?? 1);
  return {
    from: new Date(start.getFullYear(), start.getMonth(), 1),
    to: new Date(start.getFullYear(), start.getMonth() + span, 1),
  };
}

/** Whether a day falls inside a window. */
export function windowHolds(
  window: { from: Date; to: Date },
  date: string,
): boolean {
  const d = fromDateKey(date);
  return d >= window.from && d < window.to;
}

/**
 * A stable key for a saved window, for the per-window sync marks.
 *
 * Derived from the same two dates the save uses, so a window and its mark can
 * never describe different spans.
 */
export function windowKey(window: { from: Date; to: Date }): string {
  return `${dateKey(window.from)}..${dateKey(window.to)}`;
}


/** What is known about one day, for colouring it in the year grid. */
export interface DayMark {
  published: boolean;
  draft: boolean;
}

/**
 * Which of the five states a square in the year grid is in.
 *
 * Pure, and out here rather than inside the component, because the ORDER is a
 * decision and not a detail -- and this repository keeps no DOM in its tests
 * on purpose, so a rule that lives in JSX is a rule nothing checks.
 *
 * The order, and why:
 *  - `today` wins over everything. It is the one square a person looks for,
 *    and a today that is also published must not disappear into the run of
 *    published days around it.
 *  - `published` outranks `draft`. A day that is both has been published and
 *    then edited; what the TEAM currently believes is the published half, and
 *    that is what the grid reports.
 *  - `outside` is a neighbouring month's day, filling a corner of the grid.
 *    It is never coloured, whatever it carries: colouring it would put the
 *    same day in two months and count it twice at a glance.
 */
export type DayState = 'today' | 'outside' | 'published' | 'draft' | 'empty';

export function dayState(args: {
  key: string;
  todayKey: string;
  outside: boolean;
  mark?: DayMark;
}): DayState {
  const { key, todayKey, outside, mark } = args;
  if (key === todayKey) return 'today';
  if (outside) return 'outside';
  if (mark?.published) return 'published';
  if (mark?.draft) return 'draft';
  return 'empty';
}

/**
 * The days of a window that get PLANNED, when the period does not start on
 * its first day.
 *
 * A first calendar asked for on the 22nd of the month is for the 22nd
 * onwards: the days already gone are shown, and never planned, sent or
 * published. `floor` is that first day. A floor outside the window changes
 * nothing -- it belongs to the month it was set in, so paging to another month
 * plans that one whole, and coming back finds it again.
 */
export function daysFromFloor<T extends { date: string }>(
  days: T[],
  floor: string | null,
): T[] {
  if (!floor || days.length === 0) return days;
  if (floor <= days[0].date || floor > days[days.length - 1].date) return days;
  return days.filter((d) => d.date >= floor);
}
