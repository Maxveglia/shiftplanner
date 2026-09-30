// What one hour of a person's contract is worth.
//
// One definition for the two places that price an hour: the payroll table and
// the generator's cost. They used to hold a copy each, and both copies turned
// an annual salary into an hourly one by dividing by 2080 -- the FLSA's year
// of 52 forty-hour weeks. That is not the year anybody here works. The Barcelona
// hospitality agreement fixes 1,783 hours; dividing by 2080 priced every hour
// of a salaried person about a sixth below what it costs.

import type { EmployeeOut } from '../../types';

/** The two figures of the jurisdiction a year of work is read from. */
export interface YearBasis {
  /** Hours of effective work a full-time year is, where an agreement fixes one. */
  annualHours?: number | null;
  /** The full-time week, read as an annual average (Spain: 40). */
  weeklyAverageHours?: number | null;
}

/** Last resort when nothing says what a year is: the FLSA's, as before. */
const UNKNOWN_YEAR_HOURS = 2080;

/**
 * The hours a year of this contract is.
 *
 * Mirrors `expected_annual_hours` on the server (services/workday.py), so the
 * payroll and the annual-hours view agree on what a year is:
 *   - the agreed year, in the contract's share of a full-time week;
 *   - the whole agreed year when that share cannot be known;
 *   - the contracted week times 52 when no agreement fixes a year;
 *   - null when the contract states no hours either.
 *
 * The week is the contract's maximum, else its minimum -- the same reading as
 * `contractedHours` in generate.ts and `ContractTerms.weekly_hours` on the
 * server. Not imported from generate.ts, which imports this module.
 */
export function contractYearHours(
  e: EmployeeOut,
  basis: YearBasis = {},
): number | null {
  const c = e.current_contract;
  const max = c?.max_hours_per_week;
  const weekly = Number(max ?? c?.min_hours_per_week ?? 0);
  const { annualHours, weeklyAverageHours } = basis;
  if (annualHours != null && annualHours > 0) {
    if (weeklyAverageHours == null || weeklyAverageHours <= 0 || weekly <= 0) {
      return annualHours;
    }
    return annualHours * Math.min(weekly / weeklyAverageHours, 1);
  }
  return weekly > 0 ? weekly * 52 : null;
}

/**
 * The contract's rate per hour: the stated one, else the annual salary spread
 * over the hours a year of that contract is. `fallback` when the contract
 * states neither -- the two callers want different things there: payroll
 * pays nothing it cannot read, the generator still has to compare people.
 */
export function hourlyRate(
  e: EmployeeOut,
  basis: YearBasis = {},
  fallback = 0,
): number {
  const c = e.current_contract;
  if (!c) return fallback;
  if (c.hourly_rate != null) return Number(c.hourly_rate);
  if (c.base_annual_salary != null) {
    const year = contractYearHours(e, basis) ?? UNKNOWN_YEAR_HOURS;
    return Number(c.base_annual_salary) / year;
  }
  return fallback;
}
