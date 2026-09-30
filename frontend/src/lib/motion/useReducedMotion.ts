import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

// One media query and ONE `change` listener for the whole app, however many
// controls ask. Every button asks (its ripple), every table body, every
// sidebar link, and useSyncExternalStore subscribes once per component: left
// to it, a payroll table with hundreds of buttons would hang hundreds of
// listeners on the same MediaQueryList. So components subscribe to this set,
// and only the set listens to the system.
let query: MediaQueryList | null | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function mediaQuery(): MediaQueryList | null {
  if (query === undefined) {
    query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(QUERY) : null;
  }
  return query;
}

function subscribe(onChange: () => void): () => void {
  const mq = mediaQuery();
  if (!mq) return () => {};
  if (listeners.size === 0) mq.addEventListener('change', notify);
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) mq.removeEventListener('change', notify);
  };
}

function snapshot(): boolean {
  return !!mediaQuery()?.matches;
}

/**
 * Whether the person has asked their system for less motion. CSS answers the
 * same question with `motion-reduce:` and the media block in styles/motion.css;
 * this is for motion started from script (Web Animations, reveals, pointer
 * tracking), which CSS cannot switch off.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
