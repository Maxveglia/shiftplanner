// What the team's menu shows for a search and a set of "without" allergens:
// the waiter asked "what have you got without gluten?", or is looking for
// the croquetas.

import type { MenuDish, MenuSection } from './types';

export interface MenuFilter {
  /** Typed into the search box. Blank matches everything. */
  query: string;
  /** Allergens the dish must NOT contain ("without gluten"). */
  without: ReadonlySet<string>;
}

/**
 * Lower case and without accents, so "jamon" finds "Jamón" and "CAFE" finds
 * "café" -- nobody types the accent into a search box on a phone mid-service.
 */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Whether one dish passes: every word of the query, and none of the allergens. */
export function dishMatches(dish: MenuDish, filter: MenuFilter): boolean {
  if (dish.allergens.some((a) => filter.without.has(a))) return false;
  const words = foldText(filter.query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  // Name and description together: "tarta queso" finds "Tarta de queso", and
  // "trufa" finds the dish whose description says it carries truffle.
  const haystack = foldText(`${dish.name} ${dish.description ?? ''}`);
  return words.every((w) => haystack.includes(w));
}

/**
 * The sections with only the dishes that pass, in their order. A section
 * left with none is not shown at all: to the team an empty heading is noise,
 * and so is a section the manager has created and not filled yet.
 */
export function filterMenu(sections: readonly MenuSection[], filter: MenuFilter): MenuSection[] {
  return sections
    .map((section) => ({ ...section, dishes: section.dishes.filter((d) => dishMatches(d, filter)) }))
    .filter((section) => section.dishes.length > 0);
}

/** How many dishes the menu has, across its sections. */
export function countDishes(sections: readonly MenuSection[]): number {
  return sections.reduce((sum, s) => sum + s.dishes.length, 0);
}
