// Where the manager is looking, and the one thing it must never decide.
//
// The test at the bottom of this file is the reason the module exists. A bar
// in Barcelona asked for October, the toolbar was on "4 weeks", and the draft
// was saved with a 28-day window carrying 31 days of shifts -- so the server
// refused all of it and the manager got a yellow warning instead of a rota.
//
// The fix is structural rather than careful: there is no longer a way to be
// looking at less than a whole month, so there is no way to save less than one.

import { describe, expect, it } from 'vitest';
import {
  dateKey,
  dayState,
  fromDateKey,
  monthWindow,
  windowHolds,
  shiftDay,
  windowKey,
  yearOf,
} from './focus';

describe('reading and writing a day key', () => {
  it('reads a key as a LOCAL date, not a UTC instant', () => {
    // `new Date('2026-10-01')` is UTC midnight, which is 30 September west of
    // Greenwich -- the calendar would open September for somebody who pressed
    // October.
    const d = fromDateKey('2026-10-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(1);
  });

  it('round-trips', () => {
    expect(dateKey(fromDateKey('2026-02-28'))).toBe('2026-02-28');
  });
});

describe('moving between days', () => {
  it('crosses the end of a month', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('crosses the end of a year, in both directions', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('knows February', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29'); // a leap year
    expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('which year is on screen', () => {
  it('is the year itself, or the year of the open day', () => {
    expect(yearOf({ kind: 'year', year: 2026 })).toBe(2026);
    expect(yearOf({ kind: 'day', date: '2027-01-02' })).toBe(2027);
  });
});

describe('the window that gets saved', () => {
  it('is October the WHOLE month when the brief asked for October', () => {
    // THE REGRESSION. The original bug: a 28-day window with 31 days of
    // shifts in it, and a draft that would not save.
    const w = monthWindow(fromDateKey('2026-10-01'), 1);

    expect(dateKey(w.from)).toBe('2026-10-01');
    // Exclusive, and on the 1st of the month after -- so the 31st is inside.
    expect(dateKey(w.to)).toBe('2026-11-01');

    const days = Math.round(
      (w.to.getTime() - w.from.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(days).toBe(31);
  });

  it('is the same window whichever day of the month it is built from', () => {
    // Looking is free: which day is open cannot change what is saved.
    expect(windowKey(monthWindow(fromDateKey('2026-10-31'), 1))).toBe(
      windowKey(monthWindow(fromDateKey('2026-10-02'), 1)),
    );
  });

  it('covers every month a multi-month brief asked for', () => {
    const w = monthWindow(fromDateKey('2026-10-01'), 3);
    expect(dateKey(w.from)).toBe('2026-10-01');
    expect(dateKey(w.to)).toBe('2027-01-01');
  });

  it('always starts on the first of a month and ends on the first of another', () => {
    // What makes an overnight shift belong to exactly one window: every
    // boundary is a month boundary, so 23:00 on the 31st and 02:00 on the 1st
    // are each in one window and neither is orphaned between two.
    for (const date of ['2026-01-15', '2026-02-28', '2026-12-31']) {
      const w = monthWindow(fromDateKey(date), null);
      expect(w.from.getDate()).toBe(1);
      expect(w.to.getDate()).toBe(1);
    }
  });
});

describe('whether a day is inside the period', () => {
  // THE SECOND REGRESSION, and it reached production. Opening a day asks this
  // to decide whether it is starting a new period -- and a wrong yes throws
  // away the calendar on screen and reports that none was made.
  //
  // The first version compared month strings against the period's FIRST
  // month, which was wrong twice: it called the second month of a three-month
  // brief "somewhere else", and it answered against a period that had itself
  // drifted to January whenever the manager closed a day.
  const october = monthWindow(fromDateKey('2026-10-01'), 1);
  const quarter = monthWindow(fromDateKey('2026-10-01'), 3);

  it('holds every day of its own month, first and last', () => {
    expect(windowHolds(october, '2026-10-01')).toBe(true);
    expect(windowHolds(october, '2026-10-31')).toBe(true);
  });

  it('holds the later months of a longer period', () => {
    expect(windowHolds(quarter, '2026-11-15')).toBe(true);
    expect(windowHolds(quarter, '2026-12-31')).toBe(true);
  });

  it('does not hold the day either side of it', () => {
    expect(windowHolds(october, '2026-09-30')).toBe(false);
    expect(windowHolds(october, '2026-11-01')).toBe(false);
  });
});

describe('what colour a square in the year gets', () => {
  // No DOM in this repository's tests, on purpose -- so the decision lives
  // out here where a test can reach it, and `YearGrid` only turns the answer
  // into classes.
  const key = '2026-10-16';
  const state = (over: Parameters<typeof dayState>[0]) => dayState(over);

  it('marks today, whatever else is true of it', () => {
    // A today that is also published must not vanish into the run of
    // published days around it: it is the one square people look for.
    expect(
      state({
        key,
        todayKey: key,
        outside: false,
        mark: { published: true, draft: true },
      }),
    ).toBe('today');
  });

  it('shows published and draft differently', () => {
    const published = state({
      key,
      todayKey: '2026-01-01',
      outside: false,
      mark: { published: true, draft: false },
    });
    const draft = state({
      key,
      todayKey: '2026-01-01',
      outside: false,
      mark: { published: false, draft: true },
    });

    expect(published).toBe('published');
    expect(draft).toBe('draft');
    // The distinction is the point: a month drafted and never published is
    // exactly what this view exists to make visible.
    expect(published).not.toBe(draft);
  });

  it('reports a day that is both as published', () => {
    // Published and then edited. What the TEAM currently believes is the
    // published half, and that is what the grid reports.
    expect(
      state({
        key,
        todayKey: '2026-01-01',
        outside: false,
        mark: { published: true, draft: true },
      }),
    ).toBe('published');
  });

  it('never colours a neighbouring month’s day', () => {
    // It fills a corner of October's grid and belongs to November. Colouring
    // it would put one day in two months and count it twice at a glance.
    expect(
      state({
        key,
        todayKey: '2026-01-01',
        outside: true,
        mark: { published: true, draft: false },
      }),
    ).toBe('outside');
  });

  it('leaves a day with nothing planned alone', () => {
    expect(state({ key, todayKey: '2026-01-01', outside: false })).toBe('empty');
  });
});
