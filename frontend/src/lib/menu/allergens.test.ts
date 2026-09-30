import { describe, expect, it } from 'vitest';
import { ALLERGENS, isAllergen, sortAllergens } from './allergens';
import { menu } from '../i18n/messages/menu';

describe('ALLERGENS', () => {
  it('is the fourteen of Regulation 1169/2011, in the order the server keeps them', () => {
    expect(ALLERGENS).toEqual([
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
    ]);
  });

  it('has a name for each in both languages', () => {
    for (const code of ALLERGENS) {
      expect(menu.en[`menu.allergen.${code}`], code).toBeTruthy();
      expect(menu.es[`menu.allergen.${code}`], code).toBeTruthy();
    }
  });
});

describe('sortAllergens', () => {
  it('puts them in the canonical order, each once', () => {
    expect(sortAllergens(['milk', 'gluten', 'milk', 'molluscs', 'eggs'])).toEqual([
      'gluten',
      'eggs',
      'milk',
      'molluscs',
    ]);
  });

  it('keeps a code it does not know, after the known ones', () => {
    expect(sortAllergens(['kiwi', 'soy'])).toEqual(['soy', 'kiwi']);
  });

  it('does not change the list it was given', () => {
    const given = ['milk', 'gluten'];
    sortAllergens(given);
    expect(given).toEqual(['milk', 'gluten']);
  });
});

describe('isAllergen', () => {
  it('knows the fourteen and nothing else', () => {
    expect(isAllergen('sulphites')).toBe(true);
    expect(isAllergen('sulfites')).toBe(false);
  });
});
