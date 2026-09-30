// How much of a shift is night work, answered in one place.
//
// Three parts of the product need this number and must never disagree about
// it: the generator, which may not build a night longer than the law allows;
// the validator, which says so when one exists anyway; and payroll, which
// pays a premium on exactly these hours. Two implementations of "how much of
// 18:00-04:00 is night?" is two answers, and the difference is somebody's
// money or somebody's fine.
//
// The window is DATA, not a constant: 22:00-06:00 is what Spain's art. 36.1
// ET says and what the US convention happens to use as well, but it arrives
// from the rules table like every other figure, so a jurisdiction with a
// different window needs no code.

/** The hours of the day a jurisdiction counts as night. */
export interface NightWindow {
  startHour: number;
  endHour: number;
}

/**
 * Night hours inside `[startMin, endMin)`, minutes from the shift's own day.
 *
 * Walked in day-sized slices so an overnight shift counts both ends: a bar
 * open 18:00-04:00 earns night from 22:00 to midnight AND from midnight to
 * 04:00, which is six of its ten hours and the reason the rule bites.
 */
export function nightHoursIn(
  startMin: number,
  endMin: number,
  window: NightWindow,
): number {
  const from = window.startHour * 60;
  const to = window.endHour * 60;
  let minutes = 0;
  // One slice per day the shift can touch: the night that began yesterday,
  // the one that begins today, and the one that begins tomorrow.
  for (let offset = -1440; offset <= 1440; offset += 1440) {
    const nightStart = offset + from;
    const nightEnd = offset + 1440 + to;
    minutes += Math.max(
      0,
      Math.min(endMin, nightEnd) - Math.max(startMin, nightStart),
    );
  }
  return minutes / 60;
}

/**
 * Night hours in a day past which the statute calls somebody a night worker.
 *
 * Art. 36.1 ET: three hours of the daily shift, or a third of the working
 * year. Only the first is knowable from a rota, and it is the one that
 * catches what this is here for -- a closing shift, every week.
 */
export const NIGHT_WORKER_MIN_HOURS = 3;

/**
 * The pieces of `[startMin, endMin)` that are night work, as intervals.
 *
 * Same arithmetic as `nightHoursIn`, kept beside it rather than duplicated:
 * one of them counts the minutes and the other says WHERE they are, and a
 * calendar that paints one stripe while payroll bills another would be the
 * product contradicting itself on screen.
 */
export function nightSpans(
  startMin: number,
  endMin: number,
  window: NightWindow,
): { from: number; to: number }[] {
  const from = window.startHour * 60;
  const to = window.endHour * 60;
  const out: { from: number; to: number }[] = [];
  for (let offset = -1440; offset <= 1440; offset += 1440) {
    const nightStart = offset + from;
    const nightEnd = offset + 1440 + to;
    const a = Math.max(startMin, nightStart);
    const b = Math.min(endMin, nightEnd);
    if (b > a) out.push({ from: a, to: b });
  }
  return out;
}

/** The window every reader falls back to: 22:00-06:00. */
export const DEFAULT_NIGHT_WINDOW: NightWindow = { startHour: 22, endHour: 6 };
