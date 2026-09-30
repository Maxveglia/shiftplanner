// The minimum on the floor holds at every minute the business is open.
//
// Coverage is judged one minute per hour: the top of the hour, or the opening
// minute for the hour the business opens in (`coverageMinute` in ./demand).
// A handover that leaves the floor empty for half an hour INSIDE an hour --
// one person leaves at 13:15, the next arrives at 13:45 -- is asked about at
// 13:00 and 14:00, finds somebody both times, and is reported as covered.
//
// People are counted, not shifts: that half is already pinned by
// coverage.test.ts ("counts one person with two shifts on top of each other as
// ONE"), and generate.test.ts pins that a generated week covers every open
// hour. What is missing is the minutes between two of those hours.
//
// Eval case: .claude/evals/reglas-de-turnos/cases/03-cobertura-toda-la-franja.md

import { describe, expect, it } from 'vitest';
import { validateSchedule } from './validate';
import { days, employee, spec } from '../../test/factories';
import { knownGap } from '../../test/knownGap';
import type { Assignment } from './types';

const MONDAY = days('2026-03-02', 1);
const OPEN_ALL_DAY_ONE_ON = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1 });
const ROSTER = [
  employee({ id: 'ana', full_name: 'Ana Ruiz' }),
  employee({ id: 'bruno', full_name: 'Bruno Gil' }),
];

function shift(id: string, employeeId: string, startMin: number, endMin: number): Assignment {
  return {
    id,
    employeeId,
    date: MONDAY[0].date,
    startMin,
    endMin,
    // A band id, the generator's own for a business with no templates, so
    // nothing here is about templates.
    templateId: 'band-morning',
    templateName: 'Mañana',
    color: '#2563EB',
    isNight: false,
    paidHours: (endMin - startMin) / 60,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'manual',
  };
}

function gapsFor(assignments: Assignment[]) {
  return validateSchedule(assignments, ROSTER, [], [], [], OPEN_ALL_DAY_ONE_ON, MONDAY).gaps;
}

describe('one person on the floor from opening to closing', () => {
  it('reports nothing when the handover is clean', () => {
    // Ana 09:00-13:00, Bruno 13:00-17:00: somebody is there every minute.
    expect(gapsFor([shift('a', 'ana', 9 * 60, 13 * 60), shift('b', 'bruno', 13 * 60, 17 * 60)]))
      .toEqual([]);
  });

  knownGap('reports the half hour nobody is there, even inside one hour', () => {
    // Ana 09:00-13:15, Bruno 13:45-17:00: nobody from 13:15 to 13:45.
    const gaps = gapsFor([
      shift('a', 'ana', 9 * 60, 13 * 60 + 15),
      shift('b', 'bruno', 13 * 60 + 45, 17 * 60),
    ]);

    expect(gaps.filter((g) => g.date === MONDAY[0].date).length).toBeGreaterThan(0);
  });
});
