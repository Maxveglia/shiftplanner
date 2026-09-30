// The menu of the venue, as GET /menu sends it: sections in their order, each
// with its dishes in theirs. Written by the manager, dish by dish; read by the
// whole team. Only the menu -- no recipes, no cost, no link to the stock.

export interface MenuDish {
  id: string;
  section_id: string;
  name: string;
  description: string | null;
  /** Null is "no fixed price" (market price), not zero. */
  price: number | null;
  /** Allergen codes (allergens.ts), in the canonical order, each once. */
  allergens: string[];
  /** False is "sold out" today: still on the menu, just not to be offered. */
  available: boolean;
  position: number;
  /**
   * Where its photo is served ("/api/v1/menu/photos/<id>", a path on the
   * API's origin: photo.ts `photoSrc`), or null without one. The id is new
   * with every photo, so a changed photo is a changed address and no cache
   * shows the old one. The address needs no token: an <img> cannot send one.
   */
  photo_url: string | null;
  /**
   * The photo has the dish's name printed on it already -- the ones cut from
   * Casa Demo's till -- so the tile prints the price over it and not the
   * name a second time. False for a photo the manager uploads, and with no
   * photo. A server from before the field sends nothing: that is false too
   * (edit.ts `dishFromServer`).
   */
  photo_labelled: boolean;
}

export interface MenuSection {
  id: string;
  name: string;
  position: number;
  dishes: MenuDish[];
}

export interface Menu {
  sections: MenuSection[];
}

/** What POST /menu/dishes takes. */
export interface MenuDishInput {
  section_id: string;
  name: string;
  description?: string | null;
  price?: number | null;
  allergens?: string[];
  available?: boolean;
}

/**
 * What PATCH /menu/dishes/{id} takes: only what is sent changes. `price:
 * null` clears the price; a new `section_id` moves the dish to the end of
 * that section.
 */
export type MenuDishPatch = Partial<MenuDishInput>;
