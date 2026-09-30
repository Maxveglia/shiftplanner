// The language the product speaks, and the one place that decides it.
//
// Every user-visible string lives in `messages/`, keyed, in both languages. A
// component never holds English or Spanish literals; it holds a key and asks
// for it. That is what makes "switch the platform to Spanish" a one-line change
// instead of a rewrite.
//
// There are two ways in, and they exist for different callers:
//
//   useT()      React components. Re-renders when the language changes.
//   translate() plain modules (lib/schedule/*, lib/format.ts) that build labels
//               outside a component and cannot hold a hook.
//
// Both read the same dictionary and the same current language, so they can
// never disagree.

import { messages } from './messages';
import { setAppLanguage } from '../locale';

export type Language = 'es' | 'en';

/** Offered in the settings screen, in this order. */
export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
];

const STORAGE_KEY = 'shiftplanner.language';

export function isLanguage(value: unknown): value is Language {
  return value === 'es' || value === 'en';
}

/**
 * What to speak the first time somebody opens the app on this device.
 *
 * The browser's own language decides it -- a Spanish machine gets Spanish
 * without touching a setting -- and anything else falls back to English. Once
 * the manager picks a language it is stored, and the browser stops being asked.
 */
function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Private browsing or blocked storage: fall through to detection.
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

let current: Language = detectLanguage();
const listeners = new Set<(lang: Language) => void>();

// Dates and numbers follow the copy from the very first render, before any
// component mounts. Half-translated is worse than untranslated -- see locale.ts.
setAppLanguage(current);

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  if (lang === current) return;
  current = lang;
  setAppLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // The language still applies to this session; it just will not survive it.
  }
  listeners.forEach((fn) => fn(lang));
}

export function subscribe(fn: (lang: Language) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type Vars = Record<string, string | number>;

/**
 * Look a key up in the active language.
 *
 * A missing Spanish string falls back to English rather than to a blank or a
 * raw key: a screen that is 98% translated should show the two English words it
 * is missing, not two holes. In dev the miss is logged so it gets fixed.
 */
export function translateIn(lang: Language, key: string, vars?: Vars): string {
  const table = messages[lang];
  let value = table[key];
  if (value === undefined) {
    value = messages.en[key];
    if (import.meta.env.DEV) {
      console.warn(`[i18n] missing ${lang} string for "${key}"`);
    }
  }
  if (value === undefined) return key;
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** Translate outside React. Components should use `useT()` instead. */
export function translate(key: string, vars?: Vars): string {
  return translateIn(current, key, vars);
}

/**
 * Singular/plural in one call: `plural(n, 'x.one', 'x.other', { count: n })`.
 * Both languages agree on the 1-vs-rest split, which is all this product needs.
 */
export function plural(count: number, one: string, other: string, vars?: Vars): string {
  return translate(count === 1 ? one : other, { count, ...vars });
}
