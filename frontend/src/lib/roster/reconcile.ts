// Reconcile the team a manager DESCRIBED in the brief against the team that
// actually exists in the roster. The output is a plan — create these, update
// these, retire these — that the manager confirms before anything is written.
//
// Design contract:
// - Identity is never rewritten. A "resignation" is a status change to
//   `resigned` (the roster already hides those), never a delete: payroll,
//   shift and vacation history stay pointing at a real employee.
// - Characteristics (type, hours, pay) live on the versioned Contract, so a
//   change proposes a NEW contract version, not an in-place edit.
// - Nothing here calls the API. This is a pure function so the proposal shown
//   to the manager is exactly what will be applied.

import type {
  ContractOut,
  EmployeeOut,
  EmploymentType,
  EmploymentStatus,
  NightPremiumBasis,
  PayPeriod,
  TeamMemberSpec,
} from '../../types';
import { employmentStatusLabel, employmentTypeLabel } from '../format';
import { translate } from '../i18n/core';
import { APP_LOCALE } from '../locale';

export interface ContractDraft {
  employmentType: EmploymentType;
  minHoursPerWeek: number;
  maxHoursPerWeek: number | null;
  hourlyRate: number | null;
  annualSalary: number | null;
  /**
   * The rest of the contract, which no sentence about pay or hours is ABOUT
   * and which therefore has to be carried over from the current version.
   *
   * A new contract version is a whole contract, not a patch: whatever the
   * POST leaves out, the server fills with its default. Before these were
   * here, "Ana now earns 14 an hour" opened a version with no complementary
   * hours pact and a monthly pay period -- the pact she signed and the weekly
   * payslip she is on were gone, and nobody had said a word about either.
   */
  complementaryPct: number | null;
  payPeriod: PayPeriod;
  /** Own premiums; null on each = the business's figure. 0 is a real value. */
  nightPremiumPct: number | null;
  weekendPremiumPct: number | null;
  overtimeMultiplier: number | null;
  nightPremiumBasis: NightPremiumBasis | null;
}

/** What a contract with no view of its own on these says: inherit, monthly. */
const NOTHING_ELSE: Pick<
  ContractDraft,
  | 'complementaryPct'
  | 'payPeriod'
  | 'nightPremiumPct'
  | 'weekendPremiumPct'
  | 'overtimeMultiplier'
  | 'nightPremiumBasis'
> = {
  complementaryPct: null,
  // The server's own default, so a draft that states none writes what an
  // omitted field always did.
  payPeriod: 'monthly',
  nightPremiumPct: null,
  weekendPremiumPct: null,
  overtimeMultiplier: null,
  nightPremiumBasis: null,
};

/**
 * The fields a sentence about pay does not touch, as the current contract has
 * them. The one place both paths (the brief and the refine ops) read them, so
 * they cannot drift into carrying different things.
 */
export function carriedTerms(
  current: ContractOut | null,
): typeof NOTHING_ELSE {
  if (!current) return { ...NOTHING_ELSE };
  return {
    complementaryPct: current.complementary_pct ?? null,
    payPeriod: current.pay_period ?? 'monthly',
    nightPremiumPct: numOrNull(current.night_premium_pct),
    weekendPremiumPct: numOrNull(current.weekend_premium_pct),
    overtimeMultiplier: numOrNull(current.overtime_multiplier),
    nightPremiumBasis: current.night_premium_basis ?? null,
  };
}

/**
 * The reason on file for a low night premium, after a sentence about it.
 *
 * Three answers, not two. True: the night is priced into the salary. False:
 * it is not, so any reason on file goes. Null: the sentence did not say, and
 * whatever the contract already records stands -- "Juan cobra 12 la hora"
 * must not quietly erase why Juan's nights carry no premium.
 */
export function nightBasis(
  included: boolean | null | undefined,
  current: NightPremiumBasis | null,
): NightPremiumBasis | null {
  if (included === true) return 'included_in_salary';
  if (included === false) return null;
  return current;
}

// Decimal columns can arrive as strings; null stays null (it means inherit).
function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface PlannedCreate {
  kind: 'create';
  key: string;
  name: string;
  status: EmploymentStatus;
  hireDate: string; // YYYY-MM-DD
  contract: ContractDraft | null; // null = create the person without terms yet
  reason: string;
}

export interface PlannedUpdate {
  kind: 'update';
  key: string;
  employeeId: string;
  name: string;
  changes: string[];
  status: EmploymentStatus | null; // set when the status changes
  newContract: ContractDraft | null; // set when a new contract version is needed
}

export interface PlannedResign {
  kind: 'resign';
  key: string;
  employeeId: string;
  name: string;
  reason: string;
}

export interface RosterPlan {
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  resignations: PlannedResign[];
}

export function isEmptyPlan(plan: RosterPlan | null): boolean {
  return (
    !plan ||
    (plan.creates.length === 0 &&
      plan.updates.length === 0 &&
      plan.resignations.length === 0)
  );
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The contract to open for someone the brief describes for the FIRST time.
 *
 * Never null, and that is the whole point. It used to be: a brief that named
 * people without stating hours produced `draftContract` -> null, `apply` then
 * skipped the contract, and `availability()` refuses anyone whose contract is
 * missing -- on every day, silently. "Somos cinco: Hugo, Adri, Aldridge, Ethan
 * y Uri" therefore created five employees nobody could be given a shift, and
 * the manager got an empty calendar with nothing on screen saying why.
 *
 * Naming someone IS the instruction to schedule them. So when the brief states
 * no terms we open the weakest contract that can be true: paid hourly, NO
 * guaranteed weekly minimum, no ceiling of its own, and no rate. That invents
 * no pay and commits the business to no hours -- it only makes the person
 * someone a shift can be given to. The manager sets real terms in Employees,
 * and is told that is still to do.
 *
 * Only for CREATES. An existing employee keeps `draftContract`, so a brief
 * that mentions Hugo without mentioning his hours can never overwrite the
 * 40-hour contract he already has.
 */
export function contractForNewHire(m: TeamMemberSpec): ContractDraft {
  return (
    draftContract(m) ?? {
      employmentType: 'non_exempt_hourly',
      minHoursPerWeek: 0,
      maxHoursPerWeek: null,
      hourlyRate: null,
      annualSalary: null,
      ...NOTHING_ELSE,
    }
  );
}

function statesPremiums(m: TeamMemberSpec): boolean {
  return (
    m.nightPremiumPct != null ||
    m.weekendPremiumPct != null ||
    m.overtimeMultiplier != null ||
    m.nightIncludedInSalary != null
  );
}

/**
 * Build the contract terms a team line states, or null if it states none.
 *
 * `current` is the contract the person already has, when they have one. What
 * the line does not mention is carried from it: the pact and the pay period
 * always (a brief never talks about them), the premiums unless the line
 * states them. And a line that states ONLY premiums -- "a Juan no le pago la
 * nocturnidad" -- keeps the rest of the contract as it is: without that it
 * would be read as a whole new contract and Juan's 40 hours would become an
 * hourly one with no minimum.
 */
export function draftContract(
  m: TeamMemberSpec,
  current: ContractOut | null = null,
): ContractDraft | null {
  const statesPay =
    m.employmentType !== null ||
    m.minHoursPerWeek !== null ||
    m.maxHoursPerWeek !== null ||
    m.hourlyRate !== null ||
    m.annualSalary !== null;
  if (!statesPay && !statesPremiums(m)) return null;

  const carried = carriedTerms(current);
  const premiums = {
    ...carried,
    nightPremiumPct: m.nightPremiumPct ?? carried.nightPremiumPct,
    weekendPremiumPct: m.weekendPremiumPct ?? carried.weekendPremiumPct,
    overtimeMultiplier: m.overtimeMultiplier ?? carried.overtimeMultiplier,
    nightPremiumBasis: nightBasis(
      m.nightIncludedInSalary,
      carried.nightPremiumBasis,
    ),
  };

  if (!statesPay && current) {
    return {
      employmentType: current.employment_type,
      minHoursPerWeek: Number(current.min_hours_per_week),
      maxHoursPerWeek: numOrNull(current.max_hours_per_week),
      hourlyRate: numOrNull(current.hourly_rate),
      annualSalary: numOrNull(current.base_annual_salary),
      ...premiums,
    };
  }

  const type: EmploymentType =
    m.employmentType ??
    (m.annualSalary !== null ? 'exempt_salaried' : 'non_exempt_hourly');
  const min =
    m.minHoursPerWeek !== null
      ? m.minHoursPerWeek
      : type === 'exempt_salaried'
        ? 40
        : 0;

  return {
    employmentType: type,
    minHoursPerWeek: min,
    maxHoursPerWeek: m.maxHoursPerWeek,
    hourlyRate: m.hourlyRate,
    annualSalary: m.annualSalary,
    ...premiums,
  };
}

function contractDiffers(cur: ContractOut | null, d: ContractDraft): boolean {
  if (!cur) return true;
  return (
    cur.employment_type !== d.employmentType ||
    Number(cur.min_hours_per_week) !== d.minHoursPerWeek ||
    (cur.max_hours_per_week ?? null) !== d.maxHoursPerWeek ||
    (cur.hourly_rate ?? null) !== d.hourlyRate ||
    (cur.base_annual_salary ?? null) !== d.annualSalary ||
    numOrNull(cur.night_premium_pct) !== d.nightPremiumPct ||
    numOrNull(cur.weekend_premium_pct) !== d.weekendPremiumPct ||
    numOrNull(cur.overtime_multiplier) !== d.overtimeMultiplier ||
    (cur.night_premium_basis ?? null) !== d.nightPremiumBasis
  );
}

/**
 * The premiums a draft sets for the person, as short phrases for the manager.
 *
 * Only what differs from inheriting: a draft that follows the business on
 * everything says nothing here, because there is nothing to confirm.
 */
export function describePremiums(
  d: Pick<
    ContractDraft,
    'nightPremiumPct' | 'weekendPremiumPct' | 'overtimeMultiplier' | 'nightPremiumBasis'
  >,
): string[] {
  const parts: string[] = [];
  // A zero with its reason on file reads as the reason alone: "night premium
  // 0%, included in the salary" says the same thing twice.
  if (d.nightPremiumPct === 0) {
    if (d.nightPremiumBasis === null)
      parts.push(translate('roster.plan.terms.noNightPremium'));
  } else if (d.nightPremiumPct !== null)
    parts.push(translate('roster.plan.terms.nightPremium', { pct: d.nightPremiumPct }));
  if (d.nightPremiumBasis === 'included_in_salary')
    parts.push(translate('roster.plan.terms.nightInSalary'));
  if (d.weekendPremiumPct !== null)
    parts.push(
      translate('roster.plan.terms.weekendPremium', { pct: d.weekendPremiumPct }),
    );
  if (d.overtimeMultiplier !== null)
    parts.push(
      translate('roster.plan.terms.overtimeMultiplier', {
        mult: d.overtimeMultiplier,
      }),
    );
  return parts;
}

function describeContract(d: ContractDraft): string {
  const parts = [employmentTypeLabel(d.employmentType)];
  if (d.minHoursPerWeek > 0)
    parts.push(
      translate('roster.plan.terms.minHoursPerWeek', { hours: d.minHoursPerWeek }),
    );
  if (d.hourlyRate !== null)
    parts.push(translate('roster.plan.terms.hourlyRate', { rate: d.hourlyRate }));
  if (d.annualSalary !== null)
    parts.push(
      translate('roster.plan.terms.annualSalary', {
        amount: d.annualSalary.toLocaleString(APP_LOCALE),
      }),
    );
  parts.push(...describePremiums(d));
  return parts.join(', ');
}

function createStatus(m: TeamMemberSpec, hireDate: string, today: string): EmploymentStatus {
  if (m.status) return m.status;
  // Someone whose start date is still in the future is onboarding, not active.
  return hireDate > today ? 'onboarding' : 'active';
}

let counter = 0;
function key(): string {
  counter += 1;
  return `plan-${counter}`;
}

// The generated name is translated, so the numbering has to recognise both
// spellings: a roster can hold people created before the language was changed.
const PLACEHOLDER = /^(?:new hire|nueva incorporaci[oó]n) (\d+)$/;

/**
 * A distinct name for someone the manager described but did not name.
 *
 * They have to be told apart on the calendar and addressable by name in the
 * next sentence ("New hire 2 is called Ana"), so three anonymous cooks must not
 * all be called the same thing. Numbers continue past the ones already taken.
 */
export function nextPlaceholderName(taken: { full_name: string }[]): string {
  let highest = 0;
  for (const e of taken) {
    const m = PLACEHOLDER.exec(e.full_name.trim().toLowerCase());
    if (m) highest = Math.max(highest, parseInt(m[1], 10));
  }
  return translate('roster.plan.placeholderName', { n: highest + 1 });
}

function buildUpdate(e: EmployeeOut, m: TeamMemberSpec): PlannedUpdate | null {
  const changes: string[] = [];
  let status: EmploymentStatus | null = null;
  if (m.status && m.status !== e.employment_status) {
    status = m.status;
    changes.push(
      translate('roster.plan.change.status', {
        status: employmentStatusLabel(m.status),
      }),
    );
  }
  const draft = draftContract(m, e.current_contract);
  let newContract: ContractDraft | null = null;
  if (draft && contractDiffers(e.current_contract, draft)) {
    newContract = draft;
    changes.push(
      translate('roster.plan.change.contract', {
        contract: describeContract(draft),
      }),
    );
  }
  if (changes.length === 0) return null;
  return {
    kind: 'update',
    key: key(),
    employeeId: e.id,
    name: e.full_name,
    changes,
    status,
    newContract,
  };
}

function buildCreate(
  m: TeamMemberSpec,
  name: string,
  today: string,
  reason: string,
): PlannedCreate {
  const hireDate = m.startsOn ?? today;
  return {
    kind: 'create',
    key: key(),
    name,
    status: createStatus(m, hireDate, today),
    hireDate,
    contract: contractForNewHire(m),
    reason,
  };
}

function groupReason(g: TeamMemberSpec): string {
  const bits: string[] = [];
  if (g.employmentType) bits.push(employmentTypeLabel(g.employmentType));
  if (g.minHoursPerWeek !== null)
    bits.push(
      translate('roster.plan.terms.hoursPerWeek', { hours: g.minHoursPerWeek }),
    );
  return bits.length
    ? translate('roster.plan.reason.fromBrief', { terms: bits.join(', ') })
    : translate('roster.plan.reason.headcount');
}

/**
 * Compare the described team with the real roster.
 *
 * Matching is deliberately boring and explainable: named people match existing
 * employees by name; anonymous headcount claims unmatched active employees
 * first and only creates the shortfall; anyone left unclaimed becomes a
 * (default-off) resignation suggestion. Full reconciliation — the brief is the
 * source of truth — but every line is confirmed by the manager.
 */
export function reconcile(
  team: TeamMemberSpec[],
  roster: EmployeeOut[],
  today: string,
): RosterPlan {
  const creates: PlannedCreate[] = [];
  const updates: PlannedUpdate[] = [];
  const claimed = new Set<string>();

  const named = team.filter((m) => m.name && m.name.trim());
  const groups = team.filter((m) => !(m.name && m.name.trim()));

  // 1. Named people — match by name (so re-mentioning never duplicates, and a
  //    resigned person named again is reactivated rather than recreated).
  for (const m of named) {
    const nm = norm(m.name!);
    const match = roster.find(
      (e) => !claimed.has(e.id) && norm(e.full_name) === nm,
    );
    if (match) {
      claimed.add(match.id);
      const upd = buildUpdate(match, m);
      if (upd) updates.push(upd);
    } else {
      creates.push(
        buildCreate(
          m,
          m.name!.trim(),
          today,
          draftContract(m)
            ? translate('roster.plan.reason.named')
            : translate('roster.plan.reason.namedNoTerms'),
        ),
      );
    }
  }

  // 2. Anonymous headcount — satisfy the count from unclaimed active employees
  //    first, then create the shortfall as placeholders the manager renames.
  for (const g of groups) {
    const want = Math.max(1, g.count);
    let filled = 0;
    for (const e of roster) {
      if (filled >= want) break;
      if (claimed.has(e.id) || e.employment_status === 'resigned') continue;
      claimed.add(e.id);
      filled += 1;
      const upd = buildUpdate(e, g);
      if (upd) updates.push(upd);
    }
    for (; filled < want; filled += 1) {
      // Numbered, not all called the same: the manager renames them by saying
      // "New hire 2 is called Ana" once the calendar is up.
      const name = nextPlaceholderName([
        ...roster,
        ...creates.map((c) => ({ full_name: c.name })),
      ]);
      creates.push(buildCreate(g, name, today, groupReason(g)));
    }
  }

  // 3. Resignations — active people unclaimed by the brief. Off by default in
  //    the UI: only meaningful if the brief is the whole team. Someone already
  //    resigned, or on leave, is never suggested: a medical leave is expected
  //    to be absent from a staffing brief and is still very much employed.
  const resignations: PlannedResign[] = [];
  for (const e of roster) {
    if (claimed.has(e.id)) continue;
    if (e.employment_status === 'resigned' || e.employment_status === 'on_leave')
      continue;
    resignations.push({
      kind: 'resign',
      key: key(),
      employeeId: e.id,
      name: e.full_name,
      reason: translate('roster.plan.reason.notMentioned'),
    });
  }

  return { creates, updates, resignations };
}
