// TypeScript mirror of the ShiftPlanner Phase 0 API contract.
// Keep in sync with the backend Pydantic *Out schemas.

import type { AppKey } from './lib/apps';

// ---- Enums ----------------------------------------------------------------

/**
 * Who is signed in. `store` is a shop account: the till's tablet, not a
 * person -- an employee's access to the inventory and the shop, and no shifts
 * (it has no calendar to see). What each may do is said by `permissions`.
 */
export type Role = 'manager' | 'employee' | 'store';

export type EmploymentStatus =
  | 'active'
  | 'onboarding'
  | 'on_leave'
  | 'resigned';

export type EmploymentType =
  | 'exempt_salaried'
  | 'non_exempt_hourly'
  | 'non_exempt_salaried';

export type AbsenceStatus =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type MovementType =
  | 'accrual'
  | 'consumption'
  | 'adjustment'
  | 'carryover'
  | 'expiration';

export type RuleHardness = 'hard' | 'soft';

/** How often someone is paid — agreed with their manager, held on the contract. */
export type PayPeriod = 'weekly' | 'biweekly' | 'monthly';

// ---- Auth -----------------------------------------------------------------

export interface UserOut {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  org_id: string;
  org_name: string;
  /** Labour jurisdiction of the business, e.g. 'ES-CT-HOSTELERIA'. */
  org_jurisdiction: string;
  employee_id: string | null;
  /**
   * The apps this business has on, as `GET /workspace` says them -- sent with
   * the user so the first screen after signing in need not wait for a second
   * request. Optional: a session saved in this browser before the server sent
   * it has none, and then the workspace is asked for instead. May name an app
   * this client does not know; read it through `activeApps` (lib/apps.ts).
   */
  apps?: AppKey[];
  /**
   * The business's workspace is still being set up -- said on its profile on
   * the server, as `GET /workspace` says it -- and the launcher says so above
   * whatever apps it has meanwhile. Optional for the same reason as `apps`;
   * missing reads as no.
   */
  preparing?: boolean;
  /**
   * What this account may do, as the server's table says it
   * (backend/app/access.py): read through `lib/access.ts`, never compared to
   * the role by hand. Optional: a session saved before the server sent it has
   * none, and then a manager is taken to have all and anybody else none,
   * until `GET /workspace` says.
   */
  permissions?: string[];
}

export interface AuthResponse {
  access_token: string;
  token_type: 'bearer';
  user: UserOut;
}

export interface SignupPayload {
  org_name: string;
  email: string;
  password: string;
  full_name: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

// ---- Contracts ------------------------------------------------------------

/**
 * Why a contract's night premium may sit below the agreement's, or at zero.
 * The only lawful one: the night work is already priced into the salary.
 */
export type NightPremiumBasis = 'included_in_salary';

export interface ContractOut {
  id: string;
  employee_id: string;
  employment_type: EmploymentType;
  base_annual_salary: number | null;
  hourly_rate: number | null;
  min_hours_per_week: number;
  max_hours_per_week: number | null;
  /** The complementary-hours pact, as a fraction. Null means no pact. */
  complementary_pct: number | null;
  /**
   * This person's own premiums. Null on each means "whatever the business
   * pays" (the org pay policy), which is not the same as zero: 0 is a real
   * answer -- "a Juan no le pago la nocturnidad" -- and is only lawful when
   * the night work is priced into the salary, which `night_premium_basis`
   * records (art. 36.2 ET).
   */
  night_premium_pct: number | null;
  weekend_premium_pct: number | null;
  overtime_multiplier: number | null;
  night_premium_basis: NightPremiumBasis | null;
  pay_period: PayPeriod;
  valid_from: string; // date (YYYY-MM-DD)
  valid_to: string | null; // date (YYYY-MM-DD)
  created_at: string; // datetime (ISO)
}

export interface ContractCreate {
  employment_type: EmploymentType;
  base_annual_salary: number | null;
  hourly_rate: number | null;
  min_hours_per_week: number;
  max_hours_per_week: number | null;
  /**
   * Share of the contracted hours agreed IN WRITING as complementary hours
   * (art. 12.5 ET), as a fraction. Null means no pact — which is not zero:
   * without one the employer may not require a single complementary hour, and
   * the working year reports the hours instead of counting them against a
   * quota. Only meaningful on a part-time contract.
   */
  complementary_pct: number | null;
  /** Percent, 0..200. Null = the business's figure. */
  night_premium_pct: number | null;
  /** Percent, 0..200. Null = the business's figure. */
  weekend_premium_pct: number | null;
  /** 1..5. Null = the business's figure; never below 1 (art. 35.1 ET). */
  overtime_multiplier: number | null;
  night_premium_basis: NightPremiumBasis | null;
  pay_period: PayPeriod;
  valid_from: string; // date
}

// ---- Employees ------------------------------------------------------------

export interface EmployeeOut {
  id: string;
  org_id: string;
  external_id: string;
  /** Contiguous 1..N position in the roster; recomputed after every delete. */
  display_number?: number;
  full_name: string;
  email: string | null;
  employment_status: EmploymentStatus;
  hire_date: string; // date
  current_contract: ContractOut | null;
  created_at: string; // datetime
}

export interface EmployeeCreate {
  /** null = let the server assign the next sequential code. */
  external_id: string | null;
  full_name: string;
  email: string | null;
  employment_status: EmploymentStatus;
  hire_date: string; // date
}

export type EmployeeUpdate = Partial<EmployeeCreate>;

/**
 * One line of the team the manager's brief described, as extracted by Claude.
 * Anonymous headcount ("5 employees") has name = null and count = N; a named
 * person has name set and count = 1. The client reconciles this against the
 * real roster — the roster is never sent to the model.
 */
export interface TeamMemberSpec {
  name: string | null;
  count: number;
  employmentType: EmploymentType | null;
  minHoursPerWeek: number | null;
  maxHoursPerWeek: number | null;
  hourlyRate: number | null;
  annualSalary: number | null;
  /**
   * This person's own premiums, when the brief states them. Null = not said.
   * 0 is meaningful ("no le pago la nocturnidad") and must not be read as
   * unstated. Optional on the wire: an intake from before these existed sends
   * nothing, and that has to read as "not said", not as a crash.
   */
  nightPremiumPct?: number | null;
  weekendPremiumPct?: number | null;
  overtimeMultiplier?: number | null;
  /** True = night work priced into the salary (art. 36.2 ET). */
  nightIncludedInSalary?: boolean | null;
  status: Exclude<EmploymentStatus, 'resigned'> | null;
  startsOn: string | null; // date (YYYY-MM-DD)
}

// ---- Published schedule ---------------------------------------------------

/**
 * A shift as the server stores it: an interval, not a set of grid cells.
 * Only rows with status 'published' are ever returned to an employee.
 */
export interface AssignmentOut {
  id: string;
  employee_id: string;
  start_at: string; // datetime (ISO)
  end_at: string; // datetime (ISO)
  shift_template_id: string | null;
  unpaid_break_minutes: number;
  status: 'draft' | 'published' | 'archived';
  source: 'ai' | 'manual';
  is_overtime: boolean;
  is_premium: boolean;
  published_at: string | null; // datetime
}

export interface PublishResult {
  published: number;
  replaced: number;
  published_at: string; // datetime
  /**
   * How many people were written to, and how many could not be.
   *
   * `notified` counts messages HANDED TO the mail provider, not messages read:
   * the send happens after the response and only the provider knows the rest.
   * `unreachable` is the one a manager acts on -- somebody whose shifts moved
   * and who will not hear it from us, because they have no login, no address
   * on it, or turned the email off. It is also everybody who changed when no
   * provider is configured at all, which is the honest answer rather than a
   * silent zero.
   *
   * Optional on the wire until the server that sends them is deployed: an app
   * loaded from a newer build against an older API must not render `undefined`
   * people as a number.
   */
  notified?: number;
  unreachable?: number;
  /**
   * Whether a mail provider is configured at all. When it is not, everybody
   * who changed is `unreachable` for a reason that has nothing to do with
   * their logins -- and the screen has to say THAT, or it sends a manager
   * hunting through the roster for a fault that is not there.
   */
  mail_configured?: boolean;
  /**
   * Shifts the publish refused because the person has approved time off.
   *
   * Dropped rather than rejected: a manager must not be stopped from
   * publishing a month over a shift they signed the holiday off for. Told,
   * though, because those hours are uncovered now.
   */
  skipped_on_leave?: number;
}

export interface DraftOut {
  saved: number;
  replaced: number;
  saved_at: string; // datetime
}

// ---- Organisation pay policy ---------------------------------------------

/** Stored on the org so the manager's payroll and the employee's estimate agree. */
export interface PayPolicyOut {
  night_differential_pct: number;
  weekend_premium_pct: number;
  overtime_multiplier: number;
}

// ---- Employee logins ------------------------------------------------------

export interface EmployeeAccountOut {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  created_at: string; // datetime
}

export interface EmployeeAccountCreate {
  /** null = reuse the address already on the employee record. */
  email: string | null;
  password: string;
}

// ---- Shift templates ------------------------------------------------------

export interface ShiftTemplateOut {
  id: string;
  org_id: string;
  name: string;
  /**
   * Set only on the templates WE seed at signup ('morning' | 'evening' |
   * 'night'); null on anything a manager created. `shiftTemplateLabel` reads
   * it -- never render it.
   */
  seed_key: string | null;
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  unpaid_break_minutes: number;
  color: string;
  is_night: boolean;
  is_weekend_premium: boolean;
}

export interface ShiftTemplateCreate {
  name: string;
  start_time: string; // "HH:MM"
  end_time: string; // "HH:MM"
  unpaid_break_minutes: number;
  color: string;
  is_night: boolean;
  is_weekend_premium: boolean;
}

// ---- Absence types --------------------------------------------------------

export interface AbsenceTypeOut {
  id: string;
  org_id: string;
  name: string;
  code: string;
  is_paid: boolean;
  consumes_balance: boolean;
  requires_approval: boolean;
  is_health_data: boolean;
  /**
   * Whether the hours this kind of leave excuses are worked back later.
   *
   * Holiday is not: the day is given. A day swapped for a busy Saturday is:
   * the hours were lent, and the hours worked back are ORDINARY hours rather
   * than overtime (art. 34 ET). Optional so a client reading an older server
   * keeps the only behaviour there used to be.
   */
  is_recoverable?: boolean;
}

// ---- Absences -------------------------------------------------------------

export interface AbsenceOut {
  id: string;
  org_id: string;
  employee_id: string;
  absence_type_id: string;
  start_at: string; // datetime
  end_at: string; // datetime
  status: AbsenceStatus;
  note: string | null;
  created_at: string; // datetime
}

/**
 * An absence just approved, and what approving it took off the calendar.
 *
 * Its own shape rather than three more fields on `AbsenceOut`: these numbers
 * are true of one MOMENT, not of the absence, and a listing whose every row
 * claimed to have cleared nothing would be saying something it does not know.
 */
export interface AbsenceApprovedOut extends AbsenceOut {
  shifts_cleared: number;
  hours_cleared: number;
  /** How many of them the team had already been shown. */
  published_cleared: number;
}

export interface AbsenceCreate {
  employee_id: string;
  absence_type_id: string;
  start_at: string; // datetime
  end_at: string; // datetime
  note: string | null;
}

// ---- Vacation ledger / balance -------------------------------------------

export interface VacationLedgerOut {
  id: string;
  movement_type: MovementType;
  days: number;
  effective_date: string; // date
  reason: string;
  created_at: string; // datetime
}

export interface VacationBalanceOut {
  employee_id: string;
  balance_days: number;
  ledger: VacationLedgerOut[];
}

// ---- Labor profiles / compliance rules -----------------------------------

export interface ComplianceRuleOut {
  id: string;
  rule_type: string;
  threshold: number | null;
  unit: string;
  reference_window: string;
  hardness: RuleHardness;
  premium_multiplier: number | null;
  notes: string;
}

export interface LaborProfileOut {
  id: string;
  jurisdiction_code: string;
  name: string;
  parent_code: string | null;
  effective_date: string; // date
  rules: ComplianceRuleOut[];
}

// ---- Generic API error ----------------------------------------------------

export interface ApiError {
  detail: string;
}

// ---- Back office ----------------------------------------------------------
// The platform operator's view: how many organizations are on the platform and
// how many of them pay. Mirrors app/schemas/backoffice.py. Note what is absent
// and stays absent -- no employee names, no salaries, no absence details. The
// back office counts customers, it does not read them.

export type Plan = 'trial' | 'starter' | 'growth' | 'scale';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled';

export interface PlatformAdminOut {
  id: string;
  email: string;
  full_name: string;
  last_login_at: string | null;
}

export interface PlatformAuthResponse {
  access_token: string;
  token_type: 'bearer';
  admin: PlatformAdminOut;
}

export interface PlatformLoginPayload {
  email: string;
  password: string;
}

export interface CustomerCounts {
  total: number;
  paying: number;
  trialing: number;
  trial_expired: number;
  past_due: number;
  canceled: number;
}

export interface PeopleCounts {
  managers_total: number;
  managers_paying: number;
  employees_total: number;
  employees_paying: number;
}

export interface UsageCounts {
  active_7d: number;
  active_30d: number;
  /** Paying and silent for 30+ days: churn that has already happened. */
  dormant_paying: number;
}

export interface PlanCount {
  plan: Plan;
  customers: number;
}

export interface MonthlyCount {
  /** YYYY-MM */
  month: string;
  signups: number;
  conversions: number;
  cancellations: number;
}

export interface MonthlySpend {
  /** YYYY-MM */
  month: string;
  usd: number;
}

/** What the platform's model calls cost. A cost, never a price. */
export interface ApiSpend {
  calls_30d: number;
  input_tokens_30d: number;
  output_tokens_30d: number;
  usd_30d: number;
  usd_total: number;
  by_purpose_30d: Record<string, number>;
  /** Twelve calendar months, oldest first. The provider's cap is monthly. */
  monthly: MonthlySpend[];
}

export interface PlatformMetrics {
  generated_at: string;
  customers: CustomerCounts;
  people: PeopleCounts;
  usage: UsageCounts;
  api_spend: ApiSpend;
  by_plan: PlanCount[];
  monthly: MonthlyCount[];
}

export interface Customer {
  org_id: string;
  org_name: string;
  jurisdiction_code: string;
  signed_up_at: string;
  plan: Plan;
  status: SubscriptionStatus;
  seats: number | null;
  trial_ends_at: string | null;
  activated_at: string | null;
  canceled_at: string | null;
  owner_name: string | null;
  owner_email: string | null;
  managers: number;
  employees: number;
  last_active_at: string | null;
}

export interface CustomerAdmin {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
}

export interface ApiCost {
  calls_30d: number;
  input_tokens_30d: number;
  output_tokens_30d: number;
  usd_30d: number;
  usd_total: number;
  by_purpose_30d: Record<string, number>;
}

export interface CustomerDetail extends Customer {
  admins: CustomerAdmin[];
  employee_logins: number;
  employees_by_status: Record<string, number>;
  shift_templates: number;
  absences_recorded: number;
  api_cost: ApiCost;
}

export interface CustomerList {
  total: number;
  items: Customer[];
}

export interface SubscriptionUpdate {
  plan?: Plan;
  status?: SubscriptionStatus;
  seats?: number | null;
  trial_ends_at?: string | null;
}

/** Result of removing a customer from the platform. Irreversible. */
export interface CustomerDeleted {
  org_id: string;
  name: string;
  deleted_employees: number;
  deleted_users: number;
}

// ---- The working year (art. 34 ET) ----------------------------------------

/** One rule broken, on one date. The wording lives in the UI, keyed by `rule`. */
export interface WorkdayError {
  rule: string;
  day: string;
  employee_id: string;
  detail: Record<string, number>;
}

/**
 * The same rule broken several times, said once.
 *
 * A breach is a property of a PERSON over the period, not of one week: the
 * same missing notice was written into every week it touched, so the screen
 * repeated one sentence five times and read as five separate problems. The
 * server groups them now -- first date, the most recent numbers, and how many
 * times it happened -- and the count is what the UI writes as "x3".
 */
export interface WorkdayFinding {
  rule: string;
  /** The first day this rule was broken in the period. */
  day: string;
  /** The numbers of the MOST RECENT occurrence: the state of things now. */
  detail: Record<string, number>;
  /** How many times this rule was broken. 1 for a single occurrence. */
  count: number;
}

/**
 * One person over the measured window, judged against their own contract.
 *
 * WHY THIS EXISTS BESIDE `WeekReport`. The week rows answer "what happened in
 * February"; this answers "is this person where their contract says they
 * should be", which is the only question the screen was ever opened for. It is
 * also the figure the planner's balance column and the employees list already
 * show, so the three screens finally say the same number.
 *
 * Everything here is OF THE PERIOD -- the window that was asked for -- and not
 * of the year. `period_expected` is what this contract asks for over exactly
 * those dates, which is what makes `period_deviation` readable without
 * knowing that 1.783 h/year happens to be 34,3 h/week.
 */
export interface EmployeeWorkday {
  employee_id: string;
  employee_name: string;
  /** The contracted week (art. 34.1 ET), as signed. */
  contracted_weekly: number;
  /** Part-time, which decides what this person's excess is CALLED. */
  part_time: boolean;
  period_hours: number;
  /** What the contract asks for over the window measured. */
  period_expected: number;
  /** `period_hours - period_expected`. Positive is over the contract. */
  period_deviation: number;
  /**
   * What the contract asks for over the part of the period NOBODY HAS PLANNED
   * yet -- hours still to hand out, not hours anybody is behind on.
   *
   * The same notion, and the same treatment, as `pending` in `BalancesOut`:
   * kept out of `period_expected` and out of `period_deviation`, shown on its
   * own line. This screen reports whole weeks, so a November drafted to the
   * hour was measured "from 1 Nov to 6 Dec" and charged with five days of a
   * December nobody had written -- the balance read −28,6 h while the
   * planner's column, which stops where the rota stops, read 0 h. One month,
   * two screens, two answers.
   *
   * Optional: a server that predates the field sends nothing, which reads as
   * zero and leaves this screen exactly as it was.
   */
  period_pending?: number;
  recovery_hours: number;
  /** Ordinary hours moved into the period under art. 34.2 -- early, not extra. */
  irregular_hours: number;
  /** Horas extraordinarias (art. 35). Full-time contracts only. */
  overtime_hours: number;
  /** Horas complementarias (art. 12.5). Part-time contracts only. */
  complementary_hours: number;
  /** Extra hours already answered by rest within four months (art. 35.1). */
  compensated_hours: number;
  findings: WorkdayFinding[];
}

/** Hours worked back, and the day off they answer. */
export interface RecoveryCredit {
  week: string;
  day_off: string;
  hours: number;
}

/** One employee, one week, measured against the working year. */
export interface WeekReport {
  employee_id: string;
  employee_name: string;
  week_start: string;
  week_hours: number;
  annual_hours_to_date: number;
  deviation_vs_average: number;
  /** The contracted week this row was judged against (art. 35.1 ET). */
  contracted_weekly: number;
  /** Whether this contract is part-time, which decides what its excess is
   *  CALLED: extra hours are unlawful here (art. 12.4.c), complementary ones
   *  are what takes their place. */
  part_time: boolean;
  /** This contract's own share of the 80-hour year (art. 35.2). */
  overtime_cap: number | null;
  recovery_hours: number;
  /** Ordinary hours moved here under art. 34.2 — early, not extra. */
  irregular_hours: number;
  /** Horas extraordinarias (art. 35). Full-time contracts only. */
  overtime_hours: number;
  /** Horas complementarias (art. 12.5). Part-time contracts only. */
  complementary_hours: number;
  /** Extra hours already answered by rest within four months (art. 35.1). */
  compensated_hours: number;
  errors: WorkdayError[];
  recovery_credits: RecoveryCredit[];
}

/**
 * The working year for a period.
 *
 * `regime` is what makes the rest readable: under `annual_average` a week
 * above the contract is not a breach and the deviation is the figure that
 * matters, while `weekly_ceiling` is every jurisdiction that has not said
 * otherwise and keeps the reading it always had.
 */
export interface WorkdayOut {
  regime: 'annual_average' | 'weekly_ceiling';
  weekly_average_hours: number | null;
  annual_hours: number | null;
  irregular_pct: number | null;
  irregular_notice_days: number | null;
  /** Extra hours a full-time year may hold (art. 35.2: 80). */
  annual_overtime_cap: number | null;
  /** Months within which rest still answers an extra hour (art. 35.1: 4). */
  overtime_compensation_months: number | null;
  /** Whether a part-time contract may work extra hours here at all. */
  part_time_overtime_allowed: boolean;
  year_start: string;
  /**
   * First and last day actually measured: the window the figures are of.
   *
   * Nullable because a period with no week in it has no span to report, and a
   * screen that prints a balance without saying over what is asking to be
   * misread -- so the header states it, or states nothing.
   */
  period_start: string | null;
  period_end: string | null;
  /**
   * EXCLUSIVE end of what is actually measured, "YYYY-MM-DD".
   *
   * `period_end` is the end of the window the figures were asked for, rounded
   * out to whole weeks; this is where the rota -- published or drafted --
   * stops. The two differ every time a month is planned and the month after
   * it is not, and it is the second one that `period_expected` is computed to.
   * The header has to state this one, or it promises a measurement of days
   * that were never measured.
   *
   * Optional, and null when there is nothing measured at all. Absent means an
   * older server: the screen then says what it always said.
   */
  period_measured_to?: string | null;
  /**
   * The day this business first published a rota for, or null if it never has.
   *
   * Nothing before it counts against anybody -- a year measured from the 1st of
   * January would show everybody a thousand hours short of a contract nobody
   * was working under yet. Same field, same reason, as `BalancesOut`.
   */
  cycle_start: string | null;
  /** One row per person: the reading the screen leads with. */
  employees: EmployeeWorkday[];
  weeks: WeekReport[];
}
