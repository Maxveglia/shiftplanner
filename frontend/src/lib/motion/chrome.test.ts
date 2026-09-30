import { describe, expect, it } from 'vitest';
import { pageEntrance, sectionOf, springEasing, stretchFor } from './chrome';

/** The sampled values of a `linear(...)` easing. */
function points(easing: string): number[] {
  const inner = /^linear\((.*)\)$/.exec(easing)?.[1] ?? '';
  return inner.split(',').map((v) => Number(v.trim()));
}

describe('springEasing', () => {
  it('runs from rest at 0 to rest at 1', () => {
    const { easing } = springEasing();
    const v = points(easing);
    expect(v[0]).toBe(0);
    expect(v[v.length - 1]).toBe(1);
    expect(v.every(Number.isFinite)).toBe(true);
  });

  it('swings past the target a little and settles in about half a second', () => {
    const { easing, duration } = springEasing();
    const peak = Math.max(...points(easing));
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.08);
    expect(duration).toBeGreaterThan(300);
    expect(duration).toBeLessThan(700);
  });

  it('never overshoots when critically damped or more', () => {
    // Critical damping for k=380, m=1 is 2 * sqrt(380) ~ 39.
    for (const damping of [2 * Math.sqrt(380), 60]) {
      const v = points(springEasing({ damping }).easing);
      expect(Math.max(...v)).toBeLessThanOrEqual(1);
      for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]);
    }
  });

  it('caps a spring with almost no damping instead of animating forever', () => {
    expect(springEasing({ damping: 0.5 }).duration).toBeLessThanOrEqual(2001);
  });

  it('samples as many points as asked, ends included', () => {
    expect(points(springEasing({ points: 10 }).easing)).toHaveLength(11);
  });
});

describe('stretchFor', () => {
  it('leaves a pill that does not move alone', () => {
    expect(stretchFor(0, 36)).toBe(1);
  });

  it('stretches with the distance, the same either way', () => {
    expect(stretchFor(36, 36)).toBeGreaterThan(1);
    expect(stretchFor(72, 36)).toBeGreaterThan(stretchFor(36, 36));
    expect(stretchFor(-72, 36)).toBe(stretchFor(72, 36));
  });

  it('stops growing past three links, at a quarter of the height', () => {
    expect(stretchFor(108, 36)).toBe(1.25);
    expect(stretchFor(1000, 36)).toBe(1.25);
  });

  it('treats a pill with no height, or nonsense, as not moving', () => {
    expect(stretchFor(50, 0)).toBe(1);
    expect(stretchFor(Number.NaN, 36)).toBe(1);
  });
});

const SHIFTS = ['/', '/employees', '/absences', '/notes', '/colours', '/settings'];
const INVENTORY = ['/inventory', '/inventory/count', '/inventory/counts'];
const ALL = [...SHIFTS, ...INVENTORY];

describe('sectionOf', () => {
  it('matches the dashboard only on itself', () => {
    expect(sectionOf('/', SHIFTS)).toBe('/');
    expect(sectionOf('/whatever', SHIFTS)).toBeNull();
  });

  it('matches a detail to the list it hangs from', () => {
    expect(sectionOf('/employees/42', SHIFTS)).toBe('/employees');
    expect(sectionOf('/inventory/counts/7', INVENTORY)).toBe('/inventory/counts');
  });

  it('prefers the longest link, and does not take a prefix of a word', () => {
    expect(sectionOf('/inventory/count', INVENTORY)).toBe('/inventory/count');
    expect(sectionOf('/inventory/counts', INVENTORY)).toBe('/inventory/counts');
    expect(sectionOf('/employeesX', SHIFTS)).toBeNull();
  });

  it('ignores a trailing slash', () => {
    expect(sectionOf('/employees/', SHIFTS)).toBe('/employees');
  });
});

describe('pageEntrance', () => {
  it('does nothing when the path did not change', () => {
    expect(pageEntrance('/employees', '/employees', ALL)).toBeNull();
    expect(pageEntrance('/employees/', '/employees', ALL)).toBeNull();
  });

  it('rises on a first load', () => {
    expect(pageEntrance(null, '/employees', ALL)).toEqual({ x: 0, y: 10 });
  });

  it('comes from below going down the sidebar, from above going up', () => {
    expect(pageEntrance('/', '/absences', ALL)).toEqual({ x: 0, y: 10 });
    expect(pageEntrance('/settings', '/employees', ALL)).toEqual({ x: 0, y: -10 });
    expect(pageEntrance('/inventory', '/inventory/counts', ALL)).toEqual({ x: 0, y: 10 });
  });

  it('slides in from the right into a detail, from the left back out', () => {
    expect(pageEntrance('/employees', '/employees/5', ALL)).toEqual({ x: 15, y: 0 });
    expect(pageEntrance('/employees/5', '/employees', ALL)).toEqual({ x: -15, y: 0 });
    expect(pageEntrance('/inventory/counts', '/inventory/counts/3', ALL)).toEqual({ x: 15, y: 0 });
  });

  it('treats a detail reached from another section as a move between sections', () => {
    expect(pageEntrance('/', '/employees/5', ALL)).toEqual({ x: 0, y: 10 });
    expect(pageEntrance('/employees/5', '/', ALL)).toEqual({ x: 0, y: -10 });
  });

  it('rises from one detail to another, and for paths the sidebar does not know', () => {
    expect(pageEntrance('/employees/5', '/employees/6', ALL)).toEqual({ x: 0, y: 10 });
    expect(pageEntrance('/employees', '/somewhere', ALL)).toEqual({ x: 0, y: 10 });
  });

  it('scales with the distance asked for', () => {
    expect(pageEntrance('/settings', '/', ALL, 6)).toEqual({ x: 0, y: -6 });
  });
});
