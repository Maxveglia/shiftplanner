// Where an extra hour begins, on the client.
//
// Art. 35.1 ET: an extra hour is one worked "sobre la duracion maxima de la
// jornada ordinaria de trabajo" -- the maximum in THIS PERSON'S contract. The
// generator and the payroll used a constant 40 instead, which is the FLSA's
// threshold, and the effect was not neutral: the further BELOW forty somebody's
// contract was, the more hours they could be given before anything was reported.
// A 20-hour contract worked at 35 showed nothing at all.
//
// These pin the reading rather than the arithmetic around it: `generate.test.ts`
// already owns what the generator does with the answer.

import { describe, expect, it } from 'vitest';
import { ordinaryWeeklyHours } from './generate';
import { employee, contract } from '../../test/factories';
import type { SchedulingSpec } from './types';

/** The only field of the spec this function reads. */
const spain = { weeklyAverageHours: 40 } as unknown as SchedulingSpec;
const noJurisdiction = {} as unknown as SchedulingSpec;

function person(min: number, max: number | null = null) {
  return employee({
    current_contract: contract({
      min_hours_per_week: min,
      max_hours_per_week: max,
    }),
  });
}

describe('where an extra hour begins', () => {
  it('is the contracted week, not the statutory one', () => {
    expect(ordinaryWeeklyHours(person(20), spain)).toBe(20);
    expect(ordinaryWeeklyHours(person(30), spain)).toBe(30);
  });

  it('reads the maximum when the contract states one', () => {
    // "between 20 and 35 hours" is a contract for 35, the same reading
    // `contractedHours` makes everywhere else.
    expect(ordinaryWeeklyHours(person(20, 35), spain)).toBe(35);
  });

  it('never lets a contract raise the ordinary week above the statute', () => {
    // A 60-hour availability ceiling is not a 60-hour ordinary week: art. 34.1
    // caps it at forty, so the 41st hour is still extraordinary. Without this
    // the product stopped finding overtime in exactly the rotas full of it --
    // which is what the quality bench caught when this line was missing.
    expect(ordinaryWeeklyHours(person(0, 60), spain)).toBe(40);
  });

  it('falls back to the statutory week when the contract states no hours', () => {
    const noContract = employee({ current_contract: null });
    expect(ordinaryWeeklyHours(noContract, spain)).toBe(40);
  });

  it('falls back to forty where no jurisdiction has been seeded', () => {
    // The old behaviour, kept for anywhere nobody has written the law down.
    const noContract = employee({ current_contract: null });
    expect(ordinaryWeeklyHours(noContract, noJurisdiction)).toBe(40);
    expect(ordinaryWeeklyHours(noContract)).toBe(40);
  });

  it('still reads the contract when there is no spec at all', () => {
    // `priceAssignments` has no spec -- the employee's own view has none to
    // give it -- and must not thereby lose the contract.
    expect(ordinaryWeeklyHours(person(20))).toBe(20);
  });
});
