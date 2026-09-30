import { describe, expect, it } from 'vitest';
import {
  DRAG_SLOP_PX,
  MAX_TRAVEL_PX,
  REVEAL_THRESHOLD_PX,
  isDrag,
  isHorizontal,
  offsetFor,
  settle,
} from './swipe';

describe('offsetFor', () => {
  it('ignores upward movement — there is nothing above the row to uncover', () => {
    expect(offsetFor(-40)).toBe(0);
    expect(offsetFor(-1)).toBe(0);
    expect(offsetFor(0)).toBe(0);
  });

  it('follows the finger exactly until the drawer is open', () => {
    expect(offsetFor(1)).toBe(1);
    expect(offsetFor(REVEAL_THRESHOLD_PX)).toBe(REVEAL_THRESHOLD_PX);
  });

  it('resists past the threshold instead of letting the row run away', () => {
    const past = offsetFor(REVEAL_THRESHOLD_PX + 10);
    expect(past).toBeGreaterThan(REVEAL_THRESHOLD_PX);
    expect(past).toBeLessThan(REVEAL_THRESHOLD_PX + 10);
  });

  it('never moves the row further than one drawer', () => {
    expect(offsetFor(10_000)).toBe(MAX_TRAVEL_PX);
  });
});

describe('settle', () => {
  it('leaves the drawer open only once the row was pulled far enough', () => {
    expect(settle(REVEAL_THRESHOLD_PX - 1)).toBe(false);
    expect(settle(REVEAL_THRESHOLD_PX)).toBe(true);
  });

  it('reads the raw travel, not the resisted offset', () => {
    // Otherwise the rubber band would decide the outcome: past the threshold
    // the offset stops growing, and a gesture the manager pulled hard on would
    // settle the same as one that barely crossed.
    expect(settle(200)).toBe(true);
  });
});

describe('isDrag', () => {
  it('lets a still pointer be a click, so the row still opens the file', () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(DRAG_SLOP_PX, DRAG_SLOP_PX)).toBe(false);
  });

  it('counts a gesture that moved at all, in any direction', () => {
    expect(isDrag(0, DRAG_SLOP_PX + 1)).toBe(true);
    expect(isDrag(0, -(DRAG_SLOP_PX + 1))).toBe(true);
    expect(isDrag(DRAG_SLOP_PX + 1, 0)).toBe(true);
  });
});

describe('isHorizontal', () => {
  it('gives the gesture back to the table when it goes sideways', () => {
    expect(isHorizontal(30, 4)).toBe(true);
  });

  it('keeps a downward pull even when the finger drifts', () => {
    expect(isHorizontal(6, 30)).toBe(false);
  });

  it('is not tripped by the jitter of a finger settling', () => {
    expect(isHorizontal(DRAG_SLOP_PX, 0)).toBe(false);
  });
});
