// The rule these two functions encode, and the only one that matters:
//
//   what WE seeded is translated, what the CUSTOMER wrote never is.
//
// A row stops being ours the moment somebody renames it, so every case below is
// really the same question asked twice — "is this row still exactly as we
// created it?" — once for absence types and once for shift templates.

import { describe, expect, it } from 'vitest';
import {
  absenceTypeLabel,
  formatClockValue,
  formatDecimal,
  formatMoney,
  formatRate,
  formatShiftRange,
  formatTime,
  shiftTemplateLabel,
} from './format';
import { getLanguage, setLanguage, type Language } from './i18n/core';
import { absenceType, contract, days, employee, spec, template } from '../test/factories';
import { generateSchedule } from './schedule/generate';

/** Read a label in one language without leaking that language into other tests. */
function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

describe('absenceTypeLabel', () => {
  it('translates a seeded type the manager has not touched', () => {
    const vacation = absenceType({ code: 'VAC', name: 'Vacation' });
    expect(inLanguage('en', () => absenceTypeLabel(vacation))).toBe('Vacation');
    expect(inLanguage('es', () => absenceTypeLabel(vacation))).toBe('Vacaciones');
  });

  it('leaves a renamed seeded type exactly as the manager wrote it', () => {
    // He kept our code and gave it his own word. His word wins, in every
    // language — this is the whole reason the name is checked at all.
    const renamed = absenceType({ code: 'VAC', name: 'Días de playa' });
    for (const lang of ['en', 'es'] as Language[]) {
      expect(inLanguage(lang, () => absenceTypeLabel(renamed))).toBe('Días de playa');
    }
  });

  it('leaves a type the manager created alone', () => {
    const own = absenceType({ code: 'BODA', name: 'Boda' });
    for (const lang of ['en', 'es'] as Language[]) {
      expect(inLanguage(lang, () => absenceTypeLabel(own))).toBe('Boda');
    }
  });
});

describe('shiftTemplateLabel', () => {
  it('translates a seeded template the manager has not touched', () => {
    const evening = template({ seed_key: 'evening', name: 'Evening' });
    expect(inLanguage('en', () => shiftTemplateLabel(evening))).toBe('Evening');
    // The bug this fixes: "Evening" sitting in a Spanish calendar next to a
    // synthesised shift already labelled "Tarde-noche".
    expect(inLanguage('es', () => shiftTemplateLabel(evening))).toBe('Tarde-noche');
  });

  it('leaves a renamed seeded template exactly as the manager wrote it', () => {
    const renamed = template({ seed_key: 'evening', name: 'Turno de barra' });
    for (const lang of ['en', 'es'] as Language[]) {
      expect(inLanguage(lang, () => shiftTemplateLabel(renamed))).toBe('Turno de barra');
    }
  });

  it('leaves a template the manager created alone', () => {
    // No seed key at all: nothing to look up, nothing to second-guess.
    const own = template({ seed_key: null, name: 'Evening' });
    for (const lang of ['en', 'es'] as Language[]) {
      expect(inLanguage(lang, () => shiftTemplateLabel(own))).toBe('Evening');
    }
  });
});

// The last place a seeded name leaked, and the one hardest to see: a calendar
// that has just been generated and not yet published. The published one goes
// through `persist`, which was already fixed; this one is built in the browser
// from the template rows straight off the API, so a bar could hold an
// "Evening" block beside a "Tarde-noche" block in the same week -- the first
// taken from a seeded template, the second synthesised and named after its
// band. Two names for the same hours, in two languages, on one screen.
describe('a calendar built from seeded templates', () => {
  it('names its shifts in the language the rest of the screen speaks', () => {
    const staff = [
      employee({ id: 'e1', current_contract: contract({ id: 'c1', employee_id: 'e1' }) }),
    ];
    const morning = template({
      id: 't-morning',
      seed_key: 'morning',
      name: 'Morning',
      start_time: '09:00',
      end_time: '17:00',
    });
    const shop = spec({ minStaff: 1, openMin: 9 * 60, closeMin: 17 * 60 });
    const week = days('2026-03-02', 5);

    const named = (lang: Language) =>
      inLanguage(lang, () =>
        generateSchedule(staff, [morning], [], [], shop, week).assignments.map(
          (a) => a.templateName,
        ),
      );

    expect(named('en')).toContain('Morning');
    expect(named('es')).toContain('Mañana');
    expect(named('es')).not.toContain('Morning');
  });

  it('keeps the name the manager gave his own template, in any language', () => {
    const staff = [
      employee({ id: 'e1', current_contract: contract({ id: 'c1', employee_id: 'e1' }) }),
    ];
    const his = template({
      id: 't-his',
      seed_key: null,
      name: 'Turno de barra',
      start_time: '09:00',
      end_time: '17:00',
    });
    const shop = spec({ minStaff: 1, openMin: 9 * 60, closeMin: 17 * 60 });
    const week = days('2026-03-02', 5);

    for (const lang of ['en', 'es'] as Language[]) {
      const names = inLanguage(lang, () =>
        generateSchedule(staff, [his], [], [], shop, week).assignments.map(
          (a) => a.templateName,
        ),
      );
      expect(names).toContain('Turno de barra');
    }
  });
});

// A clock is a convention of the language, like a month name. The calendar
// grid has always known that -- it writes "1p" in English and "13" in Spanish
// -- and everything else used to write 24 hours whatever the screen said, so
// one shift read "5:00 PM" in the grid and "17:00 - 01:00" in the list under
// it. These are the two functions that keep that from coming back, and they
// are two on purpose.
describe('the clock', () => {
  it('is read in the language of whoever is reading it', () => {
    expect(inLanguage('en', () => formatTime(17 * 60))).toBe('5:00 PM');
    expect(inLanguage('es', () => formatTime(17 * 60))).toBe('17:00');
  });

  it('pads the hour where the language pads it, and not where AM would follow', () => {
    // "09:00 AM" is nobody's English. "9:00" on a Spanish rota is nobody's
    // Spanish either.
    expect(inLanguage('en', () => formatTime(9 * 60))).toBe('9:00 AM');
    expect(inLanguage('es', () => formatTime(9 * 60))).toBe('09:00');
  });

  it('marks a span that runs into the next day, in either language', () => {
    const late = (lang: Language) =>
      inLanguage(lang, () => formatShiftRange(22 * 60, 26 * 60));
    expect(late('en')).toBe('10:00 PM – 2:00 AM +1');
    expect(late('es')).toBe('22:00 – 02:00 +1');
  });

  it('keeps one 24-hour format for the time input, which has no language', () => {
    // <input type="time"> takes "HH:MM" and nothing else: hand it "5:00 PM"
    // and the browser shows an empty box with no error anywhere.
    for (const lang of ['en', 'es'] as Language[]) {
      expect(inLanguage(lang, () => formatClockValue(17 * 60))).toBe('17:00');
      expect(inLanguage(lang, () => formatClockValue(9 * 60))).toBe('09:00');
    }
  });
});

describe('a decimal', () => {
  it('takes the mark of the language and no thousands separator', () => {
    expect(inLanguage('en', () => formatDecimal(37.5))).toBe('37.5');
    expect(inLanguage('es', () => formatDecimal(37.5))).toBe('37,5');
    for (const lang of ['en', 'es'] as Language[]) {
      expect(inLanguage(lang, () => formatDecimal(40))).toBe('40');
      expect(inLanguage(lang, () => formatDecimal(1200))).toBe('1200');
    }
  });
});

// Every business on the product is in Spain, so an amount is in euros in
// either language; only how it is written follows the language. Intl puts a
// no-break space between a Spanish amount and its sign, so a price never
// wraps away from it.
describe('an amount of money', () => {
  const NBSP = '\u00a0';

  it('is in euros whatever the language, written the way the language writes it', () => {
    expect(inLanguage('en', () => formatMoney(1250.5))).toBe('€1,250.50');
    expect(inLanguage('es', () => formatMoney(1250.5))).toBe(`1250,50${NBSP}€`);
    expect(inLanguage('es', () => formatMoney(12))).toBe(`12,00${NBSP}€`);
  });

  it('never says dollars, nor any country before the sign', () => {
    for (const lang of ['en', 'es'] as Language[]) {
      const text = inLanguage(lang, () => formatMoney(30));
      expect(text).not.toMatch(/\$|US|EUR/);
      expect(text).toContain('€');
    }
  });

  it('rounds to whole euros when asked, for a month of pay', () => {
    expect(inLanguage('en', () => formatMoney(12345.6, { whole: true }))).toBe('€12,346');
    expect(inLanguage('es', () => formatMoney(12345.6, { whole: true }))).toBe(`12.346${NBSP}€`);
  });

  it('is a dash for no amount at all, and a zero for zero', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(inLanguage('es', () => formatMoney(0))).toBe(`0,00${NBSP}€`);
  });

  it('states an hourly rate to the cent, even when whole', () => {
    expect(inLanguage('en', () => formatRate(30))).toBe('€30.00');
    expect(inLanguage('es', () => formatRate(9.591))).toBe(`9,59${NBSP}€`);
  });
});
