// Measuring what an edit cost, and deciding whether to pay to fix it.
//
// This is the gate in front of a call that may move anybody's shifts, so both
// of its mistakes are expensive in different ways: firing when nothing broke
// spends money and churns a rota the manager had already read; not firing when
// something broke leaves the shop uncovered with nothing on screen to say so.
//
// The property that matters most is the last describe block: a rearrangement
// is KEPT only if it actually improved the numbers. Without that, "let the
// planner fix it" is just a second roll of the dice.

import { describe, expect, it } from 'vitest';
import {
  damageBetween,
  damageLines,
  isBetter,
  worthRearranging,
  type Damage,
} from './damage';
import { contract, employee } from '../../test/factories';
import type { CoverageGap, ScheduleResult } from './types';

const ANA = employee({
  id: 'e1',
  full_name: 'Ana',
  current_contract: contract({ id: 'c1', employee_id: 'e1', min_hours_per_week: 40 }),
});
const LUIS = employee({
  id: 'e2',
  full_name: 'Luis',
  current_contract: contract({ id: 'c2', employee_id: 'e2', min_hours_per_week: 20 }),
});
const TEAM = [ANA, LUIS];

function result(over: Partial<ScheduleResult> = {}): ScheduleResult {
  return {
    assignments: [],
    gaps: [],
    totalCost: 0,
    totalHours: 0,
    overtimeHours: 0,
    hoursByEmployee: {},
    belowMinimum: [],
    ...over,
  };
}

const gap = (date: string, hour: number, have: number, need: number): CoverageGap => ({
  date,
  hour,
  have,
  need,
});

describe('what an edit cost the business', () => {
  it('counts an hour that lost its cover', () => {
    const before = result();
    const after = result({ gaps: [gap('2026-10-15', 19, 1, 2)] });

    const damage = damageBetween(before, after, TEAM);
    expect(damage.uncoveredHours).toBe(1);
    expect(damage.dates).toEqual(['2026-10-15']);
  });

  it('counts an hour missing two people as two', () => {
    // The weight is right because it is two people who are not there.
    const after = result({ gaps: [gap('2026-10-15', 19, 0, 2)] });
    expect(damageBetween(result(), after, TEAM).uncoveredHours).toBe(2);
  });

  it('ignores a gap the manager was already living with', () => {
    // The rule the refill already follows: an older gap is not this edit's
    // doing, and rearranging somebody's week over it is churn.
    const standing = [gap('2026-10-15', 19, 1, 2)];
    const damage = damageBetween(
      result({ gaps: standing }),
      result({ gaps: standing }),
      TEAM,
    );
    expect(worthRearranging(damage)).toBe(false);
  });

  it('counts a standing gap that got worse, by how much worse', () => {
    const damage = damageBetween(
      result({ gaps: [gap('2026-10-15', 19, 1, 2)] }),
      result({ gaps: [gap('2026-10-15', 19, 0, 2)] }),
      TEAM,
    );
    expect(damage.uncoveredHours).toBe(1);
  });

  it('does not net an improvement off against a loss', () => {
    // Covering Tuesday does not undo uncovering Thursday. Thursday is still
    // the day nobody is there.
    const before = result({ gaps: [gap('2026-10-13', 19, 1, 2)] });
    const after = result({ gaps: [gap('2026-10-15', 19, 1, 2)] });
    expect(damageBetween(before, after, TEAM).uncoveredHours).toBe(1);
  });
});

describe('what an edit cost the people', () => {
  it('reports somebody the edit pushed below their contract', () => {
    const before = result({ hoursByEmployee: { e1: 160 } });
    const after = result({ hoursByEmployee: { e1: 120 }, belowMinimum: ['e1'] });

    const damage = damageBetween(before, after, TEAM);
    expect(damage.shortfalls).toEqual([{ employeeId: 'e1', hours: 40 }]);
  });

  it('does not re-report somebody who was already short and barely moved', () => {
    // Otherwise every unrelated edit for the rest of the month would come back
    // saying the same thing, and the signal would stop meaning anything.
    const before = result({ hoursByEmployee: { e1: 120 }, belowMinimum: ['e1'] });
    const after = result({ hoursByEmployee: { e1: 119 }, belowMinimum: ['e1'] });
    expect(damageBetween(before, after, TEAM).shortfalls).toEqual([]);
  });

  it('does report somebody already short whom the edit cost a whole shift', () => {
    const before = result({ hoursByEmployee: { e1: 120 }, belowMinimum: ['e1'] });
    const after = result({ hoursByEmployee: { e1: 112 }, belowMinimum: ['e1'] });
    expect(damageBetween(before, after, TEAM).shortfalls).toEqual([
      { employeeId: 'e1', hours: 8 },
    ]);
  });

  it('says nothing about somebody who simply worked less but is still on contract', () => {
    const before = result({ hoursByEmployee: { e1: 170 } });
    const after = result({ hoursByEmployee: { e1: 160 } });
    expect(damageBetween(before, after, TEAM).shortfalls).toEqual([]);
  });

  it('puts the worst-hit person first', () => {
    const before = result({ hoursByEmployee: { e1: 160, e2: 80 } });
    const after = result({
      hoursByEmployee: { e1: 150, e2: 40 },
      belowMinimum: ['e1', 'e2'],
    });
    expect(damageBetween(before, after, TEAM).shortfalls[0].employeeId).toBe('e2');
  });
});

describe('deciding whether to spend a call on it', () => {
  it('does not fire for an edit that cost nothing', () => {
    expect(worthRearranging(damageBetween(result(), result(), TEAM))).toBe(false);
  });

  it('fires for a single uncovered hour', () => {
    // No threshold: an uncovered hour is somebody not being served, and there
    // is no amount of that which stops mattering.
    const after = result({ gaps: [gap('2026-10-15', 19, 1, 2)] });
    expect(worthRearranging(damageBetween(result(), after, TEAM))).toBe(true);
  });

  it('fires for a contract left short even when the shop is fully covered', () => {
    const before = result({ hoursByEmployee: { e1: 160 } });
    const after = result({ hoursByEmployee: { e1: 120 }, belowMinimum: ['e1'] });
    expect(worthRearranging(damageBetween(before, after, TEAM))).toBe(true);
  });
});

describe('keeping the rearrangement only when it is better', () => {
  const damage = (uncovered: number, short: number): Damage => ({
    uncoveredHours: uncovered,
    dates: [],
    shortfalls: short > 0 ? [{ employeeId: 'e1', hours: short }] : [],
  });

  it('keeps one that covers the shop without costing anybody hours', () => {
    expect(isBetter(damage(4, 0), damage(0, 0))).toBe(true);
  });

  it('keeps one that gives somebody their hours back without losing cover', () => {
    expect(isBetter(damage(0, 8), damage(0, 0))).toBe(true);
  });

  it('REFUSES one that covers the shop by leaving somebody short', () => {
    // The trade this whole function exists to refuse. A rota that is covered
    // because a part-timer lost nine hours has not improved anything -- it has
    // moved the cost onto somebody who reads it on their phone.
    expect(isBetter(damage(4, 0), damage(0, 9))).toBe(false);
  });

  it('refuses one that pays for somebody’s hours with an uncovered evening', () => {
    expect(isBetter(damage(0, 8), damage(3, 0))).toBe(false);
  });

  it('refuses one that changed nothing', () => {
    // Churn with no gain: shifts moved on people's phones for no measurable
    // reason is exactly what this must not wave through.
    expect(isBetter(damage(4, 8), damage(4, 8))).toBe(false);
  });

  it('refuses one that made everything worse', () => {
    expect(isBetter(damage(4, 0), damage(6, 2))).toBe(false);
  });
});

describe('the damage, as the planner reads it', () => {
  it('says nothing at all when nothing broke', () => {
    expect(damageLines(damageBetween(result(), result(), TEAM), TEAM)).toEqual([]);
  });

  it('points at the days and at the IDS, with the contract as the reference', () => {
    const before = result({ hoursByEmployee: { e1: 160 } });
    const after = result({
      gaps: [gap('2026-10-15', 19, 1, 2), gap('2026-10-16', 20, 0, 2)],
      hoursByEmployee: { e1: 120 },
      belowMinimum: ['e1'],
    });

    const text = damageLines(damageBetween(before, after, TEAM), TEAM).join('\n');
    expect(text).toContain('2026-10-15');
    expect(text).toContain('2026-10-16');
    // These lines are appended to the planning context, so they obey its rule:
    // the model is told who lost hours in the vocabulary it answers in, and
    // the name stays here. It used to say "Ana".
    expect(text).toContain('e1 lost');
    expect(text).not.toContain('Ana');
    expect(text).toContain('40 h/week contract');
    // Facts only. What to do about them is said once, in the planner's prompt.
    expect(text).not.toContain('Rebuild');
  });
});
