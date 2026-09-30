// How the shop's screens write days and amounts. Everything reads the live
// locale and currency (lib/locale.ts), so it follows the manager's language;
// the currency is the business's, not the reader's.
//
// Amounts to the cent go through `formatMoney` (lib/format.ts). What is here
// is the SHORT form a chart label needs: "1234 €" on the tallest bar says the
// scale, and "1234,56 €" there is two digits of ink nobody reads at 10 px.

import { APP_CURRENCY, APP_LOCALE, APP_TIME_FORMAT } from '../locale';
import { translate } from '../i18n/core';
import { addDays, isoDay, parseIsoDay } from './period';

/**
 * An amount for a chart: whole euros up from 100, cents below (a 7,50 € day
 * is not "8 €"), and compact from 10 000 ("12,3 mil €"), where the last euro
 * stopped mattering several digits ago.
 */
export function formatMoneyShort(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const base = { style: 'currency', currency: APP_CURRENCY, currencyDisplay: 'narrowSymbol' } as const;
  if (abs >= 10_000) {
    return new Intl.NumberFormat(APP_LOCALE, { ...base, notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }
  const whole = abs >= 100 || Number.isInteger(value);
  return new Intl.NumberFormat(APP_LOCALE, {
    ...base,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase(APP_LOCALE) + text.slice(1);
}

/**
 * A day's heading in the day book: "Hoy", "Ayer", then "Jueves, 24 sept", with
 * the year only when it is not this one. Capitalised: Spanish writes weekdays
 * in lower case, and a heading that starts in lower case reads as a fragment.
 */
export function formatDayHeading(day: string, today: Date = new Date()): string {
  const date = parseIsoDay(day);
  if (!date) return day;
  const todayIso = isoDay(today);
  if (day === todayIso) return translate('store.day.today');
  if (day === addDays(todayIso, -1)) return translate('store.day.yesterday');
  return capitalise(
    date.toLocaleDateString(APP_LOCALE, {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      ...(date.getFullYear() !== today.getFullYear() ? ({ year: 'numeric' } as const) : {}),
    }),
  );
}

/** "sáb, 26 sept" -- a day in a tooltip or a table row. */
export function formatDayMedium(day: string): string {
  const date = parseIsoDay(day);
  if (!date) return day;
  return date.toLocaleDateString(APP_LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "26 sept" -- a day under a chart's axis. */
export function formatDayTick(day: string): string {
  const date = parseIsoDay(day);
  if (!date) return day;
  return date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' });
}

/** "26 sept 2026" -- a day in a title. */
export function formatDayFull(day: string): string {
  const date = parseIsoDay(day);
  if (!date) return day;
  return date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * An instant the server stamped (ISO, with its zone) as the day and the clock
 * it was HERE, in this browser: "27 sept 2026" and "13:05". A sale charged
 * at five past one says 13:05 whatever zone the server writes in. Null for
 * nothing, or for what does not read as an instant.
 */
export function formatInstant(iso: string | null | undefined): { day: string; time: string } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { day: formatDayFull(isoDay(date)), time: date.toLocaleTimeString(APP_LOCALE, APP_TIME_FORMAT) };
}

// 1 January 2024 was a Monday: day `i` of the week is that day plus i.
const A_MONDAY = new Date(2024, 0, 1);

/** Monday is 0: "lun" / "Mon". */
export function weekdayShort(weekday: number): string {
  const date = new Date(A_MONDAY);
  date.setDate(date.getDate() + weekday);
  return date.toLocaleDateString(APP_LOCALE, { weekday: 'short' });
}

/** Monday is 0: "Lunes" / "Monday", capitalised for a table's first column. */
export function weekdayLong(weekday: number): string {
  const date = new Date(A_MONDAY);
  date.setDate(date.getDate() + weekday);
  return capitalise(date.toLocaleDateString(APP_LOCALE, { weekday: 'long' }));
}
