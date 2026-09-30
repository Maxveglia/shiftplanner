// Which period a brief is planned over -- decided here, once, by rule.
//
// This used to be read off the toolbar. The toolbar is a VIEWING control: a
// manager presses "Year" to look at their year, and nothing on screen says
// that the next brief will therefore be planned twelve months at a time, one
// AI call per month. One manager pressed it, wrote a brief with no dates in
// it, and the same sentence that had cost 16 cents an hour earlier cost a
// dollar and a half.
//
// So the two are separated. The brief decides what is planned; the toolbar
// decides what is looked at. A brief that names a period -- "para octubre",
// "los próximos tres meses" -- is planned over exactly that. A brief that
// names none is planned over the four weeks in front of the manager, whatever
// the toolbar is showing and whether or not a calendar is already up.
//
// Asking for a year is still one sentence away: say it in the brief, where
// what you are asking for is written down in your own words.

/** Days planned for a brief that never said when. */
export const UNDATED_DAYS = 28;

/** What the toolbar is set to, plus the two periods a brief can ask for. */
export type PlanHorizon = 'week' | 'next4' | 'month' | 'year' | 'brief';

export interface PlanPeriod {
  horizon: PlanHorizon;
  /** The day the period is built from. */
  anchor: Date;
}

/**
 * The period to plan, from what the brief said and where the manager is.
 *
 * `briefStart` and `briefMonths` are what the intake read out of the brief:
 * which period, and how long. Either one is the manager saying when, and both
 * come back null when they did not.
 */
export function planPeriodFor(args: {
  briefStart: Date | null;
  briefMonths: number | null;
  /** Today. Passed in rather than read, so the rule is testable. */
  today: Date;
  /** Where the calendar is anchored right now. */
  anchor: Date;
}): PlanPeriod {
  const { briefStart, briefMonths, today, anchor } = args;
  if (briefStart || briefMonths) {
    // They said when. A start moves the calendar there; a span with no start
    // runs from where they are.
    return { horizon: 'brief', anchor: briefStart ?? anchor };
  }
  return { horizon: 'next4', anchor: today };
}
