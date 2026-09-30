// Apply a confirmed RosterPlan through the existing employee/contract API.
// Kept out of the reconcile module so the pure planning stays testable and the
// side effects live in one place.
//
// Ordering matters: a new employee is created first, then its contract, so the
// contract has an id to hang off. Contract versions use the server's versioning
// (POST /contracts closes the previous open one), so an update never rewrites
// history — it opens a new version valid from today.

import { api } from '../api';
import type { ContractDraft, RosterPlan } from './reconcile';

export interface ApplySelection {
  creates: Set<string>;
  updates: Set<string>;
  resignations: Set<string>;
}

export interface ApplyResult {
  created: number;
  updated: number;
  resigned: number;
}

/**
 * The POST body for a new contract version.
 *
 * EVERY field, not just the ones a sentence was about. The server fills an
 * omitted field with its default, so a body without `complementary_pct` and
 * `pay_period` used to reset both on every change the AI made -- a pay rise
 * cost the person their complementary-hours pact and moved them to monthly
 * pay. The draft carries them over from the current contract (see
 * `carriedTerms`); this only has to send what it is given.
 */
export function contractBody(c: ContractDraft, validFrom: string) {
  return {
    employment_type: c.employmentType,
    base_annual_salary: c.annualSalary,
    hourly_rate: c.hourlyRate,
    min_hours_per_week: c.minHoursPerWeek,
    max_hours_per_week: c.maxHoursPerWeek,
    complementary_pct: c.complementaryPct,
    pay_period: c.payPeriod,
    night_premium_pct: c.nightPremiumPct,
    weekend_premium_pct: c.weekendPremiumPct,
    overtime_multiplier: c.overtimeMultiplier,
    night_premium_basis: c.nightPremiumBasis,
    valid_from: validFrom,
  };
}

export async function applyRosterPlan(
  plan: RosterPlan,
  sel: ApplySelection,
  today: string,
): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, updated: 0, resigned: 0 };

  for (const c of plan.creates) {
    if (!sel.creates.has(c.key)) continue;
    const { data: emp } = await api.post<{ id: string }>('/employees', {
      external_id: null,
      full_name: c.name,
      email: null,
      employment_status: c.status,
      hire_date: c.hireDate,
    });
    if (c.contract) {
      // A contract starts when the person does.
      await api.post(`/employees/${emp.id}/contracts`, contractBody(c.contract, c.hireDate));
    }
    result.created += 1;
  }

  for (const u of plan.updates) {
    if (!sel.updates.has(u.key)) continue;
    if (u.status) {
      await api.patch(`/employees/${u.employeeId}`, {
        employment_status: u.status,
      });
    }
    if (u.newContract) {
      await api.post(
        `/employees/${u.employeeId}/contracts`,
        contractBody(u.newContract, today),
      );
    }
    result.updated += 1;
  }

  for (const r of plan.resignations) {
    if (!sel.resignations.has(r.key)) continue;
    await api.patch(`/employees/${r.employeeId}`, {
      employment_status: 'resigned',
    });
    result.resigned += 1;
  }

  return result;
}
