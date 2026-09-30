import { describe, expect, it } from 'vitest';
import { countDishes, dishMatches, filterMenu, foldText } from './filter';
import type { MenuDish, MenuSection } from './types';

function dish(id: string, name: string, allergens: string[] = [], description: string | null = null): MenuDish {
  return {
    id,
    section_id: 's',
    name,
    description,
    price: 10,
    allergens,
    available: true,
    position: 0,
    photo_url: null,
    photo_labelled: false,
  };
}

const croquetas = dish('croq', 'Croquetas de jamón', ['gluten', 'milk', 'eggs'], 'Seis, caseras');
const pulpo = dish('pulpo', 'Pulpo a la gallega', ['molluscs']);
const ensalada = dish('ens', 'Ensalada verde', [], 'Con vinagreta de mostaza de la casa');
const tarta = dish('tarta', 'Tarta de queso', ['milk', 'eggs', 'gluten']);
const cafe = dish('cafe', 'Café solo');

const MENU: MenuSection[] = [
  { id: 'a', name: 'Entrantes', position: 0, dishes: [croquetas, pulpo, ensalada] },
  { id: 'b', name: 'Postres', position: 1, dishes: [tarta] },
  { id: 'c', name: 'Bebidas', position: 2, dishes: [cafe] },
  { id: 'd', name: 'Sin rellenar', position: 3, dishes: [] },
];

const NONE = new Set<string>();
const names = (sections: MenuSection[]) => sections.map((s) => [s.name, s.dishes.map((d) => d.id)]);

describe('foldText', () => {
  it('drops accents and case', () => {
    expect(foldText('Jamón IBÉRICO, Café')).toBe('jamon iberico, cafe');
  });
});

describe('dishMatches', () => {
  it('finds a dish without its accents', () => {
    expect(dishMatches(croquetas, { query: 'jamon', without: NONE })).toBe(true);
    expect(dishMatches(cafe, { query: 'CAFE', without: NONE })).toBe(true);
  });

  it('wants every word, in the name or the description', () => {
    expect(dishMatches(tarta, { query: 'tarta queso', without: NONE })).toBe(true);
    expect(dishMatches(croquetas, { query: 'croquetas caseras', without: NONE })).toBe(true);
    expect(dishMatches(croquetas, { query: 'croquetas pollo', without: NONE })).toBe(false);
  });

  it('matches everything when the query is blank', () => {
    expect(dishMatches(pulpo, { query: '   ', without: NONE })).toBe(true);
  });

  it('hides a dish that has any of the allergens left out', () => {
    expect(dishMatches(croquetas, { query: '', without: new Set(['gluten']) })).toBe(false);
    expect(dishMatches(pulpo, { query: '', without: new Set(['gluten', 'milk']) })).toBe(true);
  });
});

describe('filterMenu', () => {
  it('keeps the order and leaves out empty sections', () => {
    expect(names(filterMenu(MENU, { query: '', without: NONE }))).toEqual([
      ['Entrantes', ['croq', 'pulpo', 'ens']],
      ['Postres', ['tarta']],
      ['Bebidas', ['cafe']],
    ]);
  });

  it('answers "what is there without gluten and milk?"', () => {
    expect(names(filterMenu(MENU, { query: '', without: new Set(['gluten', 'milk']) }))).toEqual([
      ['Entrantes', ['pulpo', 'ens']],
      ['Bebidas', ['cafe']],
    ]);
  });

  it('searches the description too: the mustard is in the vinaigrette', () => {
    expect(names(filterMenu(MENU, { query: 'mostaza', without: NONE }))).toEqual([
      ['Entrantes', ['ens']],
    ]);
  });

  it('combines the search and the allergens', () => {
    expect(names(filterMenu(MENU, { query: 'queso', without: new Set(['milk']) }))).toEqual([]);
  });

  it('does not change the menu it was given', () => {
    filterMenu(MENU, { query: 'pulpo', without: NONE });
    expect(MENU[0].dishes).toHaveLength(3);
  });
});

describe('countDishes', () => {
  it('adds up every section', () => {
    expect(countDishes(MENU)).toBe(5);
    expect(countDishes([])).toBe(0);
  });
});
