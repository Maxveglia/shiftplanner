// The days the shop's screens look at.
//
// A sale is dated by its DAY (`sold_on`, a plain date with no time and no
// zone), so everything here is a calendar date as the manager's own calendar
// has it: today is the browser's today, and a date is built from its three
// numbers rather than parsed from a string. `new Date('2026-09-27')` is UTC
// midnight, which west of Greenwich is still the 26th -- and a sale entered
// for "today" would be listed under yesterday.

/** The periods the screens offer, in days counted back from today. */
export const PERIODS = [7, 30, 90] as const;
export type PeriodDays = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: PeriodDays = 30;

/** The first day a sale can carry (the server refuses anything earlier). */
export const FIRST_SALE_DAY = '2000-01-01';

/** A date as YYYY-MM-DD, by the local calendar. */
export function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "2026-09-27" as a local Date at midnight; null when it is not a real day. */
export function parseIsoDay(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  // 2026-02-30 rolls over into March: not a day.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

/** The day `days` after (or, negative, before) a YYYY-MM-DD day. */
export function addDays(day: string, days: number): string {
  const date = parseIsoDay(day);
  if (!date) return day;
  // Through the calendar, not by adding 86 400 000 ms: a day with a clock
  // change is 23 or 25 hours long, and milliseconds would land on the wrong
  // date twice a year.
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

/** The window of the last `days` days, today included: 7 is today and the six before. */
export function periodRange(days: number, today: Date = new Date()): { from: string; to: string } {
  const to = isoDay(today);
  return { from: addDays(to, -(Math.max(1, days) - 1)), to };
}

/** `?days=` from the address, or the default when it is missing or not one on offer. */
export function readPeriod(value: string | null): PeriodDays {
  const n = Number(value);
  return (PERIODS as readonly number[]).includes(n) ? (n as PeriodDays) : DEFAULT_PERIOD;
}

/** Every day from `from` to `to`, both included, in order. Empty when `to` comes first. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (!parseIsoDay(from) || !parseIsoDay(to)) return out;
  // A year and a day at most: the server's own limit for a window, and a
  // guard against a loop over centuries from a malformed answer.
  for (let day = from; day <= to && out.length <= 366; day = addDays(day, 1)) out.push(day);
  return out;
}

/** 0 for Monday to 6 for Sunday, as the server numbers them (Date says 0 is Sunday). */
export function weekdayOf(day: string): number {
  const date = parseIsoDay(day);
  return date ? (date.getDay() + 6) % 7 : 0;
}

/**
 * Whether a sale can be dated this day: a real day from 2000 up to tomorrow,
 * the bounds the server checks. Checked here too so the form can say so
 * beside the field instead of after a round trip.
 */
export function isSaleDay(day: string, today: Date = new Date()): boolean {
  return parseIsoDay(day) !== null && day >= FIRST_SALE_DAY && day <= addDays(isoDay(today), 1);
}
