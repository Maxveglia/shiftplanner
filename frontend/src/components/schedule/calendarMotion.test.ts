// The calendar's movement, as numbers. What it looks like is checked on
// screen; what is pinned here is what would be wrong in a way nobody sees at
// a glance -- an arrow key that skips a tab, a day that grows from the wrong
// place, a burst that never ends.

import { describe, expect, it } from 'vitest';
import {
  burstLength,
  burstPieces,
  entranceFor,
  exitPoint,
  identityKey,
  monthDelay,
  nextTabIndex,
  revealFrom,
  tabDirection,
  returnScroll,
  type DayEntrance,
  type DayOrigin,
} from './calendarMotion';

describe('nextTabIndex', () => {
  it('moves right and left, wrapping round at both ends', () => {
    expect(nextTabIndex(0, 'ArrowRight', 3)).toBe(1);
    expect(nextTabIndex(2, 'ArrowRight', 3)).toBe(0);
    expect(nextTabIndex(1, 'ArrowLeft', 3)).toBe(0);
    expect(nextTabIndex(0, 'ArrowLeft', 3)).toBe(2);
  });

  it('jumps to the first and the last with Home and End', () => {
    expect(nextTabIndex(1, 'Home', 3)).toBe(0);
    expect(nextTabIndex(1, 'End', 3)).toBe(2);
  });

  it('leaves up, down and every other key to the page', () => {
    expect(nextTabIndex(1, 'ArrowUp', 3)).toBeNull();
    expect(nextTabIndex(1, 'ArrowDown', 3)).toBeNull();
    expect(nextTabIndex(1, 'Tab', 3)).toBeNull();
    expect(nextTabIndex(1, 'Enter', 3)).toBeNull();
  });

  it('treats an unknown position as the first tab, and no tabs as nothing to do', () => {
    expect(nextTabIndex(-1, 'ArrowRight', 3)).toBe(1);
    expect(nextTabIndex(7, 'ArrowLeft', 3)).toBe(2);
    expect(nextTabIndex(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('tabDirection', () => {
  it('follows the pill', () => {
    expect(tabDirection(0, 2)).toBe(1);
    expect(tabDirection(2, 1)).toBe(-1);
    expect(tabDirection(1, 1)).toBe(0);
    expect(tabDirection(-1, 1)).toBe(0);
  });
});

describe('monthDelay', () => {
  it('brings January at once and December last, inside half a second', () => {
    expect(monthDelay(0)).toBe(0);
    const all = Array.from({ length: 12 }, (_, m) => monthDelay(m));
    expect([...all].sort((a, b) => a - b)).toEqual(all);
    expect(new Set(all).size).toBe(12);
    expect(monthDelay(11)).toBeLessThan(500);
  });
});

describe('revealFrom', () => {
  const box = { left: 100, top: 50, width: 400, height: 300 };

  it('centres the circle on the pressed point, measured from the box', () => {
    const r = revealFrom({ x: 150, y: 80 }, box);
    expect(r).toMatchObject({ x: 50, y: 30, from: 14 });
  });

  it('grows exactly far enough to cover the farthest corner', () => {
    const r = revealFrom({ x: 150, y: 80 }, box);
    expect(r.to).toBe(Math.ceil(Math.hypot(350, 270)));
    const middle = revealFrom({ x: 300, y: 200 }, box);
    expect(middle.to).toBe(Math.ceil(Math.hypot(200, 150)));
  });

  it('keeps a point outside the box on its edge, so the growth is seen', () => {
    // A day pressed low in December, below where the shorter day view ends.
    const r = revealFrom({ x: 900, y: 1200 }, box);
    expect(r.x).toBe(400);
    expect(r.y).toBe(300);
    expect(r.to).toBe(Math.ceil(Math.hypot(400, 300)));
  });

  it('never ends smaller than it starts, even on an empty box', () => {
    const r = revealFrom({ x: 0, y: 0 }, { left: 0, top: 0, width: 0, height: 0 });
    expect(r.to).toBeGreaterThanOrEqual(r.from);
  });
});

describe('entranceFor and exitPoint', () => {
  const grown: DayEntrance = { kind: 'grow', date: '2026-10-15', at: { x: 320, y: 610 } };
  const origin: DayOrigin = { date: '2026-10-15', at: { x: 320, y: 610 } };

  it('plays an entrance only on the day it was meant for', () => {
    expect(entranceFor('2026-10-15', grown)).toBe(grown);
    // A generation landing on its first day, with a grow left over from before.
    expect(entranceFor('2026-11-01', grown)).toEqual({ kind: 'rise', date: '2026-11-01' });
    expect(entranceFor('2026-11-01', null)).toEqual({ kind: 'rise', date: '2026-11-01' });
  });

  it('goes back to the circle it was opened from, even after stepping away and back', () => {
    expect(exitPoint('2026-10-15', origin)).toEqual({ x: 320, y: 610 });
  });

  it('has nowhere to go back to on a day that was only stepped to', () => {
    expect(exitPoint('2026-10-16', origin)).toBeNull();
    expect(exitPoint('2026-10-16', null)).toBeNull();
  });
});

describe('returnScroll', () => {
  it('puts the day back at the height it was pressed at', () => {
    // The circle is now at 90 px (the page came back scrolled to the top);
    // it was pressed at 610.
    expect(returnScroll(90, 900, 610)).toBe(-520);
    expect(returnScroll(1450, 900, 610)).toBe(840);
    expect(returnScroll(610, 900, 610)).toBe(0);
  });

  it('centres a day that was only stepped to', () => {
    expect(returnScroll(1450, 900, null)).toBe(1000);
  });
});

describe('burstPieces', () => {
  const pieces = burstPieces(15);

  it('throws as many pieces as asked, cycling through the five of the mark', () => {
    expect(pieces).toHaveLength(15);
    expect(new Set(pieces.map((p) => p.piece))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(burstPieces(0)).toEqual([]);
  });

  it('is the same burst every time for the same seed', () => {
    expect(burstPieces(15)).toEqual(pieces);
    expect(burstPieces(15, 99)).not.toEqual(pieces);
  });

  it('sends every piece up first and then down past where it peaked', () => {
    for (const p of pieces) {
      expect(p.y1).toBeLessThan(0);
      expect(p.y2).toBeGreaterThan(p.y1 + 100);
    }
  });

  it('fans out to both sides rather than all one way', () => {
    expect(pieces.some((p) => p.x1 < -20)).toBe(true);
    expect(pieces.some((p) => p.x1 > 20)).toBe(true);
  });

  it('is brief: every piece has landed within a second and a half', () => {
    expect(burstLength(pieces)).toBeGreaterThan(0);
    expect(burstLength(pieces)).toBeLessThanOrEqual(1500);
    expect(burstLength([])).toBe(0);
  });
});

describe('identityKey', () => {
  it('is stable for one object and different for another', () => {
    const a = { diff: 1 };
    const b = { diff: 1 };
    expect(identityKey(a)).toBe(identityKey(a));
    expect(identityKey(a)).not.toBe(identityKey(b));
  });
});
