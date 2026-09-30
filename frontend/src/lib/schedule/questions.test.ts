// Answering "what hours do you keep on Saturdays?" — the two ways it goes wrong.

import { describe, expect, it } from 'vitest';
import { answerDayHours, windowFromAnswer } from './questions';
import { spec as makeSpec } from '../../test/factories';

describe('the hours a manager types', () => {
  it('are taken as written when the day ends before midnight', () => {
    expect(windowFromAnswer(8 * 60, 14 * 60)).toEqual({
      openMin: 8 * 60,
      closeMin: 14 * 60,
    });
  });

  it('roll past midnight when the close is earlier than the open', () => {
    // "de ocho de la tarde a dos" is a night, not a contradiction. Stored as
    // 02:00 it would be a day that closes before it opens, which `windowFor`
    // discards — so the Saturday would quietly keep the standing hours and the
    // answer would do nothing at all.
    expect(windowFromAnswer(20 * 60, 2 * 60)).toEqual({
      openMin: 20 * 60,
      closeMin: 26 * 60,
    });
  });

  it('are nothing when the day has no length', () => {
    expect(windowFromAnswer(10 * 60, 10 * 60)).toBeNull();
    expect(windowFromAnswer(null, 10 * 60)).toBeNull();
    expect(windowFromAnswer(10 * 60, null)).toBeNull();
  });
});

describe('writing the answer into the spec', () => {
  it('gives the day its hours', () => {
    const next = answerDayHours(makeSpec({ dayHours: [] }), 6, {
      openMin: 480,
      closeMin: 1440,
    });

    expect(next.dayHours).toEqual([{ weekday: 6, openMin: 480, closeMin: 1440 }]);
  });

  it('replaces hours that day already had, rather than adding a second set', () => {
    // Two entries for one weekday leaves `windowFor` picking whichever comes
    // first — which is exactly the one being corrected.
    const before = makeSpec({
      dayHours: [
        { weekday: 5, openMin: 1080, closeMin: 1680 },
        { weekday: 6, openMin: 600, closeMin: 1320 },
      ],
    });

    const next = answerDayHours(before, 6, { openMin: 480, closeMin: 1440 });

    expect(next.dayHours).toHaveLength(2);
    expect(next.dayHours?.filter((d) => d.weekday === 6)).toEqual([
      { weekday: 6, openMin: 480, closeMin: 1440 },
    ]);
    expect(next.dayHours?.find((d) => d.weekday === 5)).toEqual({
      weekday: 5,
      openMin: 1080,
      closeMin: 1680,
    });
  });

  it('leaves everything else in the spec alone', () => {
    const before = makeSpec({ minStaff: 3, dayHours: [] });
    const next = answerDayHours(before, 1, { openMin: 480, closeMin: 1440 });

    expect(next.minStaff).toBe(3);
    expect(next.openMin).toBe(before.openMin);
  });
});
