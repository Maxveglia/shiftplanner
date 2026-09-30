// The arithmetic of the app's motion, shared by every screen that moves.
//
// The launcher set the language -- things arrive one after another, a click
// answers where it landed, light follows the pointer -- and the rest of the
// app speaks it with these helpers and the `.m-*` classes in styles/motion.css.
// Pure on purpose: vitest runs without a DOM, so the numbers are tested here
// and the look is checked on screen.

import { coverRadius } from '../launcher/motion';

/**
 * How long item `index` of a list waits before it arrives, in milliseconds.
 *
 * Capped, because a stagger is a way of showing order, not a queue: the
 * fortieth employee in a roster must not wait two seconds to appear. Past
 * `cap` items everything arrives together with the last staggered one.
 */
export function staggerDelay(index: number, step = 40, cap = 8): number {
  if (!(index > 0)) return 0;
  return Math.min(Math.floor(index), cap) * step;
}

/**
 * Where a ripple goes and how big it grows, for a click at (x, y) inside a
 * box of `width` x `height`: a circle centred on the click whose radius
 * reaches the box's farthest corner, so it fills the control wherever the
 * click landed. Returned as the square the circle is drawn in.
 */
export function rippleBox(
  x: number,
  y: number,
  width: number,
  height: number,
): { left: number; top: number; size: number } {
  const r = coverRadius(x, y, width, height);
  return { left: x - r, top: y - r, size: r * 2 };
}

/**
 * The box an indicator slides to so it sits exactly on `item`, relative to
 * `container` (both as from getBoundingClientRect). Used by the pills that
 * glide between the sidebar's links and between tabs, instead of the active
 * one just changing colour.
 */
export function indicatorBox(
  item: { left: number; top: number; width: number; height: number },
  container: { left: number; top: number },
  scroll: { left: number; top: number } = { left: 0, top: 0 },
): { x: number; y: number; width: number; height: number } {
  return {
    x: item.left - container.left + scroll.left,
    y: item.top - container.top + scroll.top,
    width: item.width,
    height: item.height,
  };
}
