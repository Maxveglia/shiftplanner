// Nobody works past the weekly hours of their contract; what does not fit is
// said out loud.
//
// The rule as the business states it. Since PR #102 the generator reads a
// contract the other way -- as a TARGET, stretched when the shop cannot be
// covered otherwise, with each hour past it marked in `extraHours` (see
// `weeklyCeiling` in ./generate). generate.test.ts pins that reading ("marks
// the hours past the stated number as beyond contract" expects a 20-hour
// contract to END ABOVE 20). The two cannot both hold. Max chose the brief, so
// these are known gaps and that test stays exactly as it is until the
// generator changes.
//
// The shape the brief asks for already exists for the OTHER weekly limit: a
// maximum the brief states bites, and the hours it refuses come back as gaps
// (generate.test.ts, "never gives anyone more than the week the brief
// allows"). This asks the same of a contract.
//
// Eval case: .claude/evals/reglas-de-turnos/cases/04-horas-de-contrato.md

import { describe, expect } from 'vitest';
import { generateSchedule, weekKey } from './generate';
import { absenceType, contract, days, employee, spec } from '../../test/factories';
import { knownGap } from '../../test/knownGap';
import type { Assignment } from './types';

const FORTNIGHT = days('2026-03-02', 14); // two Monday-to-Sunday weeks
const TYPES = [absenceType({ id: 'vac' })];

/**
 * "Veinte horas": a minimum of 20 and no maximum, which is how the intake
 * writes it, and what `contractedHours` reads as a 20-hour contract.
 */
const PART_TIMER = employee({
  id: 'pt',
  full_name: 'Lucía Pérez',
  current_contract: contract({ employee_id: 'pt', min_hours_per_week: 20, max_hours_per_week: null }),
});

/**
 * One on the floor, 09:00-17:00, Monday to Friday: forty hours a week to
 * cover, inside the forty-hour standing limit, so the ONLY thing that could
 * stop her at twenty is her contract.
 */
const SHOP = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1, closedWeekdays: [0, 6] });

function hoursPerWeek(assignments: Assignment[], employeeId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assignments) {
    if (a.employeeId !== employeeId) continue;
    const k = weekKey(a.date);
    out[k] = (out[k] ?? 0) + a.paidHours;
  }
  return out;
}

describe('a 20-hour contract in a shop that needs more', () => {
  knownGap('is never given more than 20 hours in any week', () => {
    const result = generateSchedule([PART_TIMER], [], [], TYPES, SHOP, FORTNIGHT);
    const weeks = hoursPerWeek(result.assignments, 'pt');

    expect(Object.keys(weeks).length).toBeGreaterThan(0);
    for (const hours of Object.values(weeks)) expect(hours).toBeLessThanOrEqual(20);
  });

  knownGap('reports the hours no contract could cover, instead of absorbing them', () => {
    // Today the answer is no gap at all: she covers the whole week, 37.5 h,
    // and the only trace is `extraHours` on each shift -- an "extra" tag on
    // the bar and a line in its tooltip, not a warning about the calendar.
    const result = generateSchedule([PART_TIMER], [], [], TYPES, SHOP, FORTNIGHT);

    expect(result.gaps.length).toBeGreaterThan(0);
  });
});
