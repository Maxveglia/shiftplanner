// The one celebration in the calendar: the rota has reached the team.
//
// Publishing is the handover, the moment a month of work stops being the
// manager's draft, and it deserves more than a dialog changing its title. So
// the brand's own mark comes apart: the five pieces of the rejilla, a few of
// each, are thrown up from the button that was pressed and fall away. About a
// second, once per publish, and gone.
//
// Decoration only: hidden from assistive tech (the dialog says what happened
// in words), deaf to the pointer, and not drawn at all for anyone who has
// asked their system for less motion. Portalled to <body> so no transformed
// ancestor can become its frame, and above the dialog it celebrates.

import { useEffect, useMemo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { REJILLA_PIECES } from '../Logo';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';
import { burstLength, burstPieces, type Point } from './calendarMotion';

/** The brand, lighter, lightest: menta, menta-light, menta-soft's stronger step. */
const TONES = ['#0e7c66', '#44d6b4', '#a9e7d7'] as const;

/** Three of each piece of the mark. */
const COUNT = 15;

export function PublishBurst({ at, onDone }: { at: Point; onDone: () => void }) {
  const reduced = useReducedMotion();
  const pieces = useMemo(() => burstPieces(COUNT), []);

  useEffect(() => {
    // Nothing to wait for when nothing is drawn.
    const id = window.setTimeout(onDone, reduced ? 0 : burstLength(pieces) + 80);
    return () => window.clearTimeout(id);
    // `onDone` is a fresh closure on every render of the page; the burst
    // runs once, for as long as it lasts, whatever the page does meanwhile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, pieces]);

  if (reduced || typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-hidden="true"
      className="cal-burst pointer-events-none fixed z-[60]"
      style={{ left: at.x, top: at.y }}
    >
      {pieces.map((p, i) => {
        const shape = REJILLA_PIECES[p.piece];
        return (
          <svg
            key={i}
            // A box round the piece's own centre, so it turns about itself.
            viewBox={`${shape.cx - 6.5} ${shape.cy - 6.5} 13 13`}
            className="cal-burst-piece"
            style={
              {
                width: p.size,
                height: p.size,
                marginLeft: -p.size / 2,
                marginTop: -p.size / 2,
                color: TONES[p.tone],
                '--x1': `${p.x1}px`,
                '--y1': `${p.y1}px`,
                '--x2': `${p.x2}px`,
                '--y2': `${p.y2}px`,
                '--r': `${p.rotate}deg`,
                '--dur': `${p.duration}ms`,
                '--delay': `${p.delay}ms`,
              } as CSSProperties
            }
          >
            <path d={shape.d} fill="currentColor" />
          </svg>
        );
      })}
    </div>,
    document.body,
  );
}
