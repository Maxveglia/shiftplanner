// The menu as the till lays it out: every dish in one flat grid, in
// alphabetical order, with no headings between them -- Agua, Caprisun,
// Coca-Cola, Combo Crispy Grande… as Casa Demo's till shows it. A row of
// section chips above it narrows the grid to one section ("All" first, and
// chosen until another is); inside a section the dishes are alphabetical too.
//
// The manager's menu, the team's and the tiles of "New sale" all lay it out
// like this, so it is decided here once, with the search and the "without"
// allergens of filter.ts on top.

import { filterMenu, type MenuFilter } from './filter';
import type { MenuDish, MenuSection } from './types';

/** A section chip: the id it narrows to and the name it shows. */
export interface SectionChip {
  id: string;
  name: string;
}

/**
 * Two dish names in the order of the app's language, the way a person reads
 * a list: "Ácido" beside "Agua", not after "Zumo"; "coca-cola" beside
 * "Combo", not after every capital -- accents and capitals do not count
 * (`sensitivity: 'base'`), and "Menú 2" comes before "Menú 10". What the
 * language holds as a letter of its own does count: in Spanish, "Ñoquis"
 * after "Nuez". Two names equal to that eye fall back to the exact
 * spelling, then to the id, so the grid never swaps them between renders.
 */
export function compareDishNames(a: Pick<MenuDish, 'id' | 'name'>, b: Pick<MenuDish, 'id' | 'name'>, locale: string): number {
  return (
    a.name.localeCompare(b.name, locale, { sensitivity: 'base', numeric: true }) ||
    a.name.localeCompare(b.name, locale) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The dishes in alphabetical order, as a new list. */
export function sortDishes<T extends Pick<MenuDish, 'id' | 'name'>>(dishes: readonly T[], locale: string): T[] {
  return [...dishes].sort((a, b) => compareDishNames(a, b, locale));
}

/**
 * The chips after "All", in the manager's order of the sections. The team
 * and "New sale" get only the sections with a dish in them -- an empty chip
 * is a door to nothing -- and the manager gets every one (`keepEmpty`): a
 * section just created is where its first dish is added.
 */
export function sectionChips(sections: readonly MenuSection[], { keepEmpty = false }: { keepEmpty?: boolean } = {}): SectionChip[] {
  return sections.filter((s) => keepEmpty || s.dishes.length > 0).map((s) => ({ id: s.id, name: s.name }));
}

/**
 * The chip that is on: the one chosen while it is still among the chips,
 * "All" (null) once it is not -- the section was deleted, or its last dish
 * was, in another tab or by the refetch.
 */
export function activeSection(chips: readonly SectionChip[], chosen: string | null): string | null {
  return chosen !== null && chips.some((c) => c.id === chosen) ? chosen : null;
}

/**
 * What the grid shows: the dishes of the chosen section (every section with
 * null), that pass the search and the allergens, in alphabetical order.
 */
export function tillDishes(
  sections: readonly MenuSection[],
  { section, ...filter }: MenuFilter & { section: string | null },
  locale: string,
): MenuDish[] {
  const from = section === null ? sections : sections.filter((s) => s.id === section);
  return sortDishes(
    filterMenu(from, filter).flatMap((s) => s.dishes),
    locale,
  );
}

/** Every dish a chip stands for, before any search: what the count beside the grid is out of. */
export function dishesIn(sections: readonly MenuSection[], section: string | null): MenuDish[] {
  return (section === null ? sections : sections.filter((s) => s.id === section)).flatMap((s) => s.dishes);
}
