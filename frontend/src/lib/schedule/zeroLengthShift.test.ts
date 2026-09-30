// A shift from nine to nine is a mistake, not a day.
//
// "09:00-09:00" is somebody who filled the second box before they meant to.
// Everywhere this codebase reads a close before an open as a night -- rightly,
// 22:00-06:00 IS a night -- the same arithmetic turns the equal case into
// twenty-four hours: `if (end <= start) end += 24 * 60`. The model's proposals
// already refuse it (`zero_length` in ./proposal, pinned in
// validate.proposal.test.ts), and so does publishing on the server. These are
// the two doors that still let it in.
//
// Eval case: .claude/evals/reglas-de-turnos/cases/01-inicio-igual-fin.md

import { describe, expect } from 'vitest';
import { generateSchedule } from './generate';
import { applyOps } from './refine';
import { EMPTY_OVERLAY } from './overlay';
import { absenceType, days, employee, spec, template } from '../../test/factories';
import { knownGap } from '../../test/knownGap';
import type { EmployeeOut } from '../../types';

const WEEK = days('2026-03-02', 7); // Monday 2 March to Sunday 8 March
const WEDNESDAY = '2026-03-04';
const TYPES = [absenceType({ id: 'vac' })];
const DAY = 24 * 60;

const ROSTER: EmployeeOut[] = [
  employee({ id: 'e1', full_name: 'Sarah Chen' }),
  employee({ id: 'e2', full_name: 'Hugo Martín' }),
  employee({ id: 'e3', full_name: 'Adri Blanco' }),
  employee({ id: 'e4', full_name: 'Uri Sanz' }),
];

/** A template whose two boxes say the same minute. */
const NINE_TO_NINE = template({
  id: 'tpl-nine-to-nine',
  name: 'Mañana',
  start_time: '09:00',
  end_time: '09:00',
  unpaid_break_minutes: 0,
});

describe('a template that starts when it ends', () => {
  knownGap('is never cut into a shift by the generator', () => {
    // Read as twenty-four hours and clipped to an ordinary 09:00-17:00 day,
    // it becomes every shift of the week -- each one a perfectly normal
    // "Mañana", which is exactly why nobody notices where they came from.
    const s = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1 });
    const result = generateSchedule(ROSTER, [NINE_TO_NINE], [], TYPES, s, WEEK);

    expect(result.assignments.filter((a) => a.templateId === NINE_TO_NINE.id)).toEqual([]);
  });
});

describe('asking for cover from nine to nine', () => {
  knownGap('is refused rather than placed as a 24-hour shift', () => {
    const s = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1 });
    const current = generateSchedule(ROSTER, [], [], TYPES, s, WEEK);
    const outcome = applyOps(
      [{ op: 'add_coverage', date: WEDNESDAY, start: '09:00', end: '09:00', staff: 1 }],
      current,
      s,
      EMPTY_OVERLAY,
      ROSTER,
      [],
      [],
      TYPES,
      WEEK,
    );

    expect(outcome.result.assignments.filter((a) => a.endMin - a.startMin >= DAY)).toEqual([]);
    expect(outcome.appliedOps).toEqual([]);
    expect(outcome.skipped.length).toBeGreaterThan(0);
  });
});
