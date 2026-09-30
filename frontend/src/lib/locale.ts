// The one place the app decides what conventions it formats in.
//
// Every date, time and number went through `toLocaleDateString(undefined, ...)`
// before this, which formats in the VIEWER's locale. That sounds like good
// internationalisation, and it would be -- if the rest of the interface were
// translated. For a long time it was not: every label was English, so a machine
// set to Spanish showed one screen speaking two ("Agosto De 2026" under "Hours
// & pay"), and the locale was pinned to en-US to match the copy.
//
// The interface IS translated now (see lib/i18n), so the pin moved: the locale
// follows the LANGUAGE THE MANAGER CHOSE, not the operating system and not a
// constant. Pick Spanish and the copy, the month names and the thousands
// separators all move together; pick English and they all move back.
//
// This is the seam. `setAppLanguage` is called by lib/i18n/core.ts -- once at
// startup and again on every change -- and every formatter below follows.
// Nothing else should import it.

import type { Language } from './i18n/core';

const LOCALES: Record<Language, string> = {
  es: 'es-ES',
  en: 'en-US',
};

/**
 * Live binding on purpose. Everything that formats reads `APP_LOCALE` inside a
 * function body, so the value they see is the one current at call time, and a
 * language change needs no prop threaded through twenty components. React
 * re-renders because the language context changed; this makes that re-render
 * come out in the right language.
 */
export let APP_LOCALE: string = LOCALES.en;

/**
 * How each language writes a time of day, past what the locale alone decides.
 *
 * `Intl` picks the 12- or 24-hour clock from the locale on its own; what it
 * cannot know is that the two languages pad the hour differently in this kind
 * of product. A Spanish rota writes "09:00" and an English one writes
 * "9:00 AM" -- never "09:00 AM", which is how a padded hour reads once AM is
 * next to it. One line each, so the whole difference is visible at once.
 */
const TIME_FORMATS: Record<Language, Intl.DateTimeFormatOptions> = {
  es: { hour: '2-digit', minute: '2-digit' },
  en: { hour: 'numeric', minute: '2-digit' },
};

/** Live binding, for the same reason `APP_LOCALE` is one. */
export let APP_TIME_FORMAT: Intl.DateTimeFormatOptions = TIME_FORMATS.en;

export function setAppLanguage(lang: Language): void {
  APP_LOCALE = LOCALES[lang] ?? LOCALES.en;
  APP_TIME_FORMAT = TIME_FORMATS[lang] ?? TIME_FORMATS.en;
}

// ONE THING THIS CANNOT REACH: native <input type="date"> and type="time"
// render their own value in the browser/OS locale, and no JavaScript can
// override it -- a Spanish machine shows "14/09/2026" in the picker whatever
// this file says. It is only the widget's display; the value submitted is
// always ISO. Pinning those would mean replacing them with a custom picker,
// which is a real cost for a small inconsistency, so they are left alone
// knowingly rather than overlooked.

/**
 * What to tell the browser's speech recogniser, per language the product
 * speaks. Here rather than beside either microphone because there are two --
 * the brief panel and the refine bar -- and one of them being right while the
 * other listened in the wrong language is exactly the bug this fixes.
 *
 * It follows the CHOSEN language, never `navigator.language`. That was written
 * before the interface had a language of its own, and it is the same mistake
 * the dates above used to make -- except that dictation matched against the
 * wrong language does not fail. It transcribes confident nonsense, and the
 * manager watches their brief fill with words they did not say.
 *
 * Regional tags because the API requires one; the region is the least wrong
 * default rather than a claim about who is speaking.
 */
const DICTATION_LOCALES: Record<Language, string> = {
  es: 'es-ES',
  en: 'en-US',
};

export function dictationLocale(lang: Language): string {
  return DICTATION_LOCALES[lang] ?? DICTATION_LOCALES.en;
}

/**
 * Currency the product prices in: euros. Every business on it is in Spain --
 * its pay, its costs, its menu and its till -- and that is a property of the
 * business, not of the reader, so it does NOT change with the language. Only
 * the way the amount is written does: "€1,250.00" in English, "1250,00 €" in
 * Spanish.
 *
 * It was dollars, from when the product was built for the US market under
 * FLSA rules.
 */
export const APP_CURRENCY = 'EUR';
