// The team's published rota as the draft to start from, and back again.
//
// Two properties. Converting what the server holds into a draft must give
// exactly those shifts, priced, and no gaps -- a period opened on a fresh
// browser shows what the team sees, not what the default spec thinks is
// missing. And a draft made that way, diffed against the rows it came from,
// is empty: otherwise "Publish 0 changes" would never be the button's label
// on a calendar nobody touched.

import { describe, expect, it } from 'vitest';
import { fromAssignmentOutList, seedFromPublished, specFromShifts, toShiftPayload } from './persist';
import { diffAssignments } from './diff';
import { contract, days, employee, template } from '../../test/factories';
import type { AssignmentOut } from '../../types';

const PEOPLE = [
  employee({ id: 'e1', full_name: 'Sarah', current_contract: contract({ hourly_rate: 20 }) }),
  employee({ id: 'e2', full_name: 'Luis', current_contract: contract({ hourly_rate: 15 }) }),
];
const T = template({ id: 't1', name: 'Day' });
const WEEK = days('2026-03-02', 7);

function row(over: Partial<AssignmentOut> & { employee_id: string; start_at: string; end_at: string }): AssignmentOut {
  return {
    id: Math.random().toString(36).slice(2),
    shift_template_id: 't1',
    unpaid_break_minutes: 0,
    status: 'published',
    source: 'ai',
    is_overtime: false,
    is_premium: false,
    published_at: '2026-03-01T10:00:00.000Z',
    ...over,
  };
}

const PUBLISHED: AssignmentOut[] = [
  row({ employee_id: 'e1', start_at: '2026-03-06T09:00:00', end_at: '2026-03-06T17:00:00' }),
  row({ employee_id: 'e2', start_at: '2026-03-06T16:00:00', end_at: '2026-03-06T22:00:00' }),
];

describe('draftFromPublished — what the team has is where the manager starts', () => {
  it('gives exactly the published shifts, priced, and no gaps', () => {
    const draft = seedFromPublished(PUBLISHED, PEOPLE, [T], [], [], WEEK).result;
    expect(draft.assignments).toHaveLength(2);
    const sarah = draft.assignments.find((a) => a.employeeId === 'e1')!;
    expect([sarah.date, sarah.startMin, sarah.endMin]).toEqual(['2026-03-06', 9 * 60, 17 * 60]);
    expect(sarah.cost).toBe(8 * 20);
    expect(draft.gaps).toEqual([]);
  });

  it('pins every seeded shift, so a rebuild cannot lose one', () => {
    const seeded = seedFromPublished(PUBLISHED, PEOPLE, [T], [], [], WEEK);
    expect(seeded.overlay.pinned).toHaveLength(2);
    expect(seeded.overlay.pinned.map((a) => a.employeeId).sort()).toEqual(['e1', 'e2']);
  });

  it('asks for nobody, over the hours the rota spans', () => {
    const { spec } = seedFromPublished(PUBLISHED, PEOPLE, [T], [], [], WEEK);
    expect([spec.openMin, spec.closeMin, spec.minStaff]).toEqual([9 * 60, 22 * 60, 0]);
    // One rota cannot say which weekdays the business closes.
    expect(spec.closedWeekdays).toEqual([]);
    expect(specFromShifts([]).minStaff).toBe(0);
  });

  it('diffs to nothing against the rows it came from', () => {
    const draft = seedFromPublished(PUBLISHED, PEOPLE, [T], [], [], WEEK).result;
    expect(diffAssignments(fromAssignmentOutList(PUBLISHED, [T]), draft.assignments).total).toBe(0);
  });

  it('one removed shift is one change, for that person', () => {
    const draft = seedFromPublished(PUBLISHED, PEOPLE, [T], [], [], WEEK).result;
    const without = draft.assignments.filter((a) => a.employeeId !== 'e2');
    const diff = diffAssignments(fromAssignmentOutList(PUBLISHED, [T]), without);
    expect(diff.total).toBe(1);
    expect(diff.people.map((p) => p.employeeId)).toEqual(['e2']);
  });

  it('survives the round trip through the publish payload', () => {
    // What is sent up is what comes back down: the same date and hours.
    const draft = seedFromPublished(PUBLISHED, PEOPLE, [T], [], [], WEEK).result;
    const payload = draft.assignments.map(toShiftPayload);
    expect(payload[0].employee_id).toBe('e1');
    expect(new Date(payload[0].start_at).getHours()).toBe(9);
  });
});


describe('specFromShifts, one window per weekday', () => {
  // The October that drew every day from 03:00: one early shift somewhere in
  // the month set the window for all thirty-one days.
  const base = {
    templateId: 'synth', templateName: 'Turno', color: '#000', isNight: true,
    paidHours: 8, overtimeHours: 0, extraHours: 0, cost: 0, source: 'ai' as const,
  };
  const shifts = [
    { ...base, id: 'a', employeeId: 'e1', date: '2026-10-20', startMin: 17 * 60, endMin: 27 * 60 },
    { ...base, id: 'b', employeeId: 'e2', date: '2026-10-24', startMin: 17 * 60, endMin: 28 * 60 },
    { ...base, id: 'c', employeeId: 'e3', date: '2026-10-27', startMin: 3 * 60, endMin: 7 * 60 },
  ];

  it('gives each weekday the span of its own shifts', () => {
    const s = specFromShifts(shifts);
    const tuesday = s.dayHours?.find((d) => d.weekday === 2);
    const saturday = s.dayHours?.find((d) => d.weekday === 6);
    // Both Tuesdays, the 20th and the 27th, count toward Tuesday.
    expect(tuesday).toEqual({ weekday: 2, openMin: 3 * 60, closeMin: 27 * 60 });
    expect(saturday).toEqual({ weekday: 6, openMin: 17 * 60, closeMin: 28 * 60 });
  });

  it('still asks for nobody', () => {
    expect(specFromShifts(shifts).minStaff).toBe(0);
  });
});
