import type { CSSProperties } from 'react';
import type { MarkPiece } from '../Logo';

/**
 * A mark drawn piece by piece, each piece free to move on its own.
 *
 * The movement is the class's (`pieceClassName`): the launcher's pieces fly in
 * late and far (`launcher-piece`), the sidebar's settle in quickly and close
 * (`m-piece`). Each piece carries `--j`, its place in the mark, and
 * `--dx`/`--dy`, the direction from the mark's centre to its own, in the
 * 24-unit box -- which is all a class needs to send it in from its own side
 * and part it a little on hover. `--t` staggers one mark after another.
 */
export function AnimatedMark({
  pieces,
  pieceClassName,
  order = 0,
  className,
}: {
  pieces: MarkPiece[];
  pieceClassName: string;
  /** Which mark this is on the screen, for staggering several. */
  order?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {pieces.map((p, j) => (
        <path
          key={j}
          d={p.d}
          className={pieceClassName}
          style={
            {
              '--t': order,
              '--j': j,
              '--dx': p.cx - 12,
              '--dy': p.cy - 12,
            } as CSSProperties
          }
        />
      ))}
    </svg>
  );
}
