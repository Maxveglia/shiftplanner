// Per-person premiums said out loud, and the contract fields nobody said.
//
// Two things are pinned here. The new one: "a Juan no le pago la nocturnidad"
// has to arrive as a 0 -- not dropped as "unstated", which is what the
// positive-number reader every other term uses would do -- and "como todos"
// has to put him back on the business's figures.
//
// The older one is a regression that predates the premiums. Every terms
// change opens a new contract VERSION, and the POST that opened it sent only
// the five fields a sentence can state. The server filled the rest with its
// defaults, so "Ana now earns 14 an hour" silently dropped her complementary
// hours pact and moved her to monthly pay. Nothing on screen said so.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { applyRosterOps, mergeTerms, toRosterOp, type RosterOp } from './ops';
import { contractBody } from './apply';
import { reconcile } from './reconcile';
import { contract, employee, member } from '../../test/factories';

vi.mock('../api', () => ({
  api: { post: vi.fn(), patch: vi.fn() },
}));

const post = vi.mocked(api.post);

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ data: { id: 'new' } } as never);
});

const TODAY = '2026-10-01';

/** Ana: part-time, a 30% complementary pact, paid weekly, night at 40%. */
function ana() {
  return employee({
    id: 'e1',
    full_name: 'Ana Ruiz',
    current_contract: contract({
      employee_id: 'e1',
      hourly_rate: 12,
      min_hours_per_week: 20,
      complementary_pct: 0.3,
      pay_period: 'weekly',
      night_premium_pct: 40,
    }),
  });
}

function termsOp(raw: Record<string, unknown>) {
  const op = toRosterOp({ op: 'set_employee_terms', employee: 'Ana', ...raw });
  if (!op || op.op !== 'set_employee_terms') throw new Error('not a terms op');
  return op;
}

describe('reading premiums from the model', () => {
  it('keeps a 0% night premium as a stated zero', () => {
    expect(termsOp({ night_premium_pct: 0 }).terms.nightPremiumPct).toBe(0);
  });

  it('is a terms change on its own, with nothing else said', () => {
    // A sentence that is ONLY about a premium must still be an operation.
    expect(toRosterOp({ op: 'set_employee_terms', employee: 'Ana', weekend_premium_pct: 0 })).not.toBeNull();
  });

  it('drops an overtime multiplier below 1', () => {
    expect(termsOp({ overtime_multiplier: 0.5, hourly_rate: 14 }).terms.overtimeMultiplier).toBeNull();
  });

  it('reads whether the night is in the salary, and a return to the business', () => {
    const t = termsOp({ night_included_in_salary: true, premiums_follow_business: true }).terms;
    expect(t.nightIncludedInSalary).toBe(true);
    expect(t.premiumsFollowBusiness).toBe(true);
  });
});

describe('mergeTerms', () => {
  it('carries the pact and the pay period over a change of rate', () => {
    const draft = mergeTerms(ana().current_contract, termsOp({ hourly_rate: 14 }).terms);
    expect(draft.hourlyRate).toBe(14);
    expect(draft.complementaryPct).toBe(0.3);
    expect(draft.payPeriod).toBe('weekly');
    // And the premium nobody mentioned.
    expect(draft.nightPremiumPct).toBe(40);
  });

  it('sets a stated premium and records why the night pays nothing', () => {
    const draft = mergeTerms(
      ana().current_contract,
      termsOp({ night_premium_pct: 0, night_included_in_salary: true }).terms,
    );
    expect(draft.nightPremiumPct).toBe(0);
    expect(draft.nightPremiumBasis).toBe('included_in_salary');
  });

  it('keeps the reason on file when the sentence does not mention it', () => {
    const current = contract({ night_premium_pct: 0, night_premium_basis: 'included_in_salary' });
    const draft = mergeTerms(current, termsOp({ hourly_rate: 14 }).terms);
    expect(draft.nightPremiumBasis).toBe('included_in_salary');
  });

  it('drops the reason when the sentence says the night is not in the salary', () => {
    const current = contract({ night_premium_pct: 0, night_premium_basis: 'included_in_salary' });
    const draft = mergeTerms(current, termsOp({ night_included_in_salary: false }).terms);
    expect(draft.nightPremiumBasis).toBeNull();
  });

  it('puts every premium back on the business when told to', () => {
    const current = contract({
      night_premium_pct: 0,
      weekend_premium_pct: 5,
      overtime_multiplier: 2,
      night_premium_basis: 'included_in_salary',
    });
    const draft = mergeTerms(current, termsOp({ premiums_follow_business: true }).terms);
    expect(draft.nightPremiumPct).toBeNull();
    expect(draft.weekendPremiumPct).toBeNull();
    expect(draft.overtimeMultiplier).toBeNull();
    expect(draft.nightPremiumBasis).toBeNull();
  });
});

describe('a terms change writes the whole contract', () => {
  it('sends the pact and the pay period it was not told about', async () => {
    const op: RosterOp = termsOp({ hourly_rate: 14 });
    await applyRosterOps([op], [ana()], TODAY);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/employees/e1/contracts');
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    // The regression: these two used to be missing, and the server's
    // defaults (no pact, monthly) replaced what Ana had signed.
    expect(body.complementary_pct).toBe(0.3);
    expect(body.pay_period).toBe('weekly');
    expect(body.hourly_rate).toBe(14);
    expect(body.night_premium_pct).toBe(40);
    expect(body.valid_from).toBe(TODAY);
  });

  it('tells the manager how a premium sentence was understood', async () => {
    const outcome = await applyRosterOps(
      [termsOp({ night_premium_pct: 0 })],
      [ana()],
      TODAY,
    );
    expect(outcome.applied).toHaveLength(1);
    // The line names the premium, not just "terms updated", so a misread 0
    // is visible before it reaches payroll.
    expect(outcome.applied[0]).toMatch(/night premium|nocturnidad/i);
  });

  it('puts every field of the draft in the body', () => {
    const body = contractBody(
      {
        employmentType: 'non_exempt_hourly',
        minHoursPerWeek: 20,
        maxHoursPerWeek: null,
        hourlyRate: 12,
        annualSalary: null,
        complementaryPct: 0.3,
        payPeriod: 'biweekly',
        nightPremiumPct: 0,
        weekendPremiumPct: null,
        overtimeMultiplier: 1.75,
        nightPremiumBasis: 'included_in_salary',
      },
      TODAY,
    );
    expect(body).toMatchObject({
      complementary_pct: 0.3,
      pay_period: 'biweekly',
      night_premium_pct: 0,
      weekend_premium_pct: null,
      overtime_multiplier: 1.75,
      night_premium_basis: 'included_in_salary',
    });
  });
});

describe('the brief states premiums', () => {
  it('keeps an existing contract whole when the brief only mentions a premium', () => {
    // "Ana no cobra nocturnidad" is about her nights. It must not be read as
    // a whole new contract that turns her 20 hours into hourly-with-no-minimum.
    const plan = reconcile(
      [member({ name: 'Ana Ruiz', nightPremiumPct: 0 })],
      [ana()],
      TODAY,
    );
    expect(plan.updates).toHaveLength(1);
    const next = plan.updates[0].newContract!;
    expect(next.nightPremiumPct).toBe(0);
    expect(next.minHoursPerWeek).toBe(20);
    expect(next.hourlyRate).toBe(12);
    expect(next.complementaryPct).toBe(0.3);
    expect(next.payPeriod).toBe('weekly');
  });

  it('carries the pact, the period and the premiums over a stated rate', () => {
    const plan = reconcile(
      [member({ name: 'Ana Ruiz', hourlyRate: 15, minHoursPerWeek: 20 })],
      [ana()],
      TODAY,
    );
    const next = plan.updates[0].newContract!;
    expect(next.hourlyRate).toBe(15);
    expect(next.complementaryPct).toBe(0.3);
    expect(next.payPeriod).toBe('weekly');
    expect(next.nightPremiumPct).toBe(40);
  });

  it('proposes nothing when the stated premium is the one already on file', () => {
    const plan = reconcile(
      [member({ name: 'Ana Ruiz', nightPremiumPct: 40 })],
      [ana()],
      TODAY,
    );
    expect(plan.updates).toHaveLength(0);
  });

  it('hires someone on the premium the brief gave them', () => {
    const plan = reconcile(
      [member({ name: 'Juan', nightPremiumPct: 0, nightIncludedInSalary: true })],
      [],
      TODAY,
    );
    const c = plan.creates[0].contract!;
    expect(c.nightPremiumPct).toBe(0);
    expect(c.nightPremiumBasis).toBe('included_in_salary');
  });
});
