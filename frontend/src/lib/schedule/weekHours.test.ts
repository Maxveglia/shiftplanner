import { describe, expect, it } from 'vitest';
import { weekDates, weekHoursFor } from './weekHours';
import type { Assignment } from './types';

function shift(date: string, employeeId = 'e1', hours = 8): Assignment {
  return {
    id: `${employeeId}-${date}`, employeeId, date, startMin: 9 * 60, endMin: (9 + hours) * 60,
    templateId: 'band-morning', templateName: 'Morning', color: '#000', isNight: false,
    paidHours: hours - 0.5, overtimeHours: 0, extraHours: 0, cost: 0, source: 'ai',
  };
}
// Thu 1 Oct 2026 sits in the week Mon 28 Sep – Sun 4 Oct.
const weekOfOct1 = weekDates('2026-10-01');
const october = new Set(Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`));
const sepOct = new Set([...weekOfOct1, ...october]);

describe('weekDates', () => {
  it('runs Monday to Sunday around the date', () => {
    expect(weekOfOct1).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
  });
});

describe('weekHoursFor', () => {
  const week = [shift('2026-09-28'), shift('2026-09-29'), shift('2026-09-30'), shift('2026-10-01')];

  it('adds up the span of every shift in that week, this person only', () => {
    const all = [...week, shift('2026-10-01', 'e2'), shift('2026-10-05')];
    expect(weekHoursFor('e1', '2026-10-01', all, 40, sepOct).hours).toBe(32);
  });

  it('is short when the whole week is on the calendar and under contract', () => {
    expect(weekHoursFor('e1', '2026-10-01', week, 40, sepOct).short).toBe(true);
    expect(weekHoursFor('e1', '2026-10-01', week, 32, sepOct).short).toBe(false);
  });

  it('is never short on a week the period only partly covers, and says how partial', () => {
    const partial = weekHoursFor('e1', '2026-10-01', week, 40, october);
    expect(partial.short).toBe(false);
    // October holds Thursday to Sunday of that week: four of its seven days.
    expect(partial.coveredDays).toBe(4);
    expect(weekHoursFor('e1', '2026-10-01', week, 40, sepOct).coveredDays).toBe(7);
  });

  it('is never short without a contracted minimum', () => {
    expect(weekHoursFor('e1', '2026-10-01', week, 0, sepOct).short).toBe(false);
  });
});
