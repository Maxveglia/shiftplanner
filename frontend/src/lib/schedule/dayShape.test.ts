// A business whose day does not end at midnight, and whose weekend is not
// Saturday and Sunday.
//
// The two parameters exist because both facts were literals. "The weekend is
// day 0 or day 6" was written into four files -- both passes of the generator,
// the payroll differential and the employee's own shift list -- so a bar lost
// the Friday night it staffs hardest and paid a premium for the Sunday it
// barely opens. And a window that closed before it opened was refused
// everywhere it could be stated, so the bar could not describe its hours at
// all.
//
// What is NOT tested here is that the defaults change nothing, because
// objective.identity already pins ten calendars assignment by assignment and
// would fail if they moved.

import { describe, expect, it } from 'vitest';
import { generateSchedule } from './generate';
import { computePayroll } from './payroll';
import { parsePrompt } from './spec';
import { DEFAULT_WEEKEND_DAYS, isWeekendDay, windowFor, workingDayKey } from './demand';
import type { Assignment } from './types';
import {
  absenceType,
  contract,
  days,
  day as oneDay,
  employee,
  spec,
  template,
} from '../../test/factories';
import type { EmployeeOut } from '../../types';

const WEEK = days('2026-03-01', 7); // Sunday 1 to Saturday 7 March 2026
const FRIDAY = '2026-03-06';
const VACATION = absenceType({ id: 'atype-vac' });

function team(n: number): EmployeeOut[] {
  return Array.from({ length: n }, (_, i) =>
    employee({
      id: `e${i + 1}`,
      full_name: `Person ${i + 1}`,
      current_contract: contract({ id: `c-e${i + 1}`, employee_id: `e${i + 1}` }),
    }),
  );
}

/** A bar: opens at six in the evening, closes at four the next morning. */
const BAR = spec({
  minStaff: 1,
  openMin: 18 * 60,
  closeMin: 28 * 60, // 04:00, the following day
  weekendDays: [5, 6],
  dayBoundaryMin: 6 * 60,
});

describe('a shop that works through midnight', () => {
  it('staffs the hours after midnight instead of stopping at it', () => {
    const result = generateSchedule(team(4), [], [], [VACATION], BAR, WEEK);

    const overnight = result.assignments.filter((a) => a.endMin > 24 * 60);
    expect(overnight.length).toBeGreaterThan(0);
  });

  it('files an overnight shift under the day it started, not the day it ended', () => {
    const result = generateSchedule(team(4), [], [], [VACATION], BAR, WEEK);
    const dates = new Set(WEEK.map((d) => d.date));

    // Every shift belongs to one of the days asked for, and none has been split
    // into a second assignment on the following morning.
    for (const a of result.assignments) expect(dates.has(a.date)).toBe(true);
    const friday = result.assignments.filter((a) => a.date === FRIDAY);
    expect(friday.length).toBeGreaterThan(0);
    for (const a of friday) expect(a.startMin).toBeGreaterThanOrEqual(18 * 60);
  });

  it('previews a night as a night while the manager is still typing', () => {
    // `parsePrompt` only feeds the live preview under the brief box, but that
    // preview is the first thing a bar sees. It used to try the afternoon
    // reading ("8 a 10" means 08:00-22:00) and then add a further day on top of
    // the result, turning 18:00-04:00 into 40:00 -- shown, after the clock
    // wrapped it, as closing at 16:00.
    const parsed = parsePrompt('abrimos de 18:00 a 04:00');
    expect(parsed.openMin).toBe(18 * 60);
    expect(parsed.closeMin).toBe(28 * 60);
  });

  it('still reads an unqualified close as the afternoon when it can', () => {
    // "de 10 a 8" is a shop open ten to eight, not one that opens for a minus
    // two hour day. The afternoon reading has to keep winning where it fits.
    const parsed = parsePrompt('abrimos de 10 a 8');
    expect(parsed.openMin).toBe(10 * 60);
    expect(parsed.closeMin).toBe(20 * 60);
  });

  it('reads a per-weekday override that runs past midnight', () => {
    const s = spec({
      openMin: 9 * 60,
      closeMin: 17 * 60,
      dayHours: [{ weekday: 5, openMin: 18 * 60, closeMin: 4 * 60 }],
    });
    expect(windowFor(s, oneDay(FRIDAY))).toEqual({
      openMin: 18 * 60,
      closeMin: 28 * 60,
    });
  });
});

describe('a weekend that is not Saturday and Sunday', () => {
  it('lets a weekend-premium shift run on the days this business calls the weekend', () => {
    const premium = template({
      id: 'tpl-premium',
      name: 'Premium',
      start_time: '18:00',
      end_time: '02:00',
      unpaid_break_minutes: 0,
      is_weekend_premium: true,
    });
    const result = generateSchedule(team(4), [premium], [], [VACATION], BAR, WEEK);

    const onPremium = result.assignments.filter((a) => a.templateId === 'tpl-premium');
    expect(onPremium.length).toBeGreaterThan(0);

    // Friday and Saturday only. Sunday is an ordinary night for this business,
    // and used to be the one the old constant paid a premium for.
    const weekdaysUsed = new Set(
      onPremium.map((a) => WEEK.find((d) => d.date === a.date)?.weekday),
    );
    for (const wd of weekdaysUsed) expect([5, 6]).toContain(wd);
  });

  it('pays the weekend differential on this business\'s own weekend', () => {
    const person = employee({
      id: 'e1',
      current_contract: contract({ id: 'c-e1', employee_id: 'e1', hourly_rate: 20 }),
    });
    const friday = [shift('s1', 'e1', FRIDAY)];
    const sunday = [shift('s2', 'e1', '2026-03-01')];

    const forBar = (a: Assignment[]) =>
      computePayroll(a, [person], WEEK, undefined, [5, 6]).rows[0].weekendHours;
    const forShop = (a: Assignment[]) =>
      computePayroll(a, [person], WEEK, undefined, [0, 6]).rows[0].weekendHours;

    // The same two shifts, paid opposite ways. Before this, both businesses got
    // the shop's answer, so the bar paid nothing extra for its busiest night and
    // paid a premium for its quietest.
    expect(forBar(friday)).toBe(8);
    expect(forShop(friday)).toBe(0);
    expect(forBar(sunday)).toBe(0);
    expect(forShop(sunday)).toBe(8);
  });

  it('treats Saturday and Sunday as the weekend when nobody has said otherwise', () => {
    expect(isWeekendDay(0, undefined)).toBe(true);
    expect(isWeekendDay(6, undefined)).toBe(true);
    expect(isWeekendDay(5, undefined)).toBe(false);
    expect(DEFAULT_WEEKEND_DAYS).toEqual([0, 6]);
  });

  it('lets a business have no weekend at all', () => {
    expect(isWeekendDay(0, [])).toBe(false);
    expect(isWeekendDay(6, [])).toBe(false);
  });
});

describe('which working day a moment belongs to', () => {
  it('keeps the small hours on the night before, once a boundary is set', () => {
    // Two in the morning on Saturday. For a bar that closes at six, that is
    // still Friday night -- which is what the person holding the phone calls it.
    const smallHours = new Date(2026, 2, 7, 2, 0);
    expect(workingDayKey(smallHours, 6 * 60)).toBe('2026-03-06');
  });

  it('is the civil day when no boundary is set', () => {
    const smallHours = new Date(2026, 2, 7, 2, 0);
    expect(workingDayKey(smallHours, undefined)).toBe('2026-03-07');
    expect(workingDayKey(smallHours, 0)).toBe('2026-03-07');
  });

  it('does not move a moment that is already past the boundary', () => {
    const evening = new Date(2026, 2, 6, 20, 0);
    expect(workingDayKey(evening, 6 * 60)).toBe('2026-03-06');
  });
});

/** An eight-hour day shift, for the payroll cases. */
function shift(id: string, employeeId: string, date: string): Assignment {
  return {
    id,
    employeeId,
    date,
    startMin: 9 * 60,
    endMin: 17 * 60,
    templateId: 'tpl',
    templateName: 'Day',
    color: '#2563EB',
    isNight: false,
    paidHours: 8,
    overtimeHours: 0,
    extraHours: 0,
    cost: 160,
    source: 'ai',
  };
}

describe('minimum rest, once a shift can cross midnight', () => {
  /**
   * Every gap between one person's consecutive shifts, in absolute minutes.
   *
   * Absolute, because the whole point is that a shift ending at 04:00 the
   * following morning is stored as minute 1680 of the day it started on, and
   * any arithmetic that forgets that is the arithmetic under test.
   */
  function restGaps(assignments: Assignment[], dates: string[]): number[] {
    const index = new Map(dates.map((d, i) => [d, i]));
    const abs = (date: string, min: number) => (index.get(date) ?? 0) * 24 * 60 + min;
    const byPerson = new Map<string, { start: number; end: number }[]>();
    for (const a of assignments) {
      const list = byPerson.get(a.employeeId) ?? [];
      list.push({ start: abs(a.date, a.startMin), end: abs(a.date, a.endMin) });
      byPerson.set(a.employeeId, list);
    }
    const gaps: number[] = [];
    for (const list of byPerson.values()) {
      list.sort((x, y) => x.start - y.start);
      for (let i = 1; i < list.length; i += 1) gaps.push(list[i].start - list[i - 1].end);
    }
    return gaps;
  }

  it('does not let last night count as this morning', () => {
    // The shape that exposes it: a night that ends at four, a morning that
    // opens at six, and split days allowed.
    //
    // `prevIsToday` used to be "did the previous shift END after this day
    // started", which an overnight shift satisfies by definition -- it ends in
    // the small hours of today. Yesterday's night was therefore read as the
    // first half of a split day, and the eleven-hour rest rule was swapped for
    // the sixty-minute gap that belongs BETWEEN two halves. Two hours of rest,
    // on a rule that exists so nobody is sent home at four and called back at
    // six.
    const nightThenMorning = spec({
      minStaff: 1,
      openMin: 18 * 60,
      closeMin: 28 * 60, // closes at 04:00
      minRestHours: 11,
      splitShiftPeople: 2,
      allowSplitShifts: true,
      // Every Saturday and Sunday opens early instead, so the night before
      // butts up against the morning after.
      dayHours: [
        { weekday: 6, openMin: 6 * 60, closeMin: 14 * 60 },
        { weekday: 0, openMin: 6 * 60, closeMin: 14 * 60 },
      ],
    });

    const result = generateSchedule(team(2), [], [], [VACATION], nightThenMorning, WEEK);
    const gaps = restGaps(
      result.assignments,
      WEEK.map((d) => d.date),
    );

    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(11 * 60);
  });

  it('still lets the two halves of one day sit an hour apart', () => {
    // The rule the fix must not break: within ONE working day, eleven hours
    // between a morning and an afternoon is a contradiction, so a short break
    // stands in.
    const splitDay = spec({
      minStaff: 1,
      openMin: 8 * 60,
      closeMin: 22 * 60,
      minRestHours: 11,
      shiftLengthHours: 4,
      splitShiftPeople: 2,
      allowSplitShifts: true,
      coverage: [{ weekdays: [], dates: [], startMin: 18 * 60, endMin: 22 * 60, staff: 3 }],
    });

    const result = generateSchedule(team(3), [], [], [VACATION], splitDay, WEEK);
    const perDay = new Map<string, number>();
    for (const a of result.assignments) {
      const key = `${a.employeeId}|${a.date}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    expect([...perDay.values()].some((n) => n > 1)).toBe(true);
  });
});
