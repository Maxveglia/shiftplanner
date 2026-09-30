// Rejilla: five pieces that fill a square leaving no gaps. The week, solved.
//
// The mark itself, copied from the design system's `rejilla-menta.svg` rather
// than redrawn -- a logo that is approximately right is wrong, and the path
// data is the only part of a brand nobody can eyeball back into place.
//
// It replaces the "SP" tile that stood in for it. Two letters in a rounded
// square is what a product has before it has a logo; keeping it beside a real
// design system would say the brand stops at the colour.
//
// COLOUR COMES FROM THE TEXT COLOUR, not from a fill of its own. The system
// asks for `menta` on light grounds and `menta-light` on dark ones, and a mark
// that inherits `currentColor` gets that from whatever it sits in -- the
// sidebar, an avatar on brand, a button -- without this file knowing about any
// of them.

/** One piece of a mark: its outline, and its centre in the 24-unit box. */
export interface MarkPiece {
  d: string;
  cx: number;
  cy: number;
}

// The same path as the design system's file, cut at each `Z` into its five
// pieces so the launcher can move them one at a time. Joined back together
// they are the original, byte for byte.
export const REJILLA_PIECES: MarkPiece[] = [
  {
    d: 'M6 2H13.25A1.25 1.25 0 0 1 14.5 3.25V5.75A1.25 1.25 0 0 1 13.25 7H3.25A1.25 1.25 0 0 1 2 5.75V6A4 4 0 0 1 6 2Z',
    cx: 8.25,
    cy: 4.5,
  },
  {
    d: 'M18.25 2H18A4 4 0 0 1 22 6V13.25A1.25 1.25 0 0 1 20.75 14.5H18.25A1.25 1.25 0 0 1 17 13.25V3.25A1.25 1.25 0 0 1 18.25 2Z',
    cx: 19.5,
    cy: 8.25,
  },
  {
    d: 'M3.25 9.5H5.75A1.25 1.25 0 0 1 7 10.75V20.75A1.25 1.25 0 0 1 5.75 22H6A4 4 0 0 1 2 18V10.75A1.25 1.25 0 0 1 3.25 9.5Z',
    cx: 4.5,
    cy: 15.75,
  },
  {
    d: 'M10.75 9.5H13.25A1.25 1.25 0 0 1 14.5 10.75V13.25A1.25 1.25 0 0 1 13.25 14.5H10.75A1.25 1.25 0 0 1 9.5 13.25V10.75A1.25 1.25 0 0 1 10.75 9.5Z',
    cx: 12,
    cy: 12,
  },
  {
    d: 'M10.75 17H20.75A1.25 1.25 0 0 1 22 18.25V18A4 4 0 0 1 18 22H10.75A1.25 1.25 0 0 1 9.5 20.75V18.25A1.25 1.25 0 0 1 10.75 17Z',
    cx: 15.75,
    cy: 19.5,
  },
];

interface LogoProps {
  /** Height in pixels. The mark is square, so this is its size. */
  size?: number;
  className?: string;
}

export function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      role="img"
      aria-label="ShiftPlanner"
    >
      <path d={REJILLA_PIECES.map((p) => p.d).join('')} />
    </svg>
  );
}
