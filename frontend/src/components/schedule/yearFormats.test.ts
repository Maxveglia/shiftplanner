import { afterEach, describe, expect, it } from 'vitest';
import { formatsFor } from './YearGrid';

// The year view keeps its date formatters instead of building one per date.
// What it writes must not change for it: the same text `toLocaleDateString`
// gave, in both languages, and the right day after the machine changes time
// zone without a reload.

const zone = process.env.TZ;
afterEach(() => {
  process.env.TZ = zone;
});

const days = Array.from({ length: 60 }, (_, i) => new Date(2026, 8, 1 + i * 7));

describe('formatsFor', () => {
  for (const locale of ['es-ES', 'en-US']) {
    it(`writes what toLocaleDateString wrote, in ${locale}`, () => {
      const format = formatsFor(locale);
      for (const d of days) {
        expect(format.month.format(d)).toBe(d.toLocaleDateString(locale, { month: 'long' }));
        expect(format.weekday.format(d)).toBe(d.toLocaleDateString(locale, { weekday: 'narrow' }));
        expect(format.day.format(d)).toBe(
          d.toLocaleDateString(locale, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        );
      }
    });
  }

  it('follows the machine to a new time zone', () => {
    // A locale nothing above has used, so the first formatter for it is
    // built here, in New York.
    process.env.TZ = 'America/New_York';
    formatsFor('es-AR');
    process.env.TZ = 'Europe/Madrid';
    // Midnight on the 1st in Madrid is still the 31st in New York: a
    // formatter kept from before would call September August.
    expect(formatsFor('es-AR').month.format(new Date(2026, 8, 1))).toBe('septiembre');
  });
});
