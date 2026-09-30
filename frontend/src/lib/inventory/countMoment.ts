// When a count is taken, as far as the shop's sales are concerned: before
// opening (the day's sales are still to come, and will be taken off what is
// counted) or after closing (they are already off the shelf, and the count
// reflects them). Some days the manager counts at 10:00 and some at 00:30.
//
// A sale has a day and no time, so this is what tells the server which sales
// come after the count: after closing, those of the following days; before
// opening, those of the count's own day on.
//
// THE DAY AND THE HOUR ARE MADRID'S, not the browser's. The server decides
// both on the business's wall clock (routers/inventory.py `_count_moment`,
// services/business_time.py), and the form has to say what the server will
// keep: a manager reading the form from a phone set to New York at 23:30 is
// counting at 05:30 of the next day in the shop, and that is the day it is
// filed under. So everything here takes an INSTANT (a Date) and reads it in
// BUSINESS_TIME_ZONE; the field "Counted on" stays in the browser's own time,
// which is how it is typed and how it is sent.

/** The two moments, in the order the form offers them. */
export const COUNT_MOMENTS = ['before_open', 'after_close'] as const;
export type CountMoment = (typeof COUNT_MOMENTS)[number];

/**
 * The zone the business keeps time in: the server's BUSINESS_ZONE
 * (services/business_time.py). One market, one zone, said out loud.
 */
export const BUSINESS_TIME_ZONE = 'Europe/Madrid';

/**
 * Before this hour, "after closing" closes the day before: a bar that shuts at
 * 02:00 and counts at 02:30 on Sunday has counted Saturday's night. The server
 * uses the same hour (routers/inventory.py, LATE_CLOSE_HOUR).
 */
export const LATE_CLOSE_HOUR = 6;

// Built once: a formatter is not free, and the form reads the clock on every
// render. en-US and numeric parts only, so no language can change the digits.
let businessParts: Intl.DateTimeFormat | null = null;

/**
 * The business's wall clock at an instant: its day ("2026-09-27") and its
 * hour (0-23). Null for an invalid date.
 */
export function businessClock(instant: Date): { day: string; hour: number } | null {
  if (Number.isNaN(instant.getTime())) return null;
  businessParts ??= new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of businessParts.formatToParts(instant)) parts[part.type] = part.value;
  // `% 24`: an engine that still writes midnight as "24" under h23.
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/**
 * What the form proposes for a count taken at `instant`, by the business's
 * clock: in the morning, before opening; from noon, and in the small hours
 * after a late close, after closing. The server's own default is the same
 * rule.
 *
 * Between midnight and six the two give the same answer -- the sales a count
 * at 02:30 already reflects are the previous day's either way -- so the guess
 * there only picks the words that fit a bar that has just shut.
 */
export function defaultCountMoment(instant: Date): CountMoment {
  const hour = (businessClock(instant) ?? businessClock(new Date()))!.hour;
  return hour >= 12 || hour < LATE_CLOSE_HOUR ? 'after_close' : 'before_open';
}

/**
 * The day the help under the choice names, by the business's clock: for
 * "before opening", the count's own day (its sales are still to come); for
 * "after closing", the day being closed -- the day before, in the small hours.
 * Null for an invalid date.
 */
export function momentDay(instant: Date, moment: CountMoment): string | null {
  const clock = businessClock(instant);
  if (clock === null) return null;
  if (moment !== 'after_close' || clock.hour >= LATE_CLOSE_HOUR) return clock.day;
  const d = new Date(`${clock.day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * What a count is saved with: when it was taken and at which moment.
 *
 * Untouched, "Counted on" is only there to show the time: the count is taken
 * NOW, to the second (the field cuts to the minute, and a count and a delivery
 * in the same minute would otherwise tie -- a delivery only adds to a count it
 * comes after), and the moment the manager did not pick is worked out from
 * that same now -- not from the hour the page was opened at. Touched, it is
 * the field's time, in the browser's zone. Null when the field is not a date.
 */
export function countStamp({
  field,
  touched,
  picked,
  now,
}: {
  field: string;
  touched: boolean;
  picked: CountMoment | null;
  now: Date;
}): { at: Date; moment: CountMoment } | null {
  const at = touched ? instantOfLocalInput(field) : now;
  if (at === null) return null;
  return { at, moment: picked ?? defaultCountMoment(at) };
}

// --- The field ---------------------------------------------------------------------

/** An instant as a datetime-local input wants it: the browser's time, to the minute. */
export function localInputOf(instant: Date): string {
  const d = new Date(instant.getTime());
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * The instant a datetime-local value ("2026-09-27T09:30") names, read in the
 * browser's zone -- which is how the form sends it. Null when it is not one.
 */
export function instantOfLocalInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/**
 * How long until the minute changes: when "Counted on", which shows minutes,
 * next has something new to show. A little past it, so the timer never wakes
 * a hair early and writes the minute that is ending.
 */
export function msToNextMinute(now: Date): number {
  return 60_000 - (now.getTime() % 60_000) + 50;
}
