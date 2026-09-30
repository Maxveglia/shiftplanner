// Which days the notes screen shows, and how it names them.
//
// The screen moves one week at a time and lands on one day; everything here is
// the arithmetic of that, kept out of the page so a test can reach it without a
// DOM. Weeks start on Monday, as the rest of the product's do (see YearGrid and
// PR #128): a Spanish bar does not think of Sunday as the first day.

import { APP_LOCALE, APP_TIME_FORMAT } from '../locale';
import { dateKey, fromDateKey, shiftDay } from '../schedule/focus';

export { shiftDay };

/** 0 = Monday … 6 = Sunday, the numbering the server uses for weekdays too. */
export function weekdayIndex(key: string): number {
  return (fromDateKey(key).getDay() + 6) % 7;
}

/** The seven days, Monday first, of the week `key` falls in. */
export function weekOf(key: string): string[] {
  const monday = shiftDay(key, -weekdayIndex(key));
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
}

/**
 * Where a key in the day strip takes the selection, or null for a key the
 * strip does not handle.
 *
 * The arrows step one day and walk straight into the next or previous week
 * rather than wrapping inside this one: days are a line, not a ring, and a
 * manager on Sunday who presses → means Monday. Home and End stay inside the
 * week shown, which is what those keys mean in any row.
 */
export function stripKeyTarget(key: string, day: string): string | null {
  switch (key) {
    case 'ArrowLeft':
      return shiftDay(day, -1);
    case 'ArrowRight':
      return shiftDay(day, 1);
    case 'Home':
      return weekOf(day)[0];
    case 'End':
      return weekOf(day)[6];
    default:
      return null;
  }
}

/** A key the date input handed over, or null when it is empty or malformed. */
export function parsePickedDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = fromDateKey(value);
  // "2026-02-31" parses into March; a picker never sends it, a typed box can.
  return dateKey(d) === value ? value : null;
}

/** "Thursday, 24 September 2026" / "jueves, 24 de septiembre de 2026". */
export function longDate(key: string): string {
  return fromDateKey(key).toLocaleDateString(APP_LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * The day above the editor: "jueves, 24 sep". The year only when it is not
 * this one, because stepping back into last December is where it stops being
 * obvious and nowhere else.
 */
export function dayHeading(key: string, today: string): string {
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return fromDateKey(key).toLocaleDateString(APP_LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "mié 23 sep" for the list of notes; the year again only when it differs. */
export function shortDate(key: string, today: string): string {
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return fromDateKey(key).toLocaleDateString(APP_LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** The strip's column heading: "L" / "M" in Spanish, "M" / "T" in English. */
export function weekdayInitial(key: string): string {
  return fromDateKey(key).toLocaleDateString(APP_LOCALE, { weekday: 'narrow' });
}

/** A weekday of the server's numbering (0 = Monday), short and long. */
export function weekdayName(weekday: number, width: 'short' | 'long'): string {
  // 1 January 2024 was a Monday; building from it keeps the names the
  // locale's, the same way YearGrid builds its column initials.
  return new Date(2024, 0, 1 + weekday).toLocaleDateString(APP_LOCALE, { weekday: width });
}

/**
 * When a note was emailed, as short as it can be said: the time alone if it
 * was today, the day and the time otherwise.
 */
export function sentAtLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString(APP_LOCALE, APP_TIME_FORMAT);
  if (dateKey(d) === dateKey(now)) return time;
  const day = d.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
}
