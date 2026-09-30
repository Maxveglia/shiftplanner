// Where the paid-differently hours are, and that the two answers agree.
import { describe, expect, it } from 'vitest';
import { DEFAULT_NIGHT_WINDOW, nightHoursIn, nightSpans } from './night';

const W = DEFAULT_NIGHT_WINDOW;

describe('night work in a shift', () => {
  it('finds both ends of a bar shift that crosses midnight', () => {
    // 18:00 to 04:00: night from 22:00 to 04:00 = six hours, in one piece.
    const spans = nightSpans(18 * 60, 28 * 60, W);
    expect(spans).toEqual([{ from: 22 * 60, to: 28 * 60 }]);
    expect(nightHoursIn(18 * 60, 28 * 60, W)).toBe(6);
  });

  it('says a daytime shift has none', () => {
    expect(nightSpans(9 * 60, 17 * 60, W)).toEqual([]);
    expect(nightHoursIn(9 * 60, 17 * 60, W)).toBe(0);
  });

  it('counts an early start that begins inside the night', () => {
    // 05:00 to 13:00: one hour of it is still night.
    expect(nightHoursIn(5 * 60, 13 * 60, W)).toBe(1);
    expect(nightSpans(5 * 60, 13 * 60, W)).toEqual([{ from: 5 * 60, to: 6 * 60 }]);
  });

  it('agrees with itself: the spans always add up to the hours', () => {
    for (const [start, end] of [[17 * 60, 27 * 60], [21 * 60, 23 * 60], [0, 8 * 60]]) {
      const total = nightSpans(start, end, W).reduce((sum, s) => sum + (s.to - s.from), 0);
      expect(total / 60).toBeCloseTo(nightHoursIn(start, end, W), 10);
    }
  });
});
