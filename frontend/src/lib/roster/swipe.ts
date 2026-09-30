// Pulling a row down to uncover what is under it.
//
// The arithmetic of the gesture lives here, away from React and away from the
// DOM, for the usual reason in this codebase: a rule that can only be exercised
// by moving a real finger over a real table is a rule nobody exercises. What
// the component keeps is the plumbing — pointer capture, one piece of state —
// and every decision it makes comes from a function below.
//
// Three decisions, and they are not the same decision:
//
//   offsetFor   how far the row has actually moved while the finger is down.
//               Downwards only, and it slows to a stop past the threshold, so
//               the row cannot be dragged off into the page.
//   settle      whether letting go leaves the drawer open.
//   isDrag      whether this pointer sequence was a drag at all. The row is
//               also a link to the person's file, so a gesture that moved has
//               to swallow the click it would otherwise fire — opening the file
//               of somebody you were about to remove is the one outcome worse
//               than nothing happening.
//
// What was discarded: an X-axis swipe (the phone convention, and the one that
// does not fight the scroller) because the manager asked for down; and a
// long-press, which is invisible until it fires and adds a delay to a gesture
// that should feel immediate.

/** How far down the row has to be pulled before letting go opens the drawer. */
export const REVEAL_THRESHOLD_PX = 28;

/** Hard stop on the travel, so the row never separates from its neighbours. */
export const MAX_TRAVEL_PX = 44;

/**
 * Movement under which a pointer sequence is a click, not a drag.
 *
 * A finger resting on a row wanders a few pixels; a mouse does not move at all.
 * Below this the row behaves exactly as it did before the gesture existed.
 */
export const DRAG_SLOP_PX = 5;

/**
 * How far the row is drawn from its resting place, given the raw finger travel.
 *
 * Upward movement is nothing: this drawer is under the row, so there is nothing
 * above to uncover, and letting the row ride up would only make the table
 * shimmer while somebody scrolls. Past the threshold the remaining travel is
 * halved, which is the whole of the "rubber band" — enough that the row keeps
 * answering the finger, not enough to suggest there is more to find.
 */
export function offsetFor(dy: number): number {
  if (dy <= 0) return 0;
  if (dy <= REVEAL_THRESHOLD_PX) return dy;
  const extra = (dy - REVEAL_THRESHOLD_PX) / 2;
  return Math.min(REVEAL_THRESHOLD_PX + extra, MAX_TRAVEL_PX);
}

/** Does letting go here leave the drawer open? */
export function settle(dy: number): boolean {
  return dy >= REVEAL_THRESHOLD_PX;
}

/**
 * Was this a drag, and therefore not a click?
 *
 * Distance in ANY direction counts, including up and sideways. A gesture that
 * wandered and came back is still not somebody tapping a row, and the cost of
 * being wrong in this direction (a click that does nothing) is far below the
 * cost of the other (a navigation nobody asked for).
 */
export function isDrag(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_SLOP_PX || Math.abs(dy) > DRAG_SLOP_PX;
}

/**
 * Is this pointer sequence going sideways rather than down?
 *
 * The employees table scrolls horizontally on a narrow screen. When the finger
 * commits to that axis the drawer must let go of the gesture entirely, rather
 * than half-opening under a row somebody is only trying to look at.
 */
export function isHorizontal(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > DRAG_SLOP_PX;
}
