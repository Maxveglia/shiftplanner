// Recipes: what each product of the menu takes from the stock when it is
// sold. A product has ingredients (products of the inventory, in their unit:
// 0.75 of a product counted in kg is ¾ kg) and it can be made of other
// products of the menu ("Combo Grande = 1 Crispy Grande + 1 Patatas"), whose
// ingredients it inherits, as many levels down as there are.
//
// The server expands every sale when it is saved, and what it keeps is what
// the stock goes by. What is here is the same expansion, done in the browser,
// for the two things the Recipes screen shows before anything is saved: the
// total of a recipe while it is being typed, and "try a sale". So it has to
// come out EXACTLY as the server's does:
//
//   - every quantity multiplied and added exactly, not in floats: 0.1 kg of
//     onion in five sales is 0.5, not 0.5000000000000001, and a component of
//     a component is a product of several three-decimal numbers;
//   - rounded ONCE, at the end, to 3 decimals, half up -- what the column
//     holds. Rounding at each level would make three sales of half a
//     portion of 0.001 kg 0.003 (0.001 three times) instead of 0.002;
//   - what rounds to 0 is not there at all.
//
// Exact is done with integers (BigInt): a quantity is its thousandths, and a
// product of k of them is an integer over 10^(3k).

/** What one product is made of, as its recipe says. */
export interface RecipeParts {
  items: readonly { item_id: string; quantity: number }[];
  components: readonly { dish_id: string; quantity: number }[];
}

/** Every product's recipe, by the product's id. A product missing is one with no recipe. */
export type RecipeBook = ReadonlyMap<string, RecipeParts>;

/** A line of a sale, as far as the stock is concerned: which product, and how many. */
export interface SoldLine {
  dish_id: string;
  quantity: number;
}

/** What a sale takes of one product of the inventory. */
export interface Consumed {
  item_id: string;
  quantity: number;
}

/** The most ingredients and components one product can have (the server's limits). */
export const MAX_RECIPE_ITEMS = 30;
export const MAX_RECIPE_COMPONENTS = 20;

/**
 * The most levels of products inside products in any chain through a
 * product: a combo of products with only ingredients is one level
 * (services/recipes.py, MAX_DEPTH).
 */
export const MAX_RECIPE_DEPTH = 5;

/**
 * What one unit of a product may take, as stored (schemas/recipes.py): under
 * a hundred thousand of an ingredient, in its unit, and under a thousand of
 * another product.
 */
export const ITEM_QUANTITY_CEILING = 100_000;
export const COMPONENT_QUANTITY_CEILING = 1_000;

/** The most a quantity can be at all: numeric(12,3), below a billion. */
const MAX_QUANTITY = 1e9;

// --- Exact decimals ---------------------------------------------------------------

/** `n / 10^scale`, exactly. */
interface Exact {
  n: bigint;
  scale: number;
}

const TEN = BigInt(10);
const ZERO = BigInt(0);
const TWO = BigInt(2);

function pow10(k: number): bigint {
  let out = BigInt(1);
  for (let i = 0; i < k; i++) out *= TEN;
  return out;
}

/** A quantity as the server keeps it (3 decimals), exactly. */
function exact(value: number): Exact {
  return { n: BigInt(Math.round(value * 1000)), scale: 3 };
}

function times(a: Exact, b: Exact): Exact {
  return { n: a.n * b.n, scale: a.scale + b.scale };
}

function plus(a: Exact, b: Exact): Exact {
  if (a.scale === b.scale) return { n: a.n + b.n, scale: a.scale };
  if (a.scale > b.scale) return { n: a.n + b.n * pow10(a.scale - b.scale), scale: a.scale };
  return { n: a.n * pow10(b.scale - a.scale) + b.n, scale: b.scale };
}

/** To 3 decimals, half up (away from zero on a tie, as Python's ROUND_HALF_UP), as a number. */
function toThousandths(value: Exact): number {
  if (value.scale <= 3) return Number(value.n * pow10(3 - value.scale)) / 1000;
  const divisor = pow10(value.scale - 3);
  const negative = value.n < ZERO;
  const magnitude = negative ? -value.n : value.n;
  let whole = magnitude / divisor;
  if ((magnitude % divisor) * TWO >= divisor) whole += BigInt(1);
  return Number(negative ? -whole : whole) / 1000;
}

// --- Expanding ----------------------------------------------------------------------

type Totals = Map<string, Exact>;

function addInto(into: Totals, itemId: string, amount: Exact): void {
  const before = into.get(itemId);
  into.set(itemId, before ? plus(before, amount) : amount);
}

/**
 * Everything one unit of a product takes, exactly, its components expanded.
 *
 * A product that contains itself (A in B in A) cannot be expanded: the server
 * refuses to save one, and the editor does not offer it. Should one reach
 * here anyway, the branch that closes the loop counts as nothing rather than
 * going round for ever.
 */
function expandOne(book: RecipeBook, dishId: string, memo: Map<string, Totals>, path: Set<string>): Totals {
  const known = memo.get(dishId);
  if (known) return known;
  const totals: Totals = new Map();
  const parts = book.get(dishId);
  if (!parts || path.has(dishId)) return totals;
  path.add(dishId);
  for (const item of parts.items) {
    if (item.quantity > 0) addInto(totals, item.item_id, exact(item.quantity));
  }
  for (const component of parts.components) {
    if (component.quantity <= 0 || path.has(component.dish_id)) continue;
    const inner = expandOne(book, component.dish_id, memo, path);
    const factor = exact(component.quantity);
    for (const [itemId, amount] of inner) addInto(totals, itemId, times(factor, amount));
  }
  path.delete(dishId);
  memo.set(dishId, totals);
  return totals;
}

/**
 * What a sale takes from the stock: each line's product, times the line's
 * quantity, added up by product of the inventory and rounded once at the end.
 * A line for a product with no recipe (or no longer on the menu) takes
 * nothing. In the order each ingredient is first met.
 */
export function expandSale(book: RecipeBook, lines: readonly SoldLine[]): Consumed[] {
  const memo = new Map<string, Totals>();
  const totals: Totals = new Map();
  for (const line of lines) {
    if (!(line.quantity > 0)) continue;
    const perUnit = expandOne(book, line.dish_id, memo, new Set());
    const factor = exact(line.quantity);
    for (const [itemId, amount] of perUnit) addInto(totals, itemId, times(factor, amount));
  }
  const out: Consumed[] = [];
  for (const [itemId, amount] of totals) {
    const quantity = toThousandths(amount);
    if (quantity !== 0) out.push({ item_id: itemId, quantity });
  }
  return out;
}

/** What one unit of a product takes: its recipe, every component expanded. */
export function expandDish(book: RecipeBook, dishId: string): Consumed[] {
  return expandSale(book, [{ dish_id: dishId, quantity: 1 }]);
}

/** The book with one product's recipe replaced -- the one being edited, as typed. */
export function withRecipe(book: RecipeBook, dishId: string, parts: RecipeParts): RecipeBook {
  const next = new Map(book);
  next.set(dishId, parts);
  return next;
}

/**
 * Whether putting `candidate` inside `dishId` would make a product contain
 * itself: the candidate is the product, or already contains it, directly or
 * through its own components. What the editor leaves out of "Includes".
 */
export function wouldCycle(book: RecipeBook, dishId: string, candidate: string): boolean {
  const seen = new Set<string>();
  const pending = [candidate];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === dishId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const component of book.get(current)?.components ?? []) pending.push(component.dish_id);
  }
  return false;
}

/**
 * Levels of "includes" in the longest chain through `dishId` once its
 * components are `components`: down from it, and up through every product
 * that already includes it -- making a product a combo makes every combo it
 * is in one level deeper. The server's rule (services/recipes.py,
 * `depth_through`), so the editor offers nothing the server would refuse as
 * too deep. A loop already in the book counts as no further level.
 */
export function depthThrough(book: RecipeBook, dishId: string, components: readonly string[]): number {
  const down = new Map<string, string[]>();
  for (const [id, parts] of book) down.set(id, parts.components.map((c) => c.dish_id));
  down.set(dishId, [...components]);
  const up = new Map<string, string[]>();
  for (const [id, children] of down) {
    for (const child of children) up.set(child, [...(up.get(child) ?? []), id]);
  }
  return longest(down, dishId) + longest(up, dishId);
}

/**
 * Why a product of the menu cannot go inside `dishId` just now, with
 * `current` the products the recipe being edited already includes -- or null
 * when it can: it is the product itself; it is in already; it already
 * contains the product, directly or through others, so the product would end
 * up inside itself; or it would make a chain of products inside products
 * deeper than MAX_RECIPE_DEPTH. What the editor leaves out of "Includes".
 */
export type IncludeBlock = 'self' | 'included' | 'cycle' | 'too_deep';

export function includeBlock(
  book: RecipeBook,
  dishId: string,
  current: readonly string[],
  candidate: string,
): IncludeBlock | null {
  if (candidate === dishId) return 'self';
  if (current.includes(candidate)) return 'included';
  if (wouldCycle(book, dishId, candidate)) return 'cycle';
  if (depthThrough(book, dishId, [...current, candidate]) > MAX_RECIPE_DEPTH) return 'too_deep';
  return null;
}

/**
 * Why "Includes" has nothing to offer, so the line in its place says the
 * right thing -- or null when it offers something. `menu` is every product of
 * the menu, this one among them.
 *
 *   - `no_others`: the menu has no product but this one;
 *   - `all_in`: every other one is included already;
 *   - `rules`: some are left, and each would make the product end up inside
 *     itself or go deeper than MAX_RECIPE_DEPTH.
 *
 * The first two are the menu's; only the last is a rule of recipes, and
 * telling a manager with a two-product menu about loops and levels was the
 * bug this is for.
 */
export function nothingToInclude(
  book: RecipeBook,
  dishId: string,
  current: readonly string[],
  menu: readonly string[],
): 'no_others' | 'all_in' | 'rules' | null {
  const others = menu.filter((id) => id !== dishId);
  if (others.length === 0) return 'no_others';
  const left = others.filter((id) => !current.includes(id));
  if (left.length === 0) return 'all_in';
  return left.every((id) => includeBlock(book, dishId, current, id) !== null) ? 'rules' : null;
}

/** Edges in the longest chain from `start` in `graph` (0 for none). */
function longest(graph: ReadonlyMap<string, readonly string[]>, start: string): number {
  const memo = new Map<string, number>();
  const onPath = new Set<string>();
  const walk = (node: string): number => {
    const known = memo.get(node);
    if (known !== undefined) return known;
    if (onPath.has(node)) return -1;
    onPath.add(node);
    let best = 0;
    for (const next of graph.get(node) ?? []) best = Math.max(best, 1 + walk(next));
    onPath.delete(node);
    memo.set(node, best);
    return best;
  };
  return walk(start);
}

// --- Typing a quantity ------------------------------------------------------------

/**
 * The fractions Unicode writes as one character, as a phone keyboard or a
 * pasted recipe gives them ("¾"), by the fraction they are.
 */
const VULGAR_FRACTIONS: Readonly<Record<string, readonly [number, number]>> = {
  '¼': [1, 4],
  '½': [1, 2],
  '¾': [3, 4],
  '⅐': [1, 7],
  '⅑': [1, 9],
  '⅒': [1, 10],
  '⅓': [1, 3],
  '⅔': [2, 3],
  '⅕': [1, 5],
  '⅖': [2, 5],
  '⅗': [3, 5],
  '⅘': [4, 5],
  '⅙': [1, 6],
  '⅚': [5, 6],
  '⅛': [1, 8],
  '⅜': [3, 8],
  '⅝': [5, 8],
  '⅞': [7, 8],
};

const VULGAR = /^(?:(\d+) ?)?([¼½¾⅐-⅞])$/;

/**
 * A quantity of an ingredient or a component, as typed: "0,75" or "0.75",
 * "1", or a fraction -- "3/4", "1/2", "1 1/2", or the one-character ones,
 * "¾", "1¾", "1 ¾" -- which is how a kitchen says it. Above 0 and below
 * `ceiling` (by default a billion; the recipe's own are ITEM_ and
 * COMPONENT_QUANTITY_CEILING). A decimal keeps at most 3 places (what the
 * server stores), so "0,7525" is refused rather than cut; a fraction becomes
 * its decimal to 3 places ("1/3" is 0.333), which the field shows beside it.
 * Null for anything else, or for a fraction too small to be 0.001.
 */
export function parseRecipeQuantity(text: string, ceiling: number = MAX_QUANTITY): number | null {
  let cleaned = text.trim().replace(/\s+/g, ' ');
  if (cleaned === '') return null;
  // "1¾" is "1 3/4": the same fraction, written with one character.
  const vulgar = VULGAR.exec(cleaned);
  if (vulgar) {
    const [top, bottom] = VULGAR_FRACTIONS[vulgar[2]];
    cleaned = `${vulgar[1] ? `${vulgar[1]} ` : ''}${top}/${bottom}`;
  }
  const decimal = cleaned.replace(',', '.');
  let value: number;
  if (/^\d+(\.\d{1,3})?$/.test(decimal) || /^\.\d{1,3}$/.test(decimal)) {
    value = Number(decimal);
  } else {
    const fraction = /^(?:(\d+) )?(\d+)\/(\d+)$/.exec(cleaned);
    if (!fraction) return null;
    const [, wholeText, top, bottom] = fraction;
    const denominator = Number(bottom);
    if (denominator === 0) return null;
    value = Math.round(((wholeText ? Number(wholeText) : 0) + Number(top) / denominator) * 1000) / 1000;
  }
  return value > 0 && value < Math.min(ceiling, MAX_QUANTITY) ? value : null;
}

/** Whether the text was a fraction, so the field can say what it came to ("= 0,75 kg"). */
export function isFraction(text: string): boolean {
  return /[\/¼½¾⅐-⅞]/.test(text);
}

// --- Trying a sale -------------------------------------------------------------------

/** One product of the inventory before and after a sale that is only being tried. */
export interface TriedStock {
  item_id: string;
  /** What the sale would take. */
  take: number;
  /** What is on the shelf now (inventory `onHand`, 0 for a product not in the list). */
  now: number;
  /** What would be left: `now` minus `take`. */
  after: number;
  min_quantity: number | null;
  /** Below 0 is `negative`; below its minimum, `low`; else `ok`. */
  status: 'negative' | 'low' | 'ok';
}

/**
 * How the stock would stand after a sale: for each ingredient the sale takes,
 * what there is and what would be left, and whether that is below the
 * minimum or below zero. Nothing is saved: this is the arithmetic the server
 * will do with the sale, done first.
 */
export function trySale(
  consumed: readonly Consumed[],
  stock: ReadonlyMap<string, { now: number; min_quantity: number | null }>,
): TriedStock[] {
  return consumed.map(({ item_id, quantity }) => {
    const known = stock.get(item_id);
    const now = known?.now ?? 0;
    const min = known?.min_quantity ?? null;
    const after = Math.round((now - quantity) * 1000) / 1000;
    const status = after < 0 ? 'negative' : min !== null && after < min ? 'low' : 'ok';
    return { item_id, take: quantity, now, after, min_quantity: min, status };
  });
}

/**
 * What "how the stock would be left" shows for a sale being tried:
 *
 *   - `nothing` when the sale takes nothing, which needs no stock to say;
 *   - `error` when the stock could not be loaded, and `loading` until it is:
 *     without it every ingredient would read as 0 and the sale as leaving it
 *     below zero, so neither the table nor the sentence over it is worked
 *     out -- a false "would go below zero" is worse than a moment's wait;
 *   - `rows` otherwise, with how many would go below the minimum and below
 *     zero, for that sentence.
 *
 * `stock` is what `trySale` takes, or undefined while it has not loaded.
 */
export type TrialView =
  | { state: 'nothing' }
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'rows'; rows: TriedStock[]; low: number; negative: number };

export function trialView(
  consumed: readonly Consumed[],
  stock: {
    data: ReadonlyMap<string, { now: number; min_quantity: number | null }> | undefined;
    isError: boolean;
  },
): TrialView {
  if (consumed.length === 0) return { state: 'nothing' };
  if (stock.isError) return { state: 'error' };
  if (stock.data === undefined) return { state: 'loading' };
  const rows = trySale(consumed, stock.data);
  return {
    state: 'rows',
    rows,
    low: rows.filter((r) => r.status === 'low').length,
    negative: rows.filter((r) => r.status === 'negative').length,
  };
}
