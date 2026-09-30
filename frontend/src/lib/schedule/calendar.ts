// Folders over a period: the calendar the manager scrolls is grouped, not flat.
//
// A month is 31 day-screens and a year is 365 -- scrolled end to end that is a
// wall, not a plan. So the same days are handed back as nested groups the UI
// can keep closed, and a folder is only paid for in DOM once it is opened.
//
// Grouping is pure and total: every day of the period lands in exactly one
// week folder, and none is invented. That is what lets the numbers on a closed
// folder be trusted as the numbers of the days inside it.

import { APP_LOCALE } from '../locale';
import { translate } from '../i18n/core';
import type { Assignment, DayRef } from './types';

/** Weeks per month folder. Fixed at four -- see `weeksOfMonth`. */
const MONTH_WEEKS = 4;

export interface DayGroup {
  /** Stable across re-renders and unique in the period: the open/closed key. */
  key: string;
  title: string;
  /** The dates the folder covers, e.g. "22 – 31 August". */
  range: string;
  days: DayRef[];
}

export type WeekGroup = DayGroup;

export interface MonthGroup extends DayGroup {
  weeks: WeekGroup[];
}

function fromKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * "October", from a "YYYY-MM" key, in the language the manager chose.
 *
 * The month folders named themselves inline, and then a replan had to name the
 * months it was and was not touching -- "October is already published" -- from
 * somewhere else. Two spellings of the same month on one screen is the kind of
 * thing nobody reports and everybody notices.
 */
export function monthName(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(APP_LOCALE, { month: 'long' });
}

/**
 * "October", "October and December", "October, November and December".
 *
 * The conjunction is a dictionary string, the way `domain.spec.dayJoin`
 * already is, and not `Intl.ListFormat`: that needs a newer lib than this
 * project targets, and its one real advantage here would be Spanish turning
 * "y" into "e" before an i- sound. No month is spelt that way in either
 * language, so the rule cannot fire on the only words this ever formats.
 */
export function monthNameList(monthKeys: string[]): string {
  const names = monthKeys.map(monthName);
  if (names.length <= 1) return names[0] ?? '';
  return (
    names.slice(0, -1).join(', ') +
    translate('calendar.monthJoin') +
    names[names.length - 1]
  );
}

/**
 * "September 1 – 7", or "February 28 – March 3" when a group straddles months.
 *
 * The month is named once when both ends share it, because "September 1 –
 * September 7" is the same fact said twice. Month-before-day is the order
 * APP_LOCALE writes dates in; the label follows the locale rather than being
 * assembled by hand, so translating the app moves this with it.
 */
export function dayRangeLabel(days: DayRef[]): string {
  if (days.length === 0) return '';
  const first = fromKey(days[0].date);
  const last = fromKey(days[days.length - 1].date);
  const dayOnly = (d: Date) => d.toLocaleDateString(APP_LOCALE, { day: 'numeric' });
  const dayMonth = (d: Date) =>
    d.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'long' });
  if (days.length === 1) return dayMonth(first);
  return first.getMonth() === last.getMonth()
    ? `${dayMonth(first)} – ${dayOnly(last)}`
    : `${dayMonth(first)} – ${dayMonth(last)}`;
}

/**
 * The four week folders of one month.
 *
 * Weeks are counted from the 1st, not from Sunday: week 1 is the 1st to the
 * 7th whatever weekday it happens to start on. That is deliberate -- a month
 * spans five or six *calendar* weeks, so anchoring on Sunday would give five
 * or six folders, two of them holding a day or two that belong to the month
 * either side. Counting from the 1st keeps it at four for every month, with
 * the fourth absorbing the remainder: it ends on the 28th in February, the
 * 29th in a leap February, and the 31st in August, from the same code.
 *
 * `days` is expected to be one whole month, as `monthDays` returns it.
 */
export function weeksOfMonth(days: DayRef[]): WeekGroup[] {
  if (days.length === 0) return [];
  const monthKey = days[0].date.slice(0, 7);
  const groups: WeekGroup[] = [];
  for (let i = 0; i < MONTH_WEEKS; i += 1) {
    // The last folder runs to the end of the month; the others are exactly 7.
    const slice =
      i === MONTH_WEEKS - 1
        ? days.slice(i * 7)
        : days.slice(i * 7, (i + 1) * 7);
    if (slice.length === 0) continue;
    groups.push({
      key: `${monthKey}-w${i + 1}`,
      title: translate('roster.calendar.week', { n: i + 1 }),
      range: dayRangeLabel(slice),
      days: slice,
    });
  }
  return groups;
}

/**
 * Group a run of days into month folders, each already split into its weeks.
 *
 * Grouping the days it is *given* rather than rebuilding them from a year
 * number is what guarantees the folders and the schedule agree: the draft was
 * generated over this exact array.
 */
export function monthsOf(days: DayRef[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const day of days) {
    const key = day.date.slice(0, 7);
    const current = groups[groups.length - 1];
    if (current && current.key === key) {
      current.days.push(day);
      continue;
    }
    groups.push({
      key,
      title: monthName(key),
      range: '',
      days: [day],
      weeks: [],
    });
  }
  // Labels and weeks are derived once the month's days are all in.
  for (const group of groups) {
    group.range = dayRangeLabel(group.days);
    group.weeks = weeksOfMonth(group.days);
  }
  return groups;
}

/**
 * The folder keys leading to `dateKey`, so a view can open where the manager
 * already is instead of making them hunt for today.
 */
export function openPathFor(dateKey: string, months: MonthGroup[]): string[] {
  const month = months.find((m) => m.days.some((d) => d.date === dateKey));
  if (!month) return [];
  const week = month.weeks.find((w) => w.days.some((d) => d.date === dateKey));
  return week ? [month.key, week.key] : [month.key];
}

export interface FolderTotals {
  shifts: number;
  hours: number;
}

/**
 * Shifts and paid hours per day, so a folder's summary costs one pass over the
 * assignments for the whole period rather than one pass per folder -- a year
 * shows sixty folders over a few thousand shifts.
 */
export function totalsByDate(
  assignments: Assignment[],
): Map<string, FolderTotals> {
  const out = new Map<string, FolderTotals>();
  for (const a of assignments) {
    const entry = out.get(a.date);
    if (entry) {
      entry.shifts += 1;
      entry.hours += a.paidHours;
    } else {
      out.set(a.date, { shifts: 1, hours: a.paidHours });
    }
  }
  return out;
}

/** Sum the per-day totals over one folder's days. */
export function foldTotals(
  byDate: Map<string, FolderTotals>,
  days: DayRef[],
): FolderTotals {
  let shifts = 0;
  let hours = 0;
  for (const day of days) {
    const entry = byDate.get(day.date);
    if (!entry) continue;
    shifts += entry.shifts;
    hours += entry.hours;
  }
  return { shifts, hours };
}
