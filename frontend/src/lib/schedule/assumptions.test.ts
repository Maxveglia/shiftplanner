// What a manager is told about a number nobody gave us.
//
// The point of these is the WHY. A row that says "2 people on Monday" and
// nothing else is a setting; the same row with "because you called those days
// busier" is a reading of the brief, and the difference is whether the manager
// can tell a mistake from a preference they forgot they had.

import { describe, expect, it } from 'vitest';
import {
  correctAssumption,
  describeAssumption,
  describeAssumptions,
  isCorrectable,
} from './assumptions';
import { getLanguage, setLanguage, type Language } from '../i18n/core';
import { spec as makeSpec } from '../../test/factories';
import type { SpecGap } from '../../api/schedule';

/**
 * Read a sentence in one language without leaking it into the next test.
 *
 * The runner's own locale decides the default, so asserting on English text
 * without pinning it passes on one machine and fails on the next.
 */
function inLanguage<T>(lang: Language, read: () => T): T {
  const before = getLanguage();
  try {
    setLanguage(lang);
    return read();
  } finally {
    setLanguage(before);
  }
}

const SPEC = makeSpec({ minStaff: 1, openMin: 9 * 60, closeMin: 22 * 60 });

function gap(over: Partial<SpecGap>): SpecGap {
  return { field: 'coverage', label: 'server prose', filledBy: 'derived', loud: true, ...over };
}

describe('an assumption that rests on something the brief said', () => {
  it('names the day, the number, and the sentence it was read from', () => {
    const a = inLanguage('en', () =>
      describeAssumption(
      gap({ reason: 'ranked_weekday', value: 2, params: { staff: 2, weekday: 1, floor: 1 } }),
        SPEC,
        0,
      ),
    );

    expect(a.what).toBe('2 people on Monday');
    expect(a.because).toContain('busier');
    expect(a.because).toContain('1');
    expect(a.filledBy).toBe('derived');
  });

  it('writes a window as the hours it covers', () => {
    const a = inLanguage('en', () =>
      describeAssumption(
      gap({
        reason: 'ranked_window',
        value: 3,
        params: { staff: 3, startMin: 13 * 60, endMin: 15 * 60, floor: 2 },
      }),
        SPEC,
        0,
      ),
    );

    expect(a.what).toContain('3 people');
    expect(a.because).toContain('2');
  });

  it('says one person, not "1 people"', () => {
    const a = inLanguage('en', () =>
      describeAssumption(
      gap({ reason: 'lowest_stated', value: 1, params: { staff: 1 } }),
        SPEC,
        0,
      ),
    );

    expect(a.what).toContain('1 person');
    expect(a.because).toContain('smallest number you gave us');
  });
});

describe('a gap nothing could be derived from', () => {
  it('is marked as a default and admits it has no reason', () => {
    const a = inLanguage('en', () =>
      describeAssumption(
      gap({ field: 'min_rest', reason: 'generic', filledBy: 'default', loud: false }),
        SPEC,
        0,
      ),
    );

    expect(a.filledBy).toBe('default');
    expect(a.because).toBeNull();
  });

  it('quotes the figure the calendar is really using, not the server label', () => {
    // The server's label for this field is the constant "Open 8:00 AM-10:00 PM".
    // This shop opens at nine and shuts at ten, and that is what must be shown.
    const a = inLanguage('en', () =>
      describeAssumption(
      gap({
        field: 'opening_hours',
        label: 'Open 8:00 AM-10:00 PM',
        reason: 'generic',
        filledBy: 'default',
      }),
        SPEC,
        0,
      ),
    );

    // The clock is the reader's, the way the calendar grid has always
    // written one: AM and PM in English, 24 hours in Spanish. What matters
    // here is the FIGURE -- nine and ten, from the spec, not the eight in the
    // server's label.
    expect(a.what).not.toContain('8:00 AM');
    expect(a.what).toContain('9:00 AM');
    expect(a.what).toContain('10:00 PM');
  });

  it('falls back to describing the field when the reason is one this build does not know', () => {
    const a = inLanguage('en', () =>
      describeAssumption(
      gap({ field: 'closures', reason: 'invented_later' as never, filledBy: 'default' }),
        SPEC,
        0,
      ),
    );

    expect(a.what).toBe('Open every day');
    expect(a.what).not.toBe('server prose');
  });
});

describe('two assumptions about the same field', () => {
  it('are two rows, with keys that do not collide', () => {
    const rows = inLanguage('en', () =>
      describeAssumptions(
        [
          gap({ reason: 'ranked_weekday', params: { staff: 2, weekday: 1, floor: 1 } }),
          gap({ reason: 'ranked_weekday', params: { staff: 2, weekday: 5, floor: 1 } }),
        ],
        SPEC,
      ),
    );

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows[0].what).not.toBe(rows[1].what);
  });
});

describe('the same assumption in Spanish', () => {
  it('reads as a sentence, not as a translated word order', () => {
    const a = inLanguage('es', () =>
      describeAssumption(
        gap({ reason: 'ranked_weekday', params: { staff: 2, weekday: 1, floor: 1 } }),
        SPEC,
        0,
      ),
    );

    expect(a.what).toBe('2 personas los lunes');
    expect(a.because).toBe(
      'porque dijiste que son días más fuertes: uno más que el mínimo de 1',
    );
  });
});

describe('correcting an assumption with the manager own number', () => {
  const req = (over: Partial<import('./types').CoverageReq> = {}) => ({
    weekdays: [],
    dates: [],
    startMin: null,
    endMin: null,
    staff: 2,
    exact: false,
    ...over,
  });

  it('moves the floor when the assumption WAS the floor', () => {
    const next = correctAssumption(
      makeSpec({ minStaff: 1 }),
      gap({ field: 'min_staff', reason: 'lowest_stated', params: { staff: 1 } }),
      3,
    );

    expect(next.minStaff).toBe(3);
  });

  it('changes the day it is about, and leaves the other days alone', () => {
    const before = makeSpec({
      minStaff: 1,
      coverage: [req({ weekdays: [1], staff: 2 }), req({ weekdays: [5], staff: 2 })],
    });

    const next = correctAssumption(
      before,
      gap({ reason: 'ranked_weekday', params: { staff: 2, weekday: 1, floor: 1 } }),
      4,
    );

    expect(next.coverage?.[0].staff).toBe(4);
    expect(next.coverage?.[1].staff).toBe(2);
  });

  it('changes the window it is about, matched by its hours', () => {
    const before = makeSpec({
      coverage: [
        req({ startMin: 13 * 60, endMin: 15 * 60, staff: 2 }),
        req({ startMin: 20 * 60, endMin: 22 * 60, staff: 2 }),
      ],
    });

    const next = correctAssumption(
      before,
      gap({
        reason: 'ranked_window',
        params: { staff: 2, startMin: 20 * 60, endMin: 22 * 60, floor: 1 },
      }),
      5,
    );

    expect(next.coverage?.[0].staff).toBe(2);
    expect(next.coverage?.[1].staff).toBe(5);
  });

  it('leaves the spec alone when the rule it described is gone', () => {
    // The brief was rewritten under the row: better to change nothing than to
    // edit whichever requirement happens to sit where that one used to.
    const before = makeSpec({ coverage: [req({ weekdays: [3], staff: 2 })] });

    const next = correctAssumption(
      before,
      gap({ reason: 'ranked_weekday', params: { staff: 2, weekday: 1, floor: 1 } }),
      4,
    );

    expect(next.coverage).toEqual(before.coverage);
  });

  it('offers no editor for a shape that is not a number of people', () => {
    expect(isCorrectable(gap({ field: 'closures', reason: 'generic' }))).toBe(false);
    expect(isCorrectable(gap({ reason: 'ranked_weekday' }))).toBe(true);
  });
});

describe('a field this build has never heard of', () => {
  it('shows the server sentence rather than the untranslated key', () => {
    const a = inLanguage('en', () =>
      describeAssumption(
        gap({
          field: 'something_added_later',
          label: 'Something the server decided',
          reason: 'generic',
          filledBy: 'default',
        }),
        SPEC,
        0,
      ),
    );

    expect(a.what).toBe('Something the server decided');
    expect(a.what).not.toContain('calendar.assumed');
  });
});

describe('an assumption that rests on what we looked up', () => {
  // The distinction these pin down is the one the manager is owed. A rule
  // that came from their own sentence and a rule that came from a model
  // reading about bars in Barcelona produce the same coverage, and must not
  // read the same: the second is the one they have never seen before, and
  // "because we looked it up" is what invites them to say it is wrong.

  const WHY = 'un bar en Barcelona llena el viernes y el sábado noche';

  it('says whose idea it was, and quotes the reason', () => {
    const a = inLanguage('en', () =>
      describeAssumption(
        gap({
          reason: 'researched_weekday',
          value: 2,
          params: { staff: 2, weekday: 5, floor: 1 },
          why: WHY,
        }),
        SPEC,
        0,
      ),
    );

    expect(a.what).toBe('2 people on Friday');
    expect(a.because).toContain('we looked it up');
    expect(a.because).toContain('Barcelona');
  });

  it('says it in Spanish too', () => {
    const a = inLanguage('es', () =>
      describeAssumption(
        gap({
          reason: 'researched_weekday',
          value: 2,
          params: { staff: 2, weekday: 5, floor: 1 },
          why: WHY,
        }),
        SPEC,
        0,
      ),
    );

    expect(a.because).toContain('lo hemos mirado');
    expect(a.because).toContain('Barcelona');
  });

  it('does not read like one the manager asked for', () => {
    const read = (reason: SpecGap['reason']) =>
      inLanguage('en', () =>
        describeAssumption(
          gap({
            reason,
            value: 2,
            params: { staff: 2, weekday: 5, floor: 1 },
            why: WHY,
          }),
          SPEC,
          0,
        ),
      ).because;

    expect(read('researched_weekday')).not.toBe(read('ranked_weekday'));
  });

  it('can still be corrected with a number, like any staffing row', () => {
    // The row most worth correcting in place: nobody typed it, so there is no
    // sentence of their own to rewrite instead.
    const g = gap({
      reason: 'researched_weekday',
      value: 2,
      params: { staff: 2, weekday: 5, floor: 1 },
      why: WHY,
    });
    expect(isCorrectable(g)).toBe(true);

    const spec = makeSpec({
      minStaff: 1,
      coverage: [
        { weekdays: [5], dates: [], startMin: null, endMin: null, staff: 2 },
      ],
    });
    const corrected = correctAssumption(spec, g, 4);
    expect(corrected.coverage?.[0].staff).toBe(4);
  });

  it('writes an inferred closure as the day it shuts', () => {
    const a = inLanguage('es', () =>
      describeAssumption(
        gap({
          field: 'closed_dates',
          reason: 'researched_holiday',
          value: null,
          params: {},
          date: '2026-10-12',
          why: WHY,
        }),
        SPEC,
        0,
      ),
    );

    expect(a.what).toContain('2026-10-12');
    expect(a.because).toContain('suelen cerrar');
    // Never a number to nudge: a closure is a shape, not a figure.
    expect(isCorrectable(gap({ reason: 'researched_holiday' }))).toBe(false);
  });
});
