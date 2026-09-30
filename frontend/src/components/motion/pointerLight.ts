import type { PointerEvent } from 'react';

/**
 * Light under the pointer: an `onPointerMove` for any surface with the
 * `m-light` class, which paints a soft glow of the brand at `--mx`/`--my`.
 * Writes the two properties straight onto the element -- no React state, so
 * a pointer crossing a card re-renders nothing. Touch has no hover to light.
 */
export function trackPointerLight(e: PointerEvent<HTMLElement>): void {
  if (e.pointerType === 'touch') return;
  const el = e.currentTarget;
  const box = el.getBoundingClientRect();
  el.style.setProperty('--mx', `${e.clientX - box.left}px`);
  el.style.setProperty('--my', `${e.clientY - box.top}px`);
}
