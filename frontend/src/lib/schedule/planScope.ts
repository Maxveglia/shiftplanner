// Which months a replan is allowed to touch.
//
// "Reorganize" used to send the WHOLE horizon to the planner, every time,
// because the months were read straight off the array of days on screen. On a
// year that is twelve calls to the expensive model for a sentence that moved
// one weekend -- and `handleAdjust` escalates to it whenever the surgical path
// says a request cannot be expressed as edits, so "alternate the weekends"
// cost fourteen calls between the two paths.
//
// TWO RULES, AND THEY PULL IN DIFFERENT DIRECTIONS.
//
// 1. Replanning less is cheaper, and nearly always right: the manager is
//    looking at one month and talking about it.
// 2. Replanning less is sometimes WRONG. "Alternate the weekends" is a
//    sentence about the year, and answering it for October alone is a worse
//    product, not a cheaper one. No parser here can tell those apart, so this
//    file does not try: it takes the manager's own choice as an argument and
//    the bar on screen asks for it.
//
// THE ONE THING READ OUT OF THE SENTENCE is a month NAMED in it (`named`, see
// ./namedMonth). That is not an inference about intent, it is a date the
// manager typed, and it outranks the control -- "rehazme el calendario de
// octubre" replanned September for as long as it did not.
//
// The one thing decided WITHOUT asking is published months, and only in the
// safe direction: a rota the team already has on their phones is left alone
// unless the manager says otherwise. Skipping it costs them a second click;
// rearranging it silently costs somebody their childcare.
//
// Nothing here writes prose. What was cut and why comes back as data, and the
// dashboard turns it into the sentence under the adjustment bar -- the same
// separation the validator keeps, and for the same reason: a library that
// emits English ships English to a Spanish manager.

import type { DayRef } from './types';

/**
 * How much of the horizon a replan covers.
 *
 * `month` is the one month the manager has open. `horizon` is everything on
 * screen, which is what this always did.
 */
export type PlanScope = 'month' | 'horizon';

/** Why a month of the horizon is not being replanned. */
export type ScopeCut =
  /** Outside the scope the manager picked. */
  | 'out_of_scope'
  /** The team already has this rota, and nobody asked to move it. */
  | 'published';

export interface ScopeRequest {
  scope: PlanScope;
  /**
   * Months the manager NAMED in the sentence they just typed, if any.
   *
   * These outrank both the scope control and the open folder, for the same
   * reason a brief's own dates outrank the toolbar: it is the most specific
   * thing they said, and they said it on purpose. "Rehazme octubre" replanned
   * September until this existed -- the scope came off a control the manager
   * was not looking at while they typed a month's name into the box.
   *
   * Empty for every sentence that names no month, which is most of them, and
   * then nothing here changes.
   */
  named?: readonly string[];
  /**
   * The month the manager is looking at, "YYYY-MM". Null when there is no
   * calendar; a month not in the period is treated as no answer at all.
   */
  focus: string | null;
  /** Months the team has already been given. */
  published: ReadonlySet<string>;
  /** The manager ticked the box that says to replan those too. */
  includePublished: boolean;
}

export interface PlanningScope {
  /** The months to ask the planner for, in calendar order. Possibly empty. */
  months: string[];
  /** The days those months cover: what the planner is shown and judged on. */
  days: DayRef[];
  /** Every month of the horizon left out, and why. */
  cut: { month: string; reason: ScopeCut }[];
}

/** The months a period spans, in order, each once. */
export function monthsOfDays(days: DayRef[]): string[] {
  const out: string[] = [];
  for (const day of days) {
    const key = day.date.slice(0, 7);
    if (out[out.length - 1] !== key) out.push(key);
  }
  return out;
}

/**
 * The slice of a period that falls inside `months`.
 *
 * The planner is given these days and `scheduleFromProposal` judges the
 * proposal against them, so a month being replanned is never told off for the
 * neighbouring month's shifts -- the same contract `validateSchedule`
 * documents for its own `days` argument.
 */
export function daysInMonths(days: DayRef[], months: Iterable<string>): DayRef[] {
  const wanted = months instanceof Set ? months : new Set(months);
  return days.filter((d) => wanted.has(d.date.slice(0, 7)));
}

/** Decide what a replan covers. Pure: the caller does the asking and the telling. */
export function planningScope(days: DayRef[], req: ScopeRequest): PlanningScope {
  const all = monthsOfDays(days);
  if (all.length === 0) return { months: [], days: [], cut: [] };

  // One month is the whole horizon, so the choice cannot change anything and
  // the bar does not offer it. Guarding here too keeps this total: a `focus`
  // left over from another period must not empty a single-month replan.
  const named = (req.named ?? []).filter((m) => all.includes(m));
  const wanted =
    named.length > 0
      ? named
      : req.scope === 'horizon' || all.length === 1
        ? all
        : [req.focus !== null && all.includes(req.focus) ? req.focus : all[0]];

  const months: string[] = [];
  const cut: PlanningScope['cut'] = [];
  for (const month of all) {
    if (!wanted.includes(month)) {
      cut.push({ month, reason: 'out_of_scope' });
    } else if (req.published.has(month) && !req.includePublished) {
      cut.push({ month, reason: 'published' });
    } else {
      months.push(month);
    }
  }
  return { months, days: daysInMonths(days, months), cut };
}

/** The months cut for one reason, in calendar order. For the sentence on screen. */
export function cutFor(scope: PlanningScope, reason: ScopeCut): string[] {
  return scope.cut.filter((c) => c.reason === reason).map((c) => c.month);
}
