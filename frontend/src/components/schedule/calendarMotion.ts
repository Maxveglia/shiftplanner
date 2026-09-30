// The arithmetic behind the calendar's movement: which tab an arrow key
// reaches, when each month of the year arrives, where an opened day grows
// from and goes back to, and the flight of the pieces a publish throws up.
//
// Pure, like dayTrack.ts next to it: vitest runs without a DOM, so the
// numbers are tested here and the look is checked on screen. The components
// measure rectangles and hand them in; nothing here touches the page.

import { coverRadius } from '../../lib/launcher/motion';
import { staggerDelay } from '../../lib/motion/kit';

export interface Point {
  x: number;
  y: number;
}

// --- Tabs ------------------------------------------------------------------

/**
 * Which tab an arrow key selects in a HORIZONTAL tablist, per the WAI-ARIA
 * pattern: left and right wrap round at either end, Home and End jump to the
 * first and last, and every other key -- up and down included, which scroll
 * the page in a row of tabs -- is not the tablist's (`null`).
 *
 * Not `nextTile` from the launcher: its tiles stack into a column on a phone,
 * so up and down move there too, and here they must not.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  // A focus the list does not recognise counts as the first tab: the arrow
  // still lands somewhere sensible instead of doing nothing.
  const at = Number.isInteger(current) && current >= 0 && current < count ? current : 0;
  switch (key) {
    case 'ArrowRight':
      return (at + 1) % count;
    case 'ArrowLeft':
      return (at - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Which way the new panel comes in: from the right when the pill moved right,
 * from the left when it moved left, so the panel follows the eye. Zero when
 * nothing moved (or an index is unknown).
 */
export function tabDirection(from: number, to: number): -1 | 0 | 1 {
  if (from < 0 || to < 0 || from === to) return 0;
  return to > from ? 1 : -1;
}

// --- The year ----------------------------------------------------------------

/**
 * When month `month` (0 = January) arrives as the year comes on screen.
 * Twelve steps of 28 ms: January is there at once, December a third of a
 * second later -- the order reads, and nobody waits for it.
 */
export function monthDelay(month: number): number {
  return staggerDelay(month, 28, 11);
}

// --- Opening a day -------------------------------------------------------------

/**
 * Where a day was opened from: the circle pressed in the year, as it sat on
 * screen at that moment.
 */
export interface DayOrigin {
  date: string;
  at: Point;
}

/**
 * How a day put on screen should arrive.
 *
 * - `grow`: out of the circle that was pressed in the year, as the launcher's
 *   reveal grows out of the icon.
 * - `step`: from the side it was stepped to, like turning a page.
 * - `rise`: anything else -- a reload, a generation landing on its first day.
 *
 * Every entrance names its date, so one left over from an earlier day can
 * never be played on a different one.
 */
export type DayEntrance =
  | { kind: 'grow'; date: string; at: Point }
  | { kind: 'step'; date: string; dir: -1 | 1 }
  | { kind: 'rise'; date: string };

/** The entrance for `date`: the one given if it was meant for it, else `rise`. */
export function entranceFor(date: string, entrance: DayEntrance | null | undefined): DayEntrance {
  return entrance && entrance.date === date ? entrance : { kind: 'rise', date };
}

/**
 * Where a day being closed goes back to: the circle it was opened from, which
 * the year will put back in the same place on screen (`returnScroll`). Null
 * for any other day -- stepped past, or opened some other way -- because then
 * there is no circle the eye knows to aim at.
 */
export function exitPoint(date: string, origin: DayOrigin | null | undefined): Point | null {
  return origin && origin.date === date ? origin.at : null;
}

/**
 * How far to scroll so that the day just closed sits where the manager last
 * saw it: at `wantedY` on screen (the height it was pressed at) or, for a day
 * they only stepped to, in the middle. `centreY` is where the day's circle is
 * now. Zero when it is already there, to the pixel.
 */
export function returnScroll(centreY: number, viewportHeight: number, wantedY: number | null): number {
  const target = wantedY ?? viewportHeight / 2;
  return Math.round(centreY - target);
}

export interface Reveal {
  /** Centre of the circle, relative to the box's top-left corner. */
  x: number;
  y: number;
  /** Radius it starts from: the size of the day's own circle. */
  from: number;
  /** Radius that covers the whole box from that centre, and no more. */
  to: number;
}

/**
 * The circle a day grows out of (and shrinks back into), for a point on
 * screen and the box the day occupies (both in viewport pixels).
 *
 * The centre is clamped into the box: a day pressed low in December can sit
 * below where the shorter day view ends, and a circle growing from outside
 * the box would spend half its time invisible.
 */
export function revealFrom(
  point: Point,
  box: { left: number; top: number; width: number; height: number },
  startRadius = 14,
): Reveal {
  const width = Math.max(0, box.width);
  const height = Math.max(0, box.height);
  const x = Math.round(clamp(point.x - box.left, 0, width));
  const y = Math.round(clamp(point.y - box.top, 0, height));
  const from = Math.max(0, startRadius);
  return { x, y, from, to: Math.max(from, coverRadius(x, y, width, height)) };
}

// --- Publishing ------------------------------------------------------------------

/**
 * One piece of the mark thrown up by a publish: which piece (an index into
 * REJILLA_PIECES), where it peaks and where it ends relative to the button,
 * how far it turns, and when.
 */
export interface BurstPiece {
  piece: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  rotate: number;
  delay: number;
  duration: number;
  size: number;
  /** Which of the burst's tones: 0 the brand, 1 lighter, 2 lightest. */
  tone: 0 | 1 | 2;
}

/**
 * The flight of `count` pieces from a button: fanned out upwards across
 * 150 degrees so they read as thrown, not dropped, then falling further than
 * they rose. Seeded, so the same publish looks the same every time and a
 * test can hold it still.
 */
export function burstPieces(count: number, seed = 7): BurstPiece[] {
  const n = Math.max(0, Math.floor(count));
  const rand = mulberry32(seed);
  const pieces: BurstPiece[] = [];
  for (let i = 0; i < n; i += 1) {
    // Evenly across the fan, each nudged a little so it is not a comb.
    const along = n === 1 ? 0.5 : (i + 0.5) / n;
    const deg = -165 + 150 * along + (rand() - 0.5) * 12;
    const a = (deg * Math.PI) / 180;
    const reach = 70 + rand() * 80;
    const x1 = Math.cos(a) * reach;
    const y1 = Math.sin(a) * reach;
    const fall = 110 + rand() * 110;
    const spin = (180 + rand() * 360) * (rand() < 0.5 ? -1 : 1);
    pieces.push({
      piece: i % 5,
      x1: round1(x1),
      y1: round1(y1),
      x2: round1(x1 * 1.4),
      y2: round1(y1 + fall),
      rotate: Math.round(spin),
      delay: Math.round(rand() * 80),
      duration: Math.round(900 + rand() * 350),
      size: Math.round(12 + rand() * 8),
      tone: (i % 3) as 0 | 1 | 2,
    });
  }
  return pieces;
}

/** How long a burst lasts: until its last piece has landed. */
export function burstLength(pieces: BurstPiece[]): number {
  return pieces.reduce((m, p) => Math.max(m, p.delay + p.duration), 0);
}

// --- Replaying an entrance ----------------------------------------------------------

const keys = new WeakMap<object, number>();
let lastKey = 0;

/**
 * A number that changes when, and only when, `value` is a different object.
 * Used as a React key so a note that is replaced by a new one of the same
 * kind -- the summary of the next change -- arrives again instead of just
 * swapping its words.
 */
export function identityKey(value: object): number {
  let k = keys.get(value);
  if (k === undefined) {
    lastKey += 1;
    k = lastKey;
    keys.set(value, k);
  }
  return k;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10 + 0;
}

/** A small seeded generator, so a burst is the same every time. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
