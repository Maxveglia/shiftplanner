// When the dashboard asks "your business looks like X -- right?", and what it
// offers when the answer is no.
//
// The line exists for one kind of profile only, a GUESS, and the tests below
// are mostly about everything that must NOT raise it: a vertical a human
// declared, no vertical at all, the guess that says nothing ("other"), and a
// code the list does not carry. A question that came back after being answered
// would be the one failure the manager could not fix.

import { afterEach, describe, expect, it } from 'vitest';
import { getLanguage, setLanguage, translate } from '../i18n/core';
import { verticalLabel } from '../format';
import {
  OTHER_VERTICAL,
  otherVerticals,
  verticalToConfirm,
  type VerticalView,
} from './inferredVertical';

// The server's list, in the server's order (app/services/business_profile.py).
const VERTICALS = [
  { code: 'bar', label: 'Bar / pub' },
  { code: 'restaurant', label: 'Restaurant' },
  { code: 'cafe', label: 'Cafe / bakery' },
  { code: 'retail', label: 'Retail shop' },
  { code: 'grocery', label: 'Grocery / supermarket' },
  { code: 'clinic', label: 'Clinic / pharmacy' },
  { code: 'hotel', label: 'Hotel' },
  { code: 'gym', label: 'Gym / studio' },
  { code: 'office', label: 'Office / services' },
  { code: 'other', label: 'Something else' },
];

const profile = (patch: Partial<VerticalView> = {}): VerticalView => ({
  vertical: 'bar',
  vertical_source: 'inferred',
  verticals: VERTICALS,
  ...patch,
});

describe('verticalToConfirm', () => {
  it('asks about an inferred vertical, with the label the server sent', () => {
    expect(verticalToConfirm(profile())).toEqual({ code: 'bar', label: 'Bar / pub' });
  });

  it('never asks again once a human has declared one', () => {
    expect(verticalToConfirm(profile({ vertical_source: 'declared' }))).toBeNull();
  });

  it('asks nothing when there is no vertical, guessed or not', () => {
    // What the backend leaves when Jev is off, unsure or failed.
    expect(verticalToConfirm(profile({ vertical: null, vertical_source: 'declared' }))).toBeNull();
    expect(verticalToConfirm(profile({ vertical: null }))).toBeNull();
  });

  it('does not ask about "other", which is not a guess about anything', () => {
    expect(verticalToConfirm(profile({ vertical: OTHER_VERTICAL }))).toBeNull();
  });

  it('does not ask about a code the list does not carry', () => {
    expect(verticalToConfirm(profile({ vertical: 'foodtruck' }))).toBeNull();
  });

  it('asks nothing before the profile has loaded', () => {
    expect(verticalToConfirm(undefined)).toBeNull();
    expect(verticalToConfirm(null)).toBeNull();
  });
});

describe('otherVerticals', () => {
  it('leaves out the guess that was just refused and keeps the rest in order', () => {
    const codes = otherVerticals(VERTICALS, 'bar').map((v) => v.code);
    expect(codes).toEqual(VERTICALS.slice(1).map((v) => v.code));
  });

  it('keeps "Something else", the answer for a business none of them describe', () => {
    expect(otherVerticals(VERTICALS, 'office').map((v) => v.code)).toContain('other');
  });
});

describe('the question, in both languages', () => {
  const initial = getLanguage();
  afterEach(() => setLanguage(initial));

  // Every label is dropped into one sentence, so the sentence has to read for
  // all nine that can be asked about -- "tienda" and "Office / services" as
  // much as "Bar / pub" -- and must never show a placeholder.
  for (const lang of ['es', 'en'] as const) {
    it(`reads for every askable vertical in ${lang}`, () => {
      setLanguage(lang);
      for (const v of VERTICALS.filter((x) => x.code !== OTHER_VERTICAL)) {
        const label = verticalLabel(v);
        const sentence = translate('onboarding.inferredVertical.question', { label });
        expect(sentence).toContain(label);
        expect(sentence).not.toMatch(/[{}]/);
        expect(sentence).not.toContain('onboarding.');
      }
    });
  }
});
