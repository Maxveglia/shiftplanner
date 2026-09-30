// Which month came out badly enough to be worth paying for twice.
//
// The planner asks the model for one month per call, and every one of those
// calls used to run at the model's top effort setting. Effort buys OUTPUT, and
// output is where the money is -- roughly forty times the price of the same
// count of input tokens -- so a year of calendar was twelve expensive calls to
// arrange twelve months that are, nearly always, fine. The server plans at the
// cheaper setting now.
//
// That is only honest if a month that comes back broken is asked again at the
// expensive one, and this file is the part that says which. THE JUDGE IS FREE:
// by the time this runs, `scheduleFromProposal` has already parsed, validated,
// repaired and hole-filled the proposal, so both signals are read off work that
// is finished and paid for. No extra call decides whether to make an extra
// call.
//
// ONE RETRY PER MONTH. The caller runs exactly one round, and a month that
// comes back bad twice keeps what it has. That is not a resignation: the greedy
// pass has already filled it and the result is legal, which is precisely the
// calendar this product shipped before a model was involved at all. An
// unbounded "ask again until it is good" is how a cost saving turns into a
// bill.

import type { ProposalReport } from './fromProposal';
import type { ScheduleResult } from './types';

/**
 * Uncovered person-hours below which a month is left alone.
 *
 * Half a short shift. Under it the rota is one person coming in early away
 * from whole, and a second call to the expensive model costs more than the
 * hole it would close -- while a three-person shop, whose month is sixty
 * scheduled hours, would otherwise trip the ratio below on a single hour.
 */
export const RETRY_MIN_UNCOVERED_HOURS = 4;

/**
 * Uncovered hours as a share of the month's own scheduled hours, above which
 * it is asked again.
 *
 * A ratio rather than a count, because the same four missing hours mean
 * nothing across a 24/7 hotel and a fortnight of a corner shop. One hour in
 * twenty is the line: below it the manager closes the gap by moving one shift,
 * above it the arrangement itself is wrong and that is what a better model
 * pass actually fixes.
 *
 * Both conditions must hold. Either alone misfires in the direction that
 * costs money: the ratio on a tiny month, the count on a large one.
 */
export const RETRY_UNCOVERED_SHARE = 0.05;

export interface MonthVerdict {
  /** "YYYY-MM". */
  month: string;
  /**
   * Hard rules still broken inside the month after the repair pass.
   *
   * Expected to be zero -- the survivors are legal and the greedy pass cannot
   * place an illegal shift (see `ProposalReport.valid`). A month where it is
   * not is the one place the generator and the validator have visibly drifted,
   * and it is worth every cent to ask again.
   */
  hardViolations: number;
  /** Person-hours the month still leaves under-staffed. */
  uncovered: number;
  /** Paid person-hours the month did manage to schedule. */
  scheduled: number;
  worthRetrying: boolean;
}

function inMonth(date: string, month: string): boolean {
  return date.slice(0, 7) === month;
}

/**
 * Grade each month of a finished calendar.
 *
 * `result` and `report` are the two halves `scheduleFromProposal` returns for
 * the WHOLE period, so the split by month happens here rather than by planning
 * the months separately: a weekly ceiling runs across a month boundary, and
 * judging each month in its own validator would miss it.
 */
export function judgeMonths(
  months: Iterable<string>,
  result: ScheduleResult,
  report: ProposalReport,
): MonthVerdict[] {
  return [...months].map((month) => {
    const hardViolations = report.remaining.filter((v) => inMonth(v.date, month)).length;
    const uncovered = result.gaps
      .filter((g) => inMonth(g.date, month))
      .reduce((total, g) => total + Math.max(0, g.need - g.have), 0);
    const scheduled = result.assignments
      .filter((a) => inMonth(a.date, month))
      .reduce((total, a) => total + a.paidHours, 0);
    return {
      month,
      hardViolations,
      uncovered,
      scheduled,
      worthRetrying:
        hardViolations > 0 ||
        (uncovered >= RETRY_MIN_UNCOVERED_HOURS &&
          uncovered > scheduled * RETRY_UNCOVERED_SHARE),
    };
  });
}

/**
 * The months to ask again, at the expensive setting.
 *
 * Months the server reported as FAILED are never among them. Those are calls
 * the model never answered -- no key, a timeout, its own budget -- so their
 * calendar is the greedy pass's and there is no proposal to have been bad.
 * Asking the same month again with MORE thinking to do is the likeliest thing
 * in the product to time out twice and be billed for both, and the amber
 * banner already tells the manager those months were not reasoned about.
 */
export function monthsToRetry(
  verdicts: MonthVerdict[],
  failed: Iterable<string> = [],
): string[] {
  const unplanned = new Set(failed);
  return verdicts
    .filter((v) => v.worthRetrying && !unplanned.has(v.month))
    .map((v) => v.month);
}

function monthOfRow(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null;
  const date = (row as { date?: unknown }).date;
  return typeof date === 'string' ? date.slice(0, 7) : null;
}

/**
 * The first pass's shifts with the retried months swapped for the new answer.
 *
 * Both sides stay `unknown`: a second call is no more trustworthy than the
 * first, and the merged list goes back through `scheduleFromProposal`, which
 * assumes nothing about it. Rows with no readable date are kept rather than
 * dropped here -- deciding they are malformed is `parseProposal`'s job, and it
 * reports what it drops.
 */
export function mergeRetried(
  first: unknown,
  retried: unknown,
  months: ReadonlySet<string>,
): unknown[] {
  const kept = (Array.isArray(first) ? first : []).filter((row) => {
    const month = monthOfRow(row);
    return month === null || !months.has(month);
  });
  return [...kept, ...(Array.isArray(retried) ? retried : [])];
}
