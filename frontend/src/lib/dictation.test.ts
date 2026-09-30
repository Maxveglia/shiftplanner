// Which language the microphone listens in.
//
// It used to be `navigator.language`: the laptop's setting, not the product's.
// A manager on a Spanish macOS who had switched the interface to English got a
// recogniser still listening for Spanish -- and dictation matched against the
// wrong language does not fail. It transcribes confident nonsense, so the brief
// fills with words nobody said and goes to the model exactly like that.
//
// The same mistake the dates in locale.ts used to make, with a worse failure
// mode: a wrong month name is visible, a wrong transcription reads as your own
// typing.

import { describe, expect, it } from 'vitest';
import { dictationLocale } from './locale';
import { LANGUAGES } from './i18n/core';

describe('the language the microphone listens in', () => {
  it('follows the language the manager chose', () => {
    expect(dictationLocale('es')).toBe('es-ES');
    expect(dictationLocale('en')).toBe('en-US');
  });

  it('has an answer for every language the product offers', () => {
    // A language in the settings screen with no recogniser tag would fall back
    // silently to English and mistranscribe everything said in it.
    for (const lang of LANGUAGES) {
      expect(dictationLocale(lang.code)).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });
});
