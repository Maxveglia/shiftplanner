// The day off, planned: see ./restDays for the Friday this was written for.

import { describe, expect, it } from 'vitest';
import { contract, days, employee, spec } from '../../test/factories';
import { generateSchedule } from './generate';
import { planRestDays } from './restDays';

// The bar from the report: 17:00-03:00 on weekdays, 17:00-04:00 at weekends,
// two people always, four on forty hours and two part-timers.
const TEAM = [
  ['max', 40], ['enzo', 40], ['alberto', 40], ['arnau', 40], ['luka', 20], ['diego', 16],
] as const;
const roster = TEAM.map(([id, h]) =>
  employee({ id, full_name: id, current_contract: contract({ employee_id: id, min_hours_per_week: h }) }),
);
const SPAIN = {
  minRestHours: 12,
  maxDailyHours: 9,
  weeklyRestHours: 36,
  nightAverageMax: 8,
  nightWindow: { startHour: 22, endHour: 6 },
  weeklyAverageHours: 40,
};
const bar = spec({
  openMin: 17 * 60,
  closeMin: 27 * 60,
  minStaff: 2,
  maxHoursPerWeek: 40,
  dayHours: [0, 6].map((weekday) => ({ weekday, openMin: 17 * 60, closeMin: 28 * 60 })),
  ...SPAIN,
});
// Sunday 4 to Saturday 10 October 2026: one whole week.
const WEEK = days('2026-10-04', 7);
const OCTOBER = days('2026-10-01', 31);

describe('planRestDays', () => {
  it('staggers the full-timers across the quiet days', () => {
    const plan = planRestDays(bar, roster, WEEK);
    const fullTimers = ['max', 'enzo', 'alberto', 'arnau'].map((id) => plan.get(id));
    // Four different days, none of them the longer weekend nights.
    expect(new Set(fullTimers).size).toBe(4);
    for (const date of fullTimers) {
      expect(['2026-10-04', '2026-10-10']).not.toContain(date);
    }
  });

  it('plans nothing where the law asks for no weekly rest', () => {
    expect(planRestDays({ ...bar, weeklyRestHours: null }, roster, WEEK).size).toBe(0);
  });

  it('plans nothing for a week cut by the edge of the period', () => {
    // The days outside the period are empty to the generator: the rest is there.
    expect(planRestDays(bar, roster, WEEK.slice(3)).size).toBe(0);
  });

  it('plans nothing when the business closes a day of the week', () => {
    expect(planRestDays({ ...bar, closedWeekdays: [1] }, roster, WEEK).size).toBe(0);
  });
});

describe('the rota for that bar', () => {
  const result = generateSchedule(roster, [], [], [], bar, OCTOBER);
  const hours = result.hoursByEmployee;

  it('does not give every full-timer the same night off', () => {
    // The bug: all four off on Friday, every Friday.
    for (const friday of ['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']) {
      const fullTimersOn = result.assignments.filter(
        (a) => a.date === friday && ['max', 'enzo', 'alberto', 'arnau'].includes(a.employeeId),
      );
      expect(fullTimersOn.length).toBeGreaterThan(0);
    }
  });

  it('leaves no hour uncovered', () => {
    expect(result.gaps).toEqual([]);
  });

  it('gives a part-timer fewer hours than a full-timer', () => {
    // Before the fix: luka on 20 hours had 142 in the month, max on 40 had 161.
    for (const part of ['luka', 'diego']) {
      for (const full of ['max', 'enzo', 'alberto', 'arnau']) {
        expect(hours[part]).toBeLessThan(hours[full] * 0.75);
      }
    }
  });
});
