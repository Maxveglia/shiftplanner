// A photo on its own, in a square: a dish's where the manager edits the menu
// (the preview in the dish dialog), a product's wherever the stock lists it
// (Stock, a count, a delivery, a recipe's ingredients) and in its dialog. The
// team's menu and the tiles of "New sale" show a dish as the till does, with
// the name and the price over it (components/menu/TillTile.tsx).
//
// The box has its size before anything loads (square, set by `size`), so
// nothing on the page jumps when the photo arrives -- nor between a row with
// a photo and one without; the photo fills it (`object-cover`) whatever its
// proportions. Lazy: a list of eighty products loads the ones in sight.
//
// Without a photo -- none uploaded, or one that fails to load -- the box shows
// the name's initials on a neutral ground, as the till does for a product
// with no picture. Never a broken image.
//
// `alt` is the caller's: the dish dialog's preview names the photo it edits,
// the stock's lists name the product ("Photo of “Estrella Damm”"). Empty, the
// photo is decoration. The initials are always decoration: whether there is a
// photo is said in words where it matters.

import { useState } from 'react';
import { API_ORIGIN } from '../../lib/api';
import { nameInitials, photoSrc } from '../../lib/photo/photo';

export type SquarePhotoSize = 'row' | 'thumb' | 'preview';

/** The box for each use, with its rounding and rim. */
const BOX: Record<SquarePhotoSize, string> = {
  row: 'h-10 w-10 shrink-0 rounded-lg ring-1 ring-inset ring-white/[0.08]',
  thumb: 'h-14 w-14 shrink-0 rounded-xl ring-1 ring-inset ring-white/[0.08]',
  preview: 'h-24 w-24 shrink-0 rounded-2xl ring-1 ring-inset ring-white/[0.08]',
};

const INITIALS: Record<SquarePhotoSize, string> = {
  row: 'text-xs',
  thumb: 'text-base',
  preview: 'text-2xl',
};

/** Pixel size hinted to the browser, for the aspect ratio before the file arrives. */
const HINT: Record<SquarePhotoSize, number> = { row: 40, thumb: 56, preview: 96 };

export function SquarePhoto({
  name,
  url,
  size,
  dimmed = false,
  alt = '',
  className = '',
}: {
  /** The name, for the initials. */
  name: string;
  /** `photo_url` as the server sends it, or a `data:` preview; null or missing for none. */
  url: string | null | undefined;
  size: SquarePhotoSize;
  /** Sold out, archived: the photo in grey and faded (the word is said beside it). */
  dimmed?: boolean;
  alt?: string;
  /** Rounding and the like, from the caller. */
  className?: string;
}) {
  const src = photoSrc(url, API_ORIGIN);
  // The address that failed, not a flag: a new photo (a new address) gets its
  // own try.
  const [failed, setFailed] = useState<string | null>(null);
  const showPhoto = src !== null && src !== failed;
  const initials = nameInitials(name);

  // Spans, not divs: it may stand inside a button, which holds only
  // phrasing content.
  return (
    <span
      className={[
        'relative block overflow-hidden bg-white/[0.05]',
        BOX[size],
        className,
      ].join(' ')}
    >
      {showPhoto ? (
        <img
          src={src}
          alt={alt}
          width={HINT[size]}
          height={HINT[size]}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(src)}
          className={[
            'absolute inset-0 h-full w-full object-cover transition-[filter,opacity] duration-200 motion-reduce:transition-none',
            dimmed ? 'opacity-40 grayscale' : '',
          ].join(' ')}
        />
      ) : (
        <span
          // Decoration, always: whether there is a photo is said in words
          // where it matters (the dialog's buttons and help).
          aria-hidden="true"
          className={[
            'absolute inset-0 grid select-none place-items-center font-semibold tracking-wide',
            INITIALS[size],
            dimmed ? 'text-gray-400' : 'text-gray-500',
          ].join(' ')}
        >
          {initials}
        </span>
      )}
    </span>
  );
}
