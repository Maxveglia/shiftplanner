// How much cover a given day and hour needs -- the single answer the whole app
// asks.
//
// Before this module the formula lived inline in four places (the generator,
// the re-audit, the below-minimum check, twice), and it could only express one
// global minimum plus ONE peak window. A brief that said "four people on
// Saturday afternoons" or "we also get busy at dinner" had nowhere to land: the
// intake understood it, wrote it into `notes`, and the generator never read it.
//
// Now the spec carries a LIST of coverage requirements, each optionally scoped
// to weekdays, to specific dates, and to a window. `needAt` takes the maximum
// of everything that matches, so requirements stack instead of overwriting.

import type { CoverageReq, DayRef, SchedulingSpec } from './types';

/** Minutes in a calendar day. The clock's boundary, not the business's. */
export const DAY_MIN = 24 * 60;

/** The weekdays this business treats as its weekend. Sunday and Saturday. */
export const DEFAULT_WEEKEND_DAYS = [0, 6];

/**
 * Does this weekday carry weekend cover, premium shifts and weekend pay?
 *
 * One function because the answer used to be `weekday === 0 || weekday === 6`
 * written out in four places -- both passes of the generator, the payroll
 * differential and the employee's own shift list -- which meant a business
 * whose weekend is Friday and Saturday could not be described at all, and
 * changing three of the four would have left the fourth quietly disagreeing
 * about what people are owed.
 */
export function isWeekendDay(
  weekday: number,
  weekendDays: number[] | undefined,
): boolean {
  return (weekendDays ?? DEFAULT_WEEKEND_DAYS).includes(weekday);
}

/**
 * The working day a wall-clock instant belongs to, as a YYYY-MM-DD key.
 *
 * Before the boundary, the working day is still yesterday's: at two in the
 * morning a bar is having Friday night, not Saturday. Everything that files a
 * SHIFT already gets this right for free, because a shift is stored under the
 * day it starts on and the generator only starts one inside the opening
 * window. This is for the questions asked about NOW -- is this shift today or
 * tomorrow, which week am I looking at -- where the only clock available is the
 * civil one.
 */
export function workingDayKey(instant: Date, boundaryMin: number | undefined): string {
  const shifted = new Date(instant);
  shifted.setMinutes(shifted.getMinutes() - (boundaryMin ?? 0));
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}-${String(
    shifted.getDate(),
  ).padStart(2, '0')}`;
}

/** Is the business shut on this day -- standing weekday closure or one date? */
export function isClosedOn(spec: SchedulingSpec, day: DayRef): boolean {
  // The weekday of a DayRef is the weekday its working day starts on, and a
  // shift is filed under the day it starts on, so "closed on Mondays" already
  // means the Monday working day even when that Monday runs to four on Tuesday
  // morning. The boundary needs no application here; saying so is the point of
  // this comment, because the obvious-looking alternative -- shifting the
  // weekday by the boundary -- would close the WRONG day for every business
  // that opens after midnight.
  if (spec.closedWeekdays.includes(day.weekday)) return true;
  return (spec.closedDates ?? []).includes(day.date);
}

export interface OpenWindow {
  openMin: number;
  closeMin: number;
}

/**
 * Opening hours for this day: the per-weekday override if there is one.
 *
 * An override that closes at or before it opens used to be DISCARDED, which
 * made "Fridays we stay open until four" impossible to state: 18:00-04:00 came
 * back as 1080 and 240, failed the test, and the day silently kept the standing
 * hours. A window that ends earlier than it starts is not a contradiction, it
 * is a night -- the same reading the shift templates have always given it (see
 * the `end += 24 * 60` in ./generate) -- so it now rolls into the next day
 * instead of being thrown away. Equal open and close is still nothing, and
 * still falls back.
 */
export function windowFor(spec: SchedulingSpec, day: DayRef): OpenWindow {
  const override = (spec.dayHours ?? []).find((d) => d.weekday === day.weekday);
  if (override && override.closeMin !== override.openMin) {
    const closeMin =
      override.closeMin > override.openMin
        ? override.closeMin
        : override.closeMin + DAY_MIN;
    return { openMin: override.openMin, closeMin };
  }
  return { openMin: spec.openMin, closeMin: spec.closeMin };
}

/** A stable key for a window, so candidate shifts are built once per shape. */
export function windowKey(w: OpenWindow): string {
  return `${w.openMin}-${w.closeMin}`;
}

/**
 * The minute at which `hour` is asked whether it is covered.
 *
 * Normally the top of the hour. But a business that opens at 19:30 has an
 * hour 19 that starts shut, and asking about 19:00 asked for somebody half an
 * hour before opening -- which no candidate can be, because every one is
 * clipped to the window. The generator found nothing covering its earliest
 * deficit and abandoned the day: a bar open 19:30-03:30 got an EMPTY month,
 * nine gaps a day, and a model-proposed rota got a phantom gap at 19:00 that
 * stopped every other hole that day from being filled.
 *
 * So the hour the business opens in is asked about at the opening minute
 * itself. Every other hour, the closing one included, keeps its top: a close
 * at 03:30 is already asked about 03:00, which is open.
 */
export function coverageMinute(w: OpenWindow, hour: number): number {
  const m = hour * 60;
  return m < w.openMin && m + 60 > w.openMin ? w.openMin : m;
}

function matches(req: CoverageReq, day: DayRef, minuteOfDay: number): boolean {
  if (req.weekdays.length > 0 && !req.weekdays.includes(day.weekday)) return false;
  if (req.dates.length > 0 && !req.dates.includes(day.date)) return false;
  // A null window means "every open hour of the days this rule applies to".
  if (req.startMin == null || req.endMin == null) return true;
  // A window may run past midnight. The intake rolls those over so `endMin`
  // lands beyond 1440, and this is asked about hours past 24 on the day the
  // window STARTS -- the same day a shift is filed under. A spec written
  // anywhere else (the local parser, a refine op, a spec persisted before any
  // of this existed) can still arrive unrolled, and an unrolled window matched
  // no minute at all: the rule did not apply, and it was not reported as a gap
  // either, because gaps are measured against this same function. Rolling it
  // here means a wrapped window is either honoured or visibly missing, never
  // silently absent.
  const endMin = req.endMin < req.startMin ? req.endMin + 1440 : req.endMin;
  return minuteOfDay >= req.startMin && minuteOfDay < endMin;
}

/**
 * People required on shift at `hour` on `day`.
 *
 * THE NARROWEST *EXACT* RULE WINS. A requirement the manager marked `exact` is
 * them being specific about that part of the day, so inside it that number is the
 * answer -- it is not raised back up by the flat floor.
 *
 * This used to be a plain maximum over everything, which could only ever push
 * cover UP. A brief asking for a DIP -- "two in the morning and two in the
 * afternoon, but only one over lunch" -- was then inexpressible: the floor of
 * two always won, so the intake understood the sentence, found nothing that
 * could hold it, and dropped it into `notes` where the generator never read
 * it. Letting the window win is what makes a valley sayable at all.
 *
 * Rules of the SAME breadth still stack by maximum, never by sum: "at least 2
 * all day" plus "4 at lunch" is four at lunch, not six. `spec.peak` counts as
 * a windowed rule, so the refine op `set_peak` keeps working alongside
 * brief-driven coverage.
 */
export function needAt(spec: SchedulingSpec, day: DayRef, hour: number): number {
  // The same minute the counters look at, so a rule starting at a 19:30
  // opening applies to the hour it opens in.
  const m = coverageMinute(windowFor(spec, day), hour);

  // A rule marked `exact` REPLACES the level in its window -- the only way to
  // ask for fewer people than the flat minimum. `spec.peak` counts as one, so
  // the refine op `set_peak` keeps behaving as it always has.
  // Two levels of exactness, resolved narrowest-first. A rule with a WINDOW is
  // the manager talking about part of a day; one without is them talking about
  // whole days. Taking a plain maximum across both breadths lets "cuatro los
  // sábados" swallow "solo uno entre la 1 y las 3" — the Saturday lunch dip
  // vanishes, on the one day it costs the most to staff.
  //
  // Within the SAME breadth, the maximum still wins: two dips in force at once
  // is a contradiction the manager did not mean to write, and resolving it
  // upwards leaves the shop covered rather than empty.
  let exactWindow: number | null = null;
  let exactAllDay: number | null = null;

  // `spec.peak` is windowed by construction, so the refine op `set_peak` keeps
  // behaving as it always has.
  if (spec.peak && m >= spec.peak.startMin && m < spec.peak.endMin) {
    exactWindow = spec.peak.staff;
  }
  for (const req of spec.coverage ?? []) {
    if (!req.exact) continue;
    const windowed = req.startMin != null && req.endMin != null;
    // A null window is not "no rule" -- `matches` reads it as every open hour
    // of the days the rule covers, which is what `CoverageReq` documents. This
    // used to skip those rules outright, so "solo cuatro los sábados" fell
    // through BOTH passes and contributed nothing: `needAt` answered with the
    // flat minimum, and because that IS the answer, no gap was reported
    // either. The shift was quietly short and the calendar looked correct.
    //
    // One exception, and it is about safety rather than shape: an exact rule
    // with no scope at all -- no window, no weekday, no date -- would replace
    // the level everywhere, which is the one way this could CUT cover across
    // the whole calendar. That is the flat minimum restated, so it falls
    // through to the floor pass. The backend already collapses it into
    // `min_staff`; this is the belt to that pair of braces.
    if (!windowed && req.weekdays.length === 0 && req.dates.length === 0) continue;
    if (!matches(req, day, m)) continue;
    if (windowed) {
      exactWindow = exactWindow == null ? req.staff : Math.max(exactWindow, req.staff);
    } else {
      exactAllDay = exactAllDay == null ? req.staff : Math.max(exactAllDay, req.staff);
    }
  }
  if (exactWindow != null) return exactWindow;
  if (exactAllDay != null) return exactAllDay;

  // Everything NOT marked exact is a floor and may only raise cover. A rule
  // with a window is not automatically an override: `exact` is what says "this
  // number REPLACES the level", and without it "at least one at closing" must
  // never cut the two people already on. `types.ts` is the contract here. "At least one at
  // closing" must never CUT the two people already on: a guarantee that
  // reduces staffing is worse than no rule at all.
  let need = spec.minStaff;
  for (const req of spec.coverage ?? []) {
    if (req.exact) continue;
    if (matches(req, day, m)) need = Math.max(need, req.staff);
  }
  return need;
}

/** Preferred length of a synthesised shift, in minutes. Clamped to 3-12 h. */
export function shiftSpanMin(spec: SchedulingSpec): number {
  const hours = spec.shiftLengthHours;
  const asked =
    hours == null || !Number.isFinite(hours)
      ? 8 * 60
      : Math.round(Math.min(12, Math.max(3, hours)) * 60);
  // A statutory day is a ceiling over what anyone asked for. Spain's nine
  // hours (art. 34.3 ET) make a ten-hour shift unlawful however the brief
  // phrased it, so the cap belongs here, where every candidate is measured,
  // rather than in one of the three places that build them.
  const legal = spec.maxDailyHours;
  if (!legal || !Number.isFinite(legal)) return asked;
  return Math.min(asked, Math.round(legal * 60));
}
