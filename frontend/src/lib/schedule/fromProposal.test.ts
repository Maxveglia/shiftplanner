// The guarantee this whole feature rests on:
//
//   whatever the model says, the calendar that comes out is legal.
//
// Every test here feeds `scheduleFromProposal` something a real model produces
// -- a good month, a month with one impossible shift in it, a month of pure
// garbage -- and asserts the same two things each time: the result is valid,
// and nothing the manager decided was lost.

import { describe, expect, it } from 'vitest';
import { scheduleFromProposal } from './fromProposal';
import { validateSchedule } from './validate';
import { blackoutKey, EMPTY_OVERLAY } from './overlay';
import {
  absence,
  absenceType,
  days,
  employee,
  spec,
} from '../../test/factories';
import type { EmployeeOut } from '../../types';
import type { Assignment } from './types';

const WEEK = days('2026-03-01', 7); // Sunday 1 March to Saturday 7 March
const VACATION = absenceType({ id: 'vac' });
const SPEC = spec({ minStaff: 1, openMin: 9 * 60, closeMin: 17 * 60 });

function team(n: number): EmployeeOut[] {
  return Array.from({ length: n }, (_, i) =>
    employee({ id: `e${i + 1}`, full_name: `Person ${i + 1}` }),
  );
}

function run(
  raw: unknown,
  s = SPEC,
  roster = team(4),
  overlay = EMPTY_OVERLAY,
  absences = [] as ReturnType<typeof absence>[],
) {
  return scheduleFromProposal(
    raw,
    roster,
    [],
    absences,
    [VACATION],
    s,
    WEEK,
    overlay,
  );
}

/** A plausible day's proposal, the way a model writes it. */
function row(employeeId: string, date: string, start = '09:00', end = '17:00') {
  return { employeeId, date, start, end };
}

describe('the guarantee', () => {
  it('produces a legal calendar from a good proposal', () => {
    const raw = WEEK.map((d) => row('e1', d.date));
    const { result, report } = run(raw);
    expect(report.valid).toBe(true);
    expect(report.remaining).toEqual([]);
    expect(result.assignments.length).toBeGreaterThan(0);
  });

  it('produces a legal calendar from a proposal that is pure garbage', () => {
    const { result, report } = run([
      'lunes Ana de 9 a 5',
      { employeeId: null },
      42,
      { employeeId: 'nobody', date: 'whenever', start: 'morning', end: 'later' },
    ]);
    expect(report.proposed).toBe(0);
    expect(report.malformed).toHaveLength(4);
    expect(report.valid).toBe(true);
    // The fallback is not an empty calendar: the greedy pass still covered the
    // week, so a useless model answer costs quality, never the rota itself.
    expect(result.assignments.length).toBeGreaterThan(0);
  });

  it('produces a legal calendar when the API returned nothing at all', () => {
    const { result, report } = run(null);
    expect(report.valid).toBe(true);
    expect(result.assignments.length).toBeGreaterThan(0);
  });
});

describe('what the model got wrong is dropped, not carried', () => {
  it('drops a shift on somebody who is away, and covers the day anyway', () => {
    const away = absence({
      employee_id: 'e1',
      absence_type_id: 'vac',
      start_at: '2026-03-02T00:00:00',
      end_at: '2026-03-02T23:59:00',
    });
    const { result, report } = run(
      [row('e1', '2026-03-02')],
      SPEC,
      team(4),
      EMPTY_OVERLAY,
      [away],
    );
    expect(report.dropped.map((d) => d.kind)).toContain('unavailable');
    // Somebody still works that Monday -- just not the person on holiday.
    const monday = result.assignments.filter((a) => a.date === '2026-03-02');
    expect(monday.length).toBeGreaterThan(0);
    expect(monday.every((a) => a.employeeId !== 'e1')).toBe(true);
  });

  it('drops a shift for a person who does not work here', () => {
    const { report } = run([row('ghost', '2026-03-02')]);
    expect(report.dropped.map((d) => d.kind)).toContain('unknown_employee');
    expect(report.valid).toBe(true);
  });

  it('drops the later of two shifts that leave too little rest', () => {
    const s = spec({ openMin: 6 * 60, closeMin: 22 * 60, minStaff: 1, minRestHours: 11 });
    const { report } = run(
      [
        row('e1', '2026-03-02', '14:00', '22:00'),
        row('e1', '2026-03-03', '06:00', '14:00'),
      ],
      s,
    );
    expect(report.dropped.map((d) => d.kind)).toContain('rest');
    // Only one of the pair goes: the first shift was never at fault.
    expect(report.dropped).toHaveLength(1);
    expect(report.dropped[0].assignment.date).toBe('2026-03-03');
  });

  it('keeps the good shifts of a proposal that also contains a bad one', () => {
    const raw = [
      row('e1', '2026-03-02'),
      row('ghost', '2026-03-03'),
      row('e2', '2026-03-04'),
    ];
    const { report } = run(raw);
    expect(report.proposed).toBe(3);
    expect(report.kept).toBe(2);
    expect(report.dropped).toHaveLength(1);
  });
});

describe("the manager's decisions outrank the model's", () => {
  it('refuses a proposed shift in a slot the manager already pinned', () => {
    const pinned: Assignment = {
      id: 'm1',
      employeeId: 'e1',
      date: '2026-03-02',
      startMin: 9 * 60,
      endMin: 13 * 60,
      templateId: 'band-morning',
      templateName: 'Morning',
      color: '#2563EB',
      isNight: false,
      paidHours: 4,
      overtimeHours: 0,
      extraHours: 0,
      cost: 0,
      source: 'manual',
    };
    const overlay = { ...EMPTY_OVERLAY, pinned: [pinned] };
    const { result } = run([row('e1', '2026-03-02', '13:00', '21:00')], SPEC, team(4), overlay);

    const hers = result.assignments.filter(
      (a) => a.employeeId === 'e1' && a.date === '2026-03-02',
    );
    // Her shift is the one the manager placed, unchanged.
    expect(hers).toHaveLength(1);
    expect(hers[0].source).toBe('manual');
    expect(hers[0].endMin).toBe(13 * 60);
  });

  it('never refills a slot the manager deliberately emptied', () => {
    const overlay = {
      ...EMPTY_OVERLAY,
      blackouts: [blackoutKey('e1', '2026-03-02')],
    };
    const { result, report } = run([row('e1', '2026-03-02')], SPEC, team(4), overlay);
    expect(report.dropped.map((d) => d.kind)).toContain('blackout');
    expect(
      result.assignments.some(
        (a) => a.employeeId === 'e1' && a.date === '2026-03-02',
      ),
    ).toBe(false);
  });
});

describe('the report tells the truth', () => {
  it('counts what was proposed, kept and filled', () => {
    const raw = [row('e1', '2026-03-02'), row('e2', '2026-03-03')];
    const { result, report } = run(raw);
    expect(report.proposed).toBe(2);
    expect(report.kept).toBe(2);
    expect(report.filled).toBe(result.assignments.length - 2);
    expect(report.filled).toBeGreaterThan(0); // the rest of the week
  });

  it('the calendar it reports as valid really does validate', () => {
    // Belt and braces: re-run the check outside the pipeline, so a bug in how
    // the report is assembled cannot make a broken calendar look clean.
    const raw = WEEK.flatMap((d) => [row('e1', d.date), row('e2', d.date)]);
    const roster = team(4);
    const { result, report } = run(raw, SPEC, roster);
    const independent = validateSchedule(
      result.assignments,
      roster,
      [],
      [],
      [VACATION],
      SPEC,
      WEEK,
    );
    expect(report.valid).toBe(independent.ok);
    expect(independent.ok).toBe(true);
  });
});
