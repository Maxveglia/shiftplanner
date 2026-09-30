// A salary is spread over the year its contract is, not over the FLSA's 2080.

import { describe, expect, it } from 'vitest';
import { contractYearHours, hourlyRate } from './rate';
import { computePayroll } from './payroll';
import { contract, day, employee } from '../../test/factories';
import type { Assignment } from './types';

/** The Barcelona hospitality agreement: 1,783 hours a year on a 40-hour week. */
const BARCELONA = { annualHours: 1783, weeklyAverageHours: 40 };

function salaried(salary: number, weekly: number, over = {}) {
  return employee({
    id: 'e1',
    current_contract: contract({
      employee_id: 'e1',
      employment_type: 'non_exempt_salaried',
      hourly_rate: null,
      base_annual_salary: salary,
      min_hours_per_week: weekly,
      ...over,
    }),
  });
}

describe('the hours a year of a contract is', () => {
  it('is the agreed year for a full-time contract', () => {
    expect(contractYearHours(salaried(20000, 40), BARCELONA)).toBe(1783);
  });

  it('is the agreed year in proportion for a part-timer', () => {
    expect(contractYearHours(salaried(10000, 20), BARCELONA)).toBe(891.5);
  });

  it('never exceeds the agreed year, whatever the contract says', () => {
    expect(contractYearHours(salaried(20000, 45), BARCELONA)).toBe(1783);
  });

  it('reads the maximum before the minimum, as contractedHours does', () => {
    const e = salaried(10000, 10, { max_hours_per_week: 20 });
    expect(contractYearHours(e, BARCELONA)).toBe(891.5);
  });

  it('is the week times 52 where no agreement fixes a year', () => {
    expect(contractYearHours(salaried(20000, 30), {})).toBe(1560);
  });

  it('is the whole agreed year when the full-time week is unknown', () => {
    expect(contractYearHours(salaried(20000, 20), { annualHours: 1783 })).toBe(1783);
  });

  it('is unknown when neither the agreement nor the contract says', () => {
    expect(contractYearHours(salaried(20000, 0), {})).toBeNull();
  });
});

describe('the hourly rate', () => {
  it('spreads a salary over the agreed year, not 2080 hours', () => {
    expect(hourlyRate(salaried(17830, 40), BARCELONA)).toBeCloseTo(10, 6);
  });

  it('gives a part-timer on half the salary the same rate', () => {
    expect(hourlyRate(salaried(8915, 20), BARCELONA)).toBeCloseTo(10, 6);
  });

  it('falls back to 2080 hours only when nothing states a year', () => {
    expect(hourlyRate(salaried(20800, 0), {})).toBeCloseTo(10, 6);
  });

  it('takes a stated hourly rate at its word', () => {
    const e = employee({ current_contract: contract({ hourly_rate: 12.5 }) });
    expect(hourlyRate(e, BARCELONA)).toBe(12.5);
  });

  it('is the fallback when the contract states no pay at all', () => {
    const e = employee({ current_contract: contract({ hourly_rate: null }) });
    expect(hourlyRate(e, BARCELONA, 20)).toBe(20);
    expect(hourlyRate(employee({ current_contract: null }), BARCELONA)).toBe(0);
  });
});

describe('the payroll prices a salaried hour with the agreed year', () => {
  const shift: Assignment = {
    id: 's1',
    employeeId: 'e1',
    date: '2026-03-02',
    startMin: 9 * 60,
    endMin: 17 * 60,
    templateId: 't',
    templateName: 'Day',
    color: '#000',
    isNight: false,
    paidHours: 8,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'manual',
  };
  const policy = { nightDifferentialPct: 25, weekendPremiumPct: 0, overtimeMultiplier: 1 };

  it('pays eight hours at 10/h when the year is 1,783 hours', () => {
    const { rows } = computePayroll(
      [shift],
      [salaried(17830, 40)],
      [day('2026-03-02')],
      policy,
      undefined,
      BARCELONA,
    );
    expect(rows[0].rate).toBeCloseTo(10, 6);
    expect(rows[0].basePay).toBeCloseTo(80, 6);
  });
});
