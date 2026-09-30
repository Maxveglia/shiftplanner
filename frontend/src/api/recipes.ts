// Recipes over the wire: what each product of the menu takes from the
// inventory when it is sold. Managers only, and only with both the shop and
// the inventory switched on.
//
// GET /store/recipes is the whole menu, section by section, each product
// with its recipe: its own ingredients (`items`), the other products it is
// made of (`components`), and everything one unit takes once those are
// expanded (`expanded`, the server's sum). PUT /store/recipes/{dish} replaces
// one product's recipe entirely -- empty lists are "no recipe" -- and answers
// with the product as the GET has it.
//
// A recipe only changes what NEW sales take: each sale keeps, when it is
// saved, what it took. So a save here refreshes nothing but this list.
//
// A product with no recipe of its own that is called the same as ONE product
// of the inventory ("Agua" and "Agua") takes 1 of it per unit sold, with
// nothing set up: the automatic link (services/recipes.py). The server says
// so in `auto_item`, and its `expanded` already counts it; with several
// products called the same there is no link (`auto_ambiguous`, and which in
// `auto_matches`). A recipe of its own always replaces it -- and emptied,
// brings it back: `name_match` is the product called the same whether or not
// a recipe hides the link, so the editor can say what an emptied recipe
// will take.
//
// Every answer passes through `normalize*`, as the shop's do (store.ts): a
// Decimal column serialised by a framework default arrives as "0.750".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InventoryItem } from './inventory';
import { api } from '../lib/api';
import type { RecipeBook } from '../lib/store/recipes';
import { queryKeys } from './keys';
import { toNumber } from './store';

/** An ingredient of a product: a product of the inventory, in its unit. */
export interface RecipeItem {
  item_id: string;
  name: string;
  unit: string | null;
  /** In the inventory product's unit: 0.75 of a product counted in kg is ¾ kg. */
  quantity: number;
  /** Archived in the inventory: still taken by the sales, not offered for new recipes. */
  archived: boolean;
  /** The inventory product's photo, or null (also when the server does not say). */
  photo_url: string | null;
}

/** Another product of the menu inside this one: a combo's burger, its fries. */
export interface RecipeComponent {
  dish_id: string;
  name: string;
  quantity: number;
}

/** What one unit takes in all, every component expanded. */
export interface RecipeTotal {
  item_id: string;
  name: string;
  unit: string | null;
  quantity: number;
  /** The inventory product's photo, or null (also when the server does not say). */
  photo_url: string | null;
}

/** A product of the inventory called the same as a product of the menu. */
export interface RecipeAutoItem {
  item_id: string;
  name: string;
  unit: string | null;
  photo_url: string | null;
}

export interface RecipeDish {
  dish_id: string;
  name: string;
  /** Its photo on the menu, or null (also when the server does not say). */
  photo_url: string | null;
  /** A recipe of its OWN: the automatic link is not one. */
  has_recipe: boolean;
  items: RecipeItem[];
  components: RecipeComponent[];
  /** What one unit takes in all: the recipe's, or the automatic link's 1 × product. */
  expanded: RecipeTotal[];
  /** With no recipe of its own, the one product of the inventory called the same; null otherwise. */
  auto_item: RecipeAutoItem | null;
  /** With no recipe of its own, several products are called the same: no link, and it takes nothing. */
  auto_ambiguous: boolean;
  /** Those products, when the server says (empty otherwise). */
  auto_matches: RecipeAutoItem[];
  /**
   * The one product called the same, EVEN with a recipe of its own: what each
   * sale would take if that recipe were emptied. Null when none or several
   * are, and from a server older than the field.
   */
  name_match: RecipeAutoItem | null;
}

export interface RecipeSection {
  id: string;
  name: string;
  dishes: RecipeDish[];
}

export interface RecipeInput {
  items: { item_id: string; quantity: number }[];
  components: { dish_id: string; quantity: number }[];
}

// --- Reading the wire ---------------------------------------------------------

type Raw = Record<string, unknown>;

function asRecord(value: unknown): Raw {
  return value !== null && typeof value === 'object' ? (value as Raw) : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function quantity(value: unknown): number {
  return Math.round(toNumber(value) * 1000) / 1000;
}

function autoItem(value: unknown): RecipeAutoItem | null {
  if (value === null || typeof value !== 'object') return null;
  const r = value as Raw;
  const id = text(r.item_id);
  return id ? { item_id: id, name: text(r.name), unit: textOrNull(r.unit), photo_url: textOrNull(r.photo_url) } : null;
}

export function normalizeRecipeDish(raw: unknown): RecipeDish {
  const r = asRecord(raw);
  const items = asList(r.items).map((i) => {
    const item = asRecord(i);
    return {
      item_id: text(item.item_id),
      name: text(item.name),
      unit: textOrNull(item.unit),
      quantity: quantity(item.quantity),
      archived: item.archived === true,
      photo_url: textOrNull(item.photo_url),
    };
  });
  const components = asList(r.components).map((c) => {
    const component = asRecord(c);
    return { dish_id: text(component.dish_id), name: text(component.name), quantity: quantity(component.quantity) };
  });
  const expanded = asList(r.expanded).map((e) => {
    const total = asRecord(e);
    return {
      item_id: text(total.item_id),
      name: text(total.name),
      unit: textOrNull(total.unit),
      quantity: quantity(total.quantity),
      photo_url: textOrNull(total.photo_url),
    };
  });
  const has_recipe = typeof r.has_recipe === 'boolean' ? r.has_recipe : items.length > 0 || components.length > 0;
  return {
    dish_id: text(r.dish_id ?? r.id),
    name: text(r.name),
    photo_url: textOrNull(r.photo_url),
    // What the lists say, if the flag is missing: a recipe is having either.
    has_recipe,
    items,
    components,
    expanded,
    // A recipe of its own wins, whatever else came along.
    auto_item: has_recipe ? null : autoItem(r.auto_item),
    auto_ambiguous: !has_recipe && r.auto_ambiguous === true,
    auto_matches: has_recipe ? [] : asList(r.auto_matches).flatMap((m) => autoItem(m) ?? []),
    // Kept with a recipe too: it is what the recipe hides.
    name_match: autoItem(r.name_match),
  };
}

/**
 * What a product of the menu takes from the inventory, in a word:
 *
 *   - `recipe`: a recipe of its own;
 *   - `auto`: none, but it is called the same as one product of the
 *     inventory, and takes 1 of it;
 *   - `ambiguous`: none, and several products are called the same: nothing;
 *   - `none`: nothing.
 */
export type RecipeStatus = 'recipe' | 'auto' | 'ambiguous' | 'none';

export function recipeStatus(dish: Pick<RecipeDish, 'has_recipe' | 'auto_item' | 'auto_ambiguous'>): RecipeStatus {
  if (dish.has_recipe) return 'recipe';
  if (dish.auto_item) return 'auto';
  return dish.auto_ambiguous ? 'ambiguous' : 'none';
}

/** Whether selling it takes something from the inventory: a recipe, or the automatic link. */
export function takesFromStock(dish: Pick<RecipeDish, 'has_recipe' | 'auto_item' | 'auto_ambiguous'>): boolean {
  const status = recipeStatus(dish);
  return status === 'recipe' || status === 'auto';
}

/**
 * A name as the automatic link compares it (services/recipes.py, name_key):
 * no capitals, no accents -- "Água" is "agua" -- none of the invisible
 * characters a name pasted from the web brings along (Unicode's "format"
 * category: a zero-width space, a soft hyphen, a BOM), and every run of
 * spaces one space, none at the ends. The server folds case with Python's
 * casefold(); lowercasing does the same for these names but for "ß" (→ "ss")
 * and the final "ς" (→ "σ"), done by hand.
 */
export function nameKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ς/g, 'σ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * The products of the inventory (not archived) called the same as a product
 * of the menu: which ones make its link ambiguous. The server's list when it
 * sent one; worked out here from the stock otherwise.
 */
export function autoMatches(dish: RecipeDish, stock: readonly InventoryItem[]): string[] {
  if (dish.auto_matches.length > 0) return dish.auto_matches.map((m) => m.name);
  const key = nameKey(dish.name);
  return stock.filter((i) => i.archived_at === null && nameKey(i.name) === key).map((i) => i.name);
}

/**
 * What a product's recipe, as it is being typed, falls back to when it is
 * left empty: 1 of the one product of the inventory called the same, the
 * automatic link. Null while something is in it (`draftEmpty` false), or
 * when nothing, or several things, are called the same. `news` when the
 * product has a recipe of its own now: emptying it is what brings the link
 * back, and the editor says so ("Left without a recipe it will take 1 ×
 * Agua"). A server older than `name_match` knows only the link it has.
 */
export function linkWhenEmptied(
  dish: Pick<RecipeDish, 'has_recipe' | 'auto_item' | 'name_match'>,
  draftEmpty: boolean,
): { item: RecipeAutoItem; news: boolean } | null {
  if (!draftEmpty) return null;
  const item = dish.auto_item ?? dish.name_match;
  return item ? { item, news: dish.has_recipe } : null;
}

/** The sections, in the menu's order; `{sections: [...]}` or the bare list alike. */
export function normalizeRecipes(raw: unknown): RecipeSection[] {
  const sections = Array.isArray(raw) ? raw : asList(asRecord(raw).sections);
  return sections.map((s) => {
    const section = asRecord(s);
    return {
      id: text(section.id ?? section.section_id),
      name: text(section.name),
      dishes: asList(section.dishes ?? section.products).map(normalizeRecipeDish),
    };
  });
}

/**
 * What each product takes, by its id: what the expansion (lib/store/recipes.ts)
 * reads. Its saved recipe; and a product with none that has the automatic
 * link, 1 of its product -- so "try a sale" and a combo whose component has
 * only the link come out as the server's expansion does.
 */
export function recipeBook(sections: readonly RecipeSection[]): RecipeBook {
  const book = new Map<string, { items: RecipeInput['items']; components: RecipeInput['components'] }>();
  for (const section of sections) {
    for (const dish of section.dishes) {
      const items = dish.items.map(({ item_id, quantity: q }) => ({ item_id, quantity: q }));
      const components = dish.components.map(({ dish_id, quantity: q }) => ({ dish_id, quantity: q }));
      const auto = items.length === 0 && components.length === 0 ? dish.auto_item : null;
      book.set(dish.dish_id, auto ? { items: [{ item_id: auto.item_id, quantity: 1 }], components: [] } : { items, components });
    }
  }
  return book;
}

/** What is known of an ingredient to show it: its name, its unit, whether it is archived, its photo. */
export interface IngredientLabel {
  name: string;
  unit: string | null;
  archived: boolean;
  photo_url: string | null;
}

/**
 * Every ingredient this screen may have to show, by its inventory id: the
 * recipes' own (which include archived products), then -- fresher, and
 * winning -- the inventory's. A photo the inventory does not mention (a
 * server older than the field) leaves the recipe's.
 */
export function ingredientLabels(
  sections: readonly RecipeSection[],
  stock: readonly InventoryItem[],
): Map<string, IngredientLabel> {
  const labels = new Map<string, IngredientLabel>();
  for (const section of sections) {
    for (const dish of section.dishes) {
      // The link, and the product an emptied recipe would link to.
      for (const linked of [dish.name_match, dish.auto_item]) {
        if (!linked) continue;
        const { item_id, name, unit, photo_url } = linked;
        labels.set(item_id, { name, unit, archived: false, photo_url });
      }
      for (const total of dish.expanded) {
        labels.set(total.item_id, { name: total.name, unit: total.unit, archived: false, photo_url: total.photo_url });
      }
      for (const item of dish.items) {
        labels.set(item.item_id, { name: item.name, unit: item.unit, archived: item.archived, photo_url: item.photo_url });
      }
    }
  }
  for (const item of stock) {
    labels.set(item.id, {
      name: item.name,
      unit: item.unit,
      archived: item.archived_at !== null,
      photo_url: item.photo_url !== undefined ? item.photo_url : (labels.get(item.id)?.photo_url ?? null),
    });
  }
  return labels;
}

/** The sections with one product replaced by the server's answer for it. */
export function withSavedDish(sections: readonly RecipeSection[], dish: RecipeDish): RecipeSection[] {
  return sections.map((section) =>
    section.dishes.some((d) => d.dish_id === dish.dish_id)
      ? { ...section, dishes: section.dishes.map((d) => (d.dish_id === dish.dish_id ? dish : d)) }
      : section,
  );
}

// --- Hooks ----------------------------------------------------------------------

export function useRecipes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.recipes,
    enabled,
    queryFn: async () => {
      const { data } = await api.get<unknown>('/store/recipes');
      return normalizeRecipes(data);
    },
    // Fetched again every time the screen opens: its names come from the menu
    // and the inventory, which are written on other screens.
    staleTime: 0,
  });
}

export function useSaveRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dishId, ...payload }: RecipeInput & { dishId: string }) => {
      const { data } = await api.put<unknown>(`/store/recipes/${encodeURIComponent(dishId)}`, payload);
      return normalizeRecipeDish(data);
    },
    onSuccess: (dish) => {
      qc.setQueryData<RecipeSection[]>(queryKeys.recipes, (sections) =>
        sections ? withSavedDish(sections, dish) : sections,
      );
      // Other products' totals include this one when they contain it.
      void qc.invalidateQueries({ queryKey: queryKeys.recipes });
    },
    // A refusal can be news too: a product or an ingredient gone meanwhile,
    // or a combo changed in another tab so this one now loops (recipe_cycle)
    // or goes too deep. Both lists are asked for again, so the editor -- which
    // stays open with what was typed -- stops offering what the server has
    // just refused: the products of the menu come from the recipes, the
    // ingredients from the inventory. Not awaited: the refusal is shown at
    // once, and the lists catch up behind it.
    onError: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.recipes });
      void qc.invalidateQueries({ queryKey: queryKeys.inventory });
    },
  });
}
