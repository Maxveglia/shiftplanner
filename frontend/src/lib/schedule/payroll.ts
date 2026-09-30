// Hours worked -> money owed.
//
// This closes the loop: a schedule is only useful if it tells the manager what
// it costs to run. Every figure here is DERIVED from the shifts on the
// calendar and the employee's own contract -- nothing is entered twice.
//
// Pay components, in the order US payroll applies them:
//   base       every scheduled hour at the contract rate
//   overtime   hours past the person's own contracted week, at the
//              jurisdiction's multiplier, non-exempt only. NOT past 40: art.
//              35.1 ET measures an extra hour against the contract, and the
//              hours are counted for us in `generate.ts` (ordinaryWeeklyHours)
//   night      a differential on hours worked in the night window
//   weekend    a premium on hours worked on the business's weekend
// Exempt salaried staff earn their salary regardless, so they show hours but
// no hourly pay -- scheduling them costs nothing extra at the margin.
//
// The three premiums are the BUSINESS's (the org pay policy) unless the
// person's contract says otherwise -- see `effectivePolicy`.

import type { EmployeeOut } from '../../types';
import { DEFAULT_WEEKEND_DAYS } from './demand';
import type { NightWindow } from './night';
import { premiumHours } from './premiums';
import { hourlyRate, type YearBasis } from './rate';
import type { Assignment, DayRef } from './types';

export interface PayPolicy {
  /** Extra % paid for hours inside the night window. */
  nightDifferentialPct: number;
  /** Extra % paid for hours worked on Saturday or Sunday. */
  weekendPremiumPct: number;
  /**
   * What an extra hour costs, as a multiple of an ordinary one.
   *
   * Art. 35.1 ET sets no premium at all: an extra hour is paid at least as
   * much as an ordinary one, or given back as rest within four months. So the
   * default is 1, and a business that pays more says so.
   */
  overtimeMultiplier: number;
}

/**
 * What a screen prices with before the server has answered.
 *
 * These are the numbers a business here is created with (`routers/auth.py`),
 * not the ones this code was born with: 15/10/1.5 was the FLSA and a US
 * convention, and for the blink before `/org/pay-policy` replies it showed a
 * Spanish manager a night premium they do not pay and an overtime hour half
 * again as dear as any they have ever paid.
 */
export const DEFAULT_PAY_POLICY: PayPolicy = {
  nightDifferentialPct: 25,
  weekendPremiumPct: 0,
  overtimeMultiplier: 1,
};

/**
 * The premiums one person is actually paid: their contract's own figure where
 * it has one, the business's where it does not.
 *
 * Exported so the employee form, the payroll table and the tests all read the
 * same answer. A null on the contract means INHERIT, and a 0 means zero -- so
 * `??`, never `||`: "a Juan no le pago la nocturnidad" is a 0 that must not
 * turn back into the business's 25%.
 */
export function effectivePolicy(
  employee: EmployeeOut,
  policy: PayPolicy,
): PayPolicy {
  const c = employee.current_contract;
  const own = (v: number | string | null | undefined): number | null =>
    v == null || !Number.isFinite(Number(v)) ? null : Number(v);
  return {
    nightDifferentialPct: own(c?.night_premium_pct) ?? policy.nightDifferentialPct,
    weekendPremiumPct: own(c?.weekend_premium_pct) ?? policy.weekendPremiumPct,
    overtimeMultiplier: own(c?.overtime_multiplier) ?? policy.overtimeMultiplier,
  };
}

/** Which of a person's premiums are their own rather than the business's. */
export interface OwnPremiums {
  night: boolean;
  weekend: boolean;
  overtime: boolean;
}

export function ownPremiums(employee: EmployeeOut): OwnPremiums {
  const c = employee.current_contract;
  return {
    night: c?.night_premium_pct != null,
    weekend: c?.weekend_premium_pct != null,
    overtime: c?.overtime_multiplier != null,
  };
}

/**
 * Whether a person's night premium sits under the agreement's floor with no
 * reason on file for it.
 *
 * A warning, never a block. The only lawful reason (art. 36.2 ET) is that the
 * night work is priced into the salary, which the contract records as
 * `night_premium_basis`; an exempt salaried person's pay does not move with
 * their hours, so their nights are not priced here at all. `floor` is null
 * where no agreement states a figure, and then there is nothing to be under.
 */
export function nightPremiumBelowFloor(
  employee: EmployeeOut,
  policy: PayPolicy,
  floor: number | null,
): boolean {
  if (floor == null) return false;
  const c = employee.current_contract;
  if (!c || c.employment_type === 'exempt_salaried') return false;
  if (c.night_premium_basis === 'included_in_salary') return false;
  return effectivePolicy(employee, policy).nightDifferentialPct < floor;
}

export interface EmployeePay {
  employee: EmployeeOut;
  isSalaried: boolean;
  /** The premiums priced for this person: their own, else the business's. */
  policy: PayPolicy;
  /** Which of `policy` came from their contract rather than the business. */
  own: OwnPremiums;
  /** Contract rate, $/h. */
  rate: number;
  /** $/h actually paid for an overtime hour (rate x multiplier). */
  overtimeRate: number;
  /** EXTRA $/h added for an hour inside the night window. */
  nightRate: number;
  /** EXTRA $/h added for an hour worked on Sat/Sun. */
  weekendRate: number;
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  nightHours: number;
  weekendHours: number;
  basePay: number;
  overtimePay: number;
  nightPay: number;
  weekendPay: number;
  totalPay: number;
  /** Contracted weekly minimum scaled to the period, for the shortfall hint. */
  expectedHours: number;
}

export interface PayrollSummary {
  rows: EmployeePay[];
  totalHours: number;
  totalPay: number;
  totalOvertimeHours: number;
}

function isExemptSalaried(e: EmployeeOut): boolean {
  return e.current_contract?.employment_type === 'exempt_salaried';
}

export function computePayroll(
  assignments: Assignment[],
  employees: EmployeeOut[],
  days: DayRef[],
  policy: PayPolicy = DEFAULT_PAY_POLICY,
  /** Which weekdays earn the weekend differential. */
  weekendDays: number[] = DEFAULT_WEEKEND_DAYS,
  /**
   * What a year of work is here, to turn an annual salary into an hourly
   * rate. Left empty, a salary is spread over its contracted week times 52.
   */
  year: YearBasis = {},
  /**
   * The hours this jurisdiction calls night, as the spec states them. Left
   * empty, 22:00-06:00 -- the window this table always paid on, so a caller
   * that says nothing is paid exactly what it was.
   */
  nightWindow?: NightWindow | null,
): PayrollSummary {
  const weekdayOf = new Map(days.map((d) => [d.date, d.weekday]));
  const weeks = Math.max(1, days.length / 7);

  const rows: EmployeePay[] = employees.map((employee) => {
    const mine = assignments.filter((a) => a.employeeId === employee.id);
    const rate = hourlyRate(employee, year);
    const salaried = isExemptSalaried(employee);
    const personal = effectivePolicy(employee, policy);
    const own = ownPremiums(employee);

    let totalHours = 0;
    let overtimeHours = 0;
    let nightHours = 0;
    let weekendHours = 0;

    for (const a of mine) {
      totalHours += a.paidHours;
      overtimeHours += a.overtimeHours;

      // Which of those hours earn a premium is asked of `premiumHours`, the
      // same question the generator asks when it books a shift's cost -- see
      // ./premiums for the two conventions it keeps. Night is scaled by the
      // paid ratio, so a 30-min break never inflates the premium hours; the
      // weekend is the whole shift, counted against the day it STARTS on.
      // That is not the convention the night window uses, and the difference
      // is real money on an overnight shift: Friday 18:00-04:00 earns no
      // weekend premium for its four Saturday hours. Splitting it would change
      // what people are paid rather than where a constant lives, so it stays
      // a separate decision.
      const premium = premiumHours(a, weekdayOf.get(a.date), nightWindow, weekendDays);
      nightHours += premium.night;
      weekendHours += premium.weekend;
    }

    const regularHours = Math.max(0, totalHours - overtimeHours);

    // Exempt salaried: the salary is owed regardless of the roster, so the
    // period's cost is a straight proration -- no overtime, no differentials.
    if (salaried) {
      const annual = Number(employee.current_contract?.base_annual_salary ?? 0);
      const totalPay = (annual / 365) * days.length;
      return {
        employee,
        isSalaried: true,
        policy: personal,
        own,
        rate,
        overtimeRate: 0,
        nightRate: 0,
        weekendRate: 0,
        totalHours,
        regularHours,
        overtimeHours: 0,
        nightHours,
        weekendHours,
        basePay: totalPay,
        overtimePay: 0,
        nightPay: 0,
        weekendPay: 0,
        totalPay,
        expectedHours:
          Number(employee.current_contract?.min_hours_per_week ?? 0) * weeks,
      };
    }

    const overtimeRate = rate * personal.overtimeMultiplier;
    const nightRate = rate * (personal.nightDifferentialPct / 100);
    const weekendRate = rate * (personal.weekendPremiumPct / 100);

    const basePay = regularHours * rate;
    const overtimePay = overtimeHours * overtimeRate;
    const nightPay = nightHours * nightRate;
    const weekendPay = weekendHours * weekendRate;

    return {
      employee,
      isSalaried: false,
      policy: personal,
      own,
      rate,
      overtimeRate,
      nightRate,
      weekendRate,
      totalHours,
      regularHours,
      overtimeHours,
      nightHours,
      weekendHours,
      basePay,
      overtimePay,
      nightPay,
      weekendPay,
      totalPay: basePay + overtimePay + nightPay + weekendPay,
      expectedHours:
        Number(employee.current_contract?.min_hours_per_week ?? 0) * weeks,
    };
  });

  return {
    rows,
    totalHours: rows.reduce((s, r) => s + r.totalHours, 0),
    totalPay: rows.reduce((s, r) => s + r.totalPay, 0),
    totalOvertimeHours: rows.reduce((s, r) => s + r.overtimeHours, 0),
  };
}
