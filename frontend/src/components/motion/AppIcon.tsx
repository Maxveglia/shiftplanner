import type { MarkPiece } from '../Logo';
import { AnimatedMark } from './AnimatedMark';

/**
 * An app's icon on the dark stage: its mark in white on a rounded square of
 * its colour, lit from the top, with a glow of the same colour under it. The
 * mark assembles from its pieces (`launcher-piece`) as the icon arrives.
 *
 * Size it with `className` (`h-20 w-20`, …). `data-icon` is where the
 * launcher's reveal grows from.
 */
export function AppIcon({
  pieces,
  face,
  order = 0,
  className = '',
}: {
  pieces: MarkPiece[];
  /** The face's colour, from its top-left corner to its bottom-right. */
  face: [string, string];
  /** Which icon this is on the screen, to stagger their marks. */
  order?: number;
  className?: string;
}) {
  const background = `linear-gradient(145deg, ${face[0]}, ${face[1]})`;
  return (
    <span data-icon className={['launcher-icon relative block shrink-0', className].join(' ')}>
      <span
        aria-hidden="true"
        className="launcher-icon-glow absolute inset-0 rounded-[28%]"
        style={{ background }}
      />
      <span
        className="relative grid h-full w-full place-items-center overflow-hidden rounded-[28%] shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]"
        style={{ background }}
      >
        <AnimatedMark
          pieces={pieces}
          pieceClassName="launcher-piece"
          order={order}
          className="h-[56%] w-[56%] text-white drop-shadow-[0_2px_6px_rgb(0_0_0/0.25)]"
        />
        {/* Light catching the top of the icon. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent"
        />
      </span>
    </span>
  );
}
