// "El coste pesa pero no manda": premiums in the generator.
//
// Three promises, each of which a plausible implementation breaks:
//
//   1. A premium is never a reason to give somebody the unsocial hours. The
//      owner's example: Marta is paid 25% at night and Juan nothing, on the
//      same base rate. A generator that put the premium in its score would
//      hand Juan every night he could legally work -- measured on the shop
//      below, twenty of the twenty-eight night hours -- because every night he
//      is the cheaper answer.
//   2. It IS a reason to choose between two people the manager's own terms
//      cannot tell apart, and only then.
//   3. What a generated rota says it costs is what payroll pays for it.
//
// And a fourth that keeps the other three honest: a caller that passes no pay
// policy gets exactly what it got before.

import { describe, expect, it } from 'vitest';
import { absence, absenceType, contract, days, employee, spec } from '../../test/factories';
import { SCENARIOS, canonical, runInputs } from '../../test/objectiveScenarios';
import type { ContractOut } from '../../types';
import { generateSchedule, priceAssignments, summarize } from './generate';
import { EMPTY_OVERLAY } from './overlay';
import { computePayroll, type PayPolicy } from './payroll';
import { premiumHours } from './premiums';
import type { Assignment, SchedulingSpec } from './types';

const POLICY: PayPolicy = {
  nightDifferentialPct: 25,
  weekendPremiumPct: 0,
  overtimeMultiplier: 1,
};

const NIGHT_WINDOW = { startHour: 22, endHour: 6 };

function person(id: string, over: Partial<ContractOut> = {}) {
  return employee({
    id,
    full_name: id,
    current_contract: contract({ id: `c-${id}`, employee_id: id, hourly_rate: 15, ...over }),
  });
}

/** Night hours per person, by the definition payroll pays on. */
function nightsBy(assignments: Assignment[], s: SchedulingSpec): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assignments) {
    out[a.employeeId] =
      (out[a.employeeId] ?? 0) + premiumHours(a, undefined, s.nightWindow).night;
  }
  return out;
}

// Monday 2 to Sunday 8 March 2026.
const WEEK = days('2026-03-02', 7);

describe('the premium never decides who works the nights', () => {
  // One person on the floor from 14:00 to 02:00 every day, so each day is an
  // afternoon and a late shift, and somebody has to be picked for the late one.
  // Three people, same rate, and only Juan is paid no night premium.
  const shop = spec({
    openMin: 14 * 60,
    closeMin: 26 * 60,
    minStaff: 1,
    maxHoursPerWeek: 40,
    minRestHours: 12,
    maxDailyHours: 9,
    weeklyRestHours: 36,
    nightAverageMax: 8,
    nightWindow: NIGHT_WINDOW,
  });
  const team = [
    person('marta'),
    person('juan', { night_premium_pct: 0 }),
    person('lucia'),
  ];
  const result = generateSchedule(team, [], [], [], shop, WEEK, EMPTY_OVERLAY, POLICY);
  const nights = nightsBy(result.assignments, shop);
  const total = Object.values(nights).reduce((s, h) => s + h, 0);

  it('covers the shop, so the question is only who', () => {
    expect(result.gaps).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });

  it('does not give Juan every night, nor more of them than anybody else', () => {
    // Put the premium in the score and this is 20 of 28 for Juan and 4 each
    // for the other two. Kept out of it, he works no more nights than the
    // busiest of his colleagues.
    expect(nights.juan).toBeLessThan(total);
    expect(nights.juan).toBeLessThanOrEqual(Math.max(nights.marta ?? 0, nights.lucia ?? 0));
  });
});

describe('the premium breaks a tie, and nothing but a tie', () => {
  // One late shift, two people nothing else separates: same contract, same
  // rate, same week behind them. Marta comes first in the roster, which is
  // what decides an exact tie when nothing else does.
  const lateOnly = spec({
    openMin: 22 * 60,
    closeMin: 26 * 60,
    minStaff: 1,
    nightWindow: NIGHT_WINDOW,
  });
  const tuesday = days('2026-03-03', 1);
  const pair = () => [person('marta'), person('juan', { night_premium_pct: 0 })];
  const who = (result: { assignments: Assignment[] }) =>
    result.assignments.map((a) => a.employeeId);

  it('goes to the first in the roster when there is no pay policy to read', () => {
    expect(who(generateSchedule(pair(), [], [], [], lateOnly, tuesday))).toEqual(['marta']);
  });

  it('goes to the cheaper night when the two are otherwise identical', () => {
    expect(
      who(generateSchedule(pair(), [], [], [], lateOnly, tuesday, EMPTY_OVERLAY, POLICY)),
    ).toEqual(['juan']);
  });

  it('does the same for a weekend premium', () => {
    const saturday = days('2026-03-07', 1);
    const day = spec({ openMin: 9 * 60, closeMin: 13 * 60, minStaff: 1 });
    const team = [person('sofia', { weekend_premium_pct: 10 }), person('pablo')];
    expect(
      who(generateSchedule(team, [], [], [], day, saturday, EMPTY_OVERLAY, POLICY)),
    ).toEqual(['pablo']);
  });

  it('never outweighs something the manager asked for', () => {
    // Juan has asked for the night off and nobody has answered. That is a
    // term in the score, and the saving on his premium must not buy it back.
    const vacation = absenceType({ id: 'atype-vac' });
    const pending = absence({
      employee_id: 'juan',
      absence_type_id: 'atype-vac',
      start_at: '2026-03-03T00:00:00',
      end_at: '2026-03-03T23:59:00',
      status: 'requested',
    });
    const result = generateSchedule(
      pair(),
      [],
      [pending],
      [vacation],
      lateOnly,
      tuesday,
      EMPTY_OVERLAY,
      POLICY,
    );
    expect(who(result)).toEqual(['marta']);
  });
});

describe('what a rota says it costs is what payroll pays', () => {
  const bar = SCENARIOS.find((s) => s.name === 'a late bar, one person paid no night premium');

  it('books premiums, overtime and base exactly as computePayroll pays them', () => {
    const inputs = bar!.inputs();
    const result = runInputs(inputs);
    const { employees, days: period, spec: s, payPolicy } = inputs;
    const payroll = computePayroll(
      result.assignments,
      employees,
      period,
      payPolicy,
      s.weekendDays,
      s,
      s.nightWindow,
    );
    // The calendar has both kinds of premium in it, or this proves nothing.
    expect(payroll.rows.some((r) => r.nightPay > 0)).toBe(true);
    expect(payroll.rows.some((r) => r.weekendPay > 0)).toBe(true);
    expect(result.totalCost).toBeCloseTo(payroll.totalPay, 6);
    // And re-summarising after an edit does not move the number.
    const again = summarize(result.assignments, employees, [], [], s, period, payPolicy);
    expect(again.totalCost).toBeCloseTo(payroll.totalPay, 6);
  });

  it('prices overtime at each person own multiplier, as payroll does', () => {
    // A hand-built week: a 20-hour contract worked for 24, on a Saturday
    // night, by somebody whose contract pays overtime at 1.75.
    const emp = person('iris', {
      min_hours_per_week: 20,
      overtime_multiplier: 1.75,
      weekend_premium_pct: 15,
    });
    const shifts: Assignment[] = ['2026-03-04', '2026-03-05', '2026-03-07'].map(
      (date, i) => ({
        id: `m${i}`,
        employeeId: 'iris',
        date,
        startMin: 20 * 60,
        endMin: 28 * 60 + 30,
        templateId: 'band-night',
        templateName: 'Night',
        color: '#000',
        isNight: true,
        paidHours: 8,
        overtimeHours: 0,
        extraHours: 0,
        cost: 0,
        source: 'manual',
      }),
    );
    const s = spec({ nightWindow: NIGHT_WINDOW });
    const summary = summarize(shifts, [emp], [], [], s, WEEK, POLICY);
    const payroll = computePayroll(
      summary.assignments,
      [emp],
      WEEK,
      POLICY,
      s.weekendDays,
      s,
      s.nightWindow,
    );
    expect(summary.overtimeHours).toBe(4);
    expect(payroll.rows[0].overtimePay).toBeCloseTo(4 * 15 * 1.75, 9);
    expect(summary.totalCost).toBeCloseTo(payroll.totalPay, 6);
    const priced = priceAssignments(shifts, [emp], 1, {}, {
      policy: POLICY,
      nightWindow: s.nightWindow,
      weekendDays: s.weekendDays,
    });
    const pricedTotal = priced.assignments.reduce((sum, a) => sum + a.cost, 0);
    expect(pricedTotal).toBeCloseTo(payroll.totalPay, 6);
  });

  it('books nothing for exempt salaried staff, premiums included', () => {
    const salaried = person('eva', {
      employment_type: 'exempt_salaried',
      hourly_rate: null,
      base_annual_salary: 40000,
    });
    const late = spec({ openMin: 22 * 60, closeMin: 26 * 60, minStaff: 1, nightWindow: NIGHT_WINDOW });
    const result = generateSchedule([salaried], [], [], [], late, WEEK, EMPTY_OVERLAY, POLICY);
    expect(result.assignments.length).toBeGreaterThan(0);
    expect(result.totalCost).toBe(0);
  });
});

describe('no pay policy means the calendar it always was', () => {
  // A policy with no premiums, and overtime at the multiplier the spec implies
  // when it states none, is the same instruction as no policy at all -- and
  // every scenario must come back identical to the assignment, cost included.
  // Contract figures are cleared first, since a contract's own premium is
  // exactly what a policy passed here is supposed to switch on.
  const NO_PREMIUMS: PayPolicy = {
    nightDifferentialPct: 0,
    weekendPremiumPct: 0,
    overtimeMultiplier: 1.5,
  };

  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      const inputs = scenario.inputs();
      const employees = inputs.employees.map((e) => ({
        ...e,
        current_contract: e.current_contract && {
          ...e.current_contract,
          night_premium_pct: null,
          weekend_premium_pct: null,
          overtime_multiplier: null,
        },
      }));
      const without = runInputs({ ...inputs, employees, payPolicy: undefined });
      const zeroed = runInputs({ ...inputs, employees, payPolicy: NO_PREMIUMS });
      expect(canonical(zeroed)).toEqual(canonical(without));
    });
  }
});

describe('payroll reads the night window it is given', () => {
  const emp = person('iris');
  const shift: Assignment = {
    id: 's',
    employeeId: 'iris',
    date: '2026-03-03',
    startMin: 20 * 60,
    endMin: 24 * 60,
    templateId: 't',
    templateName: 'Late',
    color: '#000',
    isNight: false,
    paidHours: 4,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'manual',
  };
  const day = days('2026-03-03', 1);

  it('pays 22:00-06:00 when no window is passed, as it always did', () => {
    const payroll = computePayroll([shift], [emp], day, POLICY);
    expect(payroll.rows[0].nightHours).toBe(2);
  });

  it('pays the spec window when one is passed', () => {
    const payroll = computePayroll([shift], [emp], day, POLICY, undefined, {}, {
      startHour: 21,
      endHour: 6,
    });
    expect(payroll.rows[0].nightHours).toBe(3);
  });
});
