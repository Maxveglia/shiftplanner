// The hours one person works in the week a given day belongs to, and whether
// that week is short of their contract.
//
// Shown in the employee column of every day, next to the day's own hours, so
// a manager scanning a Thursday can see that somebody on a 40-hour contract
// is only down for 32 without opening Hours & pay. Measured the same way as
// the day figure beside it -- the span of the shift, break included -- so the
// two numbers add up on screen: five 8-hour days read "40h", not "37.5h".
//
// Whether the week counts as SHORT is only decided when the whole week is on
// the calendar. A period that starts on a Thursday has three days of that
// week, and calling everybody short on evidence of three days would paint the
// first screen red for no reason. Out of the period, the number still shows;
// it just is not judged.

import { weekKey } from './validate';
import type { Assignment } from './types';

export interface WeekHours {
  /** Hours worked in the week `date` falls in. */
  hours: number;
  /** Below the contract's weekly minimum, on a week the calendar fully covers. */
  short: boolean;
  /**
   * How many of the week's seven days the calendar has. Fewer than seven and
   * the figure is a part of a week, and has to be shown as one: a 40-hour
   * person reading "25h/wk" on the first Thursday of a month that starts on a
   * Thursday would rightly call it wrong.
   */
  coveredDays: number;
}

/** Every date of the (Monday-anchored) week `date` belongs to. */
export function weekDates(date: string): string[] {
  const [y, m, d] = weekKey(date).split('-').map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(y, m - 1, d + i);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate(),
    ).padStart(2, '0')}`;
  });
}

export function weekHoursFor(
  employeeId: string,
  date: string,
  assignments: Assignment[],
  contractedMin: number,
  periodDates: ReadonlySet<string>,
): WeekHours {
  const week = weekKey(date);
  let minutes = 0;
  for (const a of assignments) {
    if (a.employeeId !== employeeId || weekKey(a.date) !== week) continue;
    minutes += a.endMin - a.startMin;
  }
  const hours = minutes / 60;
  const coveredDays = weekDates(date).filter((d) => periodDates.has(d)).length;
  const whole = coveredDays === 7;
  return {
    hours,
    short: whole && contractedMin > 0 && hours < contractedMin,
    coveredDays,
  };
}
