// A person's own premiums, over the business's.
//
// The rule is one line -- the contract's figure, else the org's -- and the
// way to get it wrong is also one character: `||` instead of `??`. Then
// "a Juan no le pago la nocturnidad" stores a 0 that payroll reads as "not
// set" and prices at the business's 25% anyway. So the zero case is the one
// these tests are here for; the rest pin that null still means inherit.

import { describe, expect, it } from 'vitest';
import {
  computePayroll,
  effectivePolicy,
  nightPremiumBelowFloor,
  type PayPolicy,
} from './payroll';
import { contract, day, employee } from '../../test/factories';
import type { ContractOut } from '../../types';
import type { Assignment } from './types';

const BUSINESS: PayPolicy = {
  nightDifferentialPct: 25,
  weekendPremiumPct: 10,
  overtimeMultiplier: 1.5,
};

function person(over: Partial<ContractOut> = {}) {
  return employee({
    id: 'e1',
    current_contract: contract({ employee_id: 'e1', hourly_rate: 20, ...over }),
  });
}

function shift(over: Partial<Assignment> = {}): Assignment {
  return {
    id: 's1',
    employeeId: 'e1',
    date: '2026-03-02', // a Monday
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
    ...over,
  };
}

/** 22:00 to 06:00 on a Monday: eight paid hours, all of them in the night window. */
const NIGHT = shift({ startMin: 22 * 60, endMin: 30 * 60, isNight: true });

describe('effectivePolicy', () => {
  it('is the business policy when the contract sets nothing of its own', () => {
    expect(effectivePolicy(person(), BUSINESS)).toEqual(BUSINESS);
  });

  it('takes each figure the contract sets and inherits the others', () => {
    expect(
      effectivePolicy(person({ night_premium_pct: 40 }), BUSINESS),
    ).toEqual({ ...BUSINESS, nightDifferentialPct: 40 });
  });

  it('keeps a 0 as zero rather than falling back to the business', () => {
    expect(
      effectivePolicy(person({ night_premium_pct: 0 }), BUSINESS)
        .nightDifferentialPct,
    ).toBe(0);
  });
});

describe('computePayroll prices each person on their own premiums', () => {
  it('pays the contract night premium over the business one', () => {
    const { rows } = computePayroll(
      [NIGHT],
      [person({ night_premium_pct: 50 })],
      [day('2026-03-02')],
      BUSINESS,
    );
    // 8 night hours x (20 x 50%) = 80.
    expect(rows[0].nightPay).toBeCloseTo(80, 6);
    expect(rows[0].own.night).toBe(true);
  });

  it('inherits the business night premium when the contract says null', () => {
    const { rows } = computePayroll(
      [NIGHT],
      [person()],
      [day('2026-03-02')],
      BUSINESS,
    );
    // 8 x (20 x 25%) = 40.
    expect(rows[0].nightPay).toBeCloseTo(40, 6);
    expect(rows[0].own.night).toBe(false);
  });

  it('pays no night premium at all on a 0% contract', () => {
    const { rows } = computePayroll(
      [NIGHT],
      [person({ night_premium_pct: 0 })],
      [day('2026-03-02')],
      BUSINESS,
    );
    expect(rows[0].nightHours).toBeCloseTo(8, 6);
    expect(rows[0].nightPay).toBe(0);
    expect(rows[0].totalPay).toBeCloseTo(160, 6);
  });

  it('prices an overtime hour at the contract multiplier', () => {
    const { rows } = computePayroll(
      [shift({ paidHours: 10, overtimeHours: 2, endMin: 19 * 60 })],
      [person({ overtime_multiplier: 2 })],
      [day('2026-03-02')],
      BUSINESS,
    );
    expect(rows[0].overtimeRate).toBe(40);
    expect(rows[0].overtimePay).toBeCloseTo(80, 6);
  });

  it('pays the contract weekend premium on a weekend day', () => {
    const { rows } = computePayroll(
      [shift({ date: '2026-03-07' })], // a Saturday
      [person({ weekend_premium_pct: 0 })],
      [day('2026-03-07')],
      BUSINESS,
    );
    expect(rows[0].weekendHours).toBe(8);
    expect(rows[0].weekendPay).toBe(0);
  });
});

describe('nightPremiumBelowFloor', () => {
  it('flags a night premium under the agreement with no reason on file', () => {
    expect(
      nightPremiumBelowFloor(person({ night_premium_pct: 0 }), BUSINESS, 25),
    ).toBe(true);
  });

  it('is quiet when the night is recorded as included in the salary', () => {
    const p = person({
      night_premium_pct: 0,
      night_premium_basis: 'included_in_salary',
    });
    expect(nightPremiumBelowFloor(p, BUSINESS, 25)).toBe(false);
  });

  it('is quiet where no agreement states a floor', () => {
    expect(
      nightPremiumBelowFloor(person({ night_premium_pct: 0 }), BUSINESS, null),
    ).toBe(false);
  });

  it('is quiet for exempt salaried staff, whose nights are not priced', () => {
    const p = person({
      employment_type: 'exempt_salaried',
      night_premium_pct: 0,
    });
    expect(nightPremiumBelowFloor(p, BUSINESS, 25)).toBe(false);
  });

  it('judges the inherited figure too', () => {
    // A business paying 10% puts everybody who inherits it under a 25% floor.
    expect(
      nightPremiumBelowFloor(
        person(),
        { ...BUSINESS, nightDifferentialPct: 10 },
        25,
      ),
    ).toBe(true);
  });
});
