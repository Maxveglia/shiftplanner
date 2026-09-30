import { describe, expect, it } from 'vitest';
import { indicatorBox, rippleBox, staggerDelay } from './kit';

describe('staggerDelay', () => {
  it('waits one step per place in the list', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBe(40);
    expect(staggerDelay(3, 50)).toBe(150);
  });

  it('stops growing past the cap, so a long list is not a queue', () => {
    expect(staggerDelay(8)).toBe(320);
    expect(staggerDelay(40)).toBe(320);
    expect(staggerDelay(40, 30, 5)).toBe(150);
  });

  it('treats nonsense as the first item', () => {
    expect(staggerDelay(-2)).toBe(0);
    expect(staggerDelay(Number.NaN)).toBe(0);
  });
});

describe('rippleBox', () => {
  it('centres the circle on the click and reaches the farthest corner', () => {
    // A click at the left edge of a 100x40 button: the far corner is the
    // top-right or bottom-right one, hypot(100, 20).
    const r = Math.ceil(Math.hypot(100, 20));
    expect(rippleBox(0, 20, 100, 40)).toEqual({ left: -r, top: 20 - r, size: 2 * r });
  });

  it('is symmetric for a click in the middle', () => {
    const box = rippleBox(50, 20, 100, 40);
    expect(box.left + box.size / 2).toBe(50);
    expect(box.top + box.size / 2).toBe(20);
  });
});

describe('indicatorBox', () => {
  it('places the indicator over the item, inside the container', () => {
    expect(
      indicatorBox({ left: 130, top: 260, width: 200, height: 36 }, { left: 100, top: 200 }),
    ).toEqual({ x: 30, y: 60, width: 200, height: 36 });
  });

  it('adds what the container has scrolled', () => {
    expect(
      indicatorBox(
        { left: 130, top: 60, width: 200, height: 36 },
        { left: 100, top: 200 },
        { left: 0, top: 300 },
      ),
    ).toEqual({ x: 30, y: 160, width: 200, height: 36 });
  });
});
