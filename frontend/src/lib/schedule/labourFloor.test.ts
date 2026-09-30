// The law reaching the rota that is already on screen.
//
// Two gaps, one after the other, and the manager saw the same thing from
// both: they chose their jurisdiction, pressed "reorganise with AI", and got
// the calendar they had before.
//
//   1. The statutory figures are written into a spec when the SERVER reads a
//      brief. A draft built before those rules existed has none of them, and
//      "reorganise" sends back the spec in the browser.
//   2. The planner was never told the rules. It wrote ten-hour night shifts,
//      the validator threw the month away, and the greedy pass filled it.

import { describe, expect, it } from 'vitest';
import { withLabourFloor } from './jurisdiction';
import { buildPlanContext } from './planContext';
import { spec as makeSpec, days, employee } from '../../test/factories';
import type { LaborProfileOut } from '../../types';

function rule(
  rule_type: string,
  threshold: number | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `r-${rule_type}`,
    rule_type,
    threshold,
    unit: 'hours',
    reference_window: 'day',
    computation_method: null,
    hardness: 'hard',
    premium_multiplier: null,
    notes: null,
    ...extra,
  } as never;
}

const SPAIN: LaborProfileOut[] = [
  {
    id: 'p-es',
    jurisdiction_code: 'ES',
    name: 'Spain',
    parent_code: null,
    effective_date: '2024-01-01',
    rules: [
      rule('daily_rest_between_shifts', 12),
      rule('max_daily_ordinary_hours', 9),
      rule('weekly_rest_hours', 36),
      rule('night_work_daily_average_max', 8),
      rule('night_work_window_start', 22),
      rule('night_work_window_end', 6),
      rule('annual_overtime_cap', 80),
      rule('no_statutory_overtime_premium', null),
    ],
  },
  {
    id: 'p-host',
    jurisdiction_code: 'ES-CT-HOSTELERIA',
    name: 'Hospitality',
    parent_code: 'ES',
    effective_date: '2024-01-01',
    rules: [rule('night_premium', 25)],
  },
];

describe('withLabourFloor', () => {
  it('fills a draft written before the rules existed', () => {
    // Exactly what sits in the browser of a manager who generated yesterday.
    const old = makeSpec({ minRestHours: 11 });
    const now = withLabourFloor(old, SPAIN, 'ES-CT-HOSTELERIA');
    expect(now.minRestHours).toBe(12);
    expect(now.maxDailyHours).toBe(9);
    expect(now.weeklyRestHours).toBe(36);
    expect(now.nightAverageMax).toBe(8);
    expect(now.nightWindow).toEqual({ startHour: 22, endHour: 6 });
    expect(now.annualOvertimeCap).toBe(80);
    // "No statutory premium" is an answer, and null is how it is said.
    expect(now.overtimeMultiplier).toBeNull();
  });

  it('leaves a figure the manager stated exactly as they stated it', () => {
    // Ten hours of rest is below the statute. The product's job is to show
    // them the rule, not to rewrite the sentence they typed.
    const asked = makeSpec({
      minRestHours: 10,
      rules: [
        {
          id: 'r1',
          kind: 'min_rest',
          label: '10 h',
          sourceText: null,
          origin: 'parsed',
        },
      ],
    });
    expect(withLabourFloor(asked, SPAIN, 'ES').minRestHours).toBe(10);
  });

  it('applies nothing under a jurisdiction that no longer exists', () => {
    // The third face of the same bug, and the one a manager actually hit: the
    // chosen jurisdiction lived in the browser, the American profiles were
    // deleted, and the stored 'US-FED' matched nothing -- so a rota was
    // planned to no law at all while Settings showed a Spanish one. The code
    // has to come from the server for this never to be reachable.
    const before = makeSpec({ minRestHours: 11 });
    const after = withLabourFloor(before, SPAIN, 'US-FED');
    // No rule, no limit -- which is the right behaviour for a jurisdiction we
    // hold nothing for, and the wrong ANSWER for a Barcelona bar. What fixes
    // that is the code coming from the server, not this function.
    expect(after.maxDailyHours ?? null).toBeNull();
    expect(after.weeklyRestHours ?? null).toBeNull();
    expect(after.minRestHours).toBe(11);
  });

  it('changes nothing when no rules are loaded', () => {
    const before = makeSpec({ minRestHours: 11 });
    expect(withLabourFloor(before, [], 'ES')).toEqual(before);
  });
});

describe('what the planner is told', () => {
  const WEEK = days('2026-10-05', 7);
  const roster = [employee({ id: 'e1', full_name: 'Ana' })];

  it('states the three rules a Barcelona bar breaks', () => {
    const withLaw = withLabourFloor(
      makeSpec({ openMin: 18 * 60, closeMin: 28 * 60 }),
      SPAIN,
      'ES-CT-HOSTELERIA',
    );
    const context = buildPlanContext(
      roster,
      [],
      [],
      [],
      withLaw,
      WEEK,
      'ES-CT-HOSTELERIA',
      new Date(2026, 9, 5),
    );
    expect(context).toContain('MAXIMUM HOURS IN ONE DAY');
    expect(context).toContain('UNBROKEN REST EVERY WEEK');
    expect(context).toContain('NIGHT WORK');
    expect(context).toContain('22:00');
  });

  it('says none of it where no such law is seeded', () => {
    const context = buildPlanContext(
      roster,
      [],
      [],
      [],
      makeSpec(),
      WEEK,
      'NOWHERE',
      new Date(2026, 9, 5),
    );
    expect(context).not.toContain('MAXIMUM HOURS IN ONE DAY');
    expect(context).not.toContain('UNBROKEN REST EVERY WEEK');
  });
});
