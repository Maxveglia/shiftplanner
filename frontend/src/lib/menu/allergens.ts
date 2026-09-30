// The fourteen allergens a menu has to declare (EU Regulation 1169/2011,
// annex II), with the codes the server stores and IN THE ORDER it stores
// them. The same list, in the same order, is in the backend: a dish's
// allergens arrive sorted by it, and they are shown and sent the same way.

import { translate } from '../i18n/core';

export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soy',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;

export type Allergen = (typeof ALLERGENS)[number];

const RANK = new Map<string, number>(ALLERGENS.map((code, i) => [code, i]));

export function isAllergen(code: string): code is Allergen {
  return RANK.has(code);
}

/**
 * The codes in the canonical order, each once.
 *
 * A code this bundle does not know -- a newer server with a fifteenth -- is
 * kept, after the known ones, rather than dropped: an allergen missing from
 * the screen is the one mistake this list cannot make.
 */
export function sortAllergens(codes: readonly string[]): string[] {
  const unique = [...new Set(codes)];
  return unique.sort((a, b) => {
    const ra = RANK.get(a) ?? ALLERGENS.length;
    const rb = RANK.get(b) ?? ALLERGENS.length;
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}

/** An allergen's name in the reader's language; an unknown code as it came. */
export function allergenLabel(code: string): string {
  const key = `menu.allergen.${code}`;
  const text = translate(key);
  return text === key ? code : text;
}
