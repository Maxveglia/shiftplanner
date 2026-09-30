import { describe, expect, it } from 'vitest';
import { dayTickIndices, edgeAlign, peakIndex, shareOfMax, stepIndex, weekdayFigures } from './chart';
import { daysBetween } from './period';

describe('peakIndex', () => {
  it('is the first bar at the maximum', () => {
    expect(peakIndex([3, 9, 2, 9])).toBe(1);
  });

  it('is -1 when nothing was sold', () => {
    expect(peakIndex([0, 0, 0])).toBe(-1);
    expect(peakIndex([])).toBe(-1);
  });
});

describe('dayTickIndices', () => {
  it('labels every day of a week', () => {
    expect(dayTickIndices(daysBetween('2026-09-21', '2026-09-27'))).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('labels the Mondays of a month', () => {
    // 29 Aug (Saturday) to 27 Sep: the Mondays are 31 Aug, 7, 14 and 21 Sep.
    const days = daysBetween('2026-08-29', '2026-09-27');
    expect(dayTickIndices(days).map((i) => days[i])).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
  });

  it('labels every other Monday of a quarter, seven at most', () => {
    const days = daysBetween('2026-06-30', '2026-09-27');
    const ticks = dayTickIndices(days);
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(days[ticks[0]]).toBe('2026-07-06');
    expect(days[ticks[1]]).toBe('2026-07-20');
  });
});

describe('stepIndex', () => {
  it('moves one bar with the arrows and stops at the ends', () => {
    expect(stepIndex(5, 'ArrowLeft', 30)).toBe(4);
    expect(stepIndex(5, 'ArrowRight', 30)).toBe(6);
    expect(stepIndex(0, 'ArrowLeft', 30)).toBe(0);
    expect(stepIndex(29, 'ArrowRight', 30)).toBe(29);
  });

  it('moves a week with Page Up and Page Down', () => {
    expect(stepIndex(20, 'PageUp', 30)).toBe(13);
    expect(stepIndex(3, 'PageUp', 30)).toBe(0);
    expect(stepIndex(20, 'PageDown', 30)).toBe(27);
    expect(stepIndex(25, 'PageDown', 30)).toBe(29);
  });

  it('jumps to the ends with Home and End', () => {
    expect(stepIndex(12, 'Home', 30)).toBe(0);
    expect(stepIndex(12, 'End', 30)).toBe(29);
  });

  it('starts from the newest bar going back, the oldest going forward', () => {
    expect(stepIndex(null, 'ArrowLeft', 30)).toBe(29);
    expect(stepIndex(null, 'ArrowRight', 30)).toBe(0);
    expect(stepIndex(null, 'PageUp', 30)).toBe(23);
    expect(stepIndex(null, 'PageDown', 30)).toBe(6);
  });

  it('ignores other keys and empty charts', () => {
    expect(stepIndex(3, 'Enter', 30)).toBeNull();
    expect(stepIndex(3, 'Tab', 30)).toBeNull();
    expect(stepIndex(null, 'ArrowLeft', 0)).toBeNull();
  });
});

describe('edgeAlign', () => {
  it('hangs labels inward at the edges', () => {
    expect(edgeAlign(0, 30)).toBe('start');
    expect(edgeAlign(15, 30)).toBe('center');
    expect(edgeAlign(29, 30)).toBe('end');
    expect(edgeAlign(0, 7)).toBe('start');
    expect(edgeAlign(3, 7)).toBe('center');
    expect(edgeAlign(0, 1)).toBe('center');
  });
});

describe('weekdayFigures', () => {
  it('divides each weekday by how many of it the period has', () => {
    // 29 Aug to 27 Sep 2026: five Saturdays and five Sundays, four of the rest.
    const days = daysBetween('2026-08-29', '2026-09-27').map((date) => ({ date, total: 0 }));
    const figures = weekdayFigures({
      days,
      by_weekday: [
        { weekday: 0, total: 400 },
        { weekday: 5, total: 1000 },
        { weekday: 6, total: 0 },
      ],
    });
    expect(figures.map((f) => f.days)).toEqual([4, 4, 4, 4, 4, 5, 5]);
    expect(figures[0]).toEqual({ weekday: 0, total: 400, days: 4, average: 100 });
    expect(figures[5]).toEqual({ weekday: 5, total: 1000, days: 5, average: 200 });
    expect(figures[6].average).toBe(0);
  });

  it('rounds to the cent and survives a weekday the period does not have', () => {
    const figures = weekdayFigures({
      days: daysBetween('2026-09-21', '2026-09-23').map((date) => ({ date, total: 0 })),
      by_weekday: [{ weekday: 0, total: 10 }],
    });
    expect(figures[0].average).toBe(10);
    expect(figures[6]).toEqual({ weekday: 6, total: 0, days: 0, average: 0 });
    const thirds = weekdayFigures({
      days: daysBetween('2026-09-07', '2026-09-27').map((date) => ({ date, total: 0 })),
      by_weekday: [{ weekday: 0, total: 10 }],
    });
    expect(thirds[0].average).toBe(3.33);
  });
});

describe('shareOfMax', () => {
  it('is each value against the largest', () => {
    expect(shareOfMax([50, 100, 25, 0])).toEqual([0.5, 1, 0.25, 0]);
    expect(shareOfMax([])).toEqual([]);
    expect(shareOfMax([0, 0])).toEqual([0, 0]);
  });
});
