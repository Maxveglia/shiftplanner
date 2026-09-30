// The bug end to end, in one file: brief -> roster plan -> employees ->
// calendar.
//
// Each half of this was individually defensible. `draftContract` returning null
// for a brief that stated no terms was right; `availability` refusing anyone
// without a contract was right; `apply` skipping a null contract was right. Put
// together they produced five employees nobody could be given a shift, and a
// calendar that came back empty with nothing on screen saying why.
//
// So the regression test is the whole chain, not any one link, and it is
// written as a pair: the fixed path must produce a full calendar, and the same
// people WITHOUT contracts must produce the empty one. If the second half ever
// stops failing to schedule, the first half has stopped proving anything.

import { describe, expect, it } from 'vitest';
import { reconcile } from './reconcile';
import { generateSchedule } from '../schedule/generate';
import type { ContractOut, EmployeeOut } from '../../types';
import type { PlannedCreate } from './reconcile';
import { absenceType, days, member, spec } from '../../test/factories';

const TODAY = '2026-03-01';
const WEEK = days(TODAY, 7);
const TEAM = ['Hugo', 'Adri', 'Aldridge', 'Ethan', 'Uri'];

/**
 * The employee the API would hand back for a planned create.
 *
 * `apply.ts` posts the employee and then its contract, valid from the hire
 * date, and skips the contract entirely when the plan carries none — so a plan
 * with `contract: null` really does come back as `current_contract: null`.
 */
function asEmployee(create: PlannedCreate, index: number): EmployeeOut {
  const id = `e${index + 1}`;
  const contract: ContractOut | null = create.contract && {
    id: `c${index + 1}`,
    employee_id: id,
    employment_type: create.contract.employmentType,
    base_annual_salary: create.contract.annualSalary,
    hourly_rate: create.contract.hourlyRate,
    complementary_pct: create.contract.complementaryPct,
    night_premium_pct: create.contract.nightPremiumPct,
    weekend_premium_pct: create.contract.weekendPremiumPct,
    overtime_multiplier: create.contract.overtimeMultiplier,
    night_premium_basis: create.contract.nightPremiumBasis,
    min_hours_per_week: create.contract.minHoursPerWeek,
    max_hours_per_week: create.contract.maxHoursPerWeek,
    pay_period: create.contract.payPeriod,
    valid_from: create.hireDate,
    valid_to: null,
    created_at: `${create.hireDate}T00:00:00Z`,
  };
  return {
    id,
    org_id: 'org',
    external_id: id.toUpperCase(),
    full_name: create.name,
    email: null,
    employment_status: create.status,
    hire_date: create.hireDate,
    current_contract: contract,
    created_at: `${create.hireDate}T00:00:00Z`,
  };
}

// A shop that is genuinely coverable by five people: eight hours a day, two on
// at a time, seven days a week.
const SHOP = spec({
  openMin: 9 * 60,
  closeMin: 17 * 60,
  minStaff: 2,
  maxHoursPerWeek: 40,
  minRestHours: 11,
});

function calendarFor(employees: EmployeeOut[]) {
  return generateSchedule(employees, [], [], [absenceType()], SHOP, WEEK);
}

describe('"somos cinco" — five names, no terms, and a calendar that works', () => {
  const plan = reconcile(
    TEAM.map((name) => member({ name })),
    [],
    TODAY,
  );
  const hired = plan.creates.map(asEmployee);

  it('turns five named people into five employees who all have a contract', () => {
    expect(hired).toHaveLength(5);
    expect(hired.every((e) => e.current_contract !== null)).toBe(true);
  });

  it('fills the week and leaves no hour of the shop uncovered', () => {
    const result = calendarFor(hired);

    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.gaps).toEqual([]);
    // Every day of the week has shifts on it, not just the first one the greedy
    // pass reached before running out of legal hours.
    for (const d of WEEK) {
      expect(result.assignments.filter((a) => a.date === d.date).length)
        .toBeGreaterThan(0);
    }
  });

  it('puts every one of the five on the calendar, not just the cheapest two', () => {
    const result = calendarFor(hired);
    const scheduled = new Set(result.assignments.map((a) => a.employeeId));
    expect(scheduled.size).toBe(5);
  });

  it('produces an empty calendar the moment those same five have no contract', () => {
    // This is the failure exactly as it reached production. It is asserted, not
    // avoided: it is what makes the three tests above meaningful rather than a
    // description of a calendar that would have worked either way.
    const contractless = hired.map((e) => ({ ...e, current_contract: null }));
    const result = calendarFor(contractless);

    expect(result.assignments).toEqual([]);
    // Eight open hours on each of seven days, every one of them short.
    expect(result.gaps).toHaveLength(7 * 8);
    expect(result.gaps.every((g) => g.have === 0 && g.need === 2)).toBe(true);
  });
});
