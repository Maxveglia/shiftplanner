import { useState, type PointerEvent, type ReactNode } from 'react';
import { rippleBox } from '../../lib/motion/kit';
import { useReducedMotion } from '../../lib/motion/useReducedMotion';

interface Ripple {
  id: number;
  left: number;
  top: number;
  size: number;
}

let nextId = 0;

/**
 * A click that answers where it landed: a circle of the control's own text
 * colour grows from the pointer and fades. Spread `onPointerDown` onto the
 * control, render `ripples` inside it, and give the control `relative
 * overflow-hidden` (and `isolate`, so the ripple stays under its text).
 *
 * Pointer only. A key press has no position to grow from, and the control's
 * own focus ring already answers the keyboard.
 */
export function useRipple<T extends HTMLElement>(): {
  onPointerDown: (e: PointerEvent<T>) => void;
  ripples: ReactNode;
} {
  const reduced = useReducedMotion();
  const [ripples, setRipples] = useState<Ripple[]>([]);

  const onPointerDown = (e: PointerEvent<T>) => {
    if (reduced || e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const r = rippleBox(e.clientX - box.left, e.clientY - box.top, box.width, box.height);
    setRipples((all) => [...all, { id: nextId++, ...r }]);
  };

  const nodes = ripples.map((r) => (
    <span
      key={r.id}
      aria-hidden="true"
      className="m-ripple"
      style={{ left: r.left, top: r.top, width: r.size, height: r.size }}
      onAnimationEnd={() => setRipples((all) => all.filter((x) => x.id !== r.id))}
    />
  ));

  return { onPointerDown, ripples: nodes };
}
