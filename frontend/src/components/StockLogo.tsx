import type { MarkPiece } from './Logo';

// Pila: three boxes stacked, the inventory's mark beside Rejilla's.
//
// Drawn to Rejilla's rules so the two read as one family: the same 24-unit
// box, pieces inside 2..22 kept exactly 2.5 apart, inner corners of 1.25. The
// tape across each lid is a notch as wide as that gap, and the top box's sits
// right over the gap between the two below it, so the mark keeps Rejilla's
// rhythm while being a pyramid rather than another square -- two marks that
// both fill a square would be told apart by squinting.
//
// One radius is new: the notch's edges round at 0.625. At 1.25 the notch
// closes into a bucket shape, and a sharp corner would be the only one in the
// family.
//
// Pieces in the order they land: the two boxes at the bottom, then the one on
// top.
export const STOCK_PIECES: MarkPiece[] = [
  {
    d: 'M3.25 13.25H4.5A0.625 0.625 0 0 1 5.125 13.875V17H7.625V13.875A0.625 0.625 0 0 1 8.25 13.25H9.5A1.25 1.25 0 0 1 10.75 14.5V20.75A1.25 1.25 0 0 1 9.5 22H3.25A1.25 1.25 0 0 1 2 20.75V14.5A1.25 1.25 0 0 1 3.25 13.25Z',
    cx: 6.375,
    cy: 17.625,
  },
  {
    d: 'M14.5 13.25H15.75A0.625 0.625 0 0 1 16.375 13.875V17H18.875V13.875A0.625 0.625 0 0 1 19.5 13.25H20.75A1.25 1.25 0 0 1 22 14.5V20.75A1.25 1.25 0 0 1 20.75 22H14.5A1.25 1.25 0 0 1 13.25 20.75V14.5A1.25 1.25 0 0 1 14.5 13.25Z',
    cx: 17.625,
    cy: 17.625,
  },
  {
    d: 'M8.875 2H10.125A0.625 0.625 0 0 1 10.75 2.625V5.75H13.25V2.625A0.625 0.625 0 0 1 13.875 2H15.125A1.25 1.25 0 0 1 16.375 3.25V9.5A1.25 1.25 0 0 1 15.125 10.75H8.875A1.25 1.25 0 0 1 7.625 9.5V3.25A1.25 1.25 0 0 1 8.875 2Z',
    cx: 12,
    cy: 6.375,
  },
];

interface StockLogoProps {
  /** Height in pixels. The mark is square, so this is its size. */
  size?: number;
  className?: string;
  /** Accessible name; the mark stands for the app, whose name is translated. */
  label?: string;
}

/** The inventory's mark. Takes its colour from the text colour, as Logo does. */
export function StockLogo({ size = 32, className, label }: StockLogoProps) {
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
      <path d={STOCK_PIECES.map((p) => p.d).join('')} />
    </svg>
  );
}
