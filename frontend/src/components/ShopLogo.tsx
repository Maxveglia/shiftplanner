import type { MarkPiece } from './Logo';

// Toldo: a shopfront under its awning, the shop's mark beside Rejilla and Pila.
//
// Drawn to the family's rules: the same 24-unit box, pieces inside 2..22 kept
// exactly 2.5 apart, corners of 1.25. Its widths are that gap or multiples of
// it, so it keeps Rejilla's rhythm without being another square: the awning
// overhangs the front by 2.5 on each side, its four scallops are 5 wide, and
// the front is three columns of 5 -- two walls and the door.
//
// The awning is one piece, not a stripe per scallop. Drawn as separate pieces
// 2.5 apart the scallops stood up like battlements, and with the door under
// them the mark read as a castle. A straight top with a scalloped edge is what
// an awning is at 19px, which is the size the sidebar draws it.
//
// The door is one of the awning's scallops turned over: the same 2.5 radius,
// cut out of the front. Its edges at the ground round at 0.625, as Pila's
// notches do.
//
// Pieces in the order they land: the front, then the awning over it.
export const SHOP_PIECES: MarkPiece[] = [
  {
    d: 'M5.75 10.5H18.25A1.25 1.25 0 0 1 19.5 11.75V20.75A1.25 1.25 0 0 1 18.25 22H15.125A0.625 0.625 0 0 1 14.5 21.375V17A2.5 2.5 0 0 0 9.5 17V21.375A0.625 0.625 0 0 1 8.875 22H5.75A1.25 1.25 0 0 1 4.5 20.75V11.75A1.25 1.25 0 0 1 5.75 10.5Z',
    cx: 12,
    cy: 16.25,
  },
  {
    d: 'M3.25 2H20.75A1.25 1.25 0 0 1 22 3.25V5.5A2.5 2.5 0 0 1 17 5.5A2.5 2.5 0 0 1 12 5.5A2.5 2.5 0 0 1 7 5.5A2.5 2.5 0 0 1 2 5.5V3.25A1.25 1.25 0 0 1 3.25 2Z',
    cx: 12,
    cy: 5,
  },
];

interface ShopLogoProps {
  /** Height in pixels. The mark is square, so this is its size. */
  size?: number;
  className?: string;
  /** Accessible name; the mark stands for the app, whose name is translated. */
  label?: string;
}

/** The shop's mark. Takes its colour from the text colour, as Logo does. */
export function ShopLogo({ size = 32, className, label }: ShopLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={SHOP_PIECES.map((p) => p.d).join('')} />
    </svg>
  );
}
