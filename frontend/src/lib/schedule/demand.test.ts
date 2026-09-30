// How much cover a day and hour needs — the one question the generator, the
// re-audit and the coverage strip all ask, so a wrong answer here is wrong in
// three places at once and they still agree with each other.
//
// The two rules being protected pull in opposite directions, which is exactly
// why they need holding down:
//   - floors may only ever RAISE cover ("at least one at closing" must never
//     take away the two people already on);
//   - a rule marked `exact` REPLACES the level in its window, and is the only
//     way a brief can ask for fewer people than the flat minimum.
// Coverage rules reach this module from the intake, which really does emit both
// kinds (see backend/app/services/intake.py: a dip is exact, "al menos" is not).

import { describe, expect, it } from 'vitest';
import { isClosedOn, needAt, shiftSpanMin, windowFor } from './demand';
import type { CoverageReq } from './types';
import { day, spec } from '../../test/factories';

const MONDAY = day('2026-03-02');
const SATURDAY = day('2026-03-14');

function req(over: Partial<CoverageReq> = {}): CoverageReq {
  return { weekdays: [], dates: [], startMin: null, endMin: null, staff: 1, ...over };
}

describe('needAt — the flat minimum', () => {
  it('asks for the flat minimum at every hour when nothing else is stated', () => {
    const s = spec({ minStaff: 2 });
    expect(needAt(s, MONDAY, 9)).toBe(2);
    expect(needAt(s, MONDAY, 16)).toBe(2);
  });
});

describe('needAt — stacked requirements', () => {
  it('takes the highest requirement in force, never the sum of them', () => {
    // "At least two all day" plus "three at lunch" plus "four at lunch" is four
    // people at lunch, not nine. Summing would put the whole team on at once and
    // then report the shop as understaffed for the rest of the day.
    const s = spec({
      minStaff: 2,
      coverage: [
        req({ startMin: 12 * 60, endMin: 15 * 60, staff: 3 }),
        req({ startMin: 13 * 60, endMin: 14 * 60, staff: 4 }),
      ],
    });
    expect(needAt(s, MONDAY, 13)).toBe(4);
    expect(needAt(s, MONDAY, 12)).toBe(3);
    expect(needAt(s, MONDAY, 16)).toBe(2);
  });

  it('never lets a guarantee cut the cover that is already there', () => {
    // "At least one person at closing" is a promise of a floor. Reading it as a
    // level would send everyone but one person home at 8 PM — a guarantee that
    // reduces staffing is worse than no rule at all.
    const s = spec({
      minStaff: 3,
      coverage: [req({ startMin: 20 * 60, endMin: 22 * 60, staff: 1 })],
    });
    expect(needAt(s, MONDAY, 20)).toBe(3);
  });

  it('applies an unscoped rule to every open day', () => {
    const s = spec({ minStaff: 1, coverage: [req({ staff: 3 })] });
    expect(needAt(s, MONDAY, 9)).toBe(3);
    expect(needAt(s, SATURDAY, 21)).toBe(3);
  });
});

describe('needAt — an exact rule is how a brief asks for FEWER people', () => {
  it('lets a midday dip fall below the flat minimum inside its window', () => {
    // "Two all day, but only one over lunch." Without `exact` the floor of two
    // always wins and the sentence is inexpressible.
    const s = spec({
      minStaff: 2,
      coverage: [req({ startMin: 13 * 60, endMin: 15 * 60, staff: 1, exact: true })],
    });
    expect(needAt(s, MONDAY, 13)).toBe(1);
    expect(needAt(s, MONDAY, 14)).toBe(1);
  });

  it('restores the flat minimum the moment the dip window ends', () => {
    const s = spec({
      minStaff: 2,
      coverage: [req({ startMin: 13 * 60, endMin: 15 * 60, staff: 1, exact: true })],
    });
    expect(needAt(s, MONDAY, 12)).toBe(2);
    expect(needAt(s, MONDAY, 15)).toBe(2);
  });

  it('beats a floor that overlaps it, because the manager was being specific', () => {
    const s = spec({
      minStaff: 2,
      coverage: [
        req({ startMin: 9 * 60, endMin: 22 * 60, staff: 4 }),
        req({ startMin: 13 * 60, endMin: 15 * 60, staff: 1, exact: true }),
      ],
    });
    expect(needAt(s, MONDAY, 13)).toBe(1);
    expect(needAt(s, MONDAY, 12)).toBe(4);
  });

  it('takes the highest of two exact rules that overlap', () => {
    // Two dips in force at once is a contradiction the manager did not intend
    // to write; resolving it upwards leaves the shop covered rather than empty.
    const s = spec({
      minStaff: 5,
      coverage: [
        req({ startMin: 13 * 60, endMin: 15 * 60, staff: 1, exact: true }),
        req({ startMin: 13 * 60, endMin: 14 * 60, staff: 2, exact: true }),
      ],
    });
    expect(needAt(s, MONDAY, 13)).toBe(2);
  });

  // Regression. `CoverageReq` documents "null/null = the whole open day", and
  // the backend intake really can emit an exact rule with no window ("solo uno
  // los sábados"): it validates start/end, sets BOTH to null when the window is
  // missing or malformed, and keeps `exact` as the model sent it. `needAt` used
  // to drop such a rule twice over — the exact pass skipped it for having no
  // window, the floor pass skipped it for being exact — so a requirement the
  // manager stated had no effect anywhere. Worse, `need` stayed at the flat
  // minimum, so no coverage gap was reported: the shift was quietly short and
  // the calendar looked right.
  it('applies a whole-day exact rule to the whole open day', () => {
    const s = spec({
      minStaff: 2,
      coverage: [req({ weekdays: [6], staff: 4, exact: true })],
    });
    expect(needAt(s, SATURDAY, 12)).toBe(4);
  });
});

describe('needAt — scoping a requirement', () => {
  it('applies a weekday-scoped rule on that weekday only', () => {
    const s = spec({
      minStaff: 2,
      coverage: [req({ weekdays: [6], staff: 4 })],
    });
    expect(needAt(s, SATURDAY, 12)).toBe(4);
    expect(needAt(s, MONDAY, 12)).toBe(2);
  });

  it('applies a date-scoped rule on that date only', () => {
    // "Six people on the 24th" — a one-off the weekday pattern cannot express.
    const s = spec({
      minStaff: 2,
      coverage: [req({ dates: ['2026-03-14'], staff: 6 })],
    });
    expect(needAt(s, SATURDAY, 12)).toBe(6);
    expect(needAt(s, MONDAY, 12)).toBe(2);
  });

  it('requires both scopes to match when a rule carries a weekday and a date', () => {
    const s = spec({
      minStaff: 2,
      coverage: [req({ weekdays: [1], dates: ['2026-03-14'], staff: 6 })],
    });
    // The 14th is a Saturday, so the Monday scope rules it out.
    expect(needAt(s, SATURDAY, 12)).toBe(2);
    expect(needAt(s, MONDAY, 12)).toBe(2);
  });

  it('ends a window at its closing minute rather than including it', () => {
    // Windows are half-open, so back-to-back rules (12-15, 15-18) never both
    // apply at 15:00 and never leave 15:00 uncovered.
    const s = spec({
      minStaff: 1,
      coverage: [req({ startMin: 12 * 60, endMin: 15 * 60, staff: 3 })],
    });
    expect(needAt(s, MONDAY, 14)).toBe(3);
    expect(needAt(s, MONDAY, 15)).toBe(1);
  });
});

describe('needAt — the legacy peak window', () => {
  it('sets the level inside the peak, so `set_peak` keeps behaving as it always has', () => {
    const s = spec({
      minStaff: 2,
      peak: { startMin: 18 * 60, endMin: 21 * 60, staff: 4 },
    });
    expect(needAt(s, MONDAY, 18)).toBe(4);
    expect(needAt(s, MONDAY, 17)).toBe(2);
  });
});

describe('shiftSpanMin', () => {
  it('falls back to an eight-hour shift when the brief asked for no length', () => {
    expect(shiftSpanMin(spec({ shiftLengthHours: null }))).toBe(8 * 60);
  });

  it('ignores a length that is not a number rather than producing NaN minutes', () => {
    // A NaN span propagates into every candidate shift and empties the calendar.
    expect(shiftSpanMin(spec({ shiftLengthHours: Number.NaN }))).toBe(8 * 60);
  });

  it('gives the manager the shift length they asked for, in minutes', () => {
    expect(shiftSpanMin(spec({ shiftLengthHours: 6 }))).toBe(6 * 60);
    expect(shiftSpanMin(spec({ shiftLengthHours: 6.5 }))).toBe(390);
  });

  it('refuses to build a shift shorter than three hours or longer than twelve', () => {
    expect(shiftSpanMin(spec({ shiftLengthHours: 1 }))).toBe(3 * 60);
    expect(shiftSpanMin(spec({ shiftLengthHours: 20 }))).toBe(12 * 60);
  });
});

describe('isClosedOn and windowFor', () => {
  it('closes the shop on a standing weekday closure', () => {
    expect(isClosedOn(spec({ closedWeekdays: [1] }), MONDAY)).toBe(true);
    expect(isClosedOn(spec({ closedWeekdays: [1] }), SATURDAY)).toBe(false);
  });

  it('closes the shop on a one-off date such as a public holiday', () => {
    expect(isClosedOn(spec({ closedDates: ['2026-03-14'] }), SATURDAY)).toBe(true);
    expect(isClosedOn(spec({ closedDates: ['2026-03-14'] }), MONDAY)).toBe(false);
  });

  it('uses the per-weekday opening hours when that day has its own', () => {
    const s = spec({
      openMin: 9 * 60,
      closeMin: 17 * 60,
      dayHours: [{ weekday: 6, openMin: 10 * 60, closeMin: 23 * 60 }],
    });
    expect(windowFor(s, SATURDAY)).toEqual({ openMin: 10 * 60, closeMin: 23 * 60 });
    expect(windowFor(s, MONDAY)).toEqual({ openMin: 9 * 60, closeMin: 17 * 60 });
  });

  it('reads an override that closes before it opens as a night, not a mistake', () => {
    // This used to fall back to the standing hours, on the reasoning that a
    // backwards window would leave the day with no hours in it. The reasoning
    // was right and the conclusion was wrong: 20:00 to 08:00 is not a day with
    // no hours, it is a night, and refusing it left every business that works
    // through midnight unable to state its own Saturday. It now rolls into the
    // next day -- the same reading a shift template that ends before it starts
    // has always been given.
    const s = spec({
      openMin: 9 * 60,
      closeMin: 17 * 60,
      dayHours: [{ weekday: 6, openMin: 20 * 60, closeMin: 8 * 60 }],
    });
    expect(windowFor(s, SATURDAY)).toEqual({ openMin: 20 * 60, closeMin: 32 * 60 });
  });

  it('still falls back when an override opens and closes at the same minute', () => {
    // Zero minutes long is the one backwards-looking window that really does
    // say nothing, and it keeps the old behaviour: the standing hours stand.
    const s = spec({
      openMin: 9 * 60,
      closeMin: 17 * 60,
      dayHours: [{ weekday: 6, openMin: 20 * 60, closeMin: 20 * 60 }],
    });
    expect(windowFor(s, SATURDAY)).toEqual({ openMin: 9 * 60, closeMin: 17 * 60 });
  });
});

describe('needAt — exactness is resolved narrowest-first', () => {
  // Both of these are `exact`, and they disagree on Saturday at 14:00. Taking
  // a plain maximum across them let the whole-day rule swallow the dip — on
  // the busiest day, which is exactly where the dip is worth the most money.
  const saturdayAllDay = {
    weekdays: [6],
    dates: [],
    startMin: null,
    endMin: null,
    staff: 4,
    exact: true,
  };
  const lunchDip = {
    weekdays: [],
    dates: [],
    startMin: 13 * 60,
    endMin: 15 * 60,
    staff: 1,
    exact: true,
  };
  const s = spec({ minStaff: 2, coverage: [saturdayAllDay, lunchDip] });
  const SATURDAY = { date: '2026-09-05', weekday: 6, label: 'Saturday' };
  const MONDAY_ = { date: '2026-09-07', weekday: 1, label: 'Monday' };

  it('lets a windowed dip win over a whole-day rule on the same day', () => {
    expect(needAt(s, SATURDAY, 14)).toBe(1);
  });

  it('still applies the whole-day rule outside the dip', () => {
    expect(needAt(s, SATURDAY, 11)).toBe(4);
  });

  it('applies the dip on days the whole-day rule does not cover', () => {
    expect(needAt(s, MONDAY_, 14)).toBe(1);
    expect(needAt(s, MONDAY_, 11)).toBe(2);
  });
});
