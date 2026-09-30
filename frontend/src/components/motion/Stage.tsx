import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { greetingWords } from '../../lib/launcher/motion';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';

// The dark stage: slow washes of colour, the dot grid the brand comes from,
// and both leaning a little towards the pointer. The sign-in and the launcher
// that follows it stand on the same one, so signing in reads as one scene
// changing rather than one page replacing another. Its CSS is the `.launcher*`
// block at the end of index.css; the root it sits in needs the `launcher`
// class, which also paints the ground.

/**
 * The stage's colour and grid. Put it first inside the `launcher` root.
 *
 * The washes drift on a clock that started with the page, not with this
 * component: each one's delay is minus the seconds since the page loaded. The
 * sign-in and the launcher each mount their own backdrop, and without this
 * the colour would jump back to where it starts at the very moment signing in
 * is meant to feel like one scene carrying on.
 */
export function StageBackdrop() {
  const [since] = useState(() =>
    typeof performance !== 'undefined' ? performance.now() / 1000 : 0,
  );
  const drift = (offset: number) => `-${(since + offset).toFixed(2)}s`;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="launcher-aurora absolute inset-0">
        <div
          className="launcher-blob"
          style={{
            width: '48vmax',
            height: '48vmax',
            left: '-14vmax',
            top: '-18vmax',
            '--blob': '14 124 102', // #0e7c66
            animationDelay: drift(0),
          } as CSSProperties}
        />
        <div
          className="launcher-blob"
          style={{
            width: '40vmax',
            height: '40vmax',
            right: '-14vmax',
            top: '6vmax',
            '--blob': '180 88 13', // #b4580d
            opacity: 0.32,
            animationDelay: drift(7),
          } as CSSProperties}
        />
        <div
          className="launcher-blob"
          style={{
            width: '42vmax',
            height: '42vmax',
            left: '18vmax',
            bottom: '-26vmax',
            '--blob': '20 161 132', // #14a184
            opacity: 0.38,
            animationDelay: drift(13),
          } as CSSProperties}
        />
      </div>
      <div className="launcher-grid absolute inset-0" />
    </div>
  );
}

/**
 * An `onPointerMove` for the stage's root: sets `--px`/`--py` (-1..1 across
 * the window), which the colour follows. Once a frame at most, and never for
 * touch, which has no pointer to follow.
 */
export function useStageParallax(): (e: PointerEvent<HTMLElement>) => void {
  const reduced = useReducedMotion();
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (e) => {
    if (reduced || e.pointerType === 'touch') return;
    // Read now: React lets go of currentTarget once the handler returns.
    const el = e.currentTarget;
    const { clientX, clientY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--px', ((clientX / window.innerWidth) * 2 - 1).toFixed(3));
      el.style.setProperty('--py', ((clientY / window.innerHeight) * 2 - 1).toFixed(3));
    });
  };
}

/**
 * A heading that arrives letter by letter out of a blur (`launcher-letter`).
 * Read whole by a screen reader; drawn a letter at a time, grouped by word so
 * a line never breaks inside one. `highlight` colours a run of letters -- the
 * name in the launcher's greeting -- counted in letters, not UTF-16 units.
 */
export function LetterTitle({
  text,
  highlight,
  className,
}: {
  text: string;
  highlight?: { at: number; length: number };
  className?: string;
}) {
  return (
    <h1 className={className}>
      <span className="sr-only">{text}</span>
      {greetingWords(text).map((word, w) => (
        <span key={w} aria-hidden="true">
          {w > 0 && ' '}
          <span className="whitespace-nowrap">
            {word.letters.map(({ ch, i }) => (
              <span
                key={i}
                className={[
                  'launcher-letter',
                  highlight && i >= highlight.at && i < highlight.at + highlight.length
                    ? 'text-brand-300'
                    : '',
                ].join(' ')}
                style={{ '--i': i } as CSSProperties}
              >
                {ch}
              </span>
            ))}
          </span>
        </span>
      ))}
    </h1>
  );
}

/**
 * The stage behind a whole app screen -- the dashboard, the employee's
 * screen, the welcome questions: the launcher's colour and grid, fixed so it
 * stays put while the page scrolls, and quieter (`app-stage`), because here it
 * is the room and not the show. Put it first inside a root with
 * `relative isolate`: it sits under everything in that root and over nothing.
 */
export function AppStage() {
  return (
    <div aria-hidden="true" className="launcher app-stage pointer-events-none fixed inset-0 -z-10">
      <StageBackdrop />
    </div>
  );
}
