// What publishing the draft would do to everybody's hours.
//
// The question this answers is the one a manager asks with their finger on the
// publish button: "if I send this out, does Ana end the quarter short?". Two
// halves of the answer live in two different places and neither can give it
// alone.
//
//   THE FIRM BALANCE comes from the server (`/workday/balances`) and counts
//   PUBLISHED hours only. A draft does not move it, on purpose -- see the
//   endpoint's docstring: a balance that slid every time a shift was dragged
//   would be a number nobody could plan against.
//
//   THE DRAFT is on this screen and nowhere else. `ScheduleResult.hoursByEmployee`
//   is what it adds up to per person over the window being edited.
//
// So the projection is arithmetic across the seam, and the whole subtlety is
// in one term of it:
//
//     projected = planned - published_in_window + draftHours - total
//
// PUBLISHING REPLACES, IT DOES NOT ADD. The rota already on those dates is
// thrown away and the draft put in its place, so the hours that were there
// (`published_in_window`) have to come out of `planned` before the draft goes
// in. Leave that term out and every shift the manager did not touch is counted
// twice -- a week already published and re-drafted unchanged would read as
// double the hours, which is exactly the wrong answer in the exactly wrong
// direction: it says somebody is over when they are on track.
//
// `planned` runs past today, because the question is about where the stretch
// ENDS, not where it stands today.
//
// A STRETCH IS MEASURED AS FAR AS IT IS PLANNED, AND NO FURTHER. `total` is
// what the contract asks for between `start` and `horizon` -- the part of the
// stretch somebody has actually written a rota for, the draft on screen
// included -- and NOT what it asks for over the whole three months. Measuring
// the whole quarter while only its first month exists said that everybody who
// worked their October exactly was a hundred and fifty hours short, because
// November and December were empty; the hours were not missing, they had not
// been handed out yet. Those hours are `pending`, they are reported on their
// own line ("348 h still to plan"), and they never touch the deviation.
//
// WHICH IS WHY THE DEVIATION IS NOT THE HEADLINE. With one month drafted and
// nothing else planned, Month, Quarter and Year all have the SAME deviation --
// the same measured October, judged three times -- and printing it as the big
// figure of each tab made the three tabs look like one tab shown thrice. It
// came back twice as "the hour counter does not work", and fairly: it answered
// "how is October going" under a button that says "Year".
//
// So each row leads with the stretch itself, "X of Y hours":
//
//     hours = planned_stretch - published_in_window + draft in the stretch
//     owed  = total + pending
//
// X is every hour on the rota over the stretch if the draft is published, Y is
// what the contract asks for over the same days, end to end. Those genuinely
// differ between tabs -- 182 of 177 h in October, 182 of 526 h in the quarter
// -- and the deviation of the planned part goes underneath, labelled with the
// months it covers ("+5.4 h in October"), where it reads as what it is.
//
// Out here rather than inside the column component because this arithmetic is
// the feature -- the pixels are not -- and this repository keeps no DOM in its
// tests on purpose (see lib/schedule/balanceBar for the same split).

/** Which stretch the manager is looking at. */
export type BalanceSpan = 'month' | 'quarter' | 'year';

/**
 * The three figures a projection needs out of one server-side balance.
 *
 * Structural on purpose: `api/workday`'s `Balance` carries more than this and
 * satisfies it, so nothing under lib/ has to import from the API layer.
 */
export interface FirmSpan {
  /** PUBLISHED hours over the measured part of the stretch, `start` to `horizon`. */
  planned: number;
  /**
   * PUBLISHED hours over the WHOLE stretch, `start` to its end, the horizon
   * notwithstanding -- a December published ahead of an empty November is in
   * this and not in `planned`. The published half of "X of Y hours".
   *
   * Optional because a server that predates it sends nothing; `planned` is
   * then the best there is, and the two only differ past a gap in the rota.
   */
  planned_stretch?: number;
  /**
   * What the contract asks for over the part of the stretch that is MEASURED:
   * from `start` to `horizon`, which is as far as anybody has planned.
   *
   * Not the whole stretch. See `pending` for the rest of it, and the header of
   * this file for why the two are kept apart.
   */
  total: number;
  /** Published hours inside the window being edited -- what publishing replaces. */
  published_in_window: number;
  /** Where the server starts counting this stretch for this person, if it says. */
  start?: string | null;
  /**
   * What the contract asks for over the part of the stretch NOT YET PLANNED.
   *
   * Optional because a server that predates the field sends nothing, and a
   * missing `pending` has to read as zero: the stretch is then measured end to
   * end, which is exactly how this column behaved before the field existed.
   */
  pending?: number;
  /**
   * Exclusive end of the measured part, "YYYY-MM-DD", when the server says.
   *
   * Everything measured against `total` stops here -- the draft included. See
   * `draftHoursIn`.
   */
  horizon?: string | null;
}

/** One person's three stretches, as the server sends them. */
export interface SpanBalances {
  employee_id: string;
  employee_name: string;
  month: FirmSpan;
  quarter: FirmSpan;
  year: FirmSpan;
}

/**
 * Under an hour either way is neither short nor over.
 *
 * Without a dead band the column flickers between two colours on rounding
 * alone -- a paid break of 20 minutes here, a 15-minute overrun there -- and
 * reads as instability in the rota rather than in the arithmetic. An hour is
 * wider than the quarter of an hour the roster uses (see `barShape`) because
 * this figure is a whole quarter or a whole year of shifts added up, and the
 * rounding it carries is the sum of all of them.
 */
export const DEAD_BAND_HOURS = 1;

/** Short of the contract, over it, or close enough to neither. */
export type BalanceLean = 'over' | 'short' | 'level';

/** Two decimals, so float noise never reaches a screen or a test. */
const round = (hours: number): number => Math.round(hours * 100) / 100;

/**
 * Where the stretch would END if this draft were published.
 *
 * Positive means hours over what the contract asks for, negative means hours
 * missing. Zero-ish means the stretch comes out even.
 */
export function projectedDeviation(span: FirmSpan, draftHours: number): number {
  // The order is the story: take out what publishing would overwrite, put the
  // draft in its place, then measure the stretch against the contract.
  return round(span.planned - span.published_in_window + draftHours - span.total);
}

/** Which way a balance leans, ignoring anything inside the dead band. */
export function leanOf(hours: number, deadBand = DEAD_BAND_HOURS): BalanceLean {
  if (Math.abs(hours) < deadBand) return 'level';
  return hours > 0 ? 'over' : 'short';
}

/**
 * Hours the contract still has to hand out over this stretch, never negative.
 *
 * Zero for a server that does not send the field, which is what makes the
 * whole of this module safe to run against one: no pending hours means the
 * stretch is measured end to end, the reading it always gave.
 */
export function pendingOf(span: FirmSpan): number {
  return Math.max(0, round(span.pending ?? 0));
}

/**
 * An exclusive end date turned into the last day it actually covers.
 *
 * Horizons are exclusive -- the day after the last one counted -- because that
 * is the form arithmetic wants. A sentence wants the other one: "measured to
 * the 31st of October", not "to the 1st of November", which a manager reads as
 * a day of November nobody planned.
 *
 * Here rather than beside each screen because BOTH screens that state a
 * measured range now do this subtraction (see `workdayRows.measuredTo`), and
 * two of them is how they start disagreeing by a day.
 */
export function dayBefore(dateKey: string | null | undefined): string | null {
  if (!dateKey) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return null;
  // Through UTC, so the subtraction cannot land on a day that a local clock
  // change made 23 or 25 hours long.
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * The last day this stretch's measurement covers, inclusive, or null.
 *
 * Null when nothing is measured at all (`total` of zero): there is no day to
 * name, and naming the day before the stretch even opened would be worse than
 * saying nothing.
 */
export function measuredThrough(span: FirmSpan): string | null {
  if (span.total <= 0) return null;
  return dayBefore(span.horizon);
}

/**
 * The months the measured part covers, as "YYYY-MM" keys, or null.
 *
 * For labelling the deviation "in October" or "October to December". Null
 * unless the measurement runs from a 1st to a month's last day: a window in
 * the past measured to today stops on the 24th, and a contract signed on the
 * 20th starts there, and "in October" beside either would name days the
 * figure did not count. The caller then gives the two dates instead.
 */
export function measuredMonths(
  start: string | null | undefined,
  through: string | null | undefined,
): { from: string; to: string } | null {
  if (!start || !through || !start.endsWith('-01')) return null;
  const [y, m, d] = through.split('-').map(Number);
  if (!y || !m || !d) return null;
  // The last day of its month is the only day whose next day is the 1st.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  if (next.getUTCDate() !== 1) return null;
  return { from: start.slice(0, 7), to: through.slice(0, 7) };
}

/** One line of the column. */
export interface ProjectedRow {
  employeeId: string;
  name: string;
  /**
   * Hours on the rota over the WHOLE stretch if the draft is published: the
   * published hours the draft does not replace, plus the draft. The "X" of
   * "X of Y hours".
   */
  hours: number;
  /** What the contract asks for over the whole stretch, `total + pending`. The "Y". */
  owed: number;
  /**
   * Hours that are on the noticeboard already and stay there if the draft
   * goes out: the published rota outside the window, plus every draft shift
   * that is published exactly as it stands. The dark part of the bar.
   */
  kept: number;
  /** Draft hours that are NOT published yet -- the brand-coloured part of the bar. */
  drafted: number;
  /**
   * Hours over (+) or short (−) over the part of the stretch that has been
   * planned, draft included. The line under the bar, never the headline.
   */
  projected: number;
  lean: BalanceLean;
  /** First day counted for this person in this stretch, "YYYY-MM-DD", or null. */
  start: string | null;
  /**
   * Hours the contract asks for over the part of this stretch nobody has
   * planned yet. Zero once the stretch is written end to end.
   *
   * NOT part of the deviation and never added to it -- see the file header.
   * On screen it is the stretch of the bar nothing fills, and the sentence
   * behind the row says it in hours.
   */
  pending: number;
  /**
   * The last day the deviation covers, inclusive, or null -- for saying "to
   * the 31st of October" beside a figure that stops there.
   */
  through: string | null;
  /**
   * Whether there is anything to measure against at all.
   *
   * False when the contract asks for nothing over this stretch, now or later
   * -- the stretch ended before the cycle opened, or the person has no
   * contracted hours. The projection is then just the draft's own hours with
   * no line to compare them to, and printing that as "+159 h" says somebody is
   * 159 hours over their contract when the truth is that this stretch has no
   * contract in it. The column shows a dash instead.
   */
  measurable: boolean;
}

/**
 * Whether a stretch can be judged at all.
 *
 * A stretch that has been planned asks for `total` hours; one nobody has
 * touched yet asks for `pending`. EITHER makes it a stretch with a contract in
 * it, and that is the whole test. Only when both are zero is there no question
 * to answer: no obligation now, none coming, so no surplus and no shortfall.
 *
 * The second half matters more than it looks. Under the measured-part rule a
 * year opened in January with nothing on the rota has a `total` of zero --
 * there is no planned part to measure -- and judging that on `total` alone put
 * a mute dash next to every name on the very screen where the answer is
 * "nothing is planned yet, and here is how much of it there is". The row is
 * measurable, its deviation is zero, and its `pending` says the rest.
 */
export function isMeasurable(span: FirmSpan): boolean {
  return span.total > 0 || pendingOf(span) > 0;
}

/**
 * The whole column: one row per person the server knows about.
 *
 * ROWS FOLLOW THE SERVER'S ROSTER, not the draft. Somebody with no shifts in
 * this window still has a month and a quarter, and dropping them would hide
 * the very person most likely to be short. The other way round -- hours in the
 * draft for an id the server has never heard of, which is what a proposed hire
 * looks like before the roster change is applied -- has no contract to be
 * measured against, so there is no balance to project and no row to show.
 *
 * TWO DRAFT COUNTS, because the row makes two statements. `draftHours` is the
 * draft cut at the horizon, for the deviation -- see `draftHoursIn`.
 * `stretchDraft` is the draft over the whole stretch, for "X of Y": Y runs to
 * the end of the stretch, so X has to as well. They only differ when the
 * draft reaches past the horizon, and without the second the first is used.
 *
 * AND WHICH OF THE DRAFT IS ALREADY OUT. `settled` is the part of
 * `stretchDraft` whose shifts are published exactly as drafted -- the whole
 * of it, the moment after the manager presses publish, because the draft
 * stays on screen and IS the rota now. Without it the bar split the hours by
 * where they fall (inside the window: draft; outside: published) and painted
 * a month that had just gone out as entirely unpublished. It moves hours from
 * one part of the bar to the other and never changes X.
 */
export function projectRows(
  balances: { employees: SpanBalances[] } | null | undefined,
  draftHours: Record<string, number> | null | undefined,
  span: BalanceSpan,
  stretchDraft: Record<string, number> | null | undefined = draftHours,
  settled: Record<string, number> | null | undefined = null,
): ProjectedRow[] {
  if (!balances) return [];
  return balances.employees.map((e) => {
    const stretch = e[span];
    // A person the draft never touches contributes nothing, which is not the
    // same as having no balance: their published rota still stands.
    const draft = draftHours?.[e.employee_id] ?? 0;
    const projected = projectedDeviation(stretch, draft);
    const measurable = isMeasurable(stretch);
    // Publishing replaces the window, so what stays is the stretch's
    // published hours less the ones inside it. Never below zero: the window
    // hours are a subset of the stretch's, and a server rounding each to two
    // decimals must not produce a sliver of negative bar.
    const outside = Math.max(
      0,
      round((stretch.planned_stretch ?? stretch.planned) - stretch.published_in_window),
    );
    const inDraft = round(stretchDraft?.[e.employee_id] ?? 0);
    // Clamped to the draft it is a part of, so a caller that counted the two
    // over different days can move hours between the parts but never add any.
    const same = Math.min(inDraft, Math.max(0, round(settled?.[e.employee_id] ?? 0)));
    const kept = round(outside + same);
    const drafted = round(inDraft - same);
    return {
      employeeId: e.employee_id,
      name: e.employee_name,
      hours: round(kept + drafted),
      owed: round(stretch.total + pendingOf(stretch)),
      kept,
      drafted,
      projected,
      // Nothing to lean against when there is nothing to measure.
      lean: measurable ? leanOf(projected) : 'level',
      start: stretch.start ?? null,
      pending: pendingOf(stretch),
      through: measuredThrough(stretch),
      measurable,
    };
  });
}

/** How much of the bar each part fills, as shares of `owed`, 0..1. */
export interface StretchBar {
  /** End of the solid part: published hours that stay. */
  kept: number;
  /** End of the faint part, measured from zero: published plus draft. Never less than `kept`. */
  filled: number;
}

/**
 * The bar for one row: the stretch from nothing to `owed`.
 *
 * Clamped at the end rather than drawn past it, as the roster's bars are (see
 * `balanceBar`): a bar that overflowed would make two people's bars mean two
 * different lengths. By how much it is over is the line underneath.
 */
export function stretchBar(row: Pick<ProjectedRow, 'kept' | 'hours' | 'owed'>): StretchBar {
  const share = (h: number) => (row.owed > 0 ? Math.max(0, Math.min(1, h / row.owed)) : 0);
  return {
    kept: share(row.kept),
    filled: share(Math.max(row.hours, row.kept)),
  };
}

/** One draft shift, as far as a balance cares: whose, which day, how long. */
export interface DraftShift {
  employeeId: string;
  /** The day the shift starts on, "YYYY-MM-DD" -- the day the server counts it on. */
  date: string;
  paidHours: number;
}

/** "2026-10-01" plus `months`, as a date key. */
function addMonths(dateKey: string, months: number): string {
  const [y, m] = dateKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`;
}

const SPAN_MONTHS: Record<BalanceSpan, number> = { month: 1, quarter: 3, year: 12 };

/**
 * The draft's hours per person INSIDE one stretch -- not the whole draft.
 *
 * The draft is the period being edited, and a period can be three months. The
 * stretches are the month, quarter and year that period STARTS in. Adding the
 * whole draft to every stretch measured three months of shifts against one
 * month of contract: a draft of October to December in which somebody on forty
 * hours worked exactly their contract read "+298 h" under Month.
 *
 * So each shift counts in a stretch only if it starts inside it, from the day
 * the server starts counting that person (`start`: the latest of the stretch,
 * their contract and the first published rota) to the end of the stretch.
 * Balances from a server that sends no stretch starts get the whole draft,
 * which is what every stretch got before.
 *
 * AND IT STOPS WHERE THE CONTRACT STOPS. The end of the stretch is the wrong
 * end: the server measures `total` only as far as `horizon`, the edge of what
 * has been planned, so a draft counted to the end of the quarter puts hours in
 * the numerator whose contract is deliberately not in the denominator. The
 * manager who drafts October and December but not November would see December
 * credited against October's contract alone and read as a month over.
 *
 * The cut is the earlier of the horizon and the end of the stretch, which is
 * the window being edited intersected with the stretch -- the horizon is the
 * server's own word for where that window's measurement ends. Numerator and
 * denominator then cover the same days, which is the only arrangement in which
 * their difference means anything. Hours that fall outside are not lost: what
 * the contract asks for out there is `pending`, and the column says so.
 *
 * `reach: 'stretch'` drops the horizon and counts to the end of the stretch,
 * for the "X" of "X of Y hours", whose "Y" is the whole stretch too.
 */
export function draftHoursIn(
  draft: readonly DraftShift[] | null | undefined,
  balances:
    | {
        month_start?: string;
        quarter_start?: string;
        year_start?: string;
        employees: SpanBalances[];
      }
    | null
    | undefined,
  span: BalanceSpan,
  reach: 'horizon' | 'stretch' = 'horizon',
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!draft) return out;
  const stretchStart = balances?.[`${span}_start`];
  const stretchEnd = stretchStart ? addMonths(stretchStart, SPAN_MONTHS[span]) : null;
  // Per person, because both edges are: the contract signed on the 20th moves
  // the start, and a rota planned only to mid-November moves the end.
  const windowOf = new Map(
    (balances?.employees ?? []).map((e) => {
      const stretch = e[span];
      // Date keys are fixed-width and zero-padded, so the earlier of two is
      // the smaller string -- no parsing, no timezone to get wrong.
      const horizon = reach === 'horizon' ? (stretch.horizon ?? null) : null;
      const end =
        horizon && stretchEnd
          ? horizon < stretchEnd
            ? horizon
            : stretchEnd
          : (horizon ?? stretchEnd);
      return [e.employee_id, { from: stretch.start ?? stretchStart ?? null, end }];
    }),
  );
  for (const shift of draft) {
    const bounds = windowOf.get(shift.employeeId);
    const from = bounds?.from ?? stretchStart ?? null;
    const end = bounds ? bounds.end : stretchEnd;
    if (from && shift.date < from) continue;
    if (end && shift.date >= end) continue;
    out[shift.employeeId] = (out[shift.employeeId] ?? 0) + shift.paidHours;
  }
  return out;
}
