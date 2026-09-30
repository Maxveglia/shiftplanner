// The week strip's arithmetic. Run under TZ=Europe/Madrid as well as the
// machine's zone: the last Sunday of October is 25 hours long there, and a
// week built by adding milliseconds would lose a day across it.

import { describe, expect, it } from 'vitest';
import { getLanguage, setLanguage, type Language } from '../i18n/core';
import {
  dayHeading,
  parsePickedDate,
  sentAtLabel,
  stripKeyTarget,
  weekOf,
  weekdayIndex,
  weekdayName,
} from './days';

function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

describe('weekOf', () => {
  it('is Monday to Sunday around a Thursday', () => {
    expect(weekOf('2026-09-24')).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
  });

  it('keeps a Monday first and a Sunday last', () => {
    expect(weekOf('2026-09-21')[0]).toBe('2026-09-21');
    expect(weekOf('2026-09-27')[0]).toBe('2026-09-21');
    expect(weekOf('2026-09-27')[6]).toBe('2026-09-27');
  });

  it('crosses into last year without a special case', () => {
    expect(weekOf('2026-01-01')).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
  });

  it('keeps seven distinct days across the clock change', () => {
    const week = weekOf('2026-10-25');
    expect(week[0]).toBe('2026-10-19');
    expect(week[6]).toBe('2026-10-25');
    expect(new Set(week).size).toBe(7);
  });
});

describe('weekdayIndex', () => {
  it('numbers Monday 0 and Sunday 6, like the server', () => {
    expect(weekdayIndex('2026-09-21')).toBe(0);
    expect(weekdayIndex('2026-09-27')).toBe(6);
  });
});

describe('stripKeyTarget', () => {
  it('steps a day with the arrows, straight into the next or previous week', () => {
    expect(stripKeyTarget('ArrowRight', '2026-09-24')).toBe('2026-09-25');
    expect(stripKeyTarget('ArrowRight', '2026-09-27')).toBe('2026-09-28');
    expect(stripKeyTarget('ArrowLeft', '2026-09-21')).toBe('2026-09-20');
  });

  it('goes to the ends of the week shown with Home and End', () => {
    expect(stripKeyTarget('Home', '2026-09-24')).toBe('2026-09-21');
    expect(stripKeyTarget('End', '2026-09-24')).toBe('2026-09-27');
  });

  it('leaves every other key alone', () => {
    expect(stripKeyTarget('Enter', '2026-09-24')).toBeNull();
    expect(stripKeyTarget('ArrowDown', '2026-09-24')).toBeNull();
  });
});

describe('parsePickedDate', () => {
  it('takes a real date', () => {
    expect(parsePickedDate('2026-02-28')).toBe('2026-02-28');
  });

  it('refuses an empty box, a half-typed one and a day that does not exist', () => {
    expect(parsePickedDate('')).toBeNull();
    expect(parsePickedDate('2026-02')).toBeNull();
    expect(parsePickedDate('2026-02-31')).toBeNull();
  });
});

describe('dayHeading', () => {
  it('leaves the year out when it is this one', () => {
    const heading = inLanguage('es', () => dayHeading('2026-09-24', '2026-09-24'));
    expect(heading).toMatch(/^jueves, 24 /);
    expect(heading).not.toContain('2026');
  });

  it('says the year once it is another one', () => {
    expect(inLanguage('es', () => dayHeading('2025-12-30', '2026-01-02'))).toContain('2025');
  });
});

describe('weekdayName', () => {
  it('names the server weekday in the chosen language', () => {
    expect(inLanguage('es', () => weekdayName(0, 'long'))).toBe('lunes');
    expect(inLanguage('en', () => weekdayName(6, 'long'))).toBe('Sunday');
  });
});

describe('sentAtLabel', () => {
  it('is the time alone when the note went out today', () => {
    const sent = new Date(2026, 8, 24, 12, 43);
    expect(inLanguage('es', () => sentAtLabel(sent.toISOString(), new Date(2026, 8, 24, 20, 0)))).toBe(
      '12:43',
    );
  });

  it('adds the day when it went out another day', () => {
    const sent = new Date(2026, 8, 20, 9, 5);
    const label = inLanguage('es', () => sentAtLabel(sent.toISOString(), new Date(2026, 8, 24)));
    expect(label).toMatch(/^20 .*, 09:05$/);
  });
});
