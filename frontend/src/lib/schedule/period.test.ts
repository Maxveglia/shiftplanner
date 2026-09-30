// A period the brief NAMES, rather than counts.
//
// "El horario debe cubrir solamente el mes de octubre" came back under the
// heading NOTED, BUT NOT YET ENFORCEABLE: understood, unplaceable, printed as
// prose, and a calendar built for a different period. The spec could say how
// MANY months and never WHICH one, so October's rules were applied to whatever
// week the toolbar happened to be showing.
//
// The span itself was already right. What was missing was moving to it.

import { describe, expect, it } from 'vitest';
import { spanMonths } from './generate';

describe('a month the brief named', () => {
  it('covers exactly that month', () => {
    // "Solo el mes de octubre" arrives as a start of 2026-10-01 and one month.
    // October has 31 days and the span may not spill into November.
    const days = spanMonths(new Date(2026, 9, 1), 1);
    expect(days).toHaveLength(31);
    expect(days[0].date).toBe('2026-10-01');
    expect(days[30].date).toBe('2026-10-31');
  });

  it('starts on the first even when pointed at a day mid-month', () => {
    // The anchor is where the manager was, not where the month begins. A brief
    // naming a month means the whole month.
    const days = spanMonths(new Date(2026, 9, 17), 1);
    expect(days[0].date).toBe('2026-10-01');
    expect(days).toHaveLength(31);
  });

  it('runs on past a month boundary when asked for more than one', () => {
    const days = spanMonths(new Date(2026, 9, 1), 2);
    expect(days).toHaveLength(31 + 30);
    expect(days[days.length - 1].date).toBe('2026-11-30');
  });
});
