import { describe, expect, it } from 'vitest';
import { planPeriodFor } from './planPeriod';

const TODAY = new Date(2026, 8, 14); // Monday 14 September 2026
const ANCHOR = new Date(2026, 0, 1); // where the toolbar happened to be

describe('planPeriodFor', () => {
  it('plans four weeks from today when the brief says nothing about when', () => {
    expect(planPeriodFor({ briefStart: null, briefMonths: null, today: TODAY, anchor: ANCHOR }))
      .toEqual({ horizon: 'next4', anchor: TODAY });
  });

  it('does the same whatever the toolbar was showing', () => {
    // The whole point: "Year" is a viewing control. Pressing it must not
    // commit the manager to twelve months of AI planning on the next brief.
    const yearAnchor = new Date(2026, 5, 30);
    expect(planPeriodFor({ briefStart: null, briefMonths: null, today: TODAY, anchor: yearAnchor }))
      .toEqual({ horizon: 'next4', anchor: TODAY });
  });

  it('obeys a period the brief named', () => {
    const october = new Date(2026, 9, 1);
    expect(planPeriodFor({ briefStart: october, briefMonths: 1, today: TODAY, anchor: ANCHOR }))
      .toEqual({ horizon: 'brief', anchor: october });
  });

  it('takes a span with no start from where the manager is', () => {
    // "los próximos tres meses" says how long, not from when.
    expect(planPeriodFor({ briefStart: null, briefMonths: 3, today: TODAY, anchor: ANCHOR }))
      .toEqual({ horizon: 'brief', anchor: ANCHOR });
  });
});
