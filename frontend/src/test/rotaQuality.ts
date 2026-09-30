// Measuring a calendar, so that "did the quality drop?" stops being an opinion.
//
// WHY THIS EXISTS NOW. Making generation cheaper means asking the model for
// less: less reasoning, and less writing. Both are changes to the OUTPUT, and
// the only honest way to make them is to be able to answer "what did that
// cost us?" without spending a cent finding out. So every number below is
// computed offline, from a finished list of shifts, by the same code that
// judges a real proposal in production.
//
// THE RULE IT INHERITS. validate.ts opens by saying it never re-derives a
// limit, because a validator with its own copy of the rest rule is two answers
// to "was this person given enough rest?". A bench with its own copy is a
// THIRD answer, and the worst of the three: it would be the one telling us
// whether the cheap configuration is safe to ship. So nothing here decides
// what is legal, what a week's ceiling is, what a shift costs, or who is
// below their contract. `validateSchedule` rules on legality and coverage,
// `summarize` prices, `needAt`/`windowFor`/`isClosedOn` say what the shop
// needed, `contractedMinHours` says what was promised. This file only counts
// what they said, and puts it in a row.
//
// WHAT IT ADDS, AND WHY IT HAD TO. Exactly one measurement has no owner
// elsewhere: whether one person's shifts land at the same time of day. The
// planner's own prompt asks the model for consistent patterns, and until now
// nothing in the repo could tell whether it obliged -- a rota that puts Ana on
// at 08:00, 14:00, 09:00 and 19:00 passes every rule in validate.ts and is
// still the rota she will complain about. That is a property of the shifts
// themselves, not a limit anyone set, so measuring it here re-derives nothing.
//
// DETERMINISM. Two runs of this file on the same calendar produce the same
// numbers, byte for byte: every float is rounded once, at the point it is
// stored, and every map is built in a sorted order. That is what lets the
// baseline be pinned as a fixture and a comparison be trusted.

import type { EmployeeOut } from '../types';
import { contractedMinHours } from '../lib/schedule/availability';
import { isClosedOn, needAt, windowFor } from '../lib/schedule/demand';
import { summarize } from '../lib/schedule/generate';
import { premiumHours } from '../lib/schedule/premiums';
import type { ScenarioInputs } from './objectiveScenarios';
import type { Assignment } from '../lib/schedule/types';
import { validateSchedule, weekKey } from '../lib/schedule/validate';
import { weekDates } from '../lib/schedule/weekHours';

/**
 * Two decimals, once, at the moment a number is stored.
 *
 * Not cosmetic. A metric that carries seventeen digits of float noise cannot
 * be pinned in a fixture and cannot be compared for "worse" without an epsilon
 * that hides real differences. Rounding at the source means the number the
 * table prints, the number the fixture holds and the number the comparison
 * reads are the same number.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Below this, two rounded metrics are the same metric and not a regression. */
const EPS = 1e-9;

/**
 * One calendar's report card.
 *
 * Flat and JSON-shaped on purpose: this is what gets pinned as a baseline, and
 * a fixture full of nested objects is a fixture nobody reads the diff of.
 */
export interface RotaMetrics {
  scenario: string;

  // ---- legality: anything above zero in `hard` is a fail, full stop --------
  /** Hard violations: the rota may not be shown to anyone with these in it. */
  hard: number;
  /** Hard violations by kind. Only non-zero kinds, keys sorted. */
  hardByKind: Record<string, number>;
  /** Soft violations: defensible, but the manager should see them. */
  soft: number;
  softByKind: Record<string, number>;

  // ---- coverage -----------------------------------------------------------
  /** Person-hours the shop asked for and did not get. */
  uncoveredHours: number;
  /** Person-hours the shop asked for at all, across every open hour. */
  requiredHours: number;
  /** `uncoveredHours` as a percentage of `requiredHours`. */
  uncoveredPct: number;

  // ---- the people -------------------------------------------------------
  /**
   * Hours by which whole weeks fell short of a contracted minimum, summed.
   *
   * Counted even when the shop was fully covered, because being covered is not
   * the same as having kept your promises: a 26-hour contract given 18 hours
   * is a problem the coverage figure cannot see.
   */
  shortfallHours: number;
  /** How many people that shortfall is spread across. */
  peopleShort: number;
  /**
   * How many people the GENERATOR's own rule calls short.
   *
   * Beside `shortfallHours` rather than instead of it, because the two ask
   * different questions and both are worth having. This one prorates for the
   * days somebody was on leave or the shop was shut and forgives the last
   * tenth; the raw figure above forgives nothing. A gap between them is a week
   * where the shortfall was explainable, which is exactly when you want to see
   * both numbers rather than one.
   */
  belowMinimum: number;
  /** Hours handed out beyond somebody's contracted figure, as priced. */
  extraHours: number;

  // ---- the money ----------------------------------------------------------
  cost: number;
  paidHours: number;
  overtimeHours: number;

  // ---- pattern ------------------------------------------------------------
  /**
   * How far, in minutes, a person's shifts sit from their own usual start.
   *
   * Averaged across everyone who worked more than once. 0 means everybody
   * started at the same time every day they worked; 180 means a typical shift
   * begins three hours away from that person's habit.
   */
  patternDriftMin: number;
  /** The same figure for the worst-treated person on the rota. */
  worstPatternDriftMin: number;
  /** How many people that average is over -- anyone with two or more shifts. */
  peopleWithPattern: number;

  // ---- who gets the unsocial hours ----------------------------------------
  /**
   * Paid night hours per person, by the same definition payroll pays on
   * (./premiums): inside the spec's night window, scaled for the unpaid break.
   *
   * Only people who worked at all, keys sorted. These are here because "the
   * cheap one gets every night" is a failure no other column can see: the shop
   * is covered, nobody breaks a rule, the bill even goes DOWN -- and one person
   * works every late shift of the month.
   */
  nightHoursByPerson: Record<string, number>;
  /** Paid hours on a weekend day, by the day the shift starts. Same people. */
  weekendHoursByPerson: Record<string, number>;
  /**
   * The most night hours anybody worked minus the fewest, among the people who
   * worked at all. 0 means the nights were shared exactly evenly -- or that
   * there were none.
   *
   * Reported, not judged: see `SPREAD_AXES`.
   */
  nightSpread: number;
  /** The same spread, for weekend hours. */
  weekendSpread: number;
}

/** Minutes between two times of DAY, the short way round the clock. */
function clockGap(a: number, b: number): number {
  const d = Math.abs((a % 1440) - (b % 1440));
  return Math.min(d, 1440 - d);
}

/**
 * How scattered one person's start times are, in minutes.
 *
 * Measured against the start they actually work most often rather than against
 * an average, and round the CLOCK rather than along a number line. Both
 * choices are about night shifts. A mean of 22:00 and 02:00 is noon, which is
 * a time neither of them ever worked and would score a person on two adjacent
 * night shifts as the most erratic on the rota; and treating the clock as a
 * line makes those same two shifts twenty hours apart instead of four.
 *
 * The anchor is chosen from the person's own start times, so it is always a
 * shift they really worked, and ties go to the earlier one -- which is
 * arbitrary, and has to be SOMETHING, or the same calendar scores differently
 * depending on the order the shifts came out of the generator.
 */
function driftFor(shifts: Assignment[]): number {
  const starts = shifts.map((s) => s.startMin).sort((a, b) => a - b);
  let best = Infinity;
  let bestTotal = Infinity;
  for (const candidate of starts) {
    let total = 0;
    for (const s of starts) total += clockGap(candidate, s);
    if (total < bestTotal - EPS) {
      bestTotal = total;
      best = candidate;
    }
  }
  let sum = 0;
  for (const s of starts) sum += clockGap(best, s);
  return round2(sum / starts.length);
}

/** `${employeeId}|${weekKey}` -> paid hours, for the weeks inside the period. */
function paidHoursByEmployeeWeek(assignments: Assignment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of assignments) {
    const k = `${a.employeeId}|${weekKey(a.date)}`;
    out.set(k, (out.get(k) ?? 0) + a.paidHours);
  }
  return out;
}

/**
 * Contracted-hours shortfall, counted only over weeks the period fully holds.
 *
 * The same discipline as `weekHoursFor` in weekHours.ts, and for the same
 * reason: a period that starts on a Thursday has three days of that week, and
 * calling a 40-hour contract "22 hours short" on the evidence of three days
 * would fill the bench with a regression that is really just the edge of the
 * calendar. A partial week is measured, it is simply not judged.
 */
function shortfall(
  employees: EmployeeOut[],
  assignments: Assignment[],
  periodDates: ReadonlySet<string>,
): { hours: number; people: number } {
  const worked = paidHoursByEmployeeWeek(assignments);
  const wholeWeeks = new Set<string>();
  for (const date of periodDates) {
    const week = weekKey(date);
    if (wholeWeeks.has(week)) continue;
    if (weekDates(date).every((d) => periodDates.has(d))) wholeWeeks.add(week);
  }

  let hours = 0;
  let people = 0;
  for (const emp of employees) {
    const min = contractedMinHours(emp);
    if (min <= 0) continue;
    let short = 0;
    for (const week of wholeWeeks) {
      const got = worked.get(`${emp.id}|${week}`) ?? 0;
      if (got < min) short += min - got;
    }
    if (short > EPS) {
      hours += short;
      people += 1;
    }
  }
  return { hours: round2(hours), people };
}

/** Every person-hour the shop asked for, over the open hours of the period. */
function requiredPersonHours(inputs: ScenarioInputs): number {
  let total = 0;
  for (const day of inputs.days) {
    if (isClosedOn(inputs.spec, day)) continue;
    const w = windowFor(inputs.spec, day);
    const openHour = Math.floor(w.openMin / 60);
    const closeHour = Math.ceil(w.closeMin / 60);
    for (let h = openHour; h < closeHour; h += 1) {
      const need = needAt(inputs.spec, day, h);
      if (need > 0) total += need;
    }
  }
  return total;
}

/** Counts by violation kind, keys in a stable order so a fixture diff reads. */
function tally(kinds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of [...kinds].sort()) out[k] = (out[k] ?? 0) + 1;
  return out;
}

/**
 * Score one calendar against the brief it was built for.
 *
 * `assignments` is judged AS GIVEN and priced separately. That split is
 * deliberate and it matters most for the calendars this bench exists to judge:
 * validate.ts checks the weekly ceiling against the hours a proposal CLAIMS,
 * precisely so that a model which lies about its own arithmetic trips the
 * check instead of slipping past it. Re-pricing first and then validating
 * would quietly repair the lie and report a clean rota.
 */
export function measureRota(
  scenario: string,
  assignments: Assignment[],
  inputs: ScenarioInputs,
): RotaMetrics {
  const verdict = validateSchedule(
    assignments,
    inputs.employees,
    inputs.templates,
    inputs.absences,
    inputs.absenceTypes,
    inputs.spec,
    inputs.days,
    inputs.overlay,
  );

  // The repo's own arithmetic for money, overtime and beyond-contract hours.
  // Never recomputed here: a bench that priced shifts itself would eventually
  // disagree with payroll, and the number a manager would believe is the one
  // on the payslip.
  const priced = summarize(
    assignments,
    inputs.employees,
    inputs.absences,
    inputs.absenceTypes,
    inputs.spec,
    inputs.days,
    inputs.payPolicy,
  );

  const periodDates = new Set(inputs.days.map((d) => d.date));
  const inPeriod = assignments.filter((a) => periodDates.has(a.date));

  const hard = verdict.violations.filter((v) => v.hard);
  const soft = verdict.violations.filter((v) => !v.hard);

  const uncovered = verdict.gaps.reduce((s, g) => s + (g.need - g.have), 0);
  const required = requiredPersonHours(inputs);

  const byEmployee = new Map<string, Assignment[]>();
  for (const a of inPeriod) {
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(a);
    byEmployee.set(a.employeeId, list);
  }
  // Sorted, so the average is summed in the same order every run. Float
  // addition is not associative and a bench whose last digit depends on map
  // insertion order is a bench that fails its own fixture at random.
  const drifts = [...byEmployee.keys()]
    .sort()
    .map((id) => byEmployee.get(id) as Assignment[])
    .filter((list) => list.length >= 2)
    .map(driftFor);

  const short = shortfall(inputs.employees, inPeriod, periodDates);

  // Premium hours per person, asked of the same function payroll asks. Summed
  // in id order for the reason the drift above is: a bench whose last digit
  // depends on the order the shifts came out in fails its own fixture.
  const weekdayOf = new Map(inputs.days.map((d) => [d.date, d.weekday]));
  const nightBy: Record<string, number> = {};
  const weekendBy: Record<string, number> = {};
  for (const id of [...byEmployee.keys()].sort()) {
    let night = 0;
    let weekend = 0;
    for (const a of byEmployee.get(id) as Assignment[]) {
      const h = premiumHours(
        a,
        weekdayOf.get(a.date),
        inputs.spec.nightWindow,
        inputs.spec.weekendDays,
      );
      night += h.night;
      weekend += h.weekend;
    }
    nightBy[id] = round2(night);
    weekendBy[id] = round2(weekend);
  }
  const spread = (by: Record<string, number>): number => {
    const values = Object.values(by);
    return values.length ? round2(Math.max(...values) - Math.min(...values)) : 0;
  };

  return {
    scenario,
    hard: hard.length,
    hardByKind: tally(hard.map((v) => v.kind)),
    soft: soft.length,
    softByKind: tally(soft.map((v) => v.kind)),
    uncoveredHours: round2(uncovered),
    requiredHours: round2(required),
    uncoveredPct: required > 0 ? round2((uncovered / required) * 100) : 0,
    shortfallHours: short.hours,
    peopleShort: short.people,
    belowMinimum: priced.belowMinimum.length,
    extraHours: round2(priced.assignments.reduce((s, a) => s + a.extraHours, 0)),
    cost: round2(priced.totalCost),
    paidHours: round2(priced.totalHours),
    overtimeHours: round2(priced.overtimeHours),
    patternDriftMin: drifts.length
      ? round2(drifts.reduce((s, d) => s + d, 0) / drifts.length)
      : 0,
    worstPatternDriftMin: drifts.length ? round2(Math.max(...drifts)) : 0,
    peopleWithPattern: drifts.length,
    nightHoursByPerson: nightBy,
    weekendHoursByPerson: weekendBy,
    nightSpread: spread(nightBy),
    weekendSpread: spread(weekendBy),
  };
}

// ---------------------------------------------------------------------------
// A against B
// ---------------------------------------------------------------------------

/**
 * The axes on which B may not be worse than A.
 *
 * These are the promises the product makes to the people on the rota and to
 * the shop: it is legal, the shop is covered, contracts are honoured, and a
 * person's shifts are where they expect them. A cheaper configuration is
 * allowed to be different on all sorts of things; it is not allowed to be
 * worse on these, and a move that is worse on one of them needs a decision
 * rather than a deploy.
 */
export const QUALITY_AXES = [
  'hard',
  'uncoveredHours',
  'shortfallHours',
  'soft',
  'patternDriftMin',
] as const;

/**
 * Reported, never failed on.
 *
 * Money is not quality, and the direction it should move in depends entirely
 * on what was being changed -- a cheaper GENERATION may legitimately produce a
 * dearer ROTA, and `cheapest` is already documented as landing $24 above the
 * default on one scenario. Letting these fail a run would make the bench
 * refuse the exact trade somebody deliberately made; leaving them out entirely
 * would hide the bill. So they are shown and not judged.
 */
export const ECONOMIC_AXES = ['cost', 'overtimeHours', 'extraHours', 'paidHours'] as const;

/**
 * How evenly the nights and weekends were shared out. Reported, never failed on.
 *
 * Not in QUALITY_AXES, and on purpose. A spread is only a fault when the rota
 * had a choice, and this bench cannot tell a choice from a constraint: a
 * weekend nobody but two people can legally work has a wide spread and
 * nothing wrong with it, and a ratchet that failed there would be failing the
 * brief rather than the generator. What a spread IS good for is showing a
 * change to the scoring doing what it says -- see `spreadUnsocial` in
 * ../lib/schedule/objective -- and that is read, not asserted.
 */
export const SPREAD_AXES = ['nightSpread', 'weekendSpread'] as const;

export type QualityAxis = (typeof QUALITY_AXES)[number];
export type EconomicAxis = (typeof ECONOMIC_AXES)[number];

export interface AxisDelta {
  axis: string;
  a: number;
  b: number;
  delta: number;
}

export interface ScenarioComparison {
  scenario: string;
  /** Quality axes that moved, in the order of QUALITY_AXES. */
  quality: AxisDelta[];
  economics: AxisDelta[];
  /** Spread axes that moved. Never part of `worse` or `better`. */
  spread: AxisDelta[];
  /** B is worse than A on at least one quality axis. */
  worse: boolean;
  /** B improved on at least one quality axis. */
  better: boolean;
  /**
   * B carries hard violations, regardless of what A did.
   *
   * Separate from `worse` because it is not a comparison: a rota with a hard
   * violation is unshippable on its own terms, and "no worse than the last
   * unshippable one" is not a result anybody should be able to report green.
   */
  illegal: boolean;
  /**
   * B broke something A did not.
   *
   * The distinction earns its place the first time a comparison is run in this
   * repo: one of the twelve briefs stamps its replayed pins with a template id
   * no org owns, so BOTH sides of every A/B come back illegal on it, for a
   * reason neither configuration chose. A report that leads with ILLEGAL every
   * single time is a report people learn to scroll past, and the next time the
   * word is earned nobody will read it.
   */
  newlyIllegal: boolean;
}

export interface SuiteComparison {
  scenarios: ScenarioComparison[];
  /** Any scenario worse on a quality axis. */
  worse: boolean;
  /** Any scenario in B carrying hard violations. */
  illegal: boolean;
  /** Any scenario B broke that A had not. */
  newlyIllegal: boolean;
  /** Scenarios A measured that B did not, and the other way round. */
  missing: string[];
  added: string[];
}

function deltasFor(
  a: RotaMetrics,
  b: RotaMetrics,
  axes: readonly string[],
): AxisDelta[] {
  const out: AxisDelta[] = [];
  for (const axis of axes) {
    const av = a[axis as keyof RotaMetrics] as number;
    const bv = b[axis as keyof RotaMetrics] as number;
    if (Math.abs(bv - av) <= EPS) continue;
    out.push({ axis, a: av, b: bv, delta: round2(bv - av) });
  }
  return out;
}

/** Compare one scenario's calendar under configuration A against under B. */
export function compareRota(a: RotaMetrics, b: RotaMetrics): ScenarioComparison {
  const quality = deltasFor(a, b, QUALITY_AXES);
  return {
    scenario: b.scenario,
    quality,
    economics: deltasFor(a, b, ECONOMIC_AXES),
    spread: deltasFor(a, b, SPREAD_AXES),
    worse: quality.some((d) => d.delta > EPS),
    better: quality.some((d) => d.delta < -EPS),
    illegal: b.hard > 0,
    newlyIllegal: b.hard > 0 && a.hard === 0,
  };
}

/**
 * Compare two whole runs of the bench, scenario by scenario.
 *
 * Matched by NAME, not by position, and a scenario present on one side only is
 * reported rather than skipped. Two runs that quietly compared eleven
 * scenarios against a different eleven would be the one failure mode that
 * makes every other number here meaningless.
 */
export function compareSuites(a: RotaMetrics[], b: RotaMetrics[]): SuiteComparison {
  const byName = new Map(a.map((m) => [m.scenario, m]));
  const seen = new Set<string>();
  const scenarios: ScenarioComparison[] = [];

  for (const metrics of b) {
    seen.add(metrics.scenario);
    const before = byName.get(metrics.scenario);
    if (!before) continue;
    scenarios.push(compareRota(before, metrics));
  }

  return {
    scenarios,
    worse: scenarios.some((s) => s.worse),
    illegal: scenarios.some((s) => s.illegal),
    newlyIllegal: scenarios.some((s) => s.newlyIllegal),
    missing: a.map((m) => m.scenario).filter((n) => !seen.has(n)),
    added: b.map((m) => m.scenario).filter((n) => !byName.has(n)),
  };
}

// ---------------------------------------------------------------------------
// Printing, for the times a person rather than a test is asking
// ---------------------------------------------------------------------------

function pad(text: string, width: number, right = false): string {
  const s = text.length > width ? `${text.slice(0, width - 1)}…` : text;
  return right ? s.padStart(width) : s.padEnd(width);
}

const NAME_WIDTH = 44;

interface Column {
  head: string;
  width: number;
  of: (m: RotaMetrics) => string;
}

const COLUMNS: Column[] = [
  { head: 'hard', width: 5, of: (m) => String(m.hard) },
  { head: 'soft', width: 5, of: (m) => String(m.soft) },
  { head: 'uncov', width: 6, of: (m) => m.uncoveredHours.toFixed(1) },
  { head: 'unc%', width: 6, of: (m) => m.uncoveredPct.toFixed(1) },
  { head: 'short', width: 6, of: (m) => m.shortfallHours.toFixed(1) },
  { head: 'extra', width: 6, of: (m) => m.extraHours.toFixed(1) },
  { head: 'hours', width: 7, of: (m) => m.paidHours.toFixed(1) },
  { head: 'OT', width: 6, of: (m) => m.overtimeHours.toFixed(1) },
  { head: 'cost', width: 9, of: (m) => m.cost.toFixed(2) },
  { head: 'drift', width: 6, of: (m) => m.patternDriftMin.toFixed(0) },
  { head: 'worst', width: 6, of: (m) => m.worstPatternDriftMin.toFixed(0) },
  { head: 'nSprd', width: 6, of: (m) => m.nightSpread.toFixed(1) },
  { head: 'wSprd', width: 6, of: (m) => m.weekendSpread.toFixed(1) },
];

/**
 * The whole run as a table a person can read down.
 *
 * Fixed width, every column the same width on every run: this gets pasted into
 * a pull request and read beside the same table from the other configuration,
 * and a column that moves makes two runs impossible to compare by eye.
 */
export function formatMetricsTable(rows: RotaMetrics[], label?: string): string {
  const head = [
    pad('scenario', NAME_WIDTH),
    ...COLUMNS.map((c) => pad(c.head, c.width, true)),
  ].join(' ');
  const rule = '-'.repeat(head.length);
  const body = rows.map((m) =>
    [
      pad(m.scenario, NAME_WIDTH),
      ...COLUMNS.map((c) => pad(c.of(m), c.width, true)),
    ].join(' '),
  );

  const kinds = new Map<string, number>();
  for (const m of rows) {
    for (const [kind, n] of Object.entries({ ...m.hardByKind, ...m.softByKind })) {
      kinds.set(kind, (kinds.get(kind) ?? 0) + n);
    }
  }
  const footer = kinds.size
    ? `violations: ${[...kinds.entries()]
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, n]) => `${k}×${n}`)
        .join(', ')}`
    : 'violations: none';

  return [
    label ? `== ${label} ==` : null,
    head,
    rule,
    ...body,
    rule,
    footer,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/**
 * What changed between two runs, and whether any of it is a step backwards.
 *
 * Scenarios that came out identical are named on one line rather than given a
 * block each. A comparison whose output is mostly "no change" trains the
 * reader to skim, and the one line that mattered goes past with the rest.
 */
export function formatComparison(
  cmp: SuiteComparison,
  aLabel = 'A',
  bLabel = 'B',
): string {
  const lines: string[] = [`== ${aLabel} -> ${bLabel} ==`];
  const unchanged: string[] = [];

  for (const s of cmp.scenarios) {
    if (!s.quality.length && !s.economics.length && !s.spread.length) {
      unchanged.push(s.scenario);
      continue;
    }
    const verdict = s.newlyIllegal
      ? 'ILLEGAL'
      : s.worse
        ? 'WORSE'
        : s.better
          ? 'better'
          : 'same quality';
    lines.push(`${s.scenario}  [${verdict}]`);
    for (const d of s.quality) {
      lines.push(
        `    ${d.delta > 0 ? '!' : ' '} ${pad(d.axis, 16)} ${d.a} -> ${d.b}  (${sign(d.delta)})`,
      );
    }
    for (const d of [...s.economics, ...s.spread]) {
      lines.push(`      ${pad(d.axis, 16)} ${d.a} -> ${d.b}  (${sign(d.delta)})`);
    }
  }

  if (unchanged.length) {
    lines.push(`unchanged (${unchanged.length}): ${unchanged.join('; ')}`);
  }
  for (const name of cmp.missing) lines.push(`MISSING from ${bLabel}: ${name}`);
  for (const name of cmp.added) lines.push(`only in ${bLabel}: ${name}`);

  // Two lines, never one. The verdict answers the question that was asked --
  // is B a step backwards from A -- and illegality is reported beside it
  // rather than instead of it, saying how much of it B brought with it. Folding
  // the two together loses whichever one is not shouting.
  lines.push(
    cmp.newlyIllegal
      ? `VERDICT: ${bLabel} produces rotas that may not be shown to anyone.`
      : cmp.worse
        ? `VERDICT: ${bLabel} is worse than ${aLabel} on at least one quality axis.`
        : `VERDICT: ${bLabel} is no worse than ${aLabel}.`,
  );
  if (cmp.illegal) {
    const carried = cmp.scenarios.filter((s) => s.illegal && !s.newlyIllegal);
    const fresh = cmp.scenarios.filter((s) => s.newlyIllegal);
    if (fresh.length) {
      lines.push(`ILLEGAL, and ${aLabel} was not: ${fresh.map((s) => s.scenario).join('; ')}`);
    }
    if (carried.length) {
      lines.push(
        `illegal in both (${aLabel} too, so not this change): ${carried
          .map((s) => s.scenario)
          .join('; ')}`,
      );
    }
  }
  return lines.join('\n');
}
