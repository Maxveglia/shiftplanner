// Regression suite for the bug that shipped: a brief that NAMED people without
// stating any terms created employees with no contract, `availability()` then
// refused them on every single day, and the manager got an empty calendar with
// nothing on screen to explain why. The product was unusable and nothing broke
// loudly enough to notice.
//
// The fix rests on one distinction, and these tests exist to keep it: a person
// being created gets the weakest contract that can be true, while a person who
// already EXISTS keeps whatever they have. Collapse the two — in either
// direction — and you get back either the empty calendar or the far worse
// failure of overwriting a real 40-hour agreement with a generic one.

import { describe, expect, it } from 'vitest';
import { contractForNewHire, draftContract, reconcile } from './reconcile';
import { contract, employee, member } from '../../test/factories';

const TODAY = '2026-03-02';

describe('contractForNewHire', () => {
  it('opens a contract even when the brief states no terms at all', () => {
    // "Somos cinco: Hugo, Adri, Aldridge, Ethan y Uri" — five names, nothing
    // else. This returning null is the exact shape of the production bug.
    const draft = contractForNewHire(member({ name: 'Hugo' }));
    expect(draft).not.toBeNull();
    expect(draft.employmentType).toBe('non_exempt_hourly');
  });

  it('invents no pay for someone whose brief never mentioned money', () => {
    // Guessing a rate would put a number nobody agreed to in front of the
    // manager, and payroll would then be built on it.
    const draft = contractForNewHire(member({ name: 'Adri' }));
    expect(draft.hourlyRate).toBeNull();
    expect(draft.annualSalary).toBeNull();
  });

  it('commits the business to no weekly hours it was never promised', () => {
    // A guaranteed minimum is a liability. The default contract exists to make
    // someone schedulable, not to owe them hours, so the floor stays at zero
    // and there is no ceiling of its own either.
    const draft = contractForNewHire(member({ name: 'Uri' }));
    expect(draft.minHoursPerWeek).toBe(0);
    expect(draft.maxHoursPerWeek).toBeNull();
  });

  it('uses the terms the brief did state rather than the fallback', () => {
    // The fallback is a last resort; anything the manager said out loud wins.
    const draft = contractForNewHire(
      member({ name: 'Ethan', minHoursPerWeek: 20, hourlyRate: 18 }),
    );
    expect(draft.minHoursPerWeek).toBe(20);
    expect(draft.hourlyRate).toBe(18);
  });
});

describe('draftContract', () => {
  it('states nothing when the brief stated nothing', () => {
    // The counterpart of the rule above, and the reason the two functions are
    // separate: on the UPDATE path a fabricated contract would be applied to
    // somebody who already has a real one.
    expect(draftContract(member({ name: 'Hugo' }))).toBeNull();
  });

  it('reads a salary as exempt-salaried work with a 40-hour base', () => {
    const draft = draftContract(member({ name: 'Marta', annualSalary: 52000 }));
    expect(draft).toEqual({
      employmentType: 'exempt_salaried',
      minHoursPerWeek: 40,
      maxHoursPerWeek: null,
      hourlyRate: null,
      annualSalary: 52000,
      // Nothing the brief did not say: no pact, the server's default period,
      // and every premium inherited from the business.
      complementaryPct: null,
      payPeriod: 'monthly',
      nightPremiumPct: null,
      weekendPremiumPct: null,
      overtimeMultiplier: null,
      nightPremiumBasis: null,
    });
  });

  it('reads a rate with no type as hourly work with no guaranteed minimum', () => {
    const draft = draftContract(member({ name: 'Leo', hourlyRate: 22 }));
    expect(draft?.employmentType).toBe('non_exempt_hourly');
    expect(draft?.minHoursPerWeek).toBe(0);
  });
});

describe('reconcile — naming someone is the instruction to schedule them', () => {
  it('creates one employee per named person, every one of them with a contract', () => {
    const team = ['Hugo', 'Adri', 'Aldridge', 'Ethan', 'Uri'].map((name) =>
      member({ name }),
    );
    const plan = reconcile(team, [], TODAY);

    expect(plan.creates).toHaveLength(5);
    expect(plan.creates.map((c) => c.name)).toEqual([
      'Hugo',
      'Adri',
      'Aldridge',
      'Ethan',
      'Uri',
    ]);
    // The assertion the production bug would have failed: not one of them may
    // arrive contract-less, because a contract-less employee is invisible to
    // the generator.
    for (const created of plan.creates) {
      expect(created.contract).not.toBeNull();
    }
  });

  it('leaves an existing 40-hour contract alone when the brief never mentions hours', () => {
    // Hugo is already on the roster on a full-time agreement. The brief names
    // him while talking about something else entirely. Proposing a contract
    // change here would offer to replace a real agreement with a generic one.
    const hugo = employee({
      full_name: 'Hugo',
      current_contract: contract({ min_hours_per_week: 40, hourly_rate: 25 }),
    });
    const plan = reconcile([member({ name: 'Hugo' })], [hugo], TODAY);

    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    // Naming him also protects him: a person the brief mentions is never
    // proposed for resignation.
    expect(plan.resignations).toHaveLength(0);
  });

  it('proposes a new contract version only for the terms the brief actually changed', () => {
    const hugo = employee({
      full_name: 'Hugo',
      current_contract: contract({ min_hours_per_week: 40, hourly_rate: 25 }),
    });
    const plan = reconcile(
      [member({ name: 'Hugo', minHoursPerWeek: 20 })],
      [hugo],
      TODAY,
    );

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].newContract?.minHoursPerWeek).toBe(20);
  });

  it('matches a named person to the roster whatever the spacing and case', () => {
    // Identity is never rewritten, so re-mentioning somebody must never create
    // a second copy of them with a fresh, empty history.
    const hugo = employee({ full_name: 'Hugo  Martín' });
    const plan = reconcile([member({ name: '  hugo martín ' })], [hugo], TODAY);
    expect(plan.creates).toHaveLength(0);
  });

  it('fills an anonymous headcount from the roster before creating anyone', () => {
    // "Somos cinco" with three people already on the books is two new hires,
    // not five duplicates of the team that is already there.
    const roster = [employee({ full_name: 'A' }), employee({ full_name: 'B' })];
    const plan = reconcile([member({ count: 5 })], roster, TODAY);

    expect(plan.creates).toHaveLength(3);
    // The two it claimed are covered by the brief, so neither is offered up as
    // a resignation.
    expect(plan.resignations).toHaveLength(0);
  });

  it('gives each unnamed new hire a distinct name to be addressed by', () => {
    const plan = reconcile([member({ count: 3 })], [], TODAY);
    const names = plan.creates.map((c) => c.name);
    expect(new Set(names).size).toBe(3);
  });

  it('suggests resigning only active people the brief left out', () => {
    // Someone on medical leave is expected to be missing from a staffing brief
    // and is still very much employed; someone already resigned cannot resign
    // twice.
    const roster = [
      employee({ full_name: 'Still here' }),
      employee({ full_name: 'On leave', employment_status: 'on_leave' }),
      employee({ full_name: 'Long gone', employment_status: 'resigned' }),
    ];
    const plan = reconcile([member({ name: 'Somebody else' })], roster, TODAY);

    expect(plan.resignations.map((r) => r.name)).toEqual(['Still here']);
  });

  it('starts someone whose first day is still ahead as onboarding, not active', () => {
    const plan = reconcile(
      [member({ name: 'Nuria', startsOn: '2026-04-01' })],
      [],
      TODAY,
    );
    expect(plan.creates[0].status).toBe('onboarding');
    expect(plan.creates[0].hireDate).toBe('2026-04-01');
  });
});
