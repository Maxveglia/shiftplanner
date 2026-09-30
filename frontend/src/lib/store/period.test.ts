import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  isoDay,
  isSaleDay,
  parseIsoDay,
  periodRange,
  readPeriod,
  weekdayOf,
} from './period';

describe('isoDay / parseIsoDay', () => {
  it('writes the local calendar date, not the UTC one', () => {
    // 00:30 local on the 27th is still the 26th in UTC west of Greenwich,
    // and already the 27th east of it: the local date is the one that counts.
    expect(isoDay(new Date(2026, 8, 27, 0, 30))).toBe('2026-09-27');
    expect(isoDay(new Date(2026, 8, 27, 23, 59))).toBe('2026-09-27');
  });

  it('reads a day back as local midnight', () => {
    const d = parseIsoDay('2026-09-27')!;
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 8, 27, 0]);
  });

  it('refuses what is not a day', () => {
    expect(parseIsoDay('2026-02-30')).toBeNull();
    expect(parseIsoDay('2026-9-7')).toBeNull();
    expect(parseIsoDay('')).toBeNull();
    expect(parseIsoDay('2026-09-27T10:00:00Z')).toBeNull();
  });
});

describe('addDays', () => {
  it('crosses months, years and clock changes by the calendar', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    // The last Sunday of October is 25 hours long in Spain.
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
  });
});

describe('periodRange', () => {
  const today = new Date(2026, 8, 27, 18, 0);

  it('counts today as the last of the days', () => {
    expect(periodRange(7, today)).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(periodRange(30, today)).toEqual({ from: '2026-08-29', to: '2026-09-27' });
    expect(periodRange(90, today)).toEqual({ from: '2026-06-30', to: '2026-09-27' });
  });

  it('has exactly as many days as it says', () => {
    for (const n of [7, 30, 90]) {
      const { from, to } = periodRange(n, today);
      expect(daysBetween(from, to)).toHaveLength(n);
    }
  });
});

describe('readPeriod', () => {
  it('takes the periods on offer and falls back to 30 for anything else', () => {
    expect(readPeriod('7')).toBe(7);
    expect(readPeriod('90')).toBe(90);
    expect(readPeriod(null)).toBe(30);
    expect(readPeriod('14')).toBe(30);
    expect(readPeriod('abc')).toBe(30);
  });
});

describe('daysBetween', () => {
  it('lists every day, both ends included', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual([
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
    ]);
  });

  it('is empty backwards or with a malformed end', () => {
    expect(daysBetween('2026-10-02', '2026-09-29')).toEqual([]);
    expect(daysBetween('nope', '2026-09-29')).toEqual([]);
  });
});

describe('weekdayOf', () => {
  it('numbers Monday 0 and Sunday 6, as the server does', () => {
    expect(weekdayOf('2026-09-21')).toBe(0); // Monday
    expect(weekdayOf('2026-09-26')).toBe(5); // Saturday
    expect(weekdayOf('2026-09-27')).toBe(6); // Sunday
  });
});

describe('isSaleDay', () => {
  const today = new Date(2026, 8, 27, 23, 50);

  it('takes any real day from 2000 to tomorrow', () => {
    expect(isSaleDay('2026-09-27', today)).toBe(true);
    expect(isSaleDay('2026-09-28', today)).toBe(true);
    expect(isSaleDay('2000-01-01', today)).toBe(true);
  });

  it('refuses the day after tomorrow, the last century and non-days', () => {
    expect(isSaleDay('2026-09-29', today)).toBe(false);
    expect(isSaleDay('1999-12-31', today)).toBe(false);
    expect(isSaleDay('', today)).toBe(false);
    expect(isSaleDay('2026-02-30', today)).toBe(false);
  });
});
