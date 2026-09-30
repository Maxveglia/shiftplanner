// Which month the first calendar is for, asked as a list rather than typed.
//
// The interview's second question, straight after the opening hours. It is a
// form for the same reason the hours are: the answer is one of a dozen
// buttons, and a chat that has to understand "el mes que viene" or "after the
// summer" is a chat that can misunderstand them.
//
// WHAT "SEPTEMBER" MEANS ON THE 22ND OF SEPTEMBER. Not the whole month: the
// first three weeks are already over, and a calendar that fills them is a
// calendar nobody can use, paid for in tokens. The current month is offered
// as what is LEFT of it -- the button says so, the transcript says so, and
// `firstPlannedDay` is what the dashboard plans from. Asked on the 1st, the
// current month is simply the month.
//
// The answer does NOT go into the brief. The brief is kept on the profile and
// read as background by every later intake, so "October" written there would
// be read again in November. The month travels beside the brief instead, to
// the one calendar it was asked for.

import { translate } from '../i18n/core';
import { monthName } from '../schedule/calendar';

/** How many months the list offers, the current one included. A year. */
export const MONTHS_OFFERED = 12;

/** One button in the list. */
export interface MonthChoice {
  /** "YYYY-MM". */
  month: string;
  /** The month today is in: planned from today, not from the 1st. */
  current: boolean;
  /** The first day that would be planned (1 unless this is the current month). */
  fromDay: number;
  /** The month's last day. */
  lastDay: number;
}

function monthKeyOf(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function lastDayOf(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * The months on offer, from today's forwards. Read in LOCAL time: "today" is
 * the manager's day, the same one every window in the dashboard is built on.
 */
export function monthChoices(today: Date, count: number = MONTHS_OFFERED): MonthChoice[] {
  const out: MonthChoice[] = [];
  for (let i = 0; i < count; i++) {
    const first = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const y = first.getFullYear();
    const m = first.getMonth();
    out.push({
      month: monthKeyOf(y, m),
      current: i === 0,
      fromDay: i === 0 ? today.getDate() : 1,
      lastDay: lastDayOf(y, m),
    });
  }
  return out;
}

/** Only part of the month is left to plan. False on the 1st: then it is all of it. */
export function isPartial(choice: MonthChoice): boolean {
  return choice.fromDay > 1;
}

/**
 * What the chat hands on: the month, and the day planning starts from --
 * worked out ONCE, against the same "today" the button showed. Recomputed
 * later, a choice made at 23:55 on the 30th would be read the next morning as
 * a month that is over.
 */
export interface FirstMonthPick {
  /** "YYYY-MM". */
  month: string;
  /** "YYYY-MM-DD" to plan from, or null for the whole month. */
  from: string | null;
}

export function pickOf(choice: MonthChoice, today: Date): FirstMonthPick {
  return { month: choice.month, from: firstPlannedDay(choice.month, today) };
}

/**
 * The first day that gets planned, as "YYYY-MM-DD" -- or null when the whole
 * month does. The dashboard's floor: nothing before it is planned or sent.
 */
export function firstPlannedDay(month: string, today: Date): string | null {
  if (month !== monthKeyOf(today.getFullYear(), today.getMonth())) return null;
  if (today.getDate() === 1) return null;
  return `${month}-${String(today.getDate()).padStart(2, '0')}`;
}

function capitalised(s: string): string {
  return s ? s[0].toLocaleUpperCase() + s.slice(1) : s;
}

/**
 * The month as a button calls it: "Octubre", "Enero de 2027" once the list has
 * crossed into another year, so December and January are never ambiguous.
 */
export function monthLabel(choice: MonthChoice, today: Date): string {
  const name = capitalised(monthName(choice.month));
  const year = Number(choice.month.slice(0, 4));
  return year === today.getFullYear()
    ? name
    : translate('interview.month.withYear', { month: name, year });
}

/**
 * The answer, as the manager's own message in the transcript. Says the days
 * when only part of the month is left, so Gemini reads the same thing the
 * button said.
 */
export function composeMonthAnswer(choice: MonthChoice, today: Date): string {
  const month = monthLabel(choice, today);
  return isPartial(choice)
    ? translate('interview.month.answerRest', {
        month,
        from: choice.fromDay,
        to: choice.lastDay,
      })
    : translate('interview.month.answer', { month });
}
