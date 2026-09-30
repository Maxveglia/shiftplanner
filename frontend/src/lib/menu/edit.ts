// Pure edits on the menu as the client holds it.
//
// Every write answers with what it wrote -- a dish, a section, or (after a
// reorder) the whole menu -- and that answer is put straight into the cached
// menu, so the screen shows the change the moment the server has it rather
// than a refetch later. The refetch still follows (api.ts) and has the last
// word. The two that are applied BEFORE the server answers (reordering and
// the sold-out switch, which must not lag under a thumb) use these too.
//
// Whatever the server sends -- the menu, a dish, a reordered menu -- goes
// through `menuFromServer` / `dishFromServer` first (api.ts), so a field the
// server added later is never missing on this side.

import type { Menu, MenuDish, MenuSection } from './types';

/**
 * A dish as the server sends it. `photo_labelled` came after the rest
 * (0040): a server from before it sends none, which is false -- the name is
 * then printed over the photo, as for any photo the manager uploads.
 */
export type ServerDish = Omit<MenuDish, 'photo_labelled'> & { photo_labelled?: boolean | null };
export type ServerSection = Omit<MenuSection, 'dishes'> & { dishes: ServerDish[] };
export interface ServerMenu {
  sections: ServerSection[];
}

/**
 * A dish as the client holds it. A photo only has its name on it while
 * there is a photo: a dish without one is never "labelled", whatever came
 * with it.
 */
export function dishFromServer(dish: ServerDish): MenuDish {
  return { ...dish, photo_labelled: dish.photo_url != null && dish.photo_labelled === true };
}

export function menuFromServer(menu: ServerMenu): Menu {
  return {
    sections: menu.sections.map((s) => ({ ...s, dishes: s.dishes.map(dishFromServer) })),
  };
}

/**
 * The ids with the one at `index` moved `delta` places (-1 up, +1 down).
 * Null when it would leave the list: the first cannot go up.
 */
export function moveId(ids: readonly string[], index: number, delta: -1 | 1): string[] | null {
  const to = index + delta;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * Which of a row's two arrows should have the focus once it has moved: the
 * one just pressed, so a second press moves it again -- unless the row has
 * reached the end that arrow points at, where that arrow is now disabled and
 * the other one takes the focus instead of the focus falling to the page.
 */
export function focusAfterMove(index: number, delta: -1 | 1, length: number): 'up' | 'down' {
  const to = index + delta;
  if (delta < 0) return to <= 0 ? 'down' : 'up';
  return to >= length - 1 ? 'up' : 'down';
}

/** Sort `items` into the order of `ids`, renumbering their positions; anything not listed goes last. */
function inOrder<T extends { id: string; position: number }>(items: readonly T[], ids: readonly string[]): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...items]
    .sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length))
    .map((item, i) => (item.position === i ? item : { ...item, position: i }));
}

export function reorderSections(menu: Menu, ids: readonly string[]): Menu {
  return { sections: inOrder(menu.sections, ids) };
}

export function reorderDishes(menu: Menu, sectionId: string, ids: readonly string[]): Menu {
  return {
    sections: menu.sections.map((s) =>
      s.id === sectionId ? { ...s, dishes: inOrder(s.dishes, ids) } : s,
    ),
  };
}

/**
 * A section as the server answered it: added at the end if new, renamed in
 * place if not. Its dishes are kept from what is here when the answer brings
 * none (a rename is about the name).
 */
export function withSection(menu: Menu, section: MenuSection): Menu {
  const known = menu.sections.some((s) => s.id === section.id);
  if (!known) return { sections: [...menu.sections, { ...section, dishes: section.dishes ?? [] }] };
  return {
    sections: menu.sections.map((s) =>
      s.id === section.id ? { ...s, name: section.name } : s,
    ),
  };
}

export function withoutSection(menu: Menu, sectionId: string): Menu {
  return { sections: menu.sections.filter((s) => s.id !== sectionId) };
}

/**
 * A dish as the server answered it: replaced where it is, or -- new, or moved
 * to another section -- put at the end of its section, which is where the
 * server puts it too.
 */
export function withDish(menu: Menu, dish: MenuDish): Menu {
  const home = menu.sections.find((s) => s.dishes.some((d) => d.id === dish.id));
  if (home && home.id === dish.section_id) {
    return {
      sections: menu.sections.map((s) =>
        s.id === home.id ? { ...s, dishes: s.dishes.map((d) => (d.id === dish.id ? dish : d)) } : s,
      ),
    };
  }
  return {
    sections: menu.sections.map((s) => {
      const dishes = s.dishes.filter((d) => d.id !== dish.id);
      return s.id === dish.section_id ? { ...s, dishes: [...dishes, dish] } : { ...s, dishes };
    }),
  };
}

export function withoutDish(menu: Menu, dishId: string): Menu {
  return {
    sections: menu.sections.map((s) =>
      s.dishes.some((d) => d.id === dishId) ? { ...s, dishes: s.dishes.filter((d) => d.id !== dishId) } : s,
    ),
  };
}

/** One dish with some of its fields changed, where it is. */
export function patchDish(
  menu: Menu,
  dishId: string,
  patch: Partial<Pick<MenuDish, 'available' | 'photo_url' | 'photo_labelled'>>,
): Menu {
  return {
    sections: menu.sections.map((s) =>
      s.dishes.some((d) => d.id === dishId)
        ? { ...s, dishes: s.dishes.map((d) => (d.id === dishId ? { ...d, ...patch } : d)) }
        : s,
    ),
  };
}
