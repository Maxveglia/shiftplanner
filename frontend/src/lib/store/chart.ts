// The arithmetic behind the statistics' charts, kept out of the JSX so it can
// be tested without a DOM: which bar is the peak, which days get a label
// under the axis, where a key press moves the reading, and what an average
// weekday brings in.

import type { StoreStats } from '../../api/store';
import { weekdayOf } from './period';

/** The first bar at the maximum, or -1 when every value is 0 (no peak to label). */
export function peakIndex(values: readonly number[]): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0 && (best === -1 || values[i] > values[best])) best = i;
  }
  return best;
}

/**
 * Which days of a daily chart carry a date under the axis. A week: all seven.
 * Longer: the Mondays, so the labels fall on the same weekday and the eye
 * reads weeks; past seven Mondays (a quarter), every other one, so they never
 * crowd. The label row is the axis, not a list: the day of every bar is in
 * its tooltip and in the table.
 */
export function dayTickIndices(days: readonly string[]): number[] {
  if (days.length <= 10) return days.map((_, i) => i);
  const mondays = days.flatMap((d, i) => (weekdayOf(d) === 0 ? [i] : []));
  return mondays.length > 7 ? mondays.filter((_, k) => k % 2 === 0) : mondays;
}

/**
 * Where a key moves the reading on a chart the keyboard walks bar by bar:
 * one bar with the arrows, a week with Page Up / Page Down, the ends with
 * Home / End; stopping at the ends rather than wrapping round, because a
 * time series that jumps from today back to three months ago has lost the
 * reader. Null for a key that is not the chart's.
 *
 * With nothing read yet, the arrows start from the newest bar (Left) or the
 * oldest (Right): the chart opens on the present.
 */
export function stepIndex(current: number | null, key: string, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const from = (fallback: number) => (current === null ? fallback : current);
  switch (key) {
    case 'ArrowLeft':
      return current === null ? last : Math.max(0, current - 1);
    case 'ArrowRight':
      return current === null ? 0 : Math.min(last, current + 1);
    case 'PageUp':
      return Math.max(0, from(count) - 7);
    case 'PageDown':
      return Math.min(last, from(-1) + 7);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

/** Where a label or a tooltip over bar `index` hangs, so it never leaves the chart. */
export function edgeAlign(index: number, count: number): 'start' | 'center' | 'end' {
  if (count <= 1) return 'center';
  const at = (index + 0.5) / count;
  return at < 0.15 ? 'start' : at > 0.85 ? 'end' : 'center';
}

export interface WeekdayFigure {
  /** 0 is Monday. */
  weekday: number;
  /** What every such day of the period brought in together. */
  total: number;
  /** How many such days the period has. */
  days: number;
  /** total / days, to the cent: what one such day brings in. */
  average: number;
}

/**
 * What an average Monday, Tuesday... brings in over the period.
 *
 * The average and not the total: thirty days hold five of two weekdays and
 * four of the other five, and totals would crown whichever day the calendar
 * happened to repeat -- a quarter more, for nothing the manager did. Divided
 * by every such day in the period, closed ones included: a closed Monday
 * brings in nothing, and that is the answer to "what does a Monday bring in".
 */
export function weekdayFigures(stats: Pick<StoreStats, 'days' | 'by_weekday'>): WeekdayFigure[] {
  const counts = new Array<number>(7).fill(0);
  for (const day of stats.days) counts[weekdayOf(day.date)] += 1;
  return Array.from({ length: 7 }, (_, weekday) => {
    const total = stats.by_weekday.find((w) => w.weekday === weekday)?.total ?? 0;
    const days = counts[weekday];
    return {
      weekday,
      total,
      days,
      average: days > 0 ? Math.round((total / days) * 100) / 100 : 0,
    };
  });
}

/** Each value's share of the largest, 0 to 1: the length of a bar in a table row. */
export function shareOfMax(values: readonly number[]): number[] {
  const max = Math.max(0, ...values);
  return values.map((v) => (max > 0 && v > 0 ? v / max : 0));
}
