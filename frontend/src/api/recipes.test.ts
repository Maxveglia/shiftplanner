import { describe, expect, it } from 'vitest';
import type { InventoryItem } from './inventory';
import { expandDish, expandSale } from '../lib/store/recipes';
import {
  autoMatches,
  ingredientLabels,
  linkWhenEmptied,
  nameKey,
  normalizeRecipeDish,
  normalizeRecipes,
  recipeBook,
  recipeStatus,
  takesFromStock,
  withSavedDish,
} from './recipes';

const ANSWER = {
  sections: [
    {
      id: 's1',
      name: 'Crispy',
      dishes: [
        {
          dish_id: 'crispy',
          name: 'Crispy Grande',
          has_recipe: true,
          items: [
            { item_id: 'pollo', name: 'Pollo', unit: 'kg', quantity: '0.750', archived: false },
            { item_id: 'cebolla', name: 'Cebolla', unit: 'kg', quantity: 0.1, archived: false },
          ],
          components: [],
          expanded: [
            { item_id: 'pollo', name: 'Pollo', unit: 'kg', quantity: '0.750' },
            { item_id: 'cebolla', name: 'Cebolla', unit: 'kg', quantity: '0.100' },
          ],
        },
        {
          dish_id: 'patatas',
          name: 'Patatas',
          has_recipe: true,
          items: [{ item_id: 'patata', name: 'Patata', unit: 'kg', quantity: '0.200', archived: true }],
          components: [],
          expanded: [{ item_id: 'patata', name: 'Patata', unit: 'kg', quantity: '0.200' }],
        },
      ],
    },
    {
      id: 's2',
      name: 'Combos',
      dishes: [
        {
          dish_id: 'combo',
          name: 'Combo Crispy Grande',
          has_recipe: true,
          items: [],
          components: [
            { dish_id: 'crispy', name: 'Crispy Grande', quantity: '1.000' },
            { dish_id: 'patatas', name: 'Patatas', quantity: 1 },
          ],
          expanded: [],
        },
        { dish_id: 'bebida', name: 'Bebida', has_recipe: false, items: [], components: [], expanded: [] },
      ],
    },
  ],
};

describe('normalizeRecipes', () => {
  it('reads the sections, their products and every quantity as a number', () => {
    const sections = normalizeRecipes(ANSWER);
    expect(sections.map((s) => s.name)).toEqual(['Crispy', 'Combos']);
    expect(sections[0].dishes[0].items[0]).toEqual({
      item_id: 'pollo',
      name: 'Pollo',
      unit: 'kg',
      quantity: 0.75,
      archived: false,
      photo_url: null,
    });
    expect(sections[0].dishes[1].items[0].archived).toBe(true);
    expect(sections[1].dishes[0].components).toEqual([
      { dish_id: 'crispy', name: 'Crispy Grande', quantity: 1 },
      { dish_id: 'patatas', name: 'Patatas', quantity: 1 },
    ]);
    expect(sections[0].dishes[0].expanded[1].quantity).toBe(0.1);
  });

  it('reads each ingredient’s photo, and none when the server does not say', () => {
    const dish = normalizeRecipeDish({
      dish_id: 'd',
      name: 'D',
      items: [
        { item_id: 'pollo', name: 'Pollo', unit: 'kg', quantity: 1, photo_url: '/api/v1/inventory/photos/p1' },
        { item_id: 'sal', name: 'Sal', unit: 'kg', quantity: 0.01, photo_url: null },
        { item_id: 'cebolla', name: 'Cebolla', unit: 'kg', quantity: 0.1 },
      ],
      expanded: [{ item_id: 'pollo', name: 'Pollo', unit: 'kg', quantity: 1, photo_url: '/api/v1/inventory/photos/p1' }],
    });
    expect(dish.items.map((i) => i.photo_url)).toEqual(['/api/v1/inventory/photos/p1', null, null]);
    expect(dish.expanded[0].photo_url).toBe('/api/v1/inventory/photos/p1');
    // An older server: no field anywhere.
    expect(normalizeRecipes(ANSWER)[0].dishes[0].expanded.every((e) => e.photo_url === null)).toBe(true);
  });

  it('reads each product’s photo on the menu, and none when the server does not say', () => {
    expect(normalizeRecipeDish({ dish_id: 'd', name: 'D', photo_url: '/api/v1/menu/photos/m1' }).photo_url).toBe(
      '/api/v1/menu/photos/m1',
    );
    expect(normalizeRecipeDish({ dish_id: 'd', name: 'D', photo_url: null }).photo_url).toBeNull();
    expect(normalizeRecipeDish({ dish_id: 'd', name: 'D', photo_url: '' }).photo_url).toBeNull();
    // An older server: no field.
    expect(normalizeRecipes(ANSWER).every((s) => s.dishes.every((d) => d.photo_url === null))).toBe(true);
  });

  it('takes the bare list as well as {sections}', () => {
    expect(normalizeRecipes(ANSWER.sections)).toEqual(normalizeRecipes(ANSWER));
    expect(normalizeRecipes(null)).toEqual([]);
  });

  it('works the flag out of the lists when it is missing', () => {
    expect(normalizeRecipeDish({ dish_id: 'd', name: 'D', items: [{ item_id: 'x', quantity: 1 }] }).has_recipe).toBe(true);
    expect(normalizeRecipeDish({ dish_id: 'd', name: 'D' }).has_recipe).toBe(false);
  });
});

describe('recipeBook', () => {
  it('is what the expansion reads, and it comes out as the spec says', () => {
    const book = recipeBook(normalizeRecipes(ANSWER));
    expect(expandDish(book, 'combo')).toEqual([
      { item_id: 'pollo', quantity: 0.75 },
      { item_id: 'cebolla', quantity: 0.1 },
      { item_id: 'patata', quantity: 0.2 },
    ]);
    expect(
      expandSale(book, [
        { dish_id: 'combo', quantity: 3 },
        { dish_id: 'crispy', quantity: 2 },
      ]),
    ).toEqual([
      { item_id: 'pollo', quantity: 3.75 },
      { item_id: 'cebolla', quantity: 0.5 },
      { item_id: 'patata', quantity: 0.6 },
    ]);
    expect(expandDish(book, 'bebida')).toEqual([]);
  });
});

describe('withSavedDish', () => {
  it('puts the server’s answer in the place of the product, and nothing else changes', () => {
    const sections = normalizeRecipes(ANSWER);
    const saved = normalizeRecipeDish({
      dish_id: 'bebida',
      name: 'Bebida',
      has_recipe: true,
      items: [{ item_id: 'lata', name: 'Lata', unit: null, quantity: 1, archived: false }],
      components: [],
      expanded: [{ item_id: 'lata', name: 'Lata', unit: null, quantity: 1 }],
    });
    const next = withSavedDish(sections, saved);
    expect(next[1].dishes[1]).toBe(saved);
    expect(next[0]).toBe(sections[0]);
    expect(next[1].dishes[0]).toBe(sections[1].dishes[0]);
  });
});

describe('ingredientLabels', () => {
  function stockItem(over: Partial<InventoryItem> & { id: string; name: string }): InventoryItem {
    return {
      unit: 'kg',
      category: null,
      min_quantity: null,
      archived_at: null,
      last_quantity: null,
      last_counted_at: null,
      previous_quantity: null,
      previous_counted_at: null,
      barcodes: [],
      received_since_count: 0,
      received_between_counts: null,
      last_received_at: null,
      sold_since_count: 0,
      sold_between_counts: null,
      ...over,
    };
  }

  const SECTIONS = normalizeRecipes({
    sections: [
      {
        id: 's',
        name: 'S',
        dishes: [
          {
            dish_id: 'crispy',
            name: 'Crispy',
            items: [
              { item_id: 'pollo', name: 'Pollo', unit: 'kg', quantity: 1, photo_url: '/api/v1/inventory/photos/old' },
              { item_id: 'patata', name: 'Patata', unit: 'kg', quantity: 0.2, archived: true, photo_url: '/api/v1/inventory/photos/pat' },
            ],
            expanded: [],
          },
        ],
      },
    ],
  });

  it('takes the inventory’s name, unit, archive and photo over the recipe’s', () => {
    const labels = ingredientLabels(SECTIONS, [
      stockItem({ id: 'pollo', name: 'Pollo campero', photo_url: '/api/v1/inventory/photos/new' }),
    ]);
    expect(labels.get('pollo')).toEqual({
      name: 'Pollo campero',
      unit: 'kg',
      archived: false,
      photo_url: '/api/v1/inventory/photos/new',
    });
  });

  it('believes the inventory when it says the photo was taken off', () => {
    const labels = ingredientLabels(SECTIONS, [stockItem({ id: 'pollo', name: 'Pollo', photo_url: null })]);
    expect(labels.get('pollo')?.photo_url).toBeNull();
  });

  it('keeps the recipe’s photo when the inventory does not mention photos at all', () => {
    const labels = ingredientLabels(SECTIONS, [stockItem({ id: 'pollo', name: 'Pollo' })]);
    expect(labels.get('pollo')?.photo_url).toBe('/api/v1/inventory/photos/old');
  });

  it('knows an ingredient only a recipe holds, with its photo', () => {
    const labels = ingredientLabels(SECTIONS, []);
    expect(labels.get('patata')).toEqual({
      name: 'Patata',
      unit: 'kg',
      archived: true,
      photo_url: '/api/v1/inventory/photos/pat',
    });
    // And one it never heard of, as nothing.
    expect(labels.get('sal')).toBeUndefined();
  });

  it('gives a new product of the inventory, in no recipe yet, its photo', () => {
    const labels = ingredientLabels([], [stockItem({ id: 'sal', name: 'Sal', unit: null, photo_url: '/api/v1/inventory/photos/s' })]);
    expect(labels.get('sal')).toEqual({ name: 'Sal', unit: null, archived: false, photo_url: '/api/v1/inventory/photos/s' });
  });
});

// --- The automatic link: "Agua" on the menu takes 1 "Agua" of the inventory ----

const AGUA = { item_id: 'agua-item', name: 'Agua', unit: 'botellas', photo_url: '/api/v1/inventory/photos/a' };

const WITH_LINKS = normalizeRecipes({
  sections: [
    {
      id: 's',
      name: 'Bebidas',
      dishes: [
        {
          id: 'agua',
          name: 'Agua',
          has_recipe: false,
          items: [],
          components: [],
          expanded: [{ ...AGUA, quantity: 1 }],
          auto_item: AGUA,
          auto_ambiguous: false,
        },
        {
          id: 'cola',
          name: 'Cola',
          has_recipe: false,
          items: [],
          components: [],
          expanded: [],
          auto_item: null,
          auto_ambiguous: true,
          auto_matches: [
            { item_id: 'c1', name: 'Cola', unit: null },
            { item_id: 'c2', name: 'COLA', unit: null },
          ],
        },
        {
          id: 'menu',
          name: 'Menú del día',
          has_recipe: true,
          items: [{ item_id: 'pan', name: 'Pan', unit: null, quantity: 1 }],
          components: [{ dish_id: 'agua', name: 'Agua', quantity: 2 }],
          expanded: [],
          // A recipe of its own: whatever else came, no link.
          auto_item: AGUA,
        },
        { id: 'cafe', name: 'Café', has_recipe: false, items: [], components: [], expanded: [] },
      ],
    },
  ],
});
const [agua, cola, menu, cafe] = WITH_LINKS[0].dishes;

describe('what an emptied recipe takes (name_match)', () => {
  const withRecipe = normalizeRecipeDish({
    dish_id: 'agua',
    name: 'Agua',
    has_recipe: true,
    items: [{ item_id: 'botella', name: 'Botella 50 cl', unit: null, quantity: 1 }],
    components: [],
    expanded: [{ item_id: 'botella', name: 'Botella 50 cl', unit: null, quantity: 1 }],
    auto_item: null,
    auto_ambiguous: false,
    name_match: AGUA,
  });

  it('is read even with a recipe of its own, which hides the link but does not undo it', () => {
    expect(withRecipe.auto_item).toBeNull();
    expect(withRecipe.name_match).toEqual(AGUA);
    expect(recipeStatus(withRecipe)).toBe('recipe');
  });

  it('is the product called the same once the recipe is emptied, and that is news', () => {
    expect(linkWhenEmptied(withRecipe, true)).toEqual({ item: AGUA, news: true });
    expect(linkWhenEmptied(withRecipe, false)).toBeNull();
  });

  it('is the link it already has for a product with no recipe: no news', () => {
    expect(linkWhenEmptied(agua, true)).toEqual({ item: AGUA, news: false });
  });

  it('is nothing with several called the same, or none, or from a server older than the field', () => {
    expect(linkWhenEmptied(cola, true)).toBeNull();
    expect(linkWhenEmptied(cafe, true)).toBeNull();
    const older = normalizeRecipeDish({ ...withRecipe, dish_id: 'agua', name_match: undefined });
    expect(older.name_match).toBeNull();
    expect(linkWhenEmptied(older, true)).toBeNull();
  });

  it('gives that product its name, unit and photo, for the preview to say it', () => {
    expect(ingredientLabels([{ id: 's', name: 'Bebidas', dishes: [withRecipe] }], []).get('agua-item')).toEqual({
      name: 'Agua',
      unit: 'botellas',
      archived: false,
      photo_url: '/api/v1/inventory/photos/a',
    });
  });
});

describe('the automatic link', () => {
  it('is read with the product, its photo, and which products make it ambiguous', () => {
    expect(agua.auto_item).toEqual(AGUA);
    expect(agua.auto_ambiguous).toBe(false);
    expect(cola.auto_item).toBeNull();
    expect(cola.auto_ambiguous).toBe(true);
    expect(cola.auto_matches.map((m) => m.name)).toEqual(['Cola', 'COLA']);
    expect(menu.auto_item).toBeNull();
    // An older server: none of it.
    expect(cafe.auto_item).toBeNull();
    expect(cafe.auto_ambiguous).toBe(false);
    expect(cafe.auto_matches).toEqual([]);
  });

  it('says in a word what each product takes', () => {
    expect([agua, cola, menu, cafe].map(recipeStatus)).toEqual(['auto', 'ambiguous', 'recipe', 'none']);
    expect([agua, cola, menu, cafe].map(takesFromStock)).toEqual([true, false, true, false]);
  });

  it('counts in the expansion, for a sale and for a combo whose component has only the link', () => {
    const book = recipeBook(WITH_LINKS);
    expect(expandDish(book, 'agua')).toEqual([{ item_id: 'agua-item', quantity: 1 }]);
    expect(expandSale(book, [{ dish_id: 'agua', quantity: 3 }])).toEqual([{ item_id: 'agua-item', quantity: 3 }]);
    expect(expandDish(book, 'menu')).toEqual([
      { item_id: 'pan', quantity: 1 },
      { item_id: 'agua-item', quantity: 2 },
    ]);
    expect(expandDish(book, 'cola')).toEqual([]);
  });

  it('gives the linked product its name and photo', () => {
    expect(ingredientLabels(WITH_LINKS, []).get('agua-item')).toEqual({
      name: 'Agua',
      unit: 'botellas',
      archived: false,
      photo_url: '/api/v1/inventory/photos/a',
    });
  });

  it('compares names as the server does: no capitals, no accents, spaces collapsed', () => {
    expect(nameKey('Água')).toBe('agua');
    expect(nameKey('  AGUA   con  gas ')).toBe('agua con gas');
    expect(nameKey('Piña')).toBe(nameKey('pina'));
    expect(nameKey('Coca-Cola')).not.toBe(nameKey('Coca Cola'));
  });

  it('drops the invisible characters a pasted name brings, as the server does (category Cf)', () => {
    // A zero-width space, a soft hyphen, a BOM, a word joiner.
    expect(nameKey('Agua\u200b')).toBe('agua');
    expect(nameKey('Agua\u200b')).toBe(nameKey('Agua'));
    expect(nameKey('\ufeffAgua')).toBe('agua');
    expect(nameKey('Ag\u00adua')).toBe('agua');
    expect(nameKey('Agua\u2060 con gas')).toBe('agua con gas');
    // Not a space: a zero-width space between two words does not separate them.
    expect(nameKey('Agua\u200bcon')).toBe('aguacon');
  });

  it('folds case as Python’s casefold() does where lowercasing does not', () => {
    expect(nameKey('Weißbier')).toBe(nameKey('WEISSBIER'));
    expect(nameKey('ΟΔΟΣ')).toBe(nameKey('οδος'));
  });

  it('says which products make it ambiguous: the server’s list, or the stock’s names', () => {
    const stock = (id: string, name: string, archived = false): InventoryItem => ({
      id,
      name,
      unit: null,
      category: null,
      min_quantity: null,
      archived_at: archived ? '2026-09-01T00:00:00Z' : null,
      last_quantity: null,
      last_counted_at: null,
      previous_quantity: null,
      previous_counted_at: null,
      barcodes: [],
      received_since_count: 0,
      received_between_counts: null,
      last_received_at: null,
      sold_since_count: 0,
      sold_between_counts: null,
    });
    expect(autoMatches(cola, [])).toEqual(['Cola', 'COLA']);
    const older = { ...cola, auto_matches: [] };
    expect(autoMatches(older, [stock('1', 'cola'), stock('2', 'Cóla '), stock('3', 'Cola', true), stock('4', 'Colacao')])).toEqual([
      'cola',
      'Cóla ',
    ]);
  });
});
