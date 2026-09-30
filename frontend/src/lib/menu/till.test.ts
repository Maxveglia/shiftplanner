import { describe, expect, it } from 'vitest';
import { activeSection, compareDishNames, dishesIn, sectionChips, sortDishes, tillDishes } from './till';
import type { MenuDish, MenuSection } from './types';

function dish(id: string, name: string, section = 's', extra: Partial<MenuDish> = {}): MenuDish {
  return {
    id,
    section_id: section,
    name,
    description: null,
    price: 10,
    allergens: [],
    available: true,
    position: 0,
    photo_url: null,
    photo_labelled: false,
    ...extra,
  };
}

// Casa Demo's menu as its manager wrote it, section by section and not in
// alphabetical order -- the till shows it A to Z all the same.
const CRISPY: MenuSection[] = [
  {
    id: 'crispy',
    name: 'Crispy',
    position: 0,
    dishes: [
      dish('cp', 'Crispy Pequeño', 'crispy', { allergens: ['gluten'] }),
      dish('cg', 'Crispy Grande', 'crispy', { allergens: ['gluten'] }),
      dish('cxl', 'Crispy XL', 'crispy', { allergens: ['gluten'] }),
      dish('ca', 'Crispy Ahumado', 'crispy', { allergens: ['gluten', 'milk'] }),
    ],
  },
  {
    id: 'combos',
    name: 'Combos',
    position: 1,
    dishes: [
      dish('ccg', 'Combo Crispy Grande', 'combos', { allergens: ['gluten'] }),
      dish('pueblo', 'El del Puerto', 'combos', { description: 'Crispy, patatas y bebida' }),
    ],
  },
  { id: 'ensaladas', name: 'Ensaladas', position: 2, dishes: [dish('ens', 'Ensalada Casa Demo', 'ensaladas')] },
  {
    id: 'bebidas',
    name: 'Bebidas',
    position: 3,
    dishes: [
      dish('coca', 'Coca-Cola', 'bebidas'),
      dish('agua', 'Agua', 'bebidas'),
      dish('capri', 'Caprisun', 'bebidas', { available: false }),
    ],
  },
  { id: 'postres', name: 'Postres', position: 4, dishes: [] },
];

const NONE = new Set<string>();
const names = (dishes: readonly Pick<MenuDish, 'name'>[]) => dishes.map((d) => d.name);
const all = (extra: Partial<Parameters<typeof tillDishes>[1]> = {}) => ({ section: null, query: '', without: NONE, ...extra });

describe('compareDishNames / sortDishes', () => {
  it('lays Casa Demo out as its till does', () => {
    expect(names(tillDishes(CRISPY, all(), 'es-ES'))).toEqual([
      'Agua',
      'Caprisun',
      'Coca-Cola',
      'Combo Crispy Grande',
      'Crispy Ahumado',
      'Crispy Grande',
      'Crispy Pequeño',
      'Crispy XL',
      'El del Puerto',
      'Ensalada Casa Demo',
    ]);
  });

  it('does not count accents: "Ácido" goes with the A, not after the Z', () => {
    const list = [dish('1', 'Zumo'), dish('2', 'Ácido'), dish('3', 'Agua'), dish('4', 'Éclair'), dish('5', 'Ensalada')];
    expect(names(sortDishes(list, 'es-ES'))).toEqual(['Ácido', 'Agua', 'Éclair', 'Ensalada', 'Zumo']);
    // What a plain comparison of the strings would have done.
    expect(names([...list].sort((a, b) => (a.name < b.name ? -1 : 1)))).toEqual(['Agua', 'Ensalada', 'Zumo', 'Ácido', 'Éclair']);
  });

  it('does not count capitals: "coca-cola" beside "Combo", not after every capital', () => {
    const list = [dish('1', 'Combo'), dish('2', 'Tarta'), dish('3', 'coca-cola'), dish('4', 'AGUA')];
    expect(names(sortDishes(list, 'es-ES'))).toEqual(['AGUA', 'coca-cola', 'Combo', 'Tarta']);
  });

  it('keeps the letters of the language: in Spanish Ñ comes after N, in English with it', () => {
    const list = [dish('1', 'Ñoquis'), dish('2', 'Nuez'), dish('3', 'Nata')];
    expect(names(sortDishes(list, 'es-ES'))).toEqual(['Nata', 'Nuez', 'Ñoquis']);
    expect(names(sortDishes(list, 'en-US'))).toEqual(['Nata', 'Ñoquis', 'Nuez']);
  });

  it('reads numbers as numbers', () => {
    expect(names(sortDishes([dish('1', 'Menú 10'), dish('2', 'Menú 2')], 'es-ES'))).toEqual(['Menú 2', 'Menú 10']);
  });

  it('never leaves two names the eye reads alike to chance', () => {
    const a = dish('a', 'Crispy');
    const b = dish('b', 'CRISPY');
    const c = dish('c', 'Croústy');
    // Whichever order they come in, they leave in the same one.
    expect(names(sortDishes([a, b, c], 'es-ES'))).toEqual(names(sortDishes([c, b, a], 'es-ES')));
    // Two names spelt exactly alike: by id.
    const twin = dish('z', 'Crispy');
    expect(sortDishes([twin, a], 'es-ES').map((d) => d.id)).toEqual(['a', 'z']);
    expect(compareDishNames(a, a, 'es-ES')).toBe(0);
  });

  it('does not change the list it was given', () => {
    const list = [dish('1', 'Zumo'), dish('2', 'Agua')];
    sortDishes(list, 'es-ES');
    expect(names(list)).toEqual(['Zumo', 'Agua']);
  });
});

describe('tillDishes', () => {
  it('with a section chosen shows only its dishes, alphabetical too', () => {
    expect(names(tillDishes(CRISPY, all({ section: 'bebidas' }), 'es-ES'))).toEqual(['Agua', 'Caprisun', 'Coca-Cola']);
    expect(names(tillDishes(CRISPY, all({ section: 'crispy' }), 'es-ES'))).toEqual([
      'Crispy Ahumado',
      'Crispy Grande',
      'Crispy Pequeño',
      'Crispy XL',
    ]);
  });

  it('keeps a sold-out dish in its place', () => {
    expect(tillDishes(CRISPY, all({ section: 'bebidas' }), 'es-ES').map((d) => [d.name, d.available])).toContainEqual([
      'Caprisun',
      false,
    ]);
  });

  it('searches without accents, across every section or inside the one chosen', () => {
    expect(names(tillDishes(CRISPY, all({ query: 'ahumado' }), 'es-ES'))).toEqual(['Crispy Ahumado']);
    expect(names(tillDishes(CRISPY, all({ query: 'grande' }), 'es-ES'))).toEqual(['Combo Crispy Grande', 'Crispy Grande']);
    expect(names(tillDishes(CRISPY, all({ query: 'grande', section: 'combos' }), 'es-ES'))).toEqual(['Combo Crispy Grande']);
    // The description counts: "patatas" is what comes with El del Puerto.
    expect(names(tillDishes(CRISPY, all({ query: 'PATATAS' }), 'es-ES'))).toEqual(['El del Puerto']);
  });

  it('leaves out the allergens asked about, with the section and the search', () => {
    expect(names(tillDishes(CRISPY, all({ without: new Set(['gluten']) }), 'es-ES'))).toEqual([
      'Agua',
      'Caprisun',
      'Coca-Cola',
      'El del Puerto',
      'Ensalada Casa Demo',
    ]);
    expect(names(tillDishes(CRISPY, all({ section: 'crispy', without: new Set(['milk']) }), 'es-ES'))).toEqual([
      'Crispy Grande',
      'Crispy Pequeño',
      'Crispy XL',
    ]);
  });

  it('is empty for an empty section, or a section that is not there', () => {
    expect(tillDishes(CRISPY, all({ section: 'postres' }), 'es-ES')).toEqual([]);
    expect(tillDishes(CRISPY, all({ section: 'gone' }), 'es-ES')).toEqual([]);
  });
});

describe('sectionChips / activeSection', () => {
  it('gives the team only the sections with dishes, and the manager every one, in the manager’s order', () => {
    expect(sectionChips(CRISPY).map((c) => c.name)).toEqual(['Crispy', 'Combos', 'Ensaladas', 'Bebidas']);
    expect(sectionChips(CRISPY, { keepEmpty: true }).map((c) => c.name)).toEqual([
      'Crispy',
      'Combos',
      'Ensaladas',
      'Bebidas',
      'Postres',
    ]);
  });

  it('falls back to "All" once the chosen chip is gone', () => {
    const chips = sectionChips(CRISPY);
    expect(activeSection(chips, 'bebidas')).toBe('bebidas');
    expect(activeSection(chips, null)).toBeNull();
    // Deleted meanwhile, or (for the team) emptied.
    expect(activeSection(chips, 'gone')).toBeNull();
    expect(activeSection(chips, 'postres')).toBeNull();
    expect(activeSection(sectionChips(CRISPY, { keepEmpty: true }), 'postres')).toBe('postres');
  });
});

describe('dishesIn', () => {
  it('counts what a chip stands for before any search', () => {
    expect(dishesIn(CRISPY, null)).toHaveLength(10);
    expect(dishesIn(CRISPY, 'bebidas')).toHaveLength(3);
    expect(dishesIn(CRISPY, 'postres')).toHaveLength(0);
  });
});
