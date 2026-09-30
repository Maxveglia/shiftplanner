// A night shift, 22:00 to 06:00, is eight hours of work.
//
// The server stores it as two instants a calendar day apart. The browser files
// it under the night it STARTS on, with an end past 1440, and has to get eight
// out of that -- not sixteen (06:00 minus 22:00, the wrong way round), not
// two (what is left of Monday), and not eight on Monday plus six on Tuesday.
//
// payroll.test.ts already prices a night shift, but writes its eight hours in
// by hand; this is where they come from.
//
// Eval case: .claude/evals/reglas-de-turnos/cases/02-nocturno-22-06.md

import { describe, expect, it } from 'vitest';
import { fromAssignmentOut } from './persist';
import { computePayroll } from './payroll';
import { contract, days, employee } from '../../test/factories';
import type { AssignmentOut } from '../../types';

const WEEK = days('2026-03-02', 7); // Monday 2 March to Sunday 8 March

/** Monday 22:00 to Tuesday 06:00, local wall clock, no break. */
const NIGHT_ROW: AssignmentOut = {
  id: 'night',
  employee_id: 'e1',
  // No `Z`: local wall-clock strings, so the test does not depend on the
  // machine's zone (see the note on `absence` in test/factories.ts).
  start_at: '2026-03-02T22:00:00',
  end_at: '2026-03-03T06:00:00',
  shift_template_id: null,
  unpaid_break_minutes: 0,
  status: 'published',
  source: 'manual',
  is_overtime: false,
  is_premium: true,
  published_at: null,
};

describe('a shift from 22:00 to 06:00', () => {
  it('is read back as eight paid hours, under the night it starts on', () => {
    const a = fromAssignmentOut(NIGHT_ROW, []);

    expect(a.date).toBe('2026-03-02');
    expect([a.startMin, a.endMin]).toEqual([22 * 60, 30 * 60]);
    expect(a.paidHours).toBe(8);
  });

  it('is paid as eight hours, once', () => {
    const person = employee({
      id: 'e1',
      current_contract: contract({ employee_id: 'e1', hourly_rate: 20 }),
    });
    const { rows } = computePayroll([fromAssignmentOut(NIGHT_ROW, [])], [person], WEEK);

    expect(rows[0].totalHours).toBe(8);
    // All eight fall inside the default night window, 22:00-06:00.
    expect(rows[0].nightHours).toBeCloseTo(8, 6);
  });
});
