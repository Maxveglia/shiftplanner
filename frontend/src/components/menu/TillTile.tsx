// A dish as the till shows it -- Casa Demo's, which the team looks at all
// day behind the counter: a square with rounded corners, the photo to its
// edges, the name printed over it at the top left (white, bold, capitals)
// and the price at the bottom left. The team's menu and the tiles of "New
// sale" are both this, so the menu looks the same on the phone as at the
// till.
//
// Over any photo the words have to read, a bright plate as much as a dark
// one: a veil darkens the top and the bottom of the photo, and the words
// carry a shadow. A photo that has the name printed on it already (By
// Crispy's, cut from that till: `photo_labelled`) gets only the price --
// printed twice, the names would read one over the other. Without a photo,
// or when it does not load, the tile is a light one with the name and price
// in dark ink, as the till shows its water.
//
// Sold out: the photo in grey and faded, and "Sold out" SAID on it, by the
// price -- fading is not something everybody sees. A dish without a price
// says "Market price" there; at the till, where it cannot be charged, the
// tile can say "No price" in its place instead (`noPriceBadge`) -- one word
// for it, at the foot, never a second one over the printed name.
//
// Spans all the way down: the tiles of "New sale" and of the manager's menu
// are buttons, and a button may hold only phrasing content. What a screen
// reader hears is the tile's words in order -- `lead` ("Add", "Edit"), the
// name (printed or not), the price, then ×n and "sold out", a comma between
// each -- from text hidden to the eye where the eye gets a badge instead.

import { useState } from 'react';
import { formatQuantity } from '../../api/inventory';
import { API_ORIGIN } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { useT } from '../../lib/i18n';
import { photoSrc, tileFace } from '../../lib/menu/photo';
import type { MenuDish } from '../../lib/menu/types';
import { Badge } from '../Badge';

type Size = 'card' | 'tile';

/** The words' sizes: the team's cards are about half as wide again as the sale's tiles. */
const NAME: Record<Size, string> = {
  card: 'text-sm sm:text-base',
  tile: 'text-[11px] sm:text-xs',
};
const PRICE: Record<Size, string> = {
  card: 'text-xs sm:text-sm',
  tile: 'text-[11px] sm:text-xs',
};
const PAD: Record<Size, string> = {
  card: 'p-2 sm:p-2.5',
  tile: 'p-1.5',
};

/** Pixel size hinted to the browser, for the aspect ratio before the file arrives. */
const HINT: Record<Size, number> = { card: 400, tile: 200 };

/** White on a photo: a shadow that holds it off whatever is behind. */
const ON_PHOTO = 'text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.85),0_0_6px_rgb(0_0_0/0.45)]';

export function TillTile({
  dish,
  size,
  nameAs: Name = 'span',
  lead,
  count = 0,
  noPriceBadge,
}: {
  dish: Pick<MenuDish, 'name' | 'price' | 'available' | 'photo_url' | 'photo_labelled'>;
  size: Size;
  /** `h2` on the team's menu, where each dish is a heading under the page's; a span inside a button. */
  nameAs?: 'h2' | 'span';
  /** Said before the name and not shown: "Add" on the tile that adds, "Edit" on the one that opens it. */
  lead?: string;
  /** How many are in the sale already, shown as ×n in the corner (0: none). */
  count?: number;
  /** For a dish without a price: this, as a badge, in place of "Market price" (the till's "No price"). */
  noPriceBadge?: string;
}) {
  const t = useT();
  const soldOut = !dish.available;
  const src = photoSrc(dish.photo_url, API_ORIGIN);
  // The address that failed, not a flag: a new photo (a new address) gets its
  // own try.
  const [failed, setFailed] = useState<string | null>(null);
  const photoShown = src !== null && src !== failed;
  const face = tileFace(photoShown, dish.photo_labelled);
  const countLabel = formatQuantity(count);

  const ground = face.light
    ? // Light, as the till's water is -- and set apart from a sold-out one
      // by a darker grey as well as by the words.
      soldOut
      ? 'bg-gray-600'
      : 'bg-gray-800'
    : 'bg-gray-100';

  return (
    <span
      className={[
        'relative block aspect-square w-full overflow-hidden rounded-lg ring-1 ring-inset ring-white/[0.08]',
        ground,
      ].join(' ')}
    >
      {photoShown && (
        <>
          <img
            src={src}
            // The tile's words say what it is.
            alt=""
            width={HINT[size]}
            height={HINT[size]}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(src)}
            className={[
              'absolute inset-0 h-full w-full object-cover transition-[filter,opacity] duration-200 motion-reduce:transition-none',
              soldOut ? 'opacity-40 grayscale' : '',
            ].join(' ')}
          />
          <span
            aria-hidden="true"
            className={[
              'absolute inset-0',
              // The top is darkened only where a name is printed on it: a
              // photo that carries its own is left as the till shows it.
              face.printName
                ? 'bg-[linear-gradient(to_bottom,rgb(0_0_0/0.6),rgb(0_0_0/0)_48%,rgb(0_0_0/0)_58%,rgb(0_0_0/0.72))]'
                : 'bg-[linear-gradient(to_bottom,rgb(0_0_0/0)_58%,rgb(0_0_0/0.72))]',
            ].join(' ')}
          />
        </>
      )}

      <span className={['relative flex h-full flex-col gap-1', PAD[size]].join(' ')}>
        <Name
          className={[
            'block break-words leading-tight',
            NAME[size],
            face.printName ? '' : 'sr-only',
            face.light
              ? 'font-medium text-ground'
              : `font-extrabold uppercase tracking-tight ${ON_PHOTO}`,
          ].join(' ')}
        >
          {/* Room for the ×n in the corner, on the first line only (it is
              less tall than a line): the lines under it keep the tile's
              whole width. */}
          {count > 0 && (
            <span aria-hidden="true" className={['float-right h-3', countLabel.length > 1 ? 'w-8' : 'w-6'].join(' ')} />
          )}
          {lead && <span className="sr-only">{lead} </span>}
          {dish.name}
          {/* Inside a button the name and the price are one sentence: "Edit
              Agua, €1.00". A heading ends before the price anyway. */}
          {Name === 'span' && <span className="sr-only">,</span>}
        </Name>
        {/* At the bottom whether or not the name is printed above it. "Sold
            out" beside the price, or on a line of its own just above it where
            the tile is too narrow for both -- never over the name. */}
        <span className="mt-auto flex flex-wrap-reverse items-end gap-x-1.5 gap-y-1">
          <span
            className={[
              'block tabular-nums leading-tight',
              PRICE[size],
              face.light ? 'text-ground/75' : `font-semibold ${ON_PHOTO}`,
            ].join(' ')}
          >
            {dish.price === null ? (
              noPriceBadge ? (
                <span className="sr-only">{noPriceBadge}</span>
              ) : (
                <span className="italic">{t('menu.dish.noPrice')}</span>
              )
            ) : (
              <span className="whitespace-nowrap">{formatMoney(dish.price)}</span>
            )}
            {count > 0 && <span className="sr-only">, ×{countLabel}</span>}
            {soldOut && <span className="sr-only">, {t('menu.dish.soldOut')}</span>}
          </span>
          {soldOut && (
            <span aria-hidden="true" className="block">
              <Badge tone="red">{t('menu.dish.soldOut')}</Badge>
            </span>
          )}
          {dish.price === null && noPriceBadge && !soldOut && (
            <span aria-hidden="true" className="block">
              <Badge tone="amber">{noPriceBadge}</Badge>
            </span>
          )}
        </span>
      </span>

      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-4 tabular-nums text-white shadow ring-1 ring-black/30"
        >
          ×{countLabel}
        </span>
      )}
    </span>
  );
}
