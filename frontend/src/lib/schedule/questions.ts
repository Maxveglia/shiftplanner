// What an answered question does to the spec.
//
// Kept out of the component for the usual reason -- the test environment is
// `node`, with no DOM -- and for one specific to this pair: both of these are
// rules a manager would state as one sentence ("los sabados de ocho a dos"),
// and both have a wrong version that looks right on screen. A window that
// wraps past midnight and a day that ends up with two sets of hours are
// invisible in a rota until the day they matter.

import type { SchedulingSpec } from './types';

export interface DayWindow {
  openMin: number;
  closeMin: number;
}

/**
 * The hours a manager typed, as a window the scheduler can use.
 *
 * A close at or before the open is a NIGHT, not a mistake: a Saturday that runs
 * to two in the morning is 26:00 to everything downstream, which is the same
 * reading `windowFor` and the shift templates have always given it. Rejecting
 * it -- or storing 02:00 as-is -- is how "abrimos hasta las dos" became a
 * Saturday that closed before it opened and silently kept the standing hours.
 *
 * The SAME time twice is not a 24-hour day, it is a typo. A business that never
 * shuts says so as 00:00 to 24:00; "opens at ten, closes at ten" is somebody
 * filling the second box before they meant to, and reading it as a day-long
 * shift would staff around the clock on the strength of a slip. `windowFor`
 * already treats equal ends as nothing and falls back, so this agrees with the
 * rule the rest of the scheduler follows.
 */
export function windowFromAnswer(
  openMin: number | null,
  closeMin: number | null,
): DayWindow | null {
  if (openMin == null || closeMin == null) return null;
  if (closeMin === openMin) return null;
  return {
    openMin,
    closeMin: closeMin < openMin ? closeMin + 24 * 60 : closeMin,
  };
}

/**
 * The spec with one weekday's hours set to what the manager just told us.
 *
 * REPLACES, never appends. A weekday may only have one set of hours, and a
 * second entry for the same day leaves `windowFor` taking whichever it finds
 * first -- which is the one the manager was in the middle of correcting.
 */
export function answerDayHours(
  spec: SchedulingSpec,
  weekday: number,
  window: DayWindow,
): SchedulingSpec {
  return {
    ...spec,
    dayHours: [
      ...(spec.dayHours ?? []).filter((d) => d.weekday !== weekday),
      { weekday, openMin: window.openMin, closeMin: window.closeMin },
    ],
  };
}
