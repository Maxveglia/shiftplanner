import { describe, expect, it } from 'vitest';
import {
  COMPONENT_QUANTITY_CEILING,
  depthThrough,
  expandDish,
  expandSale,
  includeBlock,
  isFraction,
  nothingToInclude,
  parseRecipeQuantity,
  trialView,
  trySale,
  withRecipe,
  wouldCycle,
  type RecipeBook,
  type RecipeParts,
} from './recipes';

function book(entries: Record<string, Partial<RecipeParts>>): RecipeBook {
  return new Map(
    Object.entries(entries).map(([id, parts]) => [id, { items: parts.items ?? [], components: parts.components ?? [] }]),
  );
}

/** Consumed as a plain object, so an assertion reads like the spec's example. */
function asObject(list: { item_id: string; quantity: number }[]): Record<string, number> {
  return Object.fromEntries(list.map((c) => [c.item_id, c.quantity]));
}

// The spec's example (27-sep-2026): a Crispy Grande is ¾ kg of chicken and
// 0.1 kg of onion; a Combo Grande is 1 Crispy Grande and 1 Patatas (0.2 kg
// of potato).
const CRISPY = book({
  crispy: { items: [{ item_id: 'pollo', quantity: 0.75 }, { item_id: 'cebolla', quantity: 0.1 }] },
  patatas: { items: [{ item_id: 'patata', quantity: 0.2 }] },
  combo: {
    components: [
      { dish_id: 'crispy', quantity: 1 },
      { dish_id: 'patatas', quantity: 1 },
    ],
  },
});

describe('expandSale', () => {
  it('comes out exactly as the spec says: 3 combos and 2 Crispy Grande', () => {
    const consumed = expandSale(CRISPY, [
      { dish_id: 'combo', quantity: 3 },
      { dish_id: 'crispy', quantity: 2 },
    ]);
    expect(asObject(consumed)).toEqual({ pollo: 3.75, cebolla: 0.5, patata: 0.6 });
  });

  it('adds without float noise: 0.1 kg five times is 0.5', () => {
    // In floats 0.1 * 3 + 0.1 * 2 is 0.5000000000000001.
    const consumed = expandSale(CRISPY, [
      { dish_id: 'crispy', quantity: 3 },
      { dish_id: 'crispy', quantity: 2 },
    ]);
    expect(asObject(consumed).cebolla).toBe(0.5);
  });

  it('inherits the ingredients of components of components', () => {
    const menu = withRecipe(CRISPY, 'duo', { items: [], components: [{ dish_id: 'combo', quantity: 2 }] });
    expect(asObject(expandSale(menu, [{ dish_id: 'duo', quantity: 1 }]))).toEqual({
      pollo: 1.5,
      cebolla: 0.2,
      patata: 0.4,
    });
  });

  it('adds a product’s own ingredients to those of its components', () => {
    const menu = withRecipe(CRISPY, 'combo', {
      items: [{ item_id: 'salsa', quantity: 0.05 }, { item_id: 'pollo', quantity: 0.25 }],
      components: [
        { dish_id: 'crispy', quantity: 1 },
        { dish_id: 'patatas', quantity: 1 },
      ],
    });
    expect(asObject(expandSale(menu, [{ dish_id: 'combo', quantity: 2 }]))).toEqual({
      salsa: 0.1,
      pollo: 2,
      cebolla: 0.2,
      patata: 0.4,
    });
  });

  it('takes fractions of a line: half a combo', () => {
    expect(asObject(expandSale(CRISPY, [{ dish_id: 'combo', quantity: 0.5 }]))).toEqual({
      pollo: 0.375,
      cebolla: 0.05,
      patata: 0.1,
    });
  });

  it('rounds once, at the end, half up', () => {
    // Half a portion of 1 g in each of three sales is 1.5 g: 0.002 kg.
    // Rounding each unit first would give 0.0005 -> 0.001, three times: 0.003.
    const menu = book({
      pinch: { items: [{ item_id: 'sal', quantity: 0.001 }] },
      half: { components: [{ dish_id: 'pinch', quantity: 0.5 }] },
    });
    expect(asObject(expandSale(menu, [{ dish_id: 'half', quantity: 3 }]))).toEqual({ sal: 0.002 });
    // One on its own is 0.0005: a tie, which goes up.
    expect(asObject(expandSale(menu, [{ dish_id: 'half', quantity: 1 }]))).toEqual({ sal: 0.001 });
  });

  it('leaves out what rounds to nothing', () => {
    const menu = book({
      pinch: { items: [{ item_id: 'sal', quantity: 0.001 }, { item_id: 'aceite', quantity: 0.01 }] },
      tiny: { components: [{ dish_id: 'pinch', quantity: 0.4 }] },
    });
    // 0.4 g of salt rounds to 0 and is not there; 4 g of oil is.
    expect(expandSale(menu, [{ dish_id: 'tiny', quantity: 1 }])).toEqual([{ item_id: 'aceite', quantity: 0.004 }]);
  });

  it('takes nothing for a product without a recipe, or one not on the menu', () => {
    const menu = withRecipe(CRISPY, 'bebida', { items: [], components: [] });
    expect(expandSale(menu, [{ dish_id: 'bebida', quantity: 4 }])).toEqual([]);
    expect(expandSale(menu, [{ dish_id: 'gone', quantity: 1 }])).toEqual([]);
    expect(expandSale(menu, [])).toEqual([]);
  });

  it('does not go round for ever on a product that contains itself', () => {
    const loop = book({
      a: { items: [{ item_id: 'x', quantity: 1 }], components: [{ dish_id: 'b', quantity: 1 }] },
      b: { items: [{ item_id: 'y', quantity: 1 }], components: [{ dish_id: 'a', quantity: 1 }] },
    });
    expect(asObject(expandSale(loop, [{ dish_id: 'a', quantity: 1 }]))).toEqual({ x: 1, y: 1 });
  });

  it('keeps large quantities exact', () => {
    const menu = book({ big: { items: [{ item_id: 'harina', quantity: 123456.789 }] } });
    expect(asObject(expandSale(menu, [{ dish_id: 'big', quantity: 1000 }]))).toEqual({ harina: 123456789 });
  });
});

describe('expandDish', () => {
  it('is one unit, expanded', () => {
    expect(asObject(expandDish(CRISPY, 'combo'))).toEqual({ pollo: 0.75, cebolla: 0.1, patata: 0.2 });
    expect(expandDish(CRISPY, 'nope')).toEqual([]);
  });

  it('follows the recipe being typed, not the saved one', () => {
    const typed = withRecipe(CRISPY, 'crispy', { items: [{ item_id: 'pollo', quantity: 0.5 }], components: [] });
    expect(asObject(expandDish(typed, 'combo'))).toEqual({ pollo: 0.5, patata: 0.2 });
    // The book it came from is untouched.
    expect(asObject(expandDish(CRISPY, 'crispy'))).toEqual({ pollo: 0.75, cebolla: 0.1 });
  });
});

describe('wouldCycle', () => {
  it('refuses the product itself', () => {
    expect(wouldCycle(CRISPY, 'combo', 'combo')).toBe(true);
  });

  it('refuses a product that already contains this one, directly or not', () => {
    const menu = withRecipe(CRISPY, 'duo', { items: [], components: [{ dish_id: 'combo', quantity: 2 }] });
    // combo contains crispy: crispy cannot contain combo, nor duo (which contains combo).
    expect(wouldCycle(menu, 'crispy', 'combo')).toBe(true);
    expect(wouldCycle(menu, 'crispy', 'duo')).toBe(true);
    expect(wouldCycle(menu, 'combo', 'duo')).toBe(true);
  });

  it('allows everything else', () => {
    const menu = withRecipe(CRISPY, 'duo', { items: [], components: [{ dish_id: 'combo', quantity: 2 }] });
    expect(wouldCycle(menu, 'duo', 'crispy')).toBe(false);
    expect(wouldCycle(menu, 'combo', 'patatas')).toBe(false);
    expect(wouldCycle(menu, 'patatas', 'crispy')).toBe(false);
    expect(wouldCycle(menu, 'crispy', 'bebida')).toBe(false);
  });

  it('ends on a book that already has a loop in it', () => {
    const loop = book({ a: { components: [{ dish_id: 'b', quantity: 1 }] }, b: { components: [{ dish_id: 'a', quantity: 1 }] } });
    expect(wouldCycle(loop, 'c', 'a')).toBe(false);
    expect(wouldCycle(loop, 'a', 'b')).toBe(true);
  });
});

describe('parseRecipeQuantity', () => {
  it('reads what a kitchen says: ¾, ½, 0,75, 1', () => {
    expect(parseRecipeQuantity('3/4')).toBe(0.75);
    expect(parseRecipeQuantity('1/2')).toBe(0.5);
    expect(parseRecipeQuantity('0,75')).toBe(0.75);
    expect(parseRecipeQuantity('0.75')).toBe(0.75);
    expect(parseRecipeQuantity('1')).toBe(1);
    expect(parseRecipeQuantity(' 1 1/2 ')).toBe(1.5);
    expect(parseRecipeQuantity('2 1/4')).toBe(2.25);
    expect(parseRecipeQuantity(',5')).toBe(0.5);
    expect(parseRecipeQuantity('5/4')).toBe(1.25);
  });

  it('turns a fraction into what the server keeps: 3 decimals', () => {
    expect(parseRecipeQuantity('1/3')).toBe(0.333);
    expect(parseRecipeQuantity('2/3')).toBe(0.667);
    expect(parseRecipeQuantity('1/8')).toBe(0.125);
  });

  it('refuses nothing, zero, words, a fourth decimal and a fraction too small to keep', () => {
    for (const bad of ['', ' ', '0', '0,000', '0/4', '3/0', '-1', '-1/2', 'doce', '1/', '/2', '1,2345', '1/2/3', '1e3', '1/10000', '1.000.000']) {
      expect(parseRecipeQuantity(bad), bad).toBeNull();
    }
  });

  it('refuses a billion', () => {
    expect(parseRecipeQuantity('1000000000')).toBeNull();
    expect(parseRecipeQuantity('999999999.999')).toBe(999999999.999);
  });

  it('keeps under the ceiling it is given, as the server stores it', () => {
    expect(parseRecipeQuantity('999,999', COMPONENT_QUANTITY_CEILING)).toBe(999.999);
    expect(parseRecipeQuantity('1000', COMPONENT_QUANTITY_CEILING)).toBeNull();
    // 999.9996 would be stored as 1000: a fraction is rounded, then checked.
    expect(parseRecipeQuantity('9999999/10000', COMPONENT_QUANTITY_CEILING)).toBeNull();
  });
});

describe('depthThrough', () => {
  // A chain of combos: e includes d, d includes c, c includes b, b includes a.
  const chain = book({
    a: { items: [{ item_id: 'x', quantity: 1 }] },
    b: { components: [{ dish_id: 'a', quantity: 1 }] },
    c: { components: [{ dish_id: 'b', quantity: 1 }] },
    d: { components: [{ dish_id: 'c', quantity: 1 }] },
    e: { components: [{ dish_id: 'd', quantity: 1 }] },
  });

  it('is one level for a combo of products with only ingredients', () => {
    expect(depthThrough(CRISPY, 'combo', ['crispy', 'patatas'])).toBe(1);
    expect(depthThrough(CRISPY, 'crispy', [])).toBe(1);
    expect(depthThrough(CRISPY, 'bebida', [])).toBe(0);
  });

  it('counts down from the product and up through what includes it', () => {
    expect(depthThrough(chain, 'c', ['b'])).toBe(4);
    // f above e is a fifth level; one more below a would be a sixth.
    const topped = withRecipe(chain, 'f', { items: [], components: [{ dish_id: 'e', quantity: 1 }] });
    expect(depthThrough(topped, 'f', ['e'])).toBe(5);
    expect(depthThrough(topped, 'a', ['z'])).toBe(6);
  });

  it('goes by the components being typed, not the saved ones', () => {
    expect(depthThrough(chain, 'b', [])).toBe(3);
    expect(depthThrough(chain, 'e', ['a'])).toBe(1);
  });

  it('ends on a book that already has a loop in it', () => {
    const loop = book({ a: { components: [{ dish_id: 'b', quantity: 1 }] }, b: { components: [{ dish_id: 'a', quantity: 1 }] } });
    expect(Number.isFinite(depthThrough(loop, 'c', ['a']))).toBe(true);
  });
});

describe('includeBlock', () => {
  const chain = book({
    a: { items: [{ item_id: 'x', quantity: 1 }] },
    b: { components: [{ dish_id: 'a', quantity: 1 }] },
    c: { components: [{ dish_id: 'b', quantity: 1 }] },
    d: { components: [{ dish_id: 'c', quantity: 1 }] },
    e: { components: [{ dish_id: 'd', quantity: 1 }] },
  });

  it('says why a product cannot go in', () => {
    expect(includeBlock(CRISPY, 'combo', ['crispy'], 'combo')).toBe('self');
    expect(includeBlock(CRISPY, 'combo', ['crispy'], 'crispy')).toBe('included');
    expect(includeBlock(CRISPY, 'crispy', [], 'combo')).toBe('cycle');
    // e is four levels over a: e inside f is five, f inside g would be six.
    const topped = withRecipe(chain, 'f', { items: [], components: [{ dish_id: 'e', quantity: 1 }] });
    expect(includeBlock(topped, 'g', [], 'f')).toBe('too_deep');
  });

  it('is nothing when it can', () => {
    expect(includeBlock(CRISPY, 'combo', ['crispy'], 'patatas')).toBeNull();
    expect(includeBlock(chain, 'f', [], 'e')).toBeNull();
  });
});

describe('nothingToInclude', () => {
  it('is the menu having no other product', () => {
    expect(nothingToInclude(CRISPY, 'crispy', [], ['crispy'])).toBe('no_others');
  });

  it('is every other product being in already', () => {
    expect(nothingToInclude(CRISPY, 'combo', ['crispy', 'patatas'], ['combo', 'crispy', 'patatas'])).toBe('all_in');
  });

  it('is the rules, when what is left would loop or go too deep', () => {
    // combo contains crispy: the only product left for crispy is combo.
    expect(nothingToInclude(CRISPY, 'crispy', ['patatas'], ['combo', 'crispy', 'patatas'])).toBe('rules');
  });

  it('is nothing while something can go in', () => {
    expect(nothingToInclude(CRISPY, 'combo', ['crispy'], ['combo', 'crispy', 'patatas'])).toBeNull();
    expect(nothingToInclude(CRISPY, 'crispy', [], ['combo', 'crispy', 'patatas'])).toBeNull();
  });
});

describe('isFraction', () => {
  it('tells a fraction from a decimal', () => {
    expect(isFraction('3/4')).toBe(true);
    expect(isFraction('0,75')).toBe(false);
  });

  it('knows the one-character fractions', () => {
    expect(isFraction('¾')).toBe(true);
    expect(isFraction('1 ½')).toBe(true);
  });
});

describe('parseRecipeQuantity, one-character fractions', () => {
  it('reads each one alone', () => {
    expect(parseRecipeQuantity('¼')).toBe(0.25);
    expect(parseRecipeQuantity('½')).toBe(0.5);
    expect(parseRecipeQuantity('¾')).toBe(0.75);
    expect(parseRecipeQuantity('⅓')).toBe(0.333);
    expect(parseRecipeQuantity('⅔')).toBe(0.667);
    expect(parseRecipeQuantity('⅛')).toBe(0.125);
  });

  it('reads one after a whole number, with a space or without', () => {
    expect(parseRecipeQuantity('1¾')).toBe(1.75);
    expect(parseRecipeQuantity('1 ¾')).toBe(1.75);
    expect(parseRecipeQuantity(' 2  ½ ')).toBe(2.5);
    expect(parseRecipeQuantity('10⅛')).toBe(10.125);
  });

  it('refuses them anywhere else, or past the ceiling', () => {
    expect(parseRecipeQuantity('¾1')).toBeNull();
    expect(parseRecipeQuantity('¾¾')).toBeNull();
    expect(parseRecipeQuantity('1,5¾')).toBeNull();
    expect(parseRecipeQuantity('3/¾')).toBeNull();
    expect(parseRecipeQuantity('999¾', COMPONENT_QUANTITY_CEILING)).toBe(999.75);
    expect(parseRecipeQuantity('1000¼', COMPONENT_QUANTITY_CEILING)).toBeNull();
  });
});

describe('trySale', () => {
  const stock = new Map([
    ['pollo', { now: 5, min_quantity: 2 }],
    ['cebolla', { now: 0.6, min_quantity: null }],
    ['patata', { now: 3, min_quantity: 2.5 }],
    ['salsa', { now: 0, min_quantity: null }],
  ]);

  it('says what would be left of each ingredient, and how it would stand', () => {
    const rows = trySale(
      [
        { item_id: 'pollo', quantity: 3.75 },
        { item_id: 'cebolla', quantity: 0.5 },
        { item_id: 'patata', quantity: 0.6 },
      ],
      stock,
    );
    expect(rows).toEqual([
      { item_id: 'pollo', take: 3.75, now: 5, after: 1.25, min_quantity: 2, status: 'low' },
      { item_id: 'cebolla', take: 0.5, now: 0.6, after: 0.1, min_quantity: null, status: 'ok' },
      { item_id: 'patata', take: 0.6, now: 3, after: 2.4, min_quantity: 2.5, status: 'low' },
    ]);
  });

  it('goes below zero when there is not enough, and says so', () => {
    const [row] = trySale([{ item_id: 'cebolla', quantity: 1 }], stock);
    expect(row.after).toBe(-0.4);
    expect(row.status).toBe('negative');
  });

  it('starts an ingredient that has not moved from 0, as the server does -- never "not counted"', () => {
    const [row] = trySale([{ item_id: 'salsa', quantity: 0.05 }], stock);
    expect(row).toEqual({ item_id: 'salsa', take: 0.05, now: 0, after: -0.05, min_quantity: null, status: 'negative' });
    const [missing] = trySale([{ item_id: 'unknown', quantity: 1 }], stock);
    expect(missing.now).toBe(0);
    expect(missing.status).toBe('negative');
  });

  it('is not low at exactly the minimum', () => {
    const [row] = trySale([{ item_id: 'pollo', quantity: 3 }], stock);
    expect(row.after).toBe(2);
    expect(row.status).toBe('ok');
  });
});

describe('trialView', () => {
  const consumed = [
    { item_id: 'pollo', quantity: 3.75 },
    { item_id: 'cebolla', quantity: 1 },
  ];
  const stock = new Map([
    ['pollo', { now: 5, min_quantity: 2 }],
    ['cebolla', { now: 0.6, min_quantity: null }],
  ]);

  it('says nothing of the stock while it loads -- not "below zero" for everything', () => {
    expect(trialView(consumed, { data: undefined, isError: false })).toEqual({ state: 'loading' });
  });

  it('says the stock failed when it did', () => {
    expect(trialView(consumed, { data: undefined, isError: true })).toEqual({ state: 'error' });
    expect(trialView(consumed, { data: stock, isError: true })).toEqual({ state: 'error' });
  });

  it('says a sale takes nothing without waiting for the stock', () => {
    expect(trialView([], { data: undefined, isError: false })).toEqual({ state: 'nothing' });
  });

  it('once the stock is in, is the rows and what they add up to', () => {
    const view = trialView(consumed, { data: stock, isError: false });
    expect(view.state).toBe('rows');
    if (view.state !== 'rows') return;
    expect(view.rows.map((r) => [r.item_id, r.status])).toEqual([
      ['pollo', 'low'],
      ['cebolla', 'negative'],
    ]);
    expect(view.low).toBe(1);
    expect(view.negative).toBe(1);
  });
});
