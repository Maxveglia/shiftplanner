// What the model read in the notes, turned into what the screen shows.
//
// The reading arrives as data (spans, amounts, flags) and leaves as short
// labelled chips. The labels are built here rather than in the component so a
// test can check them in both languages; the component only picks an icon for
// each kind and lays them out.

import type { DayInsight, DayNote, InsightSummary, TimeSpan } from '../../api/dayNotes';
import { formatTime } from '../format';
import { plural, translate } from '../i18n/core';
import { APP_LOCALE } from '../locale';

/**
 * A day's takings as a plain amount: "1520", no currency sign, no cents.
 *
 * Not `formatMoney`. The note says "caja 1.520 €" and the model keeps only
 * the number, so we do not know the currency -- and `formatMoney` prices in
 * dollars, which turned a Spanish bar's till into "1520,00 $". Nobody counts
 * a day's takings in cents either.
 */
export function formatTakings(value: number): string {
  return new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: 0 }).format(value);
}

/** "HH:MM" as minutes from midnight; NaN for anything else. */
function minutesOf(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/**
 * "22:00–01:00" in Spanish, "10:00 PM–1:00 AM" in English.
 *
 * Through `formatTime`, not the raw strings, because a clock is the
 * language's: the same screen must not say "22:00" here and "10:00 PM" in the
 * calendar next door (see format.ts). A span that crosses midnight needs no
 * mark -- nobody reads "22:00–01:00" as a three-hour morning. A string the
 * server should never send is shown as it came rather than as "NaN".
 */
export function formatSpan(span: TimeSpan): string {
  const start = minutesOf(span.start);
  const end = minutesOf(span.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return `${span.start}–${span.end}`;
  return `${formatTime(start)}–${formatTime(end)}`;
}

export type ChipKind =
  | 'revenue'
  | 'customers'
  | 'closed'
  | 'busy'
  | 'quiet'
  | 'short'
  | 'over'
  | 'event';

export interface Chip {
  kind: ChipKind;
  text: string;
}

/**
 * The chips for one note's reading, in the order a manager scans a day: what
 * came in, whether it opened, when it was full or empty, where the staffing
 * missed, and what happened. Empty when there is nothing to say -- the screen
 * then shows nothing at all rather than a heading over a blank.
 */
export function insightChips(insight: DayInsight | null | undefined): Chip[] {
  if (!insight) return [];
  const chips: Chip[] = [];
  if (insight.revenue != null) {
    chips.push({
      kind: 'revenue',
      text: translate('dayNotes.insight.revenue', { amount: formatTakings(insight.revenue) }),
    });
  }
  if (insight.customers != null) {
    chips.push({
      kind: 'customers',
      text: plural(insight.customers, 'dayNotes.insight.customers.one', 'dayNotes.insight.customers.other'),
    });
  }
  if (insight.closed) chips.push({ kind: 'closed', text: translate('dayNotes.insight.closed') });
  const spans: [ChipKind, TimeSpan[] | undefined, string][] = [
    ['busy', insight.busy, 'dayNotes.insight.busy'],
    ['quiet', insight.quiet, 'dayNotes.insight.quiet'],
    ['short', insight.short_staffed, 'dayNotes.insight.short'],
    ['over', insight.over_staffed, 'dayNotes.insight.over'],
  ];
  for (const [kind, list, key] of spans) {
    for (const span of list ?? []) {
      chips.push({ kind, text: translate(key, { span: formatSpan(span) }) });
    }
  }
  for (const event of insight.events ?? []) {
    const text = event.trim();
    if (text) chips.push({ kind: 'event', text });
  }
  return chips;
}

/** One weekday of the summary, reduced to what the side card shows. */
export interface LearnedRow {
  weekday: number;
  notes: number;
  revenue: number | null;
  busy: TimeSpan[];
  short: TimeSpan[];
  closed: number;
}

/**
 * The weekdays worth a row: read at least once and with something to say.
 * A Tuesday read twice that yielded no amount, no busy hours and no shortage
 * is not a finding, and a row saying "Tue" and nothing is noise.
 */
export function learnedRows(summary: InsightSummary | undefined): LearnedRow[] {
  if (!summary) return [];
  return [...summary.by_weekday]
    .sort((a, b) => a.weekday - b.weekday)
    .filter((d) => d.notes > 0)
    .map((d) => ({
      weekday: d.weekday,
      notes: d.notes,
      revenue: d.avg_revenue,
      busy: d.busy ?? [],
      short: d.short_staffed ?? [],
      closed: d.closed,
    }))
    .filter((r) => r.revenue != null || r.busy.length > 0 || r.short.length > 0 || r.closed > 0);
}

// ---- Keeping the list in step --------------------------------------------

/**
 * The list with one note written in, newest date first -- the order the
 * server sends. Fields the caller does not know (a note only just typed has
 * no `updated_at` from the server) keep what the list had, or a stand-in.
 */
export function upsertNote(
  list: DayNote[] | undefined,
  note: Pick<DayNote, 'note_date' | 'body'> & Partial<DayNote>,
): DayNote[] {
  const current = list ?? [];
  const before = current.find((n) => n.note_date === note.note_date);
  const merged: DayNote = {
    note_date: note.note_date,
    body: note.body,
    updated_at: note.updated_at ?? before?.updated_at ?? new Date().toISOString(),
    sent_at: note.sent_at !== undefined ? note.sent_at : before?.sent_at ?? null,
    insight: note.insight !== undefined ? note.insight : before?.insight ?? null,
  };
  return [...current.filter((n) => n.note_date !== note.note_date), merged].sort((a, b) =>
    b.note_date.localeCompare(a.note_date),
  );
}

export function removeNote(list: DayNote[] | undefined, date: string): DayNote[] {
  return (list ?? []).filter((n) => n.note_date !== date);
}

// ---- Waiting for a reading -----------------------------------------------

/** How often the list is asked again while a note is being read. */
export const POLL_MS = 3_000;
/**
 * How long the screen keeps asking after something changed. A reading takes
 * a few seconds; one that has not arrived in forty is not arriving (the read
 * fails in silence on the server by design), and asking forever would be a
 * request every three seconds for as long as the tab is open.
 */
export const POLL_WINDOW_MS = 40_000;

/** The dates whose reading is still to come. */
export function pendingDates(notes: DayNote[] | undefined): string[] {
  return (notes ?? []).filter((n) => n.insight?.pending).map((n) => n.note_date);
}

/**
 * The interval to poll at, or false: only while a note is pending AND the
 * window opened by the last change is still open.
 */
export function pollInterval(notes: DayNote[] | undefined, windowOpen: boolean): number | false {
  return windowOpen && pendingDates(notes).length > 0 ? POLL_MS : false;
}

/**
 * Dates that were waiting for a reading and now have one. When any turn up,
 * the summary is stale: it was computed without them.
 */
export function newlyRead(previouslyPending: string[], notes: DayNote[] | undefined): string[] {
  const byDate = new Map((notes ?? []).map((n) => [n.note_date, n]));
  return previouslyPending.filter((date) => {
    const note = byDate.get(date);
    return note != null && note.insight != null && !note.insight.pending;
  });
}
