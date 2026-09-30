// One dish as the team's menu shows it: the till's tile (TillTile.tsx) --
// the photo to the edges, the name and the price over it -- and under it,
// small, what the till does not have and a waiter needs: the description and
// the allergens. Never over the photo: that is the till's, and a list of
// allergens printed on a plate of food would be read by nobody.
//
// A sold-out dish stays on the menu, its tile in grey and "Sold out" said on
// it. The description under it is dimmed down the grey scale, not by opacity
// (4.5:1 kept), and the allergens are not dimmed at all: they are the one
// thing under the tile that must always read clearly.

import type { MenuDish } from '../../lib/menu/types';
import { AllergenChips } from './AllergenChips';
import { TillTile } from './TillTile';

/**
 * The dish's name is an h2 (inside the tile), under the page's h1: the menu
 * is one grid, A to Z, with no section headings between the dishes.
 */
export function MenuDishCard({ dish }: { dish: MenuDish }) {
  const soldOut = !dish.available;
  return (
    <div className="flex h-full flex-col gap-1.5">
      <TillTile dish={dish} size="card" nameAs="h2" />
      {dish.description && (
        <p
          className={[
            'whitespace-pre-line break-words px-0.5 text-xs leading-snug',
            soldOut ? 'text-gray-400' : 'text-gray-500',
          ].join(' ')}
        >
          {dish.description}
        </p>
      )}
      <div className="px-0.5">
        <AllergenChips allergens={dish.allergens} compact />
      </div>
    </div>
  );
}
