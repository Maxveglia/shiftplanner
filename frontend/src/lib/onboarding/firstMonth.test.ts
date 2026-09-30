// The month of the first calendar, and what "this month" means on the 22nd.
//
// The assertion that matters is the floor: asked for the month already under
// way, the calendar starts TODAY, and asked on the 1st or for any other month
// it starts on the 1st. Everything else here is how the choice is worded back.

import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/core';
import { daysFromFloor } from '../schedule/focus';
import {
  composeMonthAnswer,
  firstPlannedDay,
  isPartial,
  monthChoices,
  monthLabel,
} from './firstMonth';

const SEP_22 = new Date(2026, 8, 22);

afterEach(() => setLanguage('en'));

describe('the months on offer', () => {
  it('starts at the month under way and runs a year', () => {
    const list = monthChoices(SEP_22);
    expect(list).toHaveLength(12);
    expect(list[0]).toEqual({ month: '2026-09', current: true, fromDay: 22, lastDay: 30 });
    expect(list[1]).toEqual({ month: '2026-10', current: false, fromDay: 1, lastDay: 31 });
    expect(list[11].month).toBe('2027-08');
  });

  it('crosses the year without skipping or repeating a month', () => {
    const list = monthChoices(new Date(2026, 11, 5), 3);
    expect(list.map((c) => c.month)).toEqual(['2026-12', '2027-01', '2027-02']);
    expect(list[2].lastDay).toBe(28);
  });

  it('offers the whole month on the 1st', () => {
    const [first] = monthChoices(new Date(2026, 9, 1));
    expect(first.fromDay).toBe(1);
    expect(isPartial(first)).toBe(false);
  });

  it('is not fooled by the 31st into skipping a short month', () => {
    // new Date(y, m + 1, 31) would roll February into March.
    const list = monthChoices(new Date(2027, 0, 31), 2);
    expect(list.map((c) => c.month)).toEqual(['2027-01', '2027-02']);
  });
});

describe('the first day that gets planned', () => {
  it('is today when the month is this one', () => {
    expect(firstPlannedDay('2026-09', SEP_22)).toBe('2026-09-22');
  });

  it('is the 1st for any other month', () => {
    expect(firstPlannedDay('2026-10', SEP_22)).toBeNull();
  });

  it('is the 1st when today is the 1st', () => {
    expect(firstPlannedDay('2026-10', new Date(2026, 9, 1))).toBeNull();
  });

  it('pads single-digit days', () => {
    expect(firstPlannedDay('2026-09', new Date(2026, 8, 5))).toBe('2026-09-05');
  });
});

describe('the planned days of a window', () => {
  const sept = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  }));

  it('drops the days before the floor', () => {
    const planned = daysFromFloor(sept, '2026-09-22');
    expect(planned.map((d) => d.date)).toEqual([
      '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26',
      '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30',
    ]);
  });

  it('leaves a window alone when the floor belongs to another month', () => {
    // Paging back to August must not plan an empty month.
    expect(daysFromFloor(sept, '2026-10-05')).toBe(sept);
    expect(daysFromFloor(sept, '2026-08-22')).toBe(sept);
    expect(daysFromFloor(sept, null)).toBe(sept);
  });
});

describe('the answer, as the manager says it', () => {
  it('says only what is left of the month under way', () => {
    setLanguage('es');
    const [sept] = monthChoices(SEP_22);
    expect(composeMonthAnswer(sept, SEP_22)).toBe('Septiembre, solo lo que queda: del 22 al 30.');
    setLanguage('en');
    expect(composeMonthAnswer(sept, SEP_22)).toBe('September 22–30: only what’s left of it.');
  });

  it('names a whole month plainly, and the year once it changes', () => {
    setLanguage('es');
    const list = monthChoices(SEP_22);
    expect(composeMonthAnswer(list[1], SEP_22)).toBe('Octubre.');
    expect(monthLabel(list[4], SEP_22)).toBe('Enero de 2027');
    setLanguage('en');
    expect(monthLabel(list[4], SEP_22)).toBe('January 2027');
  });
});
