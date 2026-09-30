// The unit is written ONCE.
//
// THE BUG THIS PINS. `formatHours` returns "23,2h" -- the unit included -- and
// five of these sentences added another " h" after the placeholder, so the
// working-year screen said "23,2h h por detrás" and "1h h complementarias" in
// both languages, on screen, for as long as the view existed. It survives
// review easily: the string reads perfectly in the file, and the duplication
// only appears once a formatted value is substituted in.
//
// So the rule is checked instead of remembered: every key whose value arrives
// through `formatHours`/`signedHours` must not write a unit of its own. The
// other half of the convention -- a BARE number carries its unit in the
// sentence -- is checked too, because dropping it would leave "40" where the
// contract column should read "40 h/sem".

import { describe, expect, it } from 'vitest';
import { workday } from './workday';
import { formatHours } from '../../format';
import { getLanguage, setLanguage, translate, type Language } from '../core';

/** Keys whose `{hours}` is already formatted by the caller. */
const FORMATTED = [
  'workday.deviation.ahead',
  'workday.deviation.behind',
  'workday.extra.overtime',
  'workday.extra.complementary',
  'workday.extra.moved',
  'workday.extra.compensated',
];

/** Keys whose numbers are bare, and whose sentence therefore owns the unit. */
const BARE = ['workday.annualHours', 'workday.contract.weekly'];

const LANGUAGES: Language[] = ['es', 'en'];

function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

describe('the working-year dictionary', () => {
  it.each(LANGUAGES)('never writes the unit twice in %s', (lang) => {
    for (const key of FORMATTED) {
      const text = inLanguage(lang, () =>
        translate(key, { hours: formatHours(23.2) }),
      );
      expect(text, key).not.toMatch(/h\s+h\b/);
      expect(text, key).toContain(inLanguage(lang, () => formatHours(23.2)));
    }
  });

  it.each(LANGUAGES)('still writes the unit for a bare number in %s', (lang) => {
    for (const key of BARE) {
      const text = inLanguage(lang, () => translate(key, { hours: 40 }));
      expect(text, key).toMatch(/40\s*h/);
    }
  });

  it('gives a retroactively published shift a sentence of its own', () => {
    // `short_notice` can arrive with NEGATIVE days (a shift entered after it
    // was worked), and the ordinary sentence would read "comunicado con −140
    // días". The alternative key exists in both languages or the fallback
    // quietly shows English.
    for (const lang of LANGUAGES) {
      expect(workday[lang]['workday.error.short_notice_after']).toBeTruthy();
    }
  });
});
