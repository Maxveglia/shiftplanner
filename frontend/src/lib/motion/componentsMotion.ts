// The decisions behind the shared components' motion -- buttons, dialogs,
// tables -- kept out of the components so vitest can check them without a
// DOM. The components measure and hand the numbers here; what comes back is
// what they do.

import { staggerDelay } from './kit';

/**
 * Where a dialog is in its life. `closing` is the short stretch after the
 * caller said `open={false}` during which it stays on screen to play its exit;
 * it is gone (`closed`) when that is over.
 */
export type Presence = 'open' | 'closing' | 'closed';

/**
 * The phase a dialog moves to when its `open` prop reads `open`.
 *
 * Opening is immediate from anywhere, including halfway through closing: a
 * dialog reopened mid-exit comes straight back rather than finishing its exit
 * first. Closing goes through `closing` only when there is an exit to play
 * (`exitMs > 0`; zero under reduced motion), otherwise straight to `closed`,
 * which is how it behaved before it moved at all.
 */
export function nextPresence(phase: Presence, open: boolean, exitMs: number): Presence {
  if (open) return 'open';
  if (phase === 'open') return exitMs > 0 ? 'closing' : 'closed';
  return phase;
}

// A caller's own positioning, unprefixed. `md:absolute` does not count: below
// md the button is still in flow, and the responsive rule comes later in the
// stylesheet than `relative` anyway, so it wins where it applies.
const POSITIONED = /(^|\s)(absolute|fixed|sticky)(\s|$)/;
const STATIC = /(^|\s)static(\s|$)/;

/**
 * The classes a button needs to hold its ripple, given the caller's
 * `className`: `relative` so the ripple is placed against it, `overflow-hidden`
 * so it stays inside the rounded corners, `isolate` so it paints under the
 * label. Tailwind orders `.relative` after `.absolute`, so adding `relative` to
 * a button a caller positioned would quietly pull it back into flow -- a
 * caller's `absolute`, `fixed` or `sticky` already makes it a containing block,
 * and then `relative` is left out. A caller who asked for `static` gets no
 * ripple at all (`null`): the ripple would have nothing to be placed against.
 */
export function rippleFrame(className: string): string | null {
  if (STATIC.test(className)) return null;
  return POSITIONED.test(className) ? 'overflow-hidden isolate' : 'relative overflow-hidden isolate';
}

/**
 * Where Tab goes inside an open dialog, so focus cannot wander onto the page
 * the dialog is covering. `current` is the index of the focused element among
 * the dialog's `count` focusable ones, or -1 when focus is on the dialog
 * itself (or somewhere outside it).
 *
 * Returns the index to focus; -1 to keep focus on the dialog (it has nothing
 * else to hold it); or `null` to let the browser take its ordinary step, which
 * already stays inside.
 */
export function wrapFocus(current: number, count: number, backwards: boolean): number | null {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  if (!backwards && current === count - 1) return 0;
  if (backwards && current === 0) return count - 1;
  return null;
}

/**
 * Where Tab goes from something inside a dialog that its list of stops does
 * not know -- a region the browser made focusable because it scrolls (the
 * publish summary's list of changes). `following` is the index of the first
 * stop AFTER the focused element in document order, or -1 if none is. Tab
 * carries on to that stop and Shift+Tab to the one before, wrapping round at
 * either end, instead of jumping back to the first stop every time -- which
 * left the buttons under a long list unreachable forwards.
 */
export function tabFromBetween(following: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (!backwards) return following >= 0 ? following : 0;
  if (following < 0) return count - 1;
  return following === 0 ? count - 1 : following - 1;
}

/**
 * How long each row of a table waits before it arrives, from the rows'
 * rendered heights.
 *
 * Only rows you can see take a place in the queue. A row with no height -- the
 * Employees page keeps a closed drawer row under every person -- rides with
 * the row above it instead of costing a step, or the tenth person would wait
 * as long as the twentieth and a list of ten would look like a list of twenty.
 * Capped by staggerDelay, so a long roster does not queue.
 */
export function rowDelays(heights: number[], step = 30, cap = 8): number[] {
  let seen = -1;
  let last = 0;
  return heights.map((h) => {
    if (h > 2) {
      seen += 1;
      last = staggerDelay(seen, step, cap);
    }
    return last;
  });
}

/**
 * How long, from the first rows appearing, until every one of them has
 * arrived: the longest wait plus one entrance. After that the table stops
 * animating rows, so a row that moves (sorting, dragging) or is added later
 * just appears where it belongs instead of arriving all over again.
 */
export function arrivalWindow(delays: number[], durationMs: number): number {
  return (delays.length ? Math.max(0, ...delays) : 0) + durationMs;
}

/**
 * What a dialog shows while it leaves: the value it was opened for, kept
 * after the caller has let go of it (`next` null), so the exit plays with the
 * content the person was looking at instead of an empty panel.
 */
export function lastShown<T>(prev: T | null, next: T | null): T | null {
  return next ?? prev;
}

/** What decides whether an element can take focus, read off the DOM. */
export interface FocusCandidate {
  /** Still in the document. */
  connected: boolean;
  /** A disabled form control. */
  disabled: boolean;
  /** Its tabIndex: 0 for a button or a link, -1 for what Tab skips. */
  tabIndex: number;
  /** Rendered at all (getClientRects().length > 0): not display:none, not in a hidden panel. */
  rendered: boolean;
  /** Inside an `inert` subtree, such as a dialog on its way out. */
  inert: boolean;
}

/**
 * Whether focus() on this element would actually put focus there. A button
 * can still be on the page and refuse it -- disabled, inside a tab panel that
 * is hidden, inside a dialog that is leaving -- and then focus() does
 * nothing and focus falls to <body>. Where focus goes back to when a dialog
 * closes is chosen with this: the opener if it can take it, otherwise the
 * first element nearest to it that can.
 */
export function canTakeFocus(c: FocusCandidate): boolean {
  // No tabIndex test here: whatever held focus before a dialog opened took it
  // somehow, and a panel given it by script (tabIndex -1, like the dialog or
  // the assistant underneath a second one) takes it back just as well.
  return c.connected && !c.disabled && !c.inert && c.rendered;
}

/**
 * Whether Tab reaches this element: it can take focus and is in the tab
 * order. What a dialog cycles through, and where focus lands when the opener
 * is gone and the nearest thing that a keyboard user could reach is picked.
 */
export function inTabOrder(c: FocusCandidate): boolean {
  return canTakeFocus(c) && c.tabIndex >= 0;
}
