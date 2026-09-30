// Greedy schedule generator (Phase 4 "auto-fill", brought forward for the
// dashboard preview).
//
// ARCHITECTURE NOTE: this heuristic produces a DRAFT fast and predictably. In
// Phase 5 the CP-SAT solver replaces this function behind the same signature,
// and this greedy result becomes the solver's warm start. Either way the output
// is a draft the manager edits and approves -- never auto-published.

import type {
  AbsenceOut,
  AbsenceTypeOut,
  EmployeeOut,
  ShiftTemplateOut,
} from '../../types';
import { availability, contractedMinHours } from './availability';
import { shiftTemplateLabel } from '../format';
import { APP_LOCALE } from '../locale';
import { DEFAULT_OBJECTIVE } from './objective';
import { planRestDays } from './restDays';
import { statesRequirement } from './spec';
import { EMPTY_OVERLAY, blackoutKey, type ScheduleOverlay } from './overlay';
import { shiftAppearance } from './bands';
import { peopleAtHour, type CoverageSpan } from './coverage';
import { NIGHT_WORKER_MIN_HOURS, nightHoursIn, type NightWindow } from './night';
import { effectivePolicy, type PayPolicy } from './payroll';
import {
  premiumHours,
  premiumPay,
  unsocialHours,
  weekdayOfKey,
  type PremiumShift,
} from './premiums';
import { hourlyRate, type YearBasis } from './rate';
import {
  coverageMinute,
  isClosedOn,
  isWeekendDay,
  needAt,
  shiftSpanMin,
  windowFor,
  windowKey,
  type OpenWindow,
} from './demand';
import type {
  Assignment,
  CoverageGap,
  DayRef,
  ScheduleResult,
  SchedulingSpec,
} from './types';

/**
 * The week an extra hour starts after, for somebody whose contract is silent.
 *
 * Forty, because that is the statutory ordinary week both jurisdictions this
 * product has ever had happen to share -- the FLSA's threshold and art. 34.1's
 * annual average. It is a LAST resort: the contract decides, and this is only
 * what to do when there is no contract and no spec to read it from.
 */
const DEFAULT_ORDINARY_WEEK = 40;

/**
 * Where this person's ordinary week ends and an extra hour begins.
 *
 * Art. 35.1 ET: an extra hour is one worked "sobre la duracion maxima de la
 * jornada ordinaria de trabajo" -- the maximum in THIS PERSON'S contract, not
 * a constant. Reading 40 for everybody, which is what this file did, meant a
 * 20-hour contract could be worked at thirty-five every week and never show a
 * single extra hour: the only people the threshold never protected were the
 * ones furthest below it.
 *
 * The statutory week is TWO things here, and both are needed. It is the
 * fallback when the contract states no hours at all, and it is the ceiling
 * over whatever the contract does state: an ordinary week cannot be agreed
 * above the legal maximum (art. 34.1 ET), so a contract whose stated figure is
 * a 60-hour availability ceiling does not thereby make the 50th hour ordinary.
 * Without that cap this function reads a generous ceiling as a generous
 * contract and quietly stops finding overtime in exactly the rotas that have
 * the most of it -- which is what the quality bench caught when it was missing.
 *
 * The same `min(contract, statute)` the server applies in
 * `services/workday.py`. One reading, two languages.
 */
export function ordinaryWeeklyHours(
  emp: EmployeeOut,
  spec?: SchedulingSpec,
): number {
  const statutory = spec?.weeklyAverageHours ?? DEFAULT_ORDINARY_WEEK;
  const contract = contractedHours(emp);
  if (contract == null) return statutory;
  return Math.min(contract, statutory);
}

/**
 * What an overtime hour costs, as a multiple of the ordinary one.
 *
 * 1.5 is the FLSA and was written here as if it were arithmetic. It is a
 * jurisdiction: Spain has no statutory premium at all (art. 35.1 ET -- paid
 * as an ordinary hour, or given back as time off within four months), so
 * costing overtime at one and a half there overstates every rota and, worse,
 * makes the generator avoid perfectly ordinary hours as if they were dear.
 */
function overtimeMultiplier(spec: SchedulingSpec): number {
  const stated = spec.overtimeMultiplier;
  if (stated === null) return 1;
  // NOT CHANGED HERE, ON PURPOSE. An UNSTATED multiplier still falls back to
  // 1.5, and it should not: a spec that says nothing is a business in this
  // market, where there is no premium. Changing it moves the generator's
  // pinned calendars -- it stops shying away from hours nobody pays extra
  // for -- and that is a decision about how rotas are planned, not about a
  // settings form. It belongs in its own change, with the twelve scenarios
  // read one by one. Production is not affected today: the server sends
  // `null` for Spain, which is handled above.
  return stated == null || !Number.isFinite(stated) ? 1.5 : stated;
}
/*
 * There is deliberately no hard weekly ceiling constant any more.
 *
 * There used to be one, clamped over everything with `Math.min`, so a manager
 * who asked for eighty hours got forty-eight and an uncovered gap for the rest
 * -- the request was not refused, it was silently shortened, which is worse.
 * The ceiling now comes from `spec.maxHoursPerWeek` (what the brief asked for,
 * defaulting to 40), lifted by anything a contract states.
 *
 * Hours beyond someone's ordinary week are still costed at the jurisdiction's
 * multiplier and still reported as overtime. The calendar obeys; the numbers
 * keep telling the truth about what obeying costs.
 */

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function monthDays(anchor: Date): DayRef[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const out: DayRef[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    out.push({
      date: toDateKey(d),
      weekday: d.getDay(),
      label: d.toLocaleDateString(APP_LOCALE, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * `count` days starting at `anchor` itself, rather than at a boundary.
 *
 * What a manager means by "make me a calendar" when they say nothing about
 * when: the weeks in front of them. The month does not mean that -- asked on
 * the 14th it plans from the 1st, so half the period is already over and the
 * rota that comes back is a fortnight of history plus a fortnight of work.
 * This starts today and runs forwards.
 */
export function daysFrom(anchor: Date, count: number): DayRef[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + i);
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
 * The Monday on or before `d`, which is where a week starts here.
 *
 * MONDAY, and one definition for the whole product. It used to be Sunday --
 * inherited from the FLSA overtime counter this began life as -- and that
 * boundary is not a formatting preference: the weekly rest (36 unbroken
 * hours, art. 37.1 ET) is measured as the longest gap INSIDE a week, so a
 * Sunday cut sliced the weekend in two and judged the smaller half. Somebody
 * working Monday to Friday rests 64 hours and was being read as 33, which is
 * a breach that is not there -- and the product acted on it: `repair.ts`
 * dropped their Friday shift, `planRetry.ts` scored the month as failed and
 * paid for a second model call to redo it.
 *
 * Every week in the product comes from here, because two anchors would put
 * two different "week totals" on one screen. The backend has the same
 * definition, for the same reason (`services/workday.py:week_start`).
 */
export function startOfWeek(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // getDay() is Sunday=0..Saturday=6; we want days since Monday.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

export function weekDays(anchor: Date): DayRef[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
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
 * Every day of `anchor`'s year, built month by month so each day carries the
 * same label a month view would give it.
 */
export function yearDays(anchor: Date): DayRef[] {
  const year = anchor.getFullYear();
  const out: DayRef[] = [];
  for (let m = 0; m < 12; m += 1) out.push(...monthDays(new Date(year, m, 1)));
  return out;
}

/**
 * Did the brief actually ASK for a weekly maximum, or is this just the default?
 *
 * The distinction decides whether the number may override a contract. A figure
 * the manager said out loud is the most recent instruction there is, so it
 * wins; the default never should, or every part-time contract in the roster
 * would quietly be widened to it.
 */
function briefSetWeeklyMax(spec: SchedulingSpec): boolean {
  return spec.rules.some(
    (r) => r.kind === 'max_weekly_hours' && r.origin === 'parsed',
  );
}

/** The employee's contracted weekly maximum, if their contract sets one. */
export function contractCeiling(emp: EmployeeOut): number | null {
  const max = emp.current_contract?.max_hours_per_week;
  return max != null ? Number(max) : null;
}

/**
 * The hours this person's contract is FOR -- the number past which a shift is
 * "beyond contract" and shown as such.
 *
 * The maximum when the contract states one. Otherwise the minimum: a contract
 * that says "20 hours" and nothing else means twenty, not "at least twenty".
 * Reading only the maximum was how a bar with four 40-hour and two 20-hour
 * contracts came out with everybody on forty: the two part-timers' contracts
 * had a minimum of 20 and no maximum, so nothing they were given ever counted
 * as beyond anything, and the coverage pass used them like full-timers. Null
 * only when the contract states no hours at all.
 */
export function contractedHours(emp: EmployeeOut): number | null {
  const max = contractCeiling(emp);
  if (max != null) return max;
  const min = contractedMinHours(emp);
  return min > 0 ? min : null;
}

/**
 * The most hours this employee may work this week, contract aside.
 *
 * The contract is deliberately NOT a wall here. A 20-hour contract is a target,
 * not a cage: when the roster cannot cover the shop otherwise, that person can
 * pick up extra hours up to this ceiling, and those hours are marked so the
 * manager sees exactly which ones went beyond the agreement. Walling the
 * contract off instead just leaves the hours uncovered and tells nobody why.
 *
 * Nothing here clamps: whatever was actually asked for is what comes back,
 * however large. A ceiling is only a ceiling -- raising it never forces anyone
 * to work more, it just stops the generator refusing when the cover is there.
 */
export function weeklyCeiling(
  spec: SchedulingSpec,
  emp: EmployeeOut,
  overlay: ScheduleOverlay,
): number {
  const requested = overlay.caps[emp.id];
  if (requested != null) return requested;
  const contract = contractCeiling(emp);
  // A ceiling below this person's own contracted MINIMUM is a contradiction:
  // it would promise them hours the generator then refuses to give. "Marcus
  // works 80 hours a week" arrives as a minimum of 80 on his contract and no
  // maximum at all, so without this the default of 48 would quietly cap the
  // very number the manager just asked for.
  const floor = contractedMinHours(emp);
  // A maximum the brief stated applies to everyone it did not carve out, so it
  // lifts a contract that is lower rather than being capped by it.
  if (briefSetWeeklyMax(spec)) {
    return Math.max(spec.maxHoursPerWeek, contract ?? 0, floor);
  }
  // No stated maximum: the standing weekly limit is the ceiling, and someone
  // contracted ABOVE it keeps their own figure.
  return Math.max(spec.maxHoursPerWeek, contract ?? 0, floor, 0);
}

/**
 * The shortest shift worth offering somebody.
 *
 * Trimming exists so a few spare hours can still be used, not so a person is
 * called in for forty minutes. Three hours is the floor: shorter than the
 * four-hour minimum the synthesiser applies to a whole day's candidates,
 * because this one is filling the tail end of a week rather than shaping a
 * normal shift, and long enough that the trip to work is worth making.
 */
const MIN_TRIMMED_SHIFT_MIN = 3 * 60;

/**
 * The same candidate, cut down to the hours this person has left this week.
 *
 * The ceiling check used to be all or nothing: a candidate whose paid hours
 * exceeded someone's remaining week was skipped, and since every candidate for
 * a given day is the same length, "skipped" meant "this person works no more
 * this week". A shop with five people and 27.5 unspent hours on the Saturday
 * covered six of them, because the shortest shift that reached four in the
 * afternoon was seven hours and nobody had seven hours left.
 *
 * Trimming takes the tail off instead. It never extends a shift, never moves
 * its start, and returns null rather than produce something too short to be
 * worth anybody's commute -- or something that no longer covers the hour it
 * was picked to cover.
 */
function trimToRemaining(
  cand: Candidate,
  remainingHours: number,
  mustCoverMin: number,
): Candidate | null {
  const paid = (cand.endMin - cand.startMin - cand.breakMin) / 60;
  if (paid <= remainingHours) return cand;
  if (remainingHours <= 0) return null;

  // An unpaid break only exists on a long enough shift, so solve for the span
  // twice: once assuming the break survives the cut, once assuming it does not.
  const withBreak = remainingHours * 60 + cand.breakMin;
  const span = withBreak >= 6 * 60 ? withBreak : remainingHours * 60;
  const breakMin = withBreak >= 6 * 60 ? cand.breakMin : 0;
  if (span < MIN_TRIMMED_SHIFT_MIN) return null;

  const endMin = Math.min(cand.endMin, cand.startMin + span);
  // Cut past the hour it was chosen for and it stops being an answer.
  if (endMin <= mustCoverMin) return null;
  if (endMin - cand.startMin < MIN_TRIMMED_SHIFT_MIN) return null;

  return { ...cand, endMin, breakMin };
}

/**
 * Hours of a shift that land beyond `contractMax`, given hours already worked.
 *
 * The one definition of "beyond", used for both of the questions this product
 * asks with it: how many hours went past the agreement, and how many went past
 * the ordinary week an extra hour is measured from. Under Spanish law those
 * are the same line (art. 35.1), and computing them in two places is how they
 * would come to disagree on one screen.
 */
function extraBeyondContract(
  contractMax: number | null,
  already: number,
  paid: number,
): number {
  if (contractMax == null) return 0;
  return (
    Math.max(0, already + paid - contractMax) - Math.max(0, already - contractMax)
  );
}

/**
 * `count` whole months starting with the one containing `anchor`.
 *
 * This is what a brief means by "the next five months": whole months, so the
 * calendar starts at a boundary the manager recognises rather than at whatever
 * day they happened to type the brief.
 */
export function spanMonths(anchor: Date, count: number): DayRef[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const out: DayRef[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(...monthDays(new Date(year, month + i, 1)));
  }
  return out;
}

/** Monday-anchored week key, used for weekly hour accumulation. */
export function weekKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return toDateKey(startOfWeek(new Date(y, m - 1, d)));
}

/**
 * The shortest break between the two halves of ONE split day.
 *
 * Module scope, and exported, because `validateSchedule` has to judge a
 * schedule it did not build by this exact number. A second copy of it here
 * would be a second answer to "was this person given enough rest?", and the
 * two would drift.
 */
export const SPLIT_MIN_GAP = 60;

/**
 * The unpaid break on a shift with no template behind it.
 *
 * A synthetic `band-*` shift has no `unpaid_break_minutes` to read, so the
 * length decides: six hours or more earns a half hour off the clock. Exported
 * because a shift PROPOSED by the model has the same nothing to read, and if it
 * were priced without a break, the same eight-hour Tuesday would be worth half
 * an hour more when the model placed it than when the generator did -- a
 * difference the manager would eventually find in somebody's pay.
 */
export function syntheticBreakMin(spanMin: number): number {
  return spanMin >= 6 * 60 ? 30 : 0;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

interface Candidate {
  startMin: number;
  endMin: number;
  templateId: string;
  templateName: string;
  color: string;
  isNight: boolean;
  breakMin: number;
  /** True when this comes from one of the org's shift templates. */
  isTemplate: boolean;
  /** Weekend-premium templates may only be used on Sat/Sun. */
  weekendOnly: boolean;
}

/** Build the shift windows the generator may choose from for a given day. */
function candidateShifts(
  spec: SchedulingSpec,
  templates: ShiftTemplateOut[],
  win: OpenWindow,
): Candidate[] {
  // The shortest shift worth synthesising. Normally 3 h, but a manager who
  // asked for shorter shifts gets what they asked for rather than nothing.
  const span = shiftSpanMin(spec);
  const floor = Math.min(180, span);
  /*
   * A stated shift length is a requirement, not a hint.
   *
   * It used to set only the FLOOR above, so "turnos de cuatro horas" left the
   * eight-hour templates in the running -- and they always won, because the
   * score rewards resolving more uncovered hours at once (`resolved * 2`) and
   * favours templates (`isTemplate ? 6`). The manager asked for four and got
   * eight.
   *
   * That also silently swallowed the other half of the same brief: a shift
   * spanning 13:00-15:00 keeps a second person on the floor through the lunch
   * dip the manager asked to run with one. Two stated requirements lost to one
   * unstated preference for long shifts.
   *
   * So when a length is stated, it caps every candidate. Nothing is clipped
   * when the brief is silent -- the templates keep their own hours, which is
   * what a business that never mentioned shift length expects.
   */
  // A length the brief stated caps every candidate -- and so does a statutory
  // day, for the same reason and with more force: without this the templates
  // keep their own hours and a ten-hour night survives the cap that exists to
  // forbid it.
  const capped = spec.shiftLengthHours != null || spec.maxDailyHours != null;
  const out: Candidate[] = [];
  const seen = new Set<string>();
  /**
   * A night may be shorter than the day it sits in.
   *
   * Art. 36.1 ET caps a night worker's day at eight hours on average, and a
   * rota that hands the same person a ten-hour closing shift every Friday is
   * not an average, it is a habit. So a candidate that is night work is cut
   * to the cap before anyone is offered it -- from the END, because the hour
   * the business needs covered first is the one it opens with, and whoever
   * takes the tail is a second person rather than the same one staying on.
   */
  const clipNight = (c: Candidate): Candidate => {
    const cap = spec.nightAverageMax;
    if (!cap || !spec.nightWindow) return c;
    if (nightHoursIn(c.startMin, c.endMin, spec.nightWindow) < NIGHT_WORKER_MIN_HOURS) {
      return c;
    }
    const most = Math.round(cap * 60);
    return c.endMin - c.startMin <= most
      ? c
      : { ...c, endMin: c.startMin + most };
  };

  const push = (raw: Candidate) => {
    const c = clipNight(raw);
    // `weekendOnly` is part of the identity, not decoration. Once capping
    // clips every template to the same length, two templates that share a
    // start time collapse to the same window — and if the weekend-premium one
    // arrived first, the weekday band it swallowed disappears from every
    // weekday, leaving a coverage hole nothing on screen explains.
    const key = `${c.startMin}-${c.endMin}-${c.weekendOnly ? 'w' : ''}`;
    if (!seen.has(key) && c.endMin - c.startMin >= floor) {
      seen.add(key);
      out.push(c);
    }
  };

  for (const t of templates) {
    let start = parseHHMM(t.start_time);
    let end = parseHHMM(t.end_time);
    if (end <= start) end += 24 * 60; // crosses midnight
    // Clip to the opening window.
    const s = Math.max(start, win.openMin);
    const e = capped
      ? Math.min(end, win.closeMin, s + span)
      : Math.min(end, win.closeMin);
    if (e - s >= floor) {
      // Appearance is decided by the time of day, never by the template's own
      // colour, so the same hours always render identically.
      //
      // The NAME goes through `shiftTemplateLabel` for the same reason the
      // published calendar does: the three templates seeded with every new
      // organisation are ours, written in English in the database, and a
      // freshly generated calendar was the last place they still leaked --
      // an "Evening" bar sitting beside a "Tarde-noche" one, in the same week,
      // because the second was synthesised and took its name from the band.
      // A template the manager renamed keeps his words, here as everywhere.
      const look = shiftAppearance(s, e, shiftTemplateLabel(t));
      push({
        startMin: s,
        endMin: e,
        templateId: t.id,
        templateName: look.label,
        color: look.color,
        isNight: look.isNight,
        // The break belongs to the shift that is actually worked, not to the
        // template it came from. A four-hour shift clipped out of an
        // eight-hour template with an hour's break would pay three — the
        // manager asked for shorter shifts, not for unpaid time. Uncapped
        // templates keep their own break, which is the agreement they encode.
        breakMin:
          capped && e - s < end - start
            ? Math.round((t.unpaid_break_minutes * (e - s)) / (end - start))
            : t.unpaid_break_minutes,
        isTemplate: true,
        weekendOnly: t.is_weekend_premium,
      });
    }
  }

  // Synthesised fallbacks so coverage can always be attempted, even when no
  // template lines up with the manager's opening hours. Their identity comes
  // from the time band -- no guessing which template they resemble.
  const step = Math.min(120, span);
  const synthesise = (s: number, e: number) => {
    if (e - s < Math.min(240, span)) return;
    const look = shiftAppearance(s, e);
    push({
      startMin: s,
      endMin: e,
      templateId: `band-${look.bandKey}`,
      templateName: look.label,
      color: look.color,
      isNight: look.isNight,
      breakMin: syntheticBreakMin(e - s),
      isTemplate: false,
      weekendOnly: false,
    });
  };

  for (let s = win.openMin; s < win.closeMin; s += step) {
    synthesise(s, Math.min(s + span, win.closeMin));
  }

  /*
   * One candidate that ENDS exactly at closing, always.
   *
   * The walk above starts at opening and steps forward, so its last few
   * candidates get clipped to the close and dropped for being too short --
   * with a 13-hour day and four-hour shifts, nothing offered covers 21:00 to
   * 22:00. Until shift length was honoured this was hidden: a long template
   * clipped to the close happened to reach the end of the day. It was never
   * covered on purpose, and any business whose open hours are not a whole
   * number of steps had the same hole waiting.
   *
   * Closing is exactly where a brief is most likely to have made a promise
   * ("siempre tiene que haber al menos una persona al cierre"), so it gets a
   * candidate of its own rather than one that happens to fit.
   */
  synthesise(Math.max(win.openMin, win.closeMin - span), win.closeMin);

  return out;
}

/**
 * What the generator compares people by when a contract states no pay. Not
 * zero: a person who costs nothing would win every hour.
 */
const UNSTATED_RATE = 20;

/** Salaried exempt staff are a sunk cost: scheduling them adds no marginal cost. */
function isSunkCost(e: EmployeeOut): boolean {
  return e.current_contract?.employment_type === 'exempt_salaried';
}

/**
 * What working a planned day off costs in the coverage pass.
 *
 * Far above anything a wage or a fairness term can add up to, so the day off
 * gives way only when nobody else can legally take the hour -- a gap is worse
 * than a moved day off, and the weekly-rest check still has the last word.
 */
const PLANNED_REST_PENALTY = 1000;

/**
 * What one person's hour costs, and what their premiums are.
 *
 * Two answers, depending on whether the caller handed over the business's pay
 * policy. Without one, exactly what this file always priced: the contract
 * rate, overtime at the spec's multiplier, and no premium at all -- every
 * caller written before premiums reached the generator gets the calendar and
 * the totals it always got. With one, the same figures payroll pays
 * (`effectivePolicy`): the person's own overtime multiplier and their own
 * night and weekend premiums, their contract's where it states one and the
 * business's where it does not. A generator that booked overtime at one
 * multiplier while payroll paid another would be two totals for one rota.
 */
interface PersonPrice {
  rate: number;
  otRate: number;
  /** Their premiums, or null when no pay policy was given: book none. */
  premiums: PayPolicy | null;
  /** Exempt salaried: paid regardless, so nothing here costs anything. */
  sunk: boolean;
}

function priceFor(
  emp: EmployeeOut,
  year: YearBasis,
  otRateWithoutPolicy: number,
  payPolicy: PayPolicy | undefined,
): PersonPrice {
  const own = payPolicy ? effectivePolicy(emp, payPolicy) : null;
  return {
    rate: hourlyRate(emp, year, UNSTATED_RATE),
    otRate: own ? own.overtimeMultiplier : otRateWithoutPolicy,
    premiums: own,
    sunk: isSunkCost(emp),
  };
}

/** The euros one shift's night and weekend hours add, for this person. */
function premiumCost(
  price: PersonPrice,
  shift: PremiumShift,
  weekday: number | undefined,
  nightWindow: NightWindow | null | undefined,
  weekendDays: number[] | undefined,
): number {
  if (price.sunk || !price.premiums) return 0;
  return premiumPay(
    premiumHours(shift, weekday, nightWindow, weekendDays),
    price.rate,
    price.premiums,
  );
}

/**
 * How close two scores have to be to count as the same score.
 *
 * RELATIVE, because the scores are not one size. A day shift for somebody
 * fresh scores in the tens; the same shift on their planned day off carries
 * PLANNED_REST_PENALTY and scores past a thousand. What has to be told apart
 * from a tie is float noise -- the same fifteen terms added in a different
 * order, which differs in about the sixteenth significant digit -- and what
 * must never be mistaken for one is a real difference. The smallest real
 * difference the objective can produce is a weight of 0.01 on a minute's
 * worth of money (`wageSensitivityWhenToppingUp` on 1/60 h at the €20 the
 * generator assumes when nobody states a rate): about 3e-3, which against a
 * score of a thousand is 3e-6 relative. One part in a billion sits three
 * orders of magnitude under the smallest real difference and six over the
 * noise, and that margin on both sides is the whole reason to pick it.
 */
const SCORE_TIE = 1e-9;

/** The part of a candidate the ranking reads. */
interface Ranked {
  score: number;
  /** What the candidate's night and weekend premiums would cost, in euros. */
  premium: number;
}

/**
 * Does `a` beat `b`? Score first; premiums only between equal scores.
 *
 * "El coste pesa pero no manda." Everything the manager asked for -- cover,
 * contracts, fairness, the planned day off -- is in the score, and a premium
 * is not. Adding it would make it one more weight among the fifteen, and the
 * owner's example shows what that weight buys: Marta is paid 25% at night and
 * Juan is not, they cost the same by day, and a score that saw the premium
 * would hand Juan every night of the month because every night he is cheaper.
 * Nobody asked for that rota, and no fairness weight small enough to leave
 * the rest of the score alone would undo it.
 *
 * So the premium is compared AFTER the score, lexicographically: of two
 * candidates the manager's own terms cannot tell apart, the one whose premiums
 * cost less is taken. That is the only thing money is allowed to decide here.
 *
 * When the premiums tie as well -- always, when no pay policy was given -- the
 * raw scores are compared exactly as they were before this function existed,
 * down to the float noise the tolerance above ignores. That is what makes a
 * caller that passes no policy get the same calendar to the assignment.
 */
function beats(a: Ranked, b: Ranked): boolean {
  const tie = SCORE_TIE * Math.max(1, Math.abs(a.score), Math.abs(b.score));
  if (Math.abs(a.score - b.score) > tie) return a.score < b.score;
  const premiumTie = SCORE_TIE * Math.max(1, Math.abs(a.premium), Math.abs(b.premium));
  if (Math.abs(a.premium - b.premium) > premiumTie) return a.premium < b.premium;
  return a.score < b.score;
}

export function generateSchedule(
  employees: EmployeeOut[],
  templates: ShiftTemplateOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  spec: SchedulingSpec,
  days: DayRef[],
  overlay: ScheduleOverlay = EMPTY_OVERLAY,
  /**
   * The business's pay policy, to book premiums and per-person overtime.
   *
   * Optional, and absent means "price exactly as before": no premiums, and
   * overtime at the spec's multiplier. The dashboard passes the org's own
   * policy, so what a generated rota says it costs is what payroll pays.
   * It never changes WHO is chosen except to break a tie -- see `beats`.
   */
  payPolicy?: PayPolicy,
): ScheduleResult {
  const roster = employees;
  // What counts as a good rota, for this business. Resolved once: a spec built
  // by a backend that predates the field carries none, and the calendar it gets
  // has to be the one it has always got.
  const obj = spec.objective ?? DEFAULT_OBJECTIVE;
  // Read with a fallback rather than trusted, because an objective is data: a
  // spec saved before this weight existed carries the other fifteen and not
  // this one, and an undefined weight turns every score into NaN -- which
  // compares false against everything and silently places nobody.
  const spreadUnsocial = obj.spreadUnsocial ?? DEFAULT_OBJECTIVE.spreadUnsocial;
  // Replay the manager's decisions FIRST, then let the greedy pass fill what
  // is still uncovered around them. This is what makes an adjustment survive a
  // later change of requirements.
  const inPeriod = new Set(days.map((d) => d.date));
  const assignments: Assignment[] = overlay.pinned.filter((a) =>
    inPeriod.has(a.date),
  );
  const blackouts = new Set(overlay.blackouts);
  const gaps: CoverageGap[] = [];
  /** What an overtime hour costs here, as a multiple of the ordinary one. */
  const otRate = overtimeMultiplier(spec);
  const weeklyHours: Record<string, number> = {}; // `${empId}|${weekKey}`
  const hoursByEmployee: Record<string, number> = {};
  /**
   * Night plus weekend hours each person has been given so far this period.
   *
   * Kept beside `hoursByEmployee` and moved wherever it moves, so both passes
   * can share the hours nobody would pick out as evenly as they share hours at
   * all. Counted by `premiumHours`, the definition payroll pays on -- see
   * ./premiums.
   */
  const unsocialByEmployee: Record<string, number> = {};
  const weekdayByDate = new Map(days.map((d) => [d.date, d.weekday]));
  /** A shift's unsocial hours, on the day it starts. */
  const unsocialOf = (date: string, shift: PremiumShift): number =>
    unsocialHours(
      premiumHours(shift, weekdayByDate.get(date), spec.nightWindow, spec.weekendDays),
    );
  /**
   * What giving this person this shift adds to the score for unsocial hours.
   *
   * Per unsocial hour of THIS shift, scaled by the SHARE of this person's
   * hours so far that were unsocial -- not by how many unsocial hours they
   * have. The difference is the part-timer. Counted in hours, the person with
   * a 16-hour contract always has the fewest nights, so every night looks
   * like theirs: on the bar in contractFirst.test.ts that pushed Diego from
   * 16 contracted hours to 24 worked, which is not sharing the nights out,
   * it is handing them to whoever is paid for fewest hours. Counted as a
   * share, somebody who works two nights out of two is further from fair
   * than somebody who works four out of ten, and a bar where every hour is
   * night work has nothing to rebalance and leaves the contracts alone.
   *
   * Only the unsocial part of the shift on offer carries it: a Tuesday
   * afternoon is not a reason to keep somebody who worked last Saturday off
   * the rota. A Saturday night counts both ways, which is what it is.
   */
  const unsocialPenalty = (empId: string, unsocial: number): number => {
    const worked = hoursByEmployee[empId] ?? 0;
    if (worked <= 0 || unsocial <= 0) return 0;
    return ((unsocialByEmployee[empId] ?? 0) / worked) * unsocial * spreadUnsocial;
  };
  const priceCache = new Map<string, PersonPrice>();
  const priceOf = (emp: EmployeeOut): PersonPrice => {
    let price = priceCache.get(emp.id);
    if (!price) {
      price = priceFor(emp, spec, otRate, payPolicy);
      priceCache.set(emp.id, price);
    }
    return price;
  };
  /**
   * What an hour costs on this roster, on average: the price the coverage pass
   * puts on buying one more hour, whoever works it.
   *
   * The wage used to enter the score once, as each candidate's own bill, and
   * that one number was doing two jobs. It decided HOW MANY hours to buy -- a
   * longer shift costs more than a shorter one for the same gap, which is what
   * stops the pass handing out nine-hour bands where four would do -- and it
   * decided WHO works them, because the same shift costs less on a cheaper
   * person. The owner wants the first and not the second: "que el coste pese
   * pero no mande; que manden las indicaciones que da el manager". So the
   * bill is split in two. Every hour bought is priced at this average and
   * weighed by `wageSensitivity`, exactly as hard as before; what one person
   * costs ABOVE or BELOW it is weighed by `preferCheaperPeople`, which is the
   * part that picks a person and the part that was turned down.
   *
   * The two add back up to the old term when the weights are equal -- average
   * plus difference is the person's own rate -- which is how `cheapest` keeps
   * the calendars it was measured on. On a roster where everybody is paid the
   * same the difference is zero and nothing about the split can move a shift.
   *
   * Lowering `wageSensitivity` instead was measured first and rejected: it
   * lets go of the length brake along with the choice of person, and the
   * house-templates shop went from 182 paid hours to 236 at 0.2 -- the same
   * cover bought with fifty-four hours nobody needed. Moving the whole wage
   * into the tie-break, beside the premiums, is the same thing taken to zero.
   *
   * Salaried staff are left out of the average. Their hours are already paid
   * (`isSunkCost`), they are charged nothing below, and averaging a zero in
   * would make every hourly person look dear by comparison.
   */
  const teamRate = (() => {
    const rates = roster.filter((e) => !isSunkCost(e)).map((e) => priceOf(e).rate);
    return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : UNSTATED_RATE;
  })();
  // Read with a fallback, like `spreadUnsocial`, and the fallback is the
  // objective's own `wageSensitivity`: an objective written before the split
  // weighed the average and the difference as one number, so reading it that
  // way rebuilds exactly the calendar it was saved with instead of NaN.
  const preferCheaperPeople = obj.preferCheaperPeople ?? obj.wageSensitivity;
  /** Absolute end time of each employee's last shift, for rest checks. */
  const lastEnd: Record<string, number> = {};
  /**
   * Every shift placed so far, by person and week, for the WEEKLY rest.
   *
   * The daily rest above needs one number -- when they last finished. A day
   * and a half off (art. 37.1 ET) is a property of the whole week: it can be
   * satisfied by Sunday plus Monday morning, or by a Wednesday nobody worked,
   * and the only way to know whether a candidate still leaves room for it is
   * to look at the week as a whole.
   */
  const weekShifts: Record<string, { start: number; end: number }[]> = {};

  /**
   * Would this shift leave the week with no unbroken rest of the required
   * length? Days nobody works count -- they are the usual way it is met.
   *
   * `weekStart` is the week's first minute on the same relative clock the
   * rest of this function uses, passed in rather than derived: the Sunday a
   * week begins on is often before the period, so there is no day to look its
   * index up from.
   */
  const breaksWeeklyRest = (
    empId: string,
    weekStartKey: string,
    weekStart: number,
    start: number,
    end: number,
  ): boolean => {
    const required = spec.weeklyRestHours;
    if (!required) return false;
    const weekEnd = weekStart + 7 * 24 * 60;
    const placed = [
      ...(weekShifts[`${empId}|${weekStartKey}`] ?? []),
      { start, end },
    ].sort((a, b) => a.start - b.start);
    let longest = 0;
    let previousEnd = weekStart;
    for (const shift of placed) {
      longest = Math.max(longest, shift.start - previousEnd);
      previousEnd = Math.max(previousEnd, shift.end);
    }
    longest = Math.max(longest, weekEnd - previousEnd);
    return longest < required * 60;
  };
  let seq = 0;

  // A split day is two shifts with a gap between them, so the between-DAYS rest
  // rule cannot apply inside one day -- 11 hours of rest between a morning and
  // an afternoon shift is a contradiction. A short break between the halves is
  // required instead.
  /*
   * HOW MANY people may work a split day, per day. Not whether.
   *
   * This used to be a boolean, and a boolean is the wrong shape for what a
   * manager means. "Puede haber gente que haga turnos partidos" permits a
   * split; it does not ask for a rota where everybody works two halves every
   * day, which is what an unlimited flag produced. Allowing something is not
   * requesting it.
   *
   * So the brief carries a COUNT: what the manager said, or one when they
   * permitted splits without saying how many. Zero means nobody, which is
   * still the default for a brief that never raises the subject.
   */
  const splitCap = Math.max(
    0,
    spec.splitShiftPeople ?? (spec.allowSplitShifts === true ? 1 : 0),
  );

  /*
   * A second shift is a LAST RESORT, and that has to be an ORDER, not a score.
   *
   * The first attempt was a flat penalty added to the score. It does not hold:
   * the dominant term is `cost / resolved`, which scales with the hourly wage,
   * so on a roster of €10 and €90 people the penalty was swallowed whole —
   * three cheap employees got split days while three expensive ones got no
   * shifts at all. No constant is safe when the thing it competes with is
   * somebody's pay rate.
   *
   * So the two are ranked separately and a first shift always wins. A split is
   * only reached for when nobody at all could legally take the hour — which is
   * exactly the valley the manager was thinking of when they allowed it, and
   * is now true whatever anyone earns.
   */

  const dayIndex = new Map(days.map((d, i) => [d.date, i]));
  const abs = (dateKey: string, min: number) =>
    (dayIndex.get(dateKey) ?? 0) * 24 * 60 + min;

  // Pinned shifts already consume hours and already provide cover, so the
  // greedy pass has to start from them rather than from zero.
  const pinnedByDate = new Map<string, Assignment[]>();
  const pinnedEnds = new Map<string, { day: number; end: number }[]>();
  for (const a of assignments) {
    weeklyHours[`${a.employeeId}|${weekKey(a.date)}`] =
      (weeklyHours[`${a.employeeId}|${weekKey(a.date)}`] ?? 0) + a.paidHours;
    hoursByEmployee[a.employeeId] =
      (hoursByEmployee[a.employeeId] ?? 0) + a.paidHours;
    unsocialByEmployee[a.employeeId] =
      (unsocialByEmployee[a.employeeId] ?? 0) + unsocialOf(a.date, a);
    // Pinned ends are kept WITH the day they belong to, not merged into one
    // running maximum. Merging them meant a shift the manager pinned on the
    // 11th became the "previous shift" for the 7th: the rest check then read a
    // negative gap and refused that person every day before the pin, silently.
    // The generated pass moves forward in time, so its own `lastEnd` is always
    // in the past and needs no such care.
    const ends = pinnedEnds.get(a.employeeId) ?? [];
    ends.push({ day: dayIndex.get(a.date) ?? 0, end: abs(a.date, a.endMin) });
    pinnedEnds.set(a.employeeId, ends);
    // A pin is a shift the week has to rest around like any other: without
    // this, a week the manager filled by hand looks empty to the weekly-rest
    // check and the generator piles on top of it.
    const pinnedWeek = `${a.employeeId}|${weekKey(a.date)}`;
    weekShifts[pinnedWeek] = [
      ...(weekShifts[pinnedWeek] ?? []),
      { start: abs(a.date, a.startMin), end: abs(a.date, a.endMin) },
    ];
    const list = pinnedByDate.get(a.date) ?? [];
    list.push(a);
    pinnedByDate.set(a.date, list);
  }

  // Opening hours can differ by weekday, so the shifts on offer differ too --
  // built once per distinct window rather than once per day.
  const candidatesByWindow = new Map<string, Candidate[]>();
  const candidatesFor = (win: OpenWindow): Candidate[] => {
    const key = windowKey(win);
    let list = candidatesByWindow.get(key);
    if (!list) {
      list = candidateShifts(spec, templates, win);
      candidatesByWindow.set(key, list);
    }
    return list;
  };

  // How far into its own week each open day sits, and how many open days that
  // week has. Both are needed by the second pass to know whether it is spending
  // hours the days still to come are going to want -- see PACING below.
  const openDaysInWeek = new Map<string, number>();
  const openDayOrdinal = new Map<string, number>();
  const asked = statesRequirement(spec);
  for (const d of days) {
    if (isClosedOn(spec, d)) continue;
    const k = weekKey(d.date);
    const n = (openDaysInWeek.get(k) ?? 0) + 1;
    openDaysInWeek.set(k, n);
    openDayOrdinal.set(d.date, n);
  }

  // Each person's day off, planned per week before any shift is placed -- see
  // ./restDays for the Friday it was written for. Keyed `${empId}|${date}`.
  const restDay = new Set<string>();
  const byWeek = new Map<string, DayRef[]>();
  for (const d of days) {
    const k = weekKey(d.date);
    byWeek.set(k, [...(byWeek.get(k) ?? []), d]);
  }
  for (const week of byWeek.values()) {
    for (const [empId, date] of planRestDays(spec, roster, week)) {
      restDay.add(`${empId}|${date}`);
    }
  }

  for (const day of days) {
    if (isClosedOn(spec, day)) continue;

    const wk = weekKey(day.date);
    const dayIdx = dayIndex.get(day.date) ?? 0;
    const openTotal = openDaysInWeek.get(wk) ?? 1;
    const openSoFar = openDayOrdinal.get(day.date) ?? openTotal;

    /**
     * When this person last finished, as of the day being filled.
     *
     * Generated shifts and pins ON OR BEFORE today count; a pin on a LATER day
     * does not, because it has not happened yet from this day's point of view.
     * Same-day ends are kept, so the two halves of a split still have to leave
     * a gap between them and can never overlap.
     */
    const restAnchor = (id: string): number | null => {
      let best = lastEnd[id] ?? null;
      for (const { day: d, end } of pinnedEnds.get(id) ?? []) {
        if (d <= dayIdx && (best == null || end > best)) best = end;
      }
      return best;
    };
    // The Sunday this week began on, which may be before the period: derived
    // from the day's own weekday rather than looked up, so a period starting
    // mid-week still measures its weeks whole.
    const weekStartAbs = (dayIdx - day.weekday) * 24 * 60;
    const win = windowFor(spec, day);
    const candidates = candidatesFor(win);
    const openHour = Math.floor(win.openMin / 60);
    const closeHour = Math.ceil(win.closeMin / 60);
    /** The minute each hour's cover is counted at -- see `coverageMinute`. */
    const at = (h: number): number => coverageMinute(win, h);
    const cover: Record<number, number> = {};
    for (let h = openHour; h < closeHour; h += 1) cover[h] = 0;

    // Seed today's state from whatever the manager already pinned here.
    const todaysPins = pinnedByDate.get(day.date) ?? [];
    // Counted, not just recorded: the cap is about how many people are on a
    // split today, so a set of "who worked" cannot answer it.
    const shiftsToday = new Map<string, number>();
    for (const a of todaysPins) {
      shiftsToday.set(a.employeeId, (shiftsToday.get(a.employeeId) ?? 0) + 1);
    }
    let splitPeopleToday = 0;
    for (const n of shiftsToday.values()) if (n >= 2) splitPeopleToday += 1;

    const worksAgainToday = (id: string): boolean => {
      const already = shiftsToday.get(id) ?? 0;
      if (already === 0) return true; // their first shift of the day
      if (splitCap <= 0) return false; // splits were never allowed
      if (already >= 2) return false; // a split is two halves, never three
      return splitPeopleToday < splitCap; // today's allowance is spent
    };

    const recordShift = (id: string) => {
      const already = shiftsToday.get(id) ?? 0;
      if (already === 1) splitPeopleToday += 1;
      shiftsToday.set(id, already + 1);
    };
    for (const a of todaysPins) {
      for (let h = openHour; h < closeHour; h += 1) {
        if (a.startMin <= at(h) && a.endMin > at(h)) cover[h] += 1;
      }
    }

    const need = (h: number): number => needAt(spec, day, h);

    // Greedily fill the earliest uncovered hour until coverage is met.
    for (let guard = 0; guard < 200; guard += 1) {
      let deficitHour = -1;
      for (let h = openHour; h < closeHour; h += 1) {
        if (cover[h] < need(h)) {
          deficitHour = h;
          break;
        }
      }
      if (deficitHour === -1) break;

      const isWeekend = isWeekendDay(day.weekday, spec.weekendDays);
      const covering = candidates.filter(
        (c) =>
          c.startMin <= at(deficitHour) &&
          c.endMin > at(deficitHour) &&
          (!c.weekendOnly || isWeekend),
      );
      if (covering.length === 0) break;

      // The hole this pick is answering: the earliest short hour and every
      // short hour straight after it. A shift is judged below by how much of
      // THIS run it closes, not only by how many short hours it touches.
      const run: number[] = [];
      for (let h = deficitHour; h < closeHour && cover[h] < need(h); h += 1) {
        run.push(h);
      }

      // Ranked apart, so no wage can buy a split ahead of somebody's first
      // shift. `bestSplit` is consulted only when `bestFirst` is empty.
      //
      // `reach` is how many hours of `run` the shift covers; `extra` is how
      // many of its hours land beyond this person's contract.
      type Choice = {
        emp: EmployeeOut;
        cand: Candidate;
        reach: number;
        extra: number;
      } & Ranked;
      const firsts: Choice[] = [];
      const splits: Choice[] = [];
      // The best of a pool by score -- unless the winner takes somebody past
      // their contract while somebody else could have closed as much of the
      // hole inside theirs. Then the best of THOSE wins instead.
      //
      // A weight could not say this. `respectContract` is a price per hour
      // beyond, and on the bar in contractFirst.test.ts it was up against
      // `spreadHours`, which the `fair` profile multiplies by everything a
      // person has worked since the period began: by the fourth Sunday the
      // sixteen-hour contract was 78 hours behind a forty-hour one, 390
      // points of "fairness" that no per-hour price short of absurd outbids.
      // So the forty-hour person with 5.5 hours of their week left sat at
      // home, and the sixteen-hour one closed the bar at 24 hours. "Que manden
      // las indicaciones del manager": the cover comes first, the contract
      // second, and sharing hours out is a preference between people who are
      // both INSIDE theirs -- it does not get to buy one of them past it.
      // Nothing is taken off the table: when nobody inside their contract
      // reaches as far, the score's own winner stands.
      const pick = (pool: Choice[]): Choice | null => {
        let top: Choice | null = null;
        for (const c of pool) if (!top || beats(c, top)) top = c;
        if (!top || top.extra <= 0) return top;
        let within: Choice | null = null;
        for (const c of pool) {
          if (c.extra > 0 || c.reach < top.reach) continue;
          if (!within || beats(c, within)) within = c;
        }
        return within ?? top;
      };

      for (const emp of roster) {
        // One shift a day unless the brief allowed split shifts.
        if (!worksAgainToday(emp.id)) continue;
        // The manager explicitly emptied this slot; never refill it.
        if (blackouts.has(blackoutKey(emp.id, day.date))) continue;

        // Status, hire date, contract window and absences -- all read from the
        // employee record, via the same function the UI uses to explain it.
        const avail = availability(emp, absences, absenceTypes, day.date);
        if (!avail.ok) continue;

        const key = `${emp.id}|${wk}`;
        const already = weeklyHours[key] ?? 0;
        const ceiling = weeklyCeiling(spec, emp, overlay);

        // This person's legal options, held until all of them are known: how
        // far into the hole the longest one reaches decides what the others
        // are allowed to be paid for (see `padding`).
        const mine: { choice: Choice; padding: number }[] = [];
        let mineReach = 0;

        for (const raw of covering) {
          // Somebody with four spare hours is not somebody who cannot work:
          // offer them the same shift, cut to what their week has left.
          const cand = trimToRemaining(raw, ceiling - already, at(deficitHour));
          if (!cand) continue;
          const span = cand.endMin - cand.startMin;
          const paid = (span - cand.breakMin) / 60;
          if (already + paid > ceiling) continue;
          // Onboarding ramp-up: shorter days, and never a night shift.
          if (avail.maxHoursToday != null && paid > avail.maxHoursToday) continue;
          if (cand.isNight && !avail.nightsAllowed) continue;

          // Minimum rest since the previous shift.
          const startAbs = abs(day.date, cand.startMin);
          const prevEnd = restAnchor(emp.id);
          // Between DAYS the rest rule applies in full. Between the two halves
          // of one split day it cannot: eleven hours between a morning and an
          // afternoon shift is a contradiction, so a short break stands in.
          //
          // Whether this is a second half is asked of the shift COUNT, not of
          // the clock. Comparing the previous end against the start of today
          // gives the right answer only while nothing crosses midnight: a night
          // that finishes at four ends after today began, so yesterday's night
          // read as the first half of today's split and bought the eleven-hour
          // rest down to sixty minutes -- on the one rule that exists so nobody
          // is sent home at four and called back at six. `shiftsToday` is keyed
          // on the day a shift STARTS, which is the day it belongs to, and it is
          // the same value the split-versus-first decision below already trusts.
          const alreadyWorkedToday = (shiftsToday.get(emp.id) ?? 0) > 0;
          const requiredGap =
            splitCap > 0 && alreadyWorkedToday
              ? SPLIT_MIN_GAP
              : spec.minRestHours * 60;
          if (prevEnd != null && startAbs - prevEnd < requiredGap) {
            continue;
          }
          // And the week's own day and a half (art. 37.1 ET where it applies).
          if (
            breaksWeeklyRest(
              emp.id,
              wk,
              weekStartAbs,
              startAbs,
              abs(day.date, cand.endMin),
            )
          ) {
            continue;
          }

          // And the week's own day and a half. Checked before the shift is
          // scored rather than after it is placed: a rota that has to be
          // undone is one the manager watches flicker.
          if (
            breaksWeeklyRest(
              emp.id,
              wk,
              weekStartAbs,
              startAbs,
              abs(day.date, cand.endMin),
            )
          ) {
            continue;
          }

          // How much of the current deficit this shift actually resolves.
          let resolved = 0;
          for (let h = openHour; h < closeHour; h += 1) {
            if (cover[h] < need(h) && cand.startMin <= at(h) && cand.endMin > at(h)) {
              resolved += 1;
            }
          }
          if (resolved === 0) continue;

          const ordinary = ordinaryWeeklyHours(emp, spec);
          const otHours = Math.max(
            0,
            Math.min(already + paid, ceiling) - Math.max(already, ordinary),
          );
          const price = priceOf(emp);
          const { rate, sunk } = price;
          // Hours inside what this person's contract still owes are paid
          // whether or not they are worked, so they cost nothing EXTRA.
          // Charging them made the coverage pass pick the shortest shift that
          // closed the gap every time -- 23:00-03:00 over 19:00-03:00 -- and a
          // forty-hour week built from four-hour shifts ends at 36.
          //
          // Owed BY TODAY, not by the end of the week: the contract spread
          // evenly over the week's open days. Counting the whole week as owed
          // on Sunday spent it by Thursday and left the last day of a shop's
          // week uncovered (lastDayOfWeek.test.ts caught exactly that).
          const contracted = contractedMinHours(emp);
          const owed = Math.max(
            0,
            Math.min(contracted, (contracted * openSoFar) / openTotal) - already,
          );
          const withinContract = Math.min(paid - otHours, owed);
          // The hours this shift actually adds to the bill, an overtime hour
          // counted at its multiplier. Priced below twice -- at the roster's
          // average and at this person's difference from it -- see `teamRate`.
          const chargedHours = sunk
            ? 0
            : paid - otHours - withinContract + price.otRate * otHours;
          const overCap = Math.max(0, already + paid - spec.maxHoursPerWeek);
          // Going beyond someone's contract is allowed but never preferred:
          // penalise it so anyone with contracted room left is chosen first,
          // and the agreement is only stretched when the alternative is a gap.
          const extra = extraBeyondContract(contractedHours(emp), already, paid);

          // Lower is better: cost per useful hour, plus fairness and
          // overtime/soft-cap penalties. Every weight comes from the objective
          // -- see ./objective for what each one means and what it was.
          const fairness = (hoursByEmployee[emp.id] ?? 0) * obj.spreadHours;
          // Contracted minimum hours are a promise: prioritise anyone still
          // short of theirs this week, proportional to how far short they are.
          const weeklyMin = contractedMinHours(emp);
          const shortfall = Math.max(0, weeklyMin - already);
          // A pending (not yet approved) time-off request is a soft signal:
          // schedule around it when there is any alternative.
          const pendingPenalty = avail.pendingAbsence
            ? obj.protectPendingTimeOff
            : 0;
          // What this person's week is worth by the end of today, if their
          // hours were spread evenly across the days the business opens. Going
          // past it is allowed -- some days genuinely need a long shift -- but
          // it is the capacity Saturday was going to need.
          const paceCap = (ceiling * openSoFar) / openTotal;
          const paceOver = Math.max(0, already + paid - paceCap);
          const shape: PremiumShift = {
            startMin: cand.startMin,
            endMin: cand.endMin,
            paidHours: paid,
          };
          const score =
            ((chargedHours * teamRate) / resolved) * obj.wageSensitivity +
            ((chargedHours * (rate - teamRate)) / resolved) * preferCheaperPeople +
            fairness +
            // Nights and weekends shared out, by default and not only when a
            // profile asks: see `spreadUnsocial` in ./objective.
            unsocialPenalty(emp.id, unsocialOf(day.date, shape)) +
            otHours * obj.overtimeAversion +
            extra * obj.respectContract +
            overCap * obj.respectWeeklyCap +
            paceOver * obj.keepHoursForLaterDays +
            pendingPenalty +
            // Their planned day off. Not a wall: if nobody else can take the
            // hour, they still can, and the weekly-rest check above decides.
            (restDay.has(`${emp.id}|${day.date}`) ? PLANNED_REST_PENALTY : 0) -
            shortfall * obj.honourContractedMinimum -
            // And every hour of this shift that delivers the contract counts
            // for it, so a longer shift for somebody still owed hours beats a
            // shorter one for the same gap.
            withinContract * obj.honourContractedMinimum -
            resolved * obj.rewardHoursCovered -
            (cand.isTemplate ? obj.preferKnownShifts : 0);

          // Deliberately NOT in the score: what this shift's premiums cost.
          // It decides between candidates the score calls equal, and nothing
          // else -- see `beats`.
          const premium = premiumCost(
            price,
            shape,
            day.weekday,
            spec.nightWindow,
            spec.weekendDays,
          );
          let reach = 0;
          for (const h of run) {
            if (cand.startMin <= at(h) && cand.endMin > at(h)) reach += 1;
          }
          // The part of the contract reward earned by hours nobody was short
          // of -- the shift's padding. It is what makes 19:00-03:00 beat
          // 23:00-03:00 for a full-timer, and that is wanted (see `owed`).
          // It is NOT wanted when the padded shift stops short of the hole and
          // the same person had a shift that closed it: at 12 a paid hour in
          // `fair`, one padding hour outbid the 2 an uncovered hour is worth,
          // so a Sunday that was short from 23:30 to 04:00 got two full-timers
          // on 21:00-03:00 -- two people already on until 23:30 -- and the last
          // hour could then only go to the part-timers, five hours each beyond
          // contract for one hour of cover. Diego ended every week at 24 on a
          // 16-hour contract. Such a shift keeps every other term of its score
          // and loses only this one.
          const padding =
            Math.max(0, withinContract - resolved) * obj.honourContractedMinimum;
          mine.push({
            choice: { emp, cand, score, premium, reach, extra },
            padding,
          });
          mineReach = Math.max(mineReach, reach);
        }

        for (const { choice: c, padding } of mine) {
          const choice: Choice =
            c.reach < mineReach ? { ...c, score: c.score + padding } : c;
          // Permission to split is not a request to.
          if ((shiftsToday.get(emp.id) ?? 0) > 0) splits.push(choice);
          else firsts.push(choice);
        }
      }

      const bestFirst = pick(firsts);
      const bestSplit = pick(splits);
      // A first shift for somebody else beats a second shift for anybody.
      const best = bestFirst ?? bestSplit;
      if (!best) break; // nobody can legally take it -> gap recorded below

      const { emp, cand } = best;
      const span = cand.endMin - cand.startMin;
      const paid = (span - cand.breakMin) / 60;
      const key = `${emp.id}|${wk}`;
      const already = weeklyHours[key] ?? 0;
      // Exempt salaried staff are not entitled to overtime (FLSA), so no
      // overtime is accrued or costed for them -- this is the same rule the
      // seeded US-FED profile states as `exempt_overtime_exclusion`.
      const price = priceOf(emp);
      const { rate, sunk } = price;
      const otHours = sunk
        ? 0
        : extraBeyondContract(ordinaryWeeklyHours(emp!, spec), already, paid);
      // Booked at what payroll will pay: base, overtime at this person's own
      // multiplier, and their night and weekend premiums. The premium never
      // chose this person (see `beats`), but it is part of what they cost.
      const cost = sunk
        ? 0
        : rate * (paid - otHours) +
          rate * price.otRate * otHours +
          best.premium;
      const extraHours = extraBeyondContract(contractedHours(emp), already, paid);

      seq += 1;
      assignments.push({
        id: `a${seq}`,
        employeeId: emp.id,
        date: day.date,
        startMin: cand.startMin,
        endMin: cand.endMin,
        templateId: cand.templateId,
        templateName: cand.templateName,
        color: cand.color,
        isNight: cand.isNight,
        paidHours: paid,
        overtimeHours: otHours,
        extraHours,
        cost,
        source: 'ai',
      });

      recordShift(emp.id);
      weekShifts[`${emp.id}|${wk}`] = [
        ...(weekShifts[`${emp.id}|${wk}`] ?? []),
        { start: abs(day.date, cand.startMin), end: abs(day.date, cand.endMin) },
      ];
      weeklyHours[key] = already + paid;
      hoursByEmployee[emp.id] = (hoursByEmployee[emp.id] ?? 0) + paid;
      unsocialByEmployee[emp.id] =
        (unsocialByEmployee[emp.id] ?? 0) +
        unsocialOf(day.date, {
          startMin: cand.startMin,
          endMin: cand.endMin,
          paidHours: paid,
        });
      lastEnd[emp.id] = abs(day.date, cand.endMin);
      for (let h = openHour; h < closeHour; h += 1) {
        if (cand.startMin <= at(h) && cand.endMin > at(h)) cover[h] += 1;
      }
    }

    // SECOND PASS -- honour each contract's distinct base hours.
    //
    // Only for a rota somebody asked for. Under a spec that states no
    // requirement -- the team's published calendar opened with no brief
    // behind it -- filling people toward their contracts would invent a
    // week the team never saw, so the pass is skipped (see `asked`) and the
    // pinned shifts are the whole result.
    //
    // Coverage is now met for the day, but a contract's `min_hours_per_week`
    // is a guaranteed floor the employer committed to, and every employee's is
    // their own: a 40h full-timer, a 20h part-timer and a 12h student must each
    // be filled toward THEIR base, not a shared one. So keep offering shifts to
    // anyone still short of their weekly base, under the exact same legality
    // checks the coverage pass used (availability, rest, per-contract ceiling,
    // onboarding ramp-up, no second shift that day, no refilling a slot the
    // manager emptied). This is what lets a roster of mixed contracts schedule.
    const dayIsWeekend = isWeekendDay(day.weekday, spec.weekendDays);
    for (let guard = 0; asked && guard < roster.length + 1; guard += 1) {
      type Pick = {
        emp: EmployeeOut;
        cand: Candidate;
        paid: number;
        otHours: number;
        cost: number;
      } & Ranked;
      // Same rule as the coverage pass: a first shift outranks a split
      // outright, so no wage can buy one ahead of somebody's first.
      let bestFirst: Pick | null = null;
      let bestSplit: Pick | null = null;

      for (const emp of roster) {
        // One shift a day unless the brief allowed split shifts.
        if (!worksAgainToday(emp.id)) continue;
        if (blackouts.has(blackoutKey(emp.id, day.date))) continue;

        // Only people whose contract sets a base, and who are still under it.
        const base = contractedMinHours(emp);
        if (base <= 0) continue;
        // Topping somebody up is never worth their planned day off.
        if (restDay.has(`${emp.id}|${day.date}`)) continue;
        const key = `${emp.id}|${wk}`;
        const already = weeklyHours[key] ?? 0;
        if (already >= base) continue;


        const avail = availability(emp, absences, absenceTypes, day.date);
        if (!avail.ok) continue;

        const ceiling = weeklyCeiling(spec, emp, overlay);
        const remaining = base - already;
        const price = priceOf(emp);
        const { rate, sunk } = price;

        // Every band as it is, and each one also cut down to what this person
        // is still owed -- never below the three hours a trip to work is worth.
        // Without the cut, somebody half an hour short of their base could only
        // be topped up with a whole band: on the bar in contractFirst.test.ts
        // that was a five-hour Saturday close for a twenty-hour contract at
        // 19.5, 4.5 hours beyond it on a night the cover was already met. The
        // score below still chooses between the two, and a cut band only wins
        // where landing near the base outweighs everything else it weighs.
        const offers: Candidate[] = [];
        for (const raw of candidates) {
          offers.push(raw);
          const cut = trimToRemaining(
            raw,
            Math.max(remaining, MIN_TRIMMED_SHIFT_MIN / 60),
            raw.startMin,
          );
          if (cut && cut !== raw) offers.push(cut);
        }
        for (const cand of offers) {
          if (cand.weekendOnly && !dayIsWeekend) continue;
          const span = cand.endMin - cand.startMin;
          const paid = (span - cand.breakMin) / 60;
          if (already + paid > ceiling) continue;
          if (avail.maxHoursToday != null && paid > avail.maxHoursToday) continue;
          if (cand.isNight && !avail.nightsAllowed) continue;

          const startAbs = abs(day.date, cand.startMin);
          const prevEnd = restAnchor(emp.id);
          // Between DAYS the rest rule applies in full. Between the two halves
          // of one split day it cannot: eleven hours between a morning and an
          // afternoon shift is a contradiction, so a short break stands in.
          // Counted, not clocked, for the reason spelled out in the coverage
          // pass above.
          const alreadyWorkedToday = (shiftsToday.get(emp.id) ?? 0) > 0;
          const requiredGap =
            splitCap > 0 && alreadyWorkedToday
              ? SPLIT_MIN_GAP
              : spec.minRestHours * 60;
          if (prevEnd != null && startAbs - prevEnd < requiredGap) {
            continue;
          }
          // And the week's own day and a half (art. 37.1 ET where it applies).
          if (
            breaksWeeklyRest(
              emp.id,
              wk,
              weekStartAbs,
              startAbs,
              abs(day.date, cand.endMin),
            )
          ) {
            continue;
          }

          const otHours = sunk
            ? 0
            : extraBeyondContract(
                ordinaryWeeklyHours(emp, spec),
                already,
                paid,
              );
          const shape: PremiumShift = {
            startMin: cand.startMin,
            endMin: cand.endMin,
            paidHours: paid,
          };
          // Priced at base and overtime for the score, as it always was, and
          // the premium kept apart for the tie-break and the booking.
          const cost =
            sunk ? 0 : rate * (paid - otHours) + rate * price.otRate * otHours;
          const premium = premiumCost(
            price,
            shape,
            day.weekday,
            spec.nightWindow,
            spec.weekendDays,
          );

          // Lower is better. Land as close to the remaining base as possible
          // (penalise both overshooting it and stopping well short), spread the
          // hours across people still short, and never push into overtime just
          // to reach a base.
          const overshoot = Math.max(0, paid - remaining);
          const shortAfter = Math.max(0, remaining - paid);
          const score =
            overshoot * obj.avoidOvershootingBase +
            shortAfter * obj.avoidStoppingShort +
            otHours * obj.overtimeAversion +
            (hoursByEmployee[emp.id] ?? 0) * obj.spreadHoursWhenToppingUp +
            unsocialPenalty(emp.id, unsocialOf(day.date, shape)) -
            remaining * obj.urgencyOfRemainingBase +
            cost * obj.wageSensitivityWhenToppingUp -
            (cand.isTemplate ? obj.preferKnownShiftsWhenToppingUp : 0);

          const pick: Pick = { emp, cand, paid, otHours, cost, score, premium };
          if ((shiftsToday.get(emp.id) ?? 0) > 0) {
            if (!bestSplit || beats(pick, bestSplit)) bestSplit = pick;
          } else if (!bestFirst || beats(pick, bestFirst)) {
            bestFirst = pick;
          }
        }
      }

      const best = bestFirst ?? bestSplit;

      if (!best) break;

      const { emp, cand, paid, otHours } = best;
      // Booked with the premium, which the score never saw.
      const cost = best.cost + best.premium;
      const key = `${emp.id}|${wk}`;
      const extraHours = extraBeyondContract(
        contractedHours(emp),
        weeklyHours[key] ?? 0,
        paid,
      );
      seq += 1;
      assignments.push({
        id: `a${seq}`,
        employeeId: emp.id,
        date: day.date,
        startMin: cand.startMin,
        endMin: cand.endMin,
        templateId: cand.templateId,
        templateName: cand.templateName,
        color: cand.color,
        isNight: cand.isNight,
        paidHours: paid,
        overtimeHours: otHours,
        extraHours,
        cost,
        source: 'ai',
      });

      recordShift(emp.id);
      weekShifts[`${emp.id}|${wk}`] = [
        ...(weekShifts[`${emp.id}|${wk}`] ?? []),
        { start: abs(day.date, cand.startMin), end: abs(day.date, cand.endMin) },
      ];
      weeklyHours[key] = (weeklyHours[key] ?? 0) + paid;
      hoursByEmployee[emp.id] = (hoursByEmployee[emp.id] ?? 0) + paid;
      unsocialByEmployee[emp.id] =
        (unsocialByEmployee[emp.id] ?? 0) +
        unsocialOf(day.date, {
          startMin: cand.startMin,
          endMin: cand.endMin,
          paidHours: paid,
        });
      lastEnd[emp.id] = abs(day.date, cand.endMin);
      for (let h = openHour; h < closeHour; h += 1) {
        if (cand.startMin <= at(h) && cand.endMin > at(h)) cover[h] += 1;
      }
    }

    // Record whatever coverage we could not fill.
    for (let h = openHour; h < closeHour; h += 1) {
      if (cover[h] < need(h)) {
        gaps.push({ date: day.date, hour: h, have: cover[h], need: need(h) });
      }
    }
  }

  const totalCost = assignments.reduce((s, a) => s + a.cost, 0);
  const totalHours = assignments.reduce((s, a) => s + a.paidHours, 0);
  const overtimeHours = assignments.reduce((s, a) => s + a.overtimeHours, 0);

  // Anyone left below their contracted weekly minimum, averaged over the span.
  const weeks = Math.max(1, days.length / 7);
  const belowMinimum = roster
    .filter((e) => {
      const min = contractedMinHours(e);
      if (min <= 0) return false;
      // Only a real shortfall if they were actually available to work.
      const availableDays = days.filter(
        (d) => !isClosedOn(spec, d) && availability(e, absences, absenceTypes, d.date).ok,
      ).length;
      if (availableDays === 0) return false;
      const expected = min * weeks * (availableDays / Math.max(1, days.length));
      return (hoursByEmployee[e.id] ?? 0) < expected * 0.9;
    })
    .map((e) => e.id);

  return {
    assignments,
    gaps,
    totalCost,
    totalHours,
    overtimeHours,
    hoursByEmployee,
    belowMinimum,
  };
}

/** What `priceAssignments` needs to book premiums, when a caller has it. */
export interface PricingPolicy {
  policy: PayPolicy;
  /** The spec's night window; 22:00-06:00 when unstated. */
  nightWindow?: NightWindow | null;
  /** The business's weekend; Saturday and Sunday when unstated. */
  weekendDays?: number[];
}

export interface PricedSchedule {
  assignments: Assignment[];
  hoursByEmployee: Record<string, number>;
}

/**
 * Price a bare list of shifts: weekly hours in date order, overtime against
 * each person's own contracted week, cost at their rate (zero for sunk-cost
 * salaried).
 *
 * This is the shared pricing the employee's own view uses, so their estimate is
 * the same arithmetic as the manager's payroll — no second, drifting formula.
 *
 * No spec reaches here, so a contract that states no hours falls back to the
 * statutory week. That is the one case where this and `summarize` can differ,
 * and it is the case where neither of them knows anything.
 */
export function priceAssignments(
  assignments: Assignment[],
  employees: EmployeeOut[],
  /**
   * What an overtime hour costs here, as a multiple of an ordinary one.
   *
   * DEFAULTS TO 1, which is this product's market: art. 35.1 ET says an extra
   * hour is never worth LESS than an ordinary one and sets no premium above
   * it. It used to default to the FLSA's 1.5 -- another country's law, kept
   * because that is where this code was born -- so a caller with no spec to
   * read from priced overtime half as dear again as anybody here pays it. A
   * caller that HAS a spec still passes `overtimeMultiplier(spec)`, so the
   * two sides of the product price identically.
   */
  otRate: number = 1,
  /** What a year of work is, to price a salary by the hour. See `rate.ts`. */
  year: YearBasis = {},
  /**
   * The business's pay policy and where its premiums fall, to price the
   * shifts as payroll pays them. Left off, no premium is booked and overtime
   * is `otRate` -- what this always did. Given, each person's overtime and
   * premiums are their own (`effectivePolicy`) and `otRate` is not read.
   */
  premiums?: PricingPolicy,
): PricedSchedule {
  const byEmployee = new Map(employees.map((e) => [e.id, e]));
  const ordered = [...assignments].sort((a, b) =>
    a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date),
  );

  const weeklyHours: Record<string, number> = {};
  const hoursByEmployee: Record<string, number> = {};
  const priced: Assignment[] = [];

  for (const a of ordered) {
    const emp = byEmployee.get(a.employeeId);
    const key = `${a.employeeId}|${weekKey(a.date)}`;
    const already = weeklyHours[key] ?? 0;
    const paid = a.paidHours;
    const sunk = Boolean(emp && isSunkCost(emp));
    const otHours =
      sunk || !emp
        ? 0
        : extraBeyondContract(ordinaryWeeklyHours(emp), already, paid);
    const price = emp ? priceFor(emp, year, otRate, premiums?.policy) : null;
    const rate = price ? price.rate : 0;
    const cost =
      sunk || !price
        ? 0
        : rate * (paid - otHours) +
          rate * price.otRate * otHours +
          premiumCost(
            price,
            a,
            weekdayOfKey(a.date),
            premiums?.nightWindow,
            premiums?.weekendDays,
          );
    // Re-derived, not carried over: a shift the manager dragged in by hand is
    // beyond contract for exactly the same reason a generated one is.
    const extraHours = emp
      ? extraBeyondContract(contractedHours(emp), already, paid)
      : 0;

    weeklyHours[key] = already + paid;
    hoursByEmployee[a.employeeId] = (hoursByEmployee[a.employeeId] ?? 0) + paid;
    priced.push({ ...a, overtimeHours: otHours, extraHours, cost });
  }

  return { assignments: priced, hoursByEmployee };
}

/**
 * Recompute every derived figure from a list of shifts.
 *
 * Manual edits go through here so a hand-placed shift is costed by exactly the
 * same rules as an AI-placed one: weekly hours are re-accumulated in date
 * order, overtime is re-derived against the FLSA threshold, and coverage gaps
 * are recounted. The manager can never end up with a schedule whose totals
 * silently disagree with its shifts.
 */
export function summarize(
  assignments: Assignment[],
  employees: EmployeeOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  spec: SchedulingSpec,
  days: DayRef[],
  /**
   * The business's pay policy, priced exactly as `generateSchedule` prices
   * with it -- the two must agree, or a manual edit would reprice the rota
   * the generator just built. Left off: no premiums, as before.
   */
  payPolicy?: PayPolicy,
): ScheduleResult {
  // Summarising prices the calendar again, so it needs the same multiplier
  // the generator used -- it has the spec, so it reads it rather than
  // assuming the FLSA's.
  const otRate = overtimeMultiplier(spec);
  const weekdayByDate = new Map(days.map((d) => [d.date, d.weekday]));
  const byEmployee = new Map(employees.map((e) => [e.id, e]));
  const ordered = [...assignments].sort((a, b) =>
    a.date === b.date ? a.startMin - b.startMin : a.date.localeCompare(b.date),
  );

  const weeklyHours: Record<string, number> = {};
  const hoursByEmployee: Record<string, number> = {};
  const priced: Assignment[] = [];

  for (const a of ordered) {
    const emp = byEmployee.get(a.employeeId);
    const key = `${a.employeeId}|${weekKey(a.date)}`;
    const already = weeklyHours[key] ?? 0;
    const paid = a.paidHours;
    const sunk = Boolean(emp && isSunkCost(emp));
    const otHours = sunk
      ? 0
      : extraBeyondContract(ordinaryWeeklyHours(emp!, spec), already, paid);
    const price = emp ? priceFor(emp, spec, otRate, payPolicy) : null;
    const rate = price ? price.rate : 0;
    const cost =
      sunk || !price
        ? 0
        : rate * (paid - otHours) +
          rate * price.otRate * otHours +
          premiumCost(
            price,
            a,
            weekdayByDate.get(a.date) ?? weekdayOfKey(a.date),
            spec.nightWindow,
            spec.weekendDays,
          );
    // Re-derived, not carried over: a shift the manager dragged in by hand is
    // beyond contract for exactly the same reason a generated one is.
    const extraHours = emp
      ? extraBeyondContract(contractedHours(emp), already, paid)
      : 0;

    weeklyHours[key] = already + paid;
    hoursByEmployee[a.employeeId] = (hoursByEmployee[a.employeeId] ?? 0) + paid;
    priced.push({ ...a, overtimeHours: otHours, extraHours, cost });
  }

  // Coverage gaps, day by day.
  const gaps: CoverageGap[] = [];
  const dayIdx = new Map(days.map((d, i) => [d.date, i]));
  for (const day of days) {
    if (isClosedOn(spec, day)) continue;
    const win = windowFor(spec, day);
    const openHour = Math.floor(win.openMin / 60);
    const closeHour = Math.ceil(win.closeMin / 60);
    const prev = dayIdx.get(day.date)! - 1;
    const prevDate = prev >= 0 ? days[prev].date : null;

    for (let h = openHour; h < closeHour; h += 1) {
      const need = needAt(spec, day, h);
      // The generator files a shift under the day it STARTS on and lets its
      // minutes run past 1440 into the small hours, counting cover at hours
      // 24..27 of that same day. This loop used to model it the other way --
      // clip the shift at midnight, push the remainder onto the next day --
      // and the two never met: for h >= 24 the same-day branch clipped the
      // shift away, and the previous-day branch needed a shift ending after
      // 33:00 to fire at all. So every hour after midnight came back with
      // have = 0. A bar with four people on until 04:00 was told its whole
      // small-hours stretch was uncovered the moment anything recomputed --
      // one manual edit, one refinement -- while the calendar underneath it
      // showed those people on shift.
      //
      // Shifted onto this day's axis first, then counted as PEOPLE: one
      // person with two bars over the same minute is one person, and counting
      // the bars is what let a doubled-up shift hide a real shortage.
      const spans: CoverageSpan[] = [];
      for (const a of priced) {
        const offset =
          a.date === day.date ? 0 : prevDate && a.date === prevDate ? -1440 : null;
        if (offset === null) continue;
        spans.push({
          employeeId: a.employeeId,
          startMin: a.startMin + offset,
          endMin: a.endMin + offset,
        });
      }
      const have = peopleAtHour(spans, h, win);
      if (have < need) gaps.push({ date: day.date, hour: h, have, need });
    }
  }

  const weeks = Math.max(1, days.length / 7);
  const belowMinimum = employees
    .filter((e) => {
      const min = contractedMinHours(e);
      if (min <= 0) return false;
      const availableDays = days.filter(
        (d) => !isClosedOn(spec, d) && availability(e, absences, absenceTypes, d.date).ok,
      ).length;
      if (availableDays === 0) return false;
      const expected = min * weeks * (availableDays / Math.max(1, days.length));
      return (hoursByEmployee[e.id] ?? 0) < expected * 0.9;
    })
    .map((e) => e.id);

  return {
    assignments: priced,
    gaps,
    totalCost: priced.reduce((s, a) => s + a.cost, 0),
    totalHours: priced.reduce((s, a) => s + a.paidHours, 0),
    overtimeHours: priced.reduce((s, a) => s + a.overtimeHours, 0),
    hoursByEmployee,
    belowMinimum,
  };
}

/** Build a manual shift for an employee, snapped to the hour the manager clicked. */
export function manualShift(
  employeeId: string,
  date: string,
  /**
   * Where the manager pressed, in minutes from the track's own midnight.
   *
   * Minutes and not an hour: the grid draws an hour per column but a shift
   * starts on the half hour as often as on the hour, and the resize this
   * shift is about to be given has moved in half hours since it existed. A
   * whole-hour start was a control that could not express what the control
   * next to it could.
   */
  startAt: number,
  _templates: ShiftTemplateOut[],
  spec: SchedulingSpec,
  seq: number,
): Assignment {
  const startMin = Math.max(startAt, spec.openMin);
  // Exactly the half hour that was clicked. It used to be four hours, which
  // had to be trimmed or removed more often than it was right; now the shift
  // starts as one hour and the manager stretches it by dragging its edge.
  const endMin = startMin + 60;
  // Same appearance rule as generated shifts, so a hand-placed 2 PM shift is
  // the same colour as an AI-placed one.
  const look = shiftAppearance(startMin, endMin);
  return {
    id: `m${seq}`,
    employeeId,
    date,
    startMin,
    endMin,
    templateId: `band-${look.bandKey}`,
    templateName: look.label,
    color: look.color,
    isNight: look.isNight,
    paidHours: (endMin - startMin) / 60,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'manual',
  };
}
