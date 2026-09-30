// "How much will I get, and for which days?"
//
// The answer depends on what the employee agreed with their manager, so the
// pay period comes off the contract rather than being a setting in the UI.
// Everything here derives the exact window that question refers to.

import { APP_LOCALE } from '../locale';
import { translate } from '../i18n/core';
import type { PayPeriod } from '../../types';
import { monthDays, startOfWeek, toDateKey } from './generate';
import type { DayRef } from './types';

/**
 * A Monday, used to anchor the biweekly cycle so it is the same for everyone.
 *
 * It has to be the same weekday the weeks start on, or the distance from it
 * is not a whole number of weeks and the fortnight a person is in flips on
 * rounding. It moved with the anchor: 4 January 1970 was a Sunday, the 5th is
 * the Monday after it.
 */
const BIWEEKLY_EPOCH = new Date(1970, 0, 5);
const WEEK_MS = 7 * 86_400_000;

/** Wire value -> dictionary key. Iterate this to list every pay period. */
export const payPeriodKeys: Record<PayPeriod, string> = {
  weekly: 'labels.payPeriod.weekly',
  biweekly: 'labels.payPeriod.biweekly',
  monthly: 'labels.payPeriod.monthly',
};

export const payPeriodLabel = (v: PayPeriod): string =>
  translate(payPeriodKeys[v] ?? v);

/** The whole sentence: "You are paid every two weeks". */
export const payPeriodCadence = (v: PayPeriod): string =>
  translate(`labels.payPeriodCadence.${v}`);

/**
 * Just the frequency: "every two weeks".
 *
 * A separate string rather than the sentence with its opening words sliced off
 * -- that trick only ever worked in English, and silently produced "Cobras cada
 * dos semanas" mid-sentence the moment the copy was translated.
 */
export const payPeriodCadenceShort = (v: PayPeriod): string =>
  translate(`labels.payPeriodCadenceShort.${v}`);

/** `count` consecutive days starting at `start`. */
export function spanDays(start: Date, count: number): DayRef[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    return {
      date: toDateKey(d),
      weekday: d.getDay(),
      label: d.toLocaleDateString(APP_LOCALE, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    };
  });
}

/**
 * The days covered by the pay period that contains `anchor`.
 *
 * Weeks run Monday to Sunday -- the same boundary everything else counts by
 * (`startOfWeek`), so a pay period never splits a week in half and reports
 * overtime the employee has not accrued yet.
 */
export function payPeriodDays(period: PayPeriod, anchor: Date): DayRef[] {
  if (period === 'monthly') return monthDays(anchor);
  if (period === 'weekly') return spanDays(startOfWeek(anchor), 7);

  // Biweekly: pin the cycle to a fixed Monday so every employee in every org
  // lands on the same fortnight boundaries, whatever day they happen to look.
  const monday = startOfWeek(anchor);
  const weeks = Math.round((monday.getTime() - BIWEEKLY_EPOCH.getTime()) / WEEK_MS);
  const blockStart = new Date(monday);
  blockStart.setDate(blockStart.getDate() - (weeks % 2 === 0 ? 0 : 7));
  return spanDays(blockStart, 14);
}

/** Move `anchor` one whole pay period forward (+1) or back (-1). */
export function shiftPayPeriod(
  period: PayPeriod,
  anchor: Date,
  delta: number,
): Date {
  const next = new Date(anchor);
  if (period === 'monthly') next.setMonth(next.getMonth() + delta);
  else next.setDate(next.getDate() + delta * (period === 'weekly' ? 7 : 14));
  return next;
}

/** "September 2026" for a month, "31 Aug – 13 Sep" otherwise. */
export function periodLabel(period: PayPeriod, days: DayRef[]): string {
  if (days.length === 0) return '';
  if (period === 'monthly') {
    const [y, m] = days[0].date.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(APP_LOCALE, {
      month: 'long',
      year: 'numeric',
    });
  }
  const short = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(APP_LOCALE, {
      day: 'numeric',
      month: 'short',
    });
  };
  return `${short(days[0].date)} – ${short(days[days.length - 1].date)}`;
}

/** Instants bounding the period, for querying the server. */
export function periodBounds(days: DayRef[]): { from: Date; to: Date } {
  const first = days[0].date.split('-').map(Number);
  const last = days[days.length - 1].date.split('-').map(Number);
  return {
    from: new Date(first[0], first[1] - 1, first[2]),
    // Exclusive end: midnight after the final day.
    to: new Date(last[0], last[1] - 1, last[2] + 1),
  };
}
