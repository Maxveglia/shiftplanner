import { describe, expect, it } from 'vitest';
import { getLanguage, setLanguage, type Language } from '../i18n/core';
import {
  formatDayHeading,
  formatDayMedium,
  formatDayTick,
  formatInstant,
  formatMoneyShort,
  weekdayLong,
  weekdayShort,
} from './format';

/** Read in one language without leaking it into other tests. */
function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

/** The figure without its currency sign, which is the business's and not tested here. */
const digits = (text: string) => text.replace(/[^\d.,a-zA-Z ]/g, '').trim();

describe('formatMoneyShort', () => {
  it('keeps the cents of a small amount', () => {
    expect(digits(inLanguage('es', () => formatMoneyShort(7.5)))).toBe('7,50');
    expect(digits(inLanguage('en', () => formatMoneyShort(7.5)))).toBe('7.50');
  });

  it('drops the cents from 100 up, and of a whole amount', () => {
    expect(digits(inLanguage('es', () => formatMoneyShort(1234.56)))).toBe('1235');
    expect(digits(inLanguage('es', () => formatMoneyShort(40)))).toBe('40');
  });

  it('goes compact from ten thousand', () => {
    expect(inLanguage('es', () => formatMoneyShort(12345))).toMatch(/12,3\s*mil/);
    expect(inLanguage('en', () => formatMoneyShort(12345))).toMatch(/12\.3K/);
  });

  it('writes a dash for what is not a number', () => {
    expect(formatMoneyShort(NaN)).toBe('—');
  });
});

describe('formatDayHeading', () => {
  const today = new Date(2026, 8, 27, 12);

  it('says today and yesterday in words', () => {
    expect(inLanguage('es', () => formatDayHeading('2026-09-27', today))).toBe('Hoy');
    expect(inLanguage('es', () => formatDayHeading('2026-09-26', today))).toBe('Ayer');
    expect(inLanguage('en', () => formatDayHeading('2026-09-27', today))).toBe('Today');
  });

  it('writes other days with their weekday, capitalised, and the year only when it is another', () => {
    const thursday = inLanguage('es', () => formatDayHeading('2026-09-24', today));
    expect(thursday.startsWith('Jueves')).toBe(true);
    expect(thursday).not.toContain('2026');
    expect(inLanguage('es', () => formatDayHeading('2025-12-31', today))).toContain('2025');
  });
});

describe('days and weekdays', () => {
  it('reads the date by the local calendar', () => {
    expect(inLanguage('en', () => formatDayTick('2026-09-26'))).toBe('Sep 26');
    expect(inLanguage('en', () => formatDayMedium('2026-09-26'))).toBe('Sat, Sep 26');
  });

  it('starts the week on Monday', () => {
    expect(inLanguage('en', () => weekdayShort(0))).toBe('Mon');
    expect(inLanguage('en', () => weekdayShort(6))).toBe('Sun');
    expect(inLanguage('es', () => weekdayLong(0))).toBe('Lunes');
    expect(inLanguage('es', () => weekdayLong(6))).toBe('Domingo');
  });
});

describe('formatInstant', () => {
  it('writes an instant as the local day and clock', () => {
    // Built from local parts, so the test says the same in any zone.
    const iso = new Date(2026, 8, 27, 13, 5).toISOString();
    expect(inLanguage('es', () => formatInstant(iso))).toEqual({ day: '27 sept 2026', time: '13:05' });
    expect(inLanguage('en', () => formatInstant(iso))).toEqual({ day: 'Sep 27, 2026', time: '1:05 PM' });
  });

  it('is null for nothing and for what does not read', () => {
    expect(formatInstant(null)).toBeNull();
    expect(formatInstant('')).toBeNull();
    expect(formatInstant('yesterday')).toBeNull();
  });
});
