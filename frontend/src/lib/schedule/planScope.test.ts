import { describe, expect, it } from 'vitest';
import { cutFor, daysInMonths, monthsOfDays, planningScope } from './planScope';
import type { DayRef } from './types';

/** A run of days across whole months, the way `spanMonths` hands them over. */
function period(months: string[], perMonth = 3): DayRef[] {
  const days: DayRef[] = [];
  for (const m of months) {
    for (let d = 1; d <= perMonth; d += 1) {
      const date = `${m}-${String(d).padStart(2, '0')}`;
      days.push({ date, weekday: d % 7, label: date });
    }
  }
  return days;
}

const NOTHING_PUBLISHED = new Set<string>();

describe('planningScope — how much of the horizon a replan touches', () => {
  it('sends the focused month alone, not the twelve on screen', () => {
    const year = period(['2026-01', '2026-02', '2026-03']);
    const scope = planningScope(year, {
      scope: 'month',
      focus: '2026-02',
      published: NOTHING_PUBLISHED,
      includePublished: false,
    });
    expect(scope.months).toEqual(['2026-02']);
    expect(scope.days.every((d) => d.date.startsWith('2026-02'))).toBe(true);
    expect(cutFor(scope, 'out_of_scope')).toEqual(['2026-01', '2026-03']);
  });

  it('sends every month when the manager asks for the horizon', () => {
    const year = period(['2026-01', '2026-02', '2026-03']);
    const scope = planningScope(year, {
      scope: 'horizon',
      focus: '2026-02',
      published: NOTHING_PUBLISHED,
      includePublished: false,
    });
    expect(scope.months).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(scope.days).toHaveLength(9);
    expect(scope.cut).toEqual([]);
  });

  // A stale focus is the ordinary case, not an edge one: the toolbar moves the
  // period and the remembered month is left pointing outside it.
  it('falls back to the first month when the focus is not in the period', () => {
    const scope = planningScope(period(['2026-05', '2026-06']), {
      scope: 'month',
      focus: '2025-12',
      published: NOTHING_PUBLISHED,
      includePublished: false,
    });
    expect(scope.months).toEqual(['2026-05']);
  });

  it('never empties a single-month period, whatever the focus says', () => {
    const scope = planningScope(period(['2026-05']), {
      scope: 'month',
      focus: '2026-09',
      published: NOTHING_PUBLISHED,
      includePublished: false,
    });
    expect(scope.months).toEqual(['2026-05']);
  });

  it('leaves a published month alone and says which', () => {
    const scope = planningScope(period(['2026-01', '2026-02']), {
      scope: 'horizon',
      focus: '2026-01',
      published: new Set(['2026-01']),
      includePublished: false,
    });
    expect(scope.months).toEqual(['2026-02']);
    expect(cutFor(scope, 'published')).toEqual(['2026-01']);
    expect(scope.days.every((d) => d.date.startsWith('2026-02'))).toBe(true);
  });

  it('replans a published month once the manager asks for it', () => {
    const scope = planningScope(period(['2026-01', '2026-02']), {
      scope: 'horizon',
      focus: '2026-01',
      published: new Set(['2026-01']),
      includePublished: true,
    });
    expect(scope.months).toEqual(['2026-01', '2026-02']);
    expect(scope.cut).toEqual([]);
  });

  // Nothing to ask the planner: the dashboard has to be able to tell this
  // apart from "the model rearranged nothing", and an empty month list is how.
  it('comes back empty when the only month in scope is published', () => {
    const scope = planningScope(period(['2026-01', '2026-02']), {
      scope: 'month',
      focus: '2026-01',
      published: new Set(['2026-01']),
      includePublished: false,
    });
    expect(scope.months).toEqual([]);
    expect(scope.days).toEqual([]);
    expect(cutFor(scope, 'published')).toEqual(['2026-01']);
    expect(cutFor(scope, 'out_of_scope')).toEqual(['2026-02']);
  });

  it('handles a period with no days at all', () => {
    expect(
      planningScope([], {
        scope: 'horizon',
        focus: null,
        published: NOTHING_PUBLISHED,
        includePublished: false,
      }),
    ).toEqual({ months: [], days: [], cut: [] });
  });
});

describe('monthsOfDays / daysInMonths', () => {
  it('lists each month once, in calendar order', () => {
    expect(monthsOfDays(period(['2026-01', '2026-02']))).toEqual([
      '2026-01',
      '2026-02',
    ]);
  });

  it('keeps the days of the months asked for, in their original order', () => {
    const days = daysInMonths(period(['2026-01', '2026-02', '2026-03']), [
      '2026-03',
      '2026-01',
    ]);
    expect(days.map((d) => d.date.slice(0, 7))).toEqual([
      '2026-01',
      '2026-01',
      '2026-01',
      '2026-03',
      '2026-03',
      '2026-03',
    ]);
  });
});

describe('a month named in the instruction', () => {
  const YEAR = days12();

  it('is what gets replanned, whatever the control says', () => {
    // The bug: October asked for, September replanned, because the scope came
    // off the control and the open folder and the sentence was never read.
    const scope = planningScope(YEAR, {
      scope: 'month',
      focus: '2026-09',
      named: ['2026-10'],
      published: new Set(),
      includePublished: false,
    });
    expect(scope.months).toEqual(['2026-10']);
    expect(cutFor(scope, 'out_of_scope')).toContain('2026-09');
  });

  it('beats the whole-horizon choice too', () => {
    const scope = planningScope(YEAR, {
      scope: 'horizon',
      focus: '2026-09',
      named: ['2026-10'],
      published: new Set(),
      includePublished: false,
    });
    expect(scope.months).toEqual(['2026-10']);
  });

  it('changes nothing when no month was named', () => {
    const scope = planningScope(YEAR, {
      scope: 'month',
      focus: '2026-09',
      named: [],
      published: new Set(),
      includePublished: false,
    });
    expect(scope.months).toEqual(['2026-09']);
  });

  it('still leaves a published month alone', () => {
    // Naming a month is not permission to rewrite a rota the team has.
    const scope = planningScope(YEAR, {
      scope: 'month',
      focus: '2026-09',
      named: ['2026-10'],
      published: new Set(['2026-10']),
      includePublished: false,
    });
    expect(scope.months).toEqual([]);
    expect(cutFor(scope, 'published')).toEqual(['2026-10']);
  });
});


/** A twelve-month horizon, one day per month: enough for a scope decision. */
function days12() {
  return Array.from({ length: 12 }, (_, i) => ({
    date: `2026-${String(i + 1).padStart(2, '0')}-01`,
    weekday: 0,
    label: '',
  }));
}
