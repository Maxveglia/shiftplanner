import { describe, expect, it } from 'vitest';
import {
  leanOf,
  isMeasurable,
  dayBefore,
  draftHoursIn,
  measuredMonths,
  measuredThrough,
  pendingOf,
  projectRows,
  projectedDeviation,
  stretchBar,
  type SpanBalances,
} from './projectedBalance';

/**
 * A stretch as the server sends it, with only the figures the projection uses.
 * `total` defaults to a 40-hour contract over a quarter of a year.
 */
function span(over: Partial<{ planned: number; total: number; published_in_window: number }> = {}) {
  return { planned: 0, total: 520, published_in_window: 0, ...over };
}

function person(over: Partial<SpanBalances> = {}): SpanBalances {
  return {
    employee_id: 'e1',
    employee_name: 'Ana Ruiz',
    month: span({ total: 173 }),
    quarter: span(),
    year: span({ total: 1800 }),
    ...over,
  };
}

describe('projecting a draft onto a published balance', () => {
  it('adds the draft to what is published elsewhere in the stretch', () => {
    // 400 published across the quarter, none of it in the window being edited,
    // and 100 hours of draft: the quarter ends 20 short of its 520.
    expect(projectedDeviation(span({ planned: 400 }), 100)).toBe(-20);
  });

  it('does not count a re-drafted week twice', () => {
    // THE CASE THIS FUNCTION EXISTS FOR. 500 hours are published across the
    // quarter, 100 of them inside the window on screen. The manager opened
    // that window and changed nothing, so the draft is the same 100 hours.
    // Publishing would replace those dates with an identical rota: the
    // quarter must come out exactly where it already is.
    const stretch = span({ planned: 500, published_in_window: 100 });
    expect(projectedDeviation(stretch, 100)).toBe(stretch.planned - stretch.total);
    expect(projectedDeviation(stretch, 100)).toBe(-20);

    // Forgetting the subtraction is not a rounding error: it turns 20 hours
    // short into 80 hours over, and points the manager the wrong way.
    const doubleCounted = stretch.planned + 100 - stretch.total;
    expect(doubleCounted).toBe(80);
  });

  it('reads a lighter draft as hours given away', () => {
    // 100 published in the window, 60 drafted over the top of them: the
    // quarter loses the 40 that were dropped.
    expect(projectedDeviation(span({ planned: 500, published_in_window: 100 }), 60)).toBe(-60);
  });

  it('with no draft withdraws what was published in the window', () => {
    // Publishing an empty window is not a no-op: it withdraws the 40 hours
    // that were there. With nothing in the window, it changes nothing.
    expect(projectedDeviation(span({ planned: 560, published_in_window: 40 }), 0)).toBe(0);
    expect(projectedDeviation(span({ planned: 560 }), 0)).toBe(40);
  });

  it('keeps the arithmetic free of float noise', () => {
    expect(projectedDeviation(span({ planned: 0.1, total: 0 }), 0.2)).toBe(0.3);
  });
});

describe('the dead band', () => {
  it('calls anything under an hour either way level', () => {
    expect(leanOf(0)).toBe('level');
    expect(leanOf(0.9)).toBe('level');
    expect(leanOf(-0.9)).toBe('level');
  });

  it('names the direction past it', () => {
    expect(leanOf(1)).toBe('over');
    expect(leanOf(-1)).toBe('short');
  });
});

describe('the column', () => {
  it('reads the stretch the manager picked', () => {
    const balances = {
      employees: [
        person({
          month: span({ total: 173, planned: 100 }),
          quarter: span({ planned: 400 }),
        }),
      ],
    };
    expect(projectRows(balances, { e1: 50 }, 'month')[0].projected).toBe(-23);
    expect(projectRows(balances, { e1: 50 }, 'quarter')[0].projected).toBe(-70);
  });

  it('gives somebody the draft never touches a row anyway', () => {
    // Nobody is shown as fine by omission: a person with no shifts in this
    // window is precisely the one most likely to be short of hours.
    const rows = projectRows(
      { employees: [person({ quarter: span({ planned: 300 }) })] },
      { someoneElse: 80 },
      'quarter',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].projected).toBe(-220);
    expect(rows[0].lean).toBe('short');
  });

  it('has nothing to say before the balances have loaded', () => {
    expect(projectRows(null, { e1: 40 }, 'quarter')).toEqual([]);
    expect(projectRows(undefined, null, 'year')).toEqual([]);
  });

  it('survives a draft that has not been generated yet', () => {
    const rows = projectRows({ employees: [person()] }, null, 'quarter');
    expect(rows[0].projected).toBe(-520);
  });

  it('splits the hours into what stays published and what the draft brings', () => {
    // 500 published over the quarter, 100 of them in the window the draft
    // replaces with 140: 400 stay, 140 arrive, 540 of the 520 asked for.
    const rows = projectRows(
      { employees: [person({ quarter: span({ planned: 500, published_in_window: 100 }) })] },
      { e1: 140 },
      'quarter',
    );
    expect(rows[0].kept).toBe(400);
    expect(rows[0].drafted).toBe(140);
    expect(rows[0].hours).toBe(540);
    expect(rows[0].owed).toBe(520);
    expect(rows[0].projected).toBe(20);
    expect(rows[0].lean).toBe('over');
  });
});

// --- Nothing to measure against ------------------------------------------
//
// From a screenshot. The column read "+159 h" for four people who were exactly
// on track, with "0h ahora" under each one, and the footer said the count
// started on the 1st of October. The manager was planning October; the column
// was answering about the July-September quarter, which ends the day the cycle
// opens. That quarter asks for no hours, so `total` was 0 and the projection
// was the draft's own hours with no line to measure them from.
//
// The anchoring is fixed on the server (the stretches follow the window being
// edited). These pin the client's half: a stretch with no contracted hours in
// it must not print a number at all.

describe('a stretch with nothing in it', () => {
  const empty = { planned: 0, total: 0, published_in_window: 0 };

  it('is not measurable', () => {
    expect(isMeasurable(empty)).toBe(false);
    expect(isMeasurable({ ...empty, total: 151 })).toBe(true);
  });

  it('never leans, however big the draft', () => {
    const rows = projectRows(
      { employees: [{ employee_id: 'e1', employee_name: 'Aldric', month: empty, quarter: empty, year: empty }] },
      { e1: 159 },
      'quarter',
    );
    expect(rows[0].measurable).toBe(false);
    // The arithmetic still answers -- the column is what refuses to print it.
    expect(rows[0].projected).toBe(159);
    expect(rows[0].lean).toBe('level');
  });

  it('leans again as soon as the contract asks for something', () => {
    const october = { planned: 0, total: 151.4, published_in_window: 0 };
    const rows = projectRows(
      { employees: [{ employee_id: 'e1', employee_name: 'Aldric', month: october, quarter: october, year: october }] },
      { e1: 159 },
      'month',
    );
    expect(rows[0].measurable).toBe(true);
    expect(rows[0].projected).toBeCloseTo(7.6, 1);
    expect(rows[0].lean).toBe('over');
  });
});

describe('draftHoursIn: each stretch counts only its own part of the draft', () => {
  // October to December, somebody on forty hours working exactly their
  // contract every month. The server anchors the stretches on October.
  const span = (total: number, start: string) => ({
    planned: 0,
    total,
    published_in_window: 0,
    start,
  });
  const balances = {
    month_start: '2026-10-01',
    quarter_start: '2026-10-01',
    year_start: '2026-01-01',
    employees: [
      {
        employee_id: 'max',
        employee_name: 'max',
        month: span(151.43, '2026-10-01'),
        quarter: span(449.4, '2026-10-01'),
        year: span(449.4, '2026-10-01'),
      },
    ],
  };
  const draft = [
    { employeeId: 'max', date: '2026-10-15', paidHours: 151.43 },
    { employeeId: 'max', date: '2026-11-15', paidHours: 146.55 },
    { employeeId: 'max', date: '2026-12-15', paidHours: 151.43 },
  ];

  it('reads a three-month draft as even under Month, not +298 h', () => {
    // The bug: the whole draft went into every stretch.
    const month = projectRows(balances, draftHoursIn(draft, balances, 'month'), 'month');
    expect(month[0].projected).toBe(0);
  });

  it('still counts the whole draft where the stretch holds all of it', () => {
    for (const s of ['quarter', 'year'] as const) {
      const rows = projectRows(balances, draftHoursIn(draft, balances, s), s);
      expect(rows[0].projected).toBe(0.01);
    }
  });

  it('leaves out a shift past the end of the stretch, and one before its start', () => {
    const edges = [
      { employeeId: 'max', date: '2026-09-30', paidHours: 8 },
      { employeeId: 'max', date: '2026-10-31', paidHours: 5 },
      { employeeId: 'max', date: '2026-11-01', paidHours: 7 },
    ];
    expect(draftHoursIn(edges, balances, 'month')).toEqual({ max: 5 });
  });

  it('counts from where the server counts this person, not from the stretch', () => {
    // Contract signed on the 20th: nothing before it is owed, so nothing
    // before it may be credited either.
    const late = {
      ...balances,
      employees: [{ ...balances.employees[0], month: span(60, '2026-10-20') }],
    };
    const shifts = [
      { employeeId: 'max', date: '2026-10-10', paidHours: 8 },
      { employeeId: 'max', date: '2026-10-25', paidHours: 8 },
    ];
    expect(draftHoursIn(shifts, late, 'month')).toEqual({ max: 8 });
  });

  it('gives the whole draft when the server sends no stretch starts', () => {
    const bare = { employees: [] as typeof balances.employees };
    expect(draftHoursIn(draft, bare, 'month')).toEqual({ max: 449.41 });
  });
});

// --- Measured as far as it is planned, and no further ----------------------
//
// From a screenshot. Planning October 2026, the column showed everybody
// between +15 h and +46 h over a contract they were working to the hour, and
// Month, Quarter and Year printed exactly the same three figures.
//
// Two mistakes, one on each side of the division. The server measured the
// whole quarter and the whole year against a draft that only covered October.
// The client counted the draft to the END of the stretch while the server had
// stopped counting the contract at the edge of what was planned -- so the
// numerator and the denominator covered different months.
//
// The base is now: each stretch is judged over the part somebody has actually
// planned (`total`, ending at `horizon`), and what the contract asks for over
// the rest travels separately as `pending`, to be SHOWN and never added in.
// These fix that arithmetic in place.

describe('a stretch measured only as far as it is planned', () => {
  // October 2026 on screen. Forty hours a week, under the contract-first rule
  // of a week times the days over seven: 40 × 31/7 for the month, 40 × 92/7
  // for October-December, 40 × 365/7 for the year. Nothing published before
  // it, nothing planned after it -- the draft is the only rota in existence.
  const OCTOBER = 177.14;
  const QUARTER_PENDING = 348.57; // 40 × 92/7 − OCTOBER: November and December
  const YEAR_PENDING = 1908.57; // 40 × 365/7 − OCTOBER: the other eleven months

  /** One stretch whose measured part is exactly the October on screen. */
  const measured = (pending: number, over: Partial<{ planned: number; published_in_window: number }> = {}) => ({
    planned: 0,
    published_in_window: 0,
    total: OCTOBER,
    pending,
    horizon: '2026-11-01',
    start: '2026-10-01',
    ...over,
  });

  const balances = {
    month_start: '2026-10-01',
    quarter_start: '2026-10-01',
    year_start: '2026-01-01',
    employees: [
      {
        employee_id: 'max',
        employee_name: 'Max Veglia',
        month: measured(0),
        quarter: measured(QUARTER_PENDING),
        year: measured(YEAR_PENDING),
      },
    ],
  };

  /** The month drafted to the hour. */
  const october = [{ employeeId: 'max', date: '2026-10-15', paidHours: OCTOBER }];

  it('gives the three tabs the same figure and different hours left to plan', () => {
    // THE READING THE SCREENSHOT SHOULD HAVE HAD. One October is planned, so
    // all three stretches are judging the same October and must agree on it:
    // even. What differs is how much of each stretch is still to be written,
    // and that is the whole of the difference between the tabs.
    const rows = (['month', 'quarter', 'year'] as const).map(
      (s) => projectRows(balances, draftHoursIn(october, balances, s), s)[0],
    );
    expect(rows.map((r) => r.projected)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.lean)).toEqual(['level', 'level', 'level']);
    expect(rows.map((r) => r.pending)).toEqual([0, QUARTER_PENDING, YEAR_PENDING]);
  });

  it('never folds the hours left to plan into the balance', () => {
    // The old reading of an empty November and December: 348 hours short of a
    // contract nobody had been asked to work yet. Hours still to hand out are
    // not hours anybody is behind on, and they must not touch this figure.
    const row = projectRows(balances, draftHoursIn(october, balances, 'quarter'), 'quarter')[0];
    expect(row.projected).toBe(0);
    expect(row.projected - row.pending).toBe(-QUARTER_PENDING); // what it used to say
  });

  it('says which day the figure is measured to', () => {
    const row = projectRows(balances, {}, 'quarter')[0];
    // Inclusive, for a sentence: the horizon is the 1st of November because
    // that is the first day NOT counted.
    expect(row.through).toBe('2026-10-31');
    expect(measuredThrough({ ...measured(0), horizon: '2027-01-01' })).toBe('2026-12-31');
  });

  it('leaves a re-drafted month exactly where it stands', () => {
    // October is published with five hours of overtime in it. The manager
    // opens the month, changes nothing, and the draft comes back the same.
    // Publishing would overwrite those dates with an identical rota, so the
    // balance may not move by so much as a minute -- under any tab.
    const published = 180;
    const asPublished = {
      ...balances,
      employees: [
        {
          ...balances.employees[0],
          month: measured(0, { planned: published, published_in_window: published }),
          quarter: measured(QUARTER_PENDING, { planned: published, published_in_window: published }),
        },
      ],
    };
    const same = [{ employeeId: 'max', date: '2026-10-15', paidHours: published }];
    for (const s of ['month', 'quarter'] as const) {
      const row = projectRows(asPublished, draftHoursIn(same, asPublished, s), s)[0];
      expect(row.projected).toBe(2.86);
      // Every published hour is inside the window, so all of them are
      // replaced -- by the same 180.
      expect(row.kept).toBe(0);
      expect(row.hours).toBe(published);
    }
  });

  it('does not credit a draft shift past the horizon', () => {
    // THE INCOHERENCE THIS PAIR OF FIELDS CLOSES. A manager who drafts October
    // and December but not November: the quarter's contract is counted to the
    // 1st of November, so December's hours have no contract behind them in
    // this reading. Counting them anyway credited 151 hours against October
    // alone and printed a month and a half of overtime that nobody worked.
    const skipsNovember = [
      ...october,
      { employeeId: 'max', date: '2026-12-15', paidHours: 151 },
    ];
    expect(draftHoursIn(skipsNovember, balances, 'quarter')).toEqual({ max: OCTOBER });
    expect(draftHoursIn(skipsNovember, balances, 'year')).toEqual({ max: OCTOBER });
    const row = projectRows(balances, draftHoursIn(skipsNovember, balances, 'quarter'), 'quarter')[0];
    expect(row.projected).toBe(0);
  });

  it('still cuts the draft at the end of the stretch when the horizon runs past it', () => {
    // A horizon beyond the stretch is the server talking about a longer
    // measurement than this tab; the month is still a month.
    const wide = {
      ...balances,
      employees: [
        { ...balances.employees[0], month: { ...measured(0), horizon: '2027-01-01' } },
      ],
    };
    const later = [...october, { employeeId: 'max', date: '2026-11-15', paidHours: 40 }];
    expect(draftHoursIn(later, wide, 'month')).toEqual({ max: OCTOBER });
  });

  it('behaves exactly as it did against a server that sends neither field', () => {
    // Deployment order is not ours to choose. Without `pending` there is
    // nothing left to plan to report, without `horizon` the stretch is
    // measured end to end, and the draft is counted end to end with it --
    // the same answer this file gave before either field existed.
    const legacy = { planned: 0, total: 520, published_in_window: 0, start: '2026-10-01' };
    const old = {
      ...balances,
      employees: [{ ...balances.employees[0], quarter: legacy }],
    };
    const spread = [...october, { employeeId: 'max', date: '2026-12-15', paidHours: 151 }];
    expect(draftHoursIn(spread, old, 'quarter')).toEqual({ max: 328.14 });
    const row = projectRows(old, draftHoursIn(spread, old, 'quarter'), 'quarter')[0];
    expect(row.pending).toBe(0);
    expect(row.through).toBeNull();
    expect(row.projected).toBe(-191.86);
    expect(pendingOf(legacy)).toBe(0);
  });
});

describe('a stretch nobody has planned any of', () => {
  // The year, opened in January, with not a shift on the rota. Its measured
  // part is empty, so `total` is zero -- the same zero that means "this
  // stretch has no contract in it" for a quarter that ended before the
  // business existed. The two must not read the same on screen: one has
  // nothing to say and the other has the only thing worth saying.
  const untouched = {
    planned: 0,
    total: 0,
    published_in_window: 0,
    pending: 2085.71,
    horizon: null,
    start: '2026-01-01',
  };

  it('is measurable on the strength of what is still to come', () => {
    expect(isMeasurable(untouched)).toBe(true);
    // And an empty stretch that asks for nothing at all still is not.
    expect(isMeasurable({ ...untouched, pending: 0 })).toBe(false);
  });

  it('reads as even, with the whole stretch still to plan', () => {
    const rows = projectRows(
      {
        employees: [
          { employee_id: 'max', employee_name: 'Max Veglia', month: untouched, quarter: untouched, year: untouched },
        ],
      },
      {},
      'year',
    );
    expect(rows[0].measurable).toBe(true);
    expect(rows[0].projected).toBe(0);
    expect(rows[0].pending).toBe(2085.71);
    // No day to name: nothing has been measured, so "measured to the 31st of
    // December" would be a sentence about a measurement that did not happen.
    expect(rows[0].through).toBeNull();
  });
});

describe('dayBefore: an exclusive end, as a day a person can be told', () => {
  // Shared with the working-year screen (`workdayRows.measuredTo`), which
  // states the same kind of range in its header. Two subtractions are how two
  // screens start disagreeing by a day.
  it('steps back one day, across a month and a year', () => {
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
  });

  it('has nothing to say about nothing', () => {
    expect(dayBefore(null)).toBeNull();
    expect(dayBefore(undefined)).toBeNull();
    expect(dayBefore('')).toBeNull();
  });
});

// --- The three tabs have to say three different things ---------------------
//
// From a screenshot of 24-sep-2026: October drafted, nothing published, the
// cycle opening on the 1st of October. Under "Year" the column read "adam
// +5,4h", and the same "+5,4h" under Month and Quarter -- the deviation of the
// planned October, judged three times, printed as the headline of each tab. It
// was reported as the hour counter not working, the second time for the same
// reason. The headline is now the stretch itself, "X of Y hours", which is
// genuinely different in each tab; the deviation moves underneath and names
// the months it covers.

describe('X of Y hours: the stretch, not the planned part', () => {
  const WEEK = 40;
  const pace = (days: number) => Math.round(((WEEK * days) / 7) * 100) / 100;
  const OCTOBER = pace(31); // 177.14
  const NOV_DEC = pace(61); // 348.57
  const DRAFTED = 182.5; // adam's October in the screenshot

  // Cycle from the 1st of October, so the quarter and the year both start
  // there and hold the same 92 days; the month is October alone.
  const october = (pending: number) => ({
    planned: 0,
    planned_stretch: 0,
    published_in_window: 0,
    total: OCTOBER,
    pending,
    horizon: '2026-11-01',
    start: '2026-10-01',
  });
  const balances = {
    month_start: '2026-10-01',
    quarter_start: '2026-10-01',
    year_start: '2026-01-01',
    employees: [
      {
        employee_id: 'adam',
        employee_name: 'adam',
        month: october(0),
        quarter: october(NOV_DEC),
        year: october(NOV_DEC),
      },
    ],
  };
  const draft = [{ employeeId: 'adam', date: '2026-10-15', paidHours: DRAFTED }];
  const row = (s: 'month' | 'quarter' | 'year') =>
    projectRows(
      balances,
      draftHoursIn(draft, balances, s),
      s,
      draftHoursIn(draft, balances, s, 'stretch'),
    )[0];

  it('gives the month and the quarter different headlines', () => {
    expect([row('month').hours, row('month').owed]).toEqual([DRAFTED, OCTOBER]);
    expect([row('quarter').hours, row('quarter').owed]).toEqual([DRAFTED, 525.71]);
    // The year opened on the 1st of October, so it IS the quarter here --
    // the footer says "Counted from 1 Oct" for exactly this reason.
    expect([row('year').hours, row('year').owed]).toEqual([DRAFTED, 525.71]);
  });

  it('keeps the deviation of the planned part underneath, and says it is October', () => {
    for (const s of ['month', 'quarter', 'year'] as const) {
      expect(row(s).projected).toBe(5.36);
      expect(measuredMonths(row(s).start, row(s).through)).toEqual({
        from: '2026-10',
        to: '2026-10',
      });
    }
  });

  it('draws the draft as a fraction of the whole stretch', () => {
    // Over the month the bar is full (182.5 of 177.1); over the quarter it is
    // about a third, and the empty two-thirds are November and December.
    expect(stretchBar(row('month'))).toEqual({ kept: 0, filled: 1 });
    expect(stretchBar(row('quarter')).filled).toBeCloseTo(DRAFTED / 525.71, 4);
    expect(stretchBar(row('quarter')).kept).toBe(0);
  });

  it('counts a published December in X even though the measurement stops in October', () => {
    // Christmas planned early: December published, November empty, October
    // being drafted. The horizon stops at November -- nothing there is
    // written -- so the deviation is October's. But December's hours are on
    // the rota, and Y includes December, so X must too.
    const withDecember = {
      ...balances,
      employees: [
        {
          ...balances.employees[0],
          quarter: { ...october(NOV_DEC), planned_stretch: 40 },
        },
      ],
    };
    const q = projectRows(
      withDecember,
      draftHoursIn(draft, withDecember, 'quarter'),
      'quarter',
      draftHoursIn(draft, withDecember, 'quarter', 'stretch'),
    )[0];
    expect(q.kept).toBe(40);
    expect(q.hours).toBe(DRAFTED + 40);
    expect(q.projected).toBe(5.36);
  });

  it('counts a draft shift past the horizon in X and not in the deviation', () => {
    const skipsNovember = [...draft, { employeeId: 'adam', date: '2026-12-15', paidHours: 151 }];
    expect(draftHoursIn(skipsNovember, balances, 'quarter')).toEqual({ adam: DRAFTED });
    expect(draftHoursIn(skipsNovember, balances, 'quarter', 'stretch')).toEqual({
      adam: DRAFTED + 151,
    });
    // Still the end of the stretch, though: the month is a month.
    expect(draftHoursIn(skipsNovember, balances, 'month', 'stretch')).toEqual({ adam: DRAFTED });
  });

  it('reads X from `planned` when the server does not send `planned_stretch`', () => {
    const legacy = {
      employees: [
        person({ quarter: { planned: 300, total: 520, published_in_window: 100 } }),
      ],
    };
    const r = projectRows(legacy, { e1: 90 }, 'quarter')[0];
    expect(r.kept).toBe(200);
    expect(r.hours).toBe(290);
    expect(r.owed).toBe(520);
  });
});

describe('stretchBar', () => {
  it('clamps an overfull stretch to a full bar', () => {
    expect(stretchBar({ kept: 100, hours: 250, owed: 200 })).toEqual({ kept: 0.5, filled: 1 });
  });

  it('never draws the faint part shorter than the solid one', () => {
    // A draft that empties the window: fewer hours than what stays published
    // cannot happen, but a rounding sliver must not draw backwards.
    expect(stretchBar({ kept: 100, hours: 99.99, owed: 200 })).toEqual({ kept: 0.5, filled: 0.5 });
  });

  it('draws nothing for a stretch that asks for nothing', () => {
    expect(stretchBar({ kept: 10, hours: 20, owed: 0 })).toEqual({ kept: 0, filled: 0 });
  });
});

describe('measuredMonths: naming what the deviation covers', () => {
  it('names one month, or a run of them', () => {
    expect(measuredMonths('2026-10-01', '2026-10-31')).toEqual({ from: '2026-10', to: '2026-10' });
    expect(measuredMonths('2026-10-01', '2026-12-31')).toEqual({ from: '2026-10', to: '2026-12' });
    expect(measuredMonths('2026-11-01', '2027-01-31')).toEqual({ from: '2026-11', to: '2027-01' });
  });

  it('refuses a measurement that starts in the middle of a month', () => {
    // A contract signed on the 20th: the figure covers the 20th to the 31st,
    // and "in October" would claim the nineteen days before it.
    expect(measuredMonths('2026-10-20', '2026-10-31')).toBeNull();
    // The first rota published on the 17th of September, asked about the year.
    expect(measuredMonths('2026-09-17', '2026-10-31')).toBeNull();
  });

  it('refuses a measurement that stops in the middle of a month', () => {
    // A past window measured to today: "in September" would name days it did
    // not count, so the column says "to 24 Sep" instead.
    expect(measuredMonths('2026-09-01', '2026-09-24')).toBeNull();
    expect(measuredMonths('2028-02-01', '2028-02-28')).toBeNull(); // a leap February
    expect(measuredMonths('2026-02-01', '2026-02-28')).toEqual({ from: '2026-02', to: '2026-02' });
  });

  it('has nothing to name without both ends', () => {
    expect(measuredMonths(null, '2026-10-31')).toBeNull();
    expect(measuredMonths('2026-10-01', null)).toBeNull();
  });
});

// --- Published is published, wherever it falls -----------------------------
//
// From a screenshot of 24-sep-2026, taken straight after publishing October:
// the draft stays on screen and is the rota now, but every bar was drawn in
// the draft's colour. The split went by WHERE the hours fall -- inside the
// window being replaced counted as draft -- when the question the two shades
// answer is WHETHER they are out already.

describe('the bar after publishing', () => {
  const OCTOBER = 177.14;
  const published = 182.5;
  const october = {
    planned: published,
    planned_stretch: published,
    published_in_window: published,
    total: OCTOBER,
    pending: 348.57,
    horizon: '2026-11-01',
    start: '2026-10-01',
  };
  const balances = {
    employees: [
      { employee_id: 'adam', employee_name: 'adam', month: october, quarter: october, year: october },
    ],
  };

  it('draws a month that has just gone out as published, all of it', () => {
    const row = projectRows(balances, { adam: published }, 'quarter', { adam: published }, { adam: published })[0];
    expect(row.kept).toBe(published);
    expect(row.drafted).toBe(0);
    expect(row.hours).toBe(published);
    expect(stretchBar(row).kept).toBe(stretchBar(row).filled);
  });

  it('draws only what the draft changes in the draft colour', () => {
    // Ten hours moved or added since: 172.5 still match the noticeboard.
    const row = projectRows(balances, { adam: 182.5 }, 'quarter', { adam: 182.5 }, { adam: 172.5 })[0];
    expect(row.kept).toBe(172.5);
    expect(row.drafted).toBe(10);
    expect(row.hours).toBe(182.5);
  });

  it('never lets the settled part add hours of its own', () => {
    const row = projectRows(balances, { adam: 100 }, 'quarter', { adam: 100 }, { adam: 140 })[0];
    expect(row.hours).toBe(100);
    expect(row.kept).toBe(100);
    expect(row.drafted).toBe(0);
  });

  it('draws the draft colour when nothing is out yet, as before', () => {
    const unpublished = { ...october, planned: 0, planned_stretch: 0, published_in_window: 0 };
    const row = projectRows(
      { employees: [{ ...balances.employees[0], quarter: unpublished }] },
      { adam: published },
      'quarter',
      { adam: published },
      {},
    )[0];
    expect(row.kept).toBe(0);
    expect(row.drafted).toBe(published);
  });
});
