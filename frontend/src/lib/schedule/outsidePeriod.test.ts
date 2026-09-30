// A shift outside the period on screen must never reach that period's draft.
//
// The server owns a shift by the window it STARTS in and refuses a PUT
// /schedule/draft carrying one that starts elsewhere (422
// `shift_outside_period`). The draft is sent whole on every change, so one
// such shift used to make every later save and every publish fail -- after the
// refine panel had said "added". Same for a shift that ends before it starts
// (422 `shift_ends_before_start`), which `move_shift` produced for a night.
//
// These tests stand in for the server with the one check it makes: every
// payload shift starts inside [from, to) and ends after it starts.

import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from './refine';
import { generateSchedule } from './generate';
import { EMPTY_OVERLAY } from './overlay';
import { toShiftPayload } from './persist';
import { cleanStrays, startsOutside, validPins, withinWindow } from './draftSync';
import type { Assignment, ScheduleResult } from './types';
import { setLanguage } from '../i18n/core';
import { absenceType, days, employee, spec } from '../../test/factories';
import type { EmployeeOut } from '../../types';

// October 2026, the whole month: the period on screen.
const OCTOBER = days('2026-10-01', 31);
const FROM = new Date(2026, 9, 1);
const TO = new Date(2026, 10, 1);
const TYPES = [absenceType({ id: 'vac' })];
const ROSTER: EmployeeOut[] = [
  employee({ id: 'e1', full_name: 'Sarah Chen' }),
  employee({ id: 'e2', full_name: 'Hugo Martín' }),
];
const BASE = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1 });

function refine(ops: EditOp[]) {
  const current: ScheduleResult = generateSchedule(ROSTER, [], [], TYPES, BASE, OCTOBER);
  return applyOps(ops, current, BASE, EMPTY_OVERLAY, ROSTER, [], [], TYPES, OCTOBER);
}

/** What `validate_shifts` answers for the window, as far as time goes. */
function serverRefuses(assignments: Assignment[]): string | null {
  for (const s of assignments.map(toShiftPayload)) {
    const start = new Date(s.start_at);
    const end = new Date(s.end_at);
    if (end <= start) return 'shift_ends_before_start';
    if (!(FROM <= start && start < TO)) return 'shift_outside_period';
  }
  return null;
}

describe('refine — a day outside the period on screen', () => {
  it('refuses add_shift on a day of next month instead of saying it was added', () => {
    setLanguage('es');
    const outcome = refine([
      { op: 'add_shift', employee: 'Sarah Chen', date: '2026-11-03', start: '09:00', end: '17:00' },
    ]);

    expect(outcome.result.assignments.some((a) => a.date === '2026-11-03')).toBe(false);
    expect(outcome.overlay.pinned.some((a) => a.date === '2026-11-03')).toBe(false);
    expect(outcome.applied).toEqual([]);
    expect(outcome.appliedOps).toEqual([]);
    expect(outcome.skipped).toHaveLength(1);
    expect(outcome.skipped[0]).toContain('El 3 nov 2026 está fuera de octubre de 2026');
    expect(outcome.skipped[0]).toContain('cambia a ese mes');
    expect(outcome.skipped[0]).not.toContain('2026-11-03');
    expect(serverRefuses(outcome.result.assignments)).toBeNull();
  });

  it('says so in English too', () => {
    setLanguage('en');
    const outcome = refine([
      { op: 'add_shift', employee: 'Sarah Chen', date: '2026-09-30', start: '09:00', end: '17:00' },
    ]);
    expect(outcome.skipped[0]).toContain('Sep 30, 2026 is outside October 2026');
    setLanguage('es');
  });

  it('still adds a shift on a day inside the period', () => {
    const current = generateSchedule(ROSTER, [], [], TYPES, BASE, OCTOBER);
    const free = ROSTER.find(
      (e) => !current.assignments.some((a) => a.date === '2026-10-31' && a.employeeId === e.id),
    )!;
    const outcome = applyOps(
      [{ op: 'add_shift', employee: free.full_name, date: '2026-10-31', start: '18:00', end: '23:00' }],
      current, BASE, EMPTY_OVERLAY, ROSTER, [], [], TYPES, OCTOBER,
    );
    expect(outcome.skipped).toEqual([]);
    expect(
      outcome.result.assignments.some(
        (a) => a.date === '2026-10-31' && a.employeeId === free.id && a.startMin === 18 * 60,
      ),
    ).toBe(true);
    expect(serverRefuses(outcome.result.assignments)).toBeNull();
  });

  it('refuses move_shift and swap outside the period', () => {
    const outcome = refine([
      { op: 'move_shift', employee: 'Sarah Chen', date: '2026-11-02', start: '10:00' },
      { op: 'swap', employeeA: 'Sarah Chen', employeeB: 'Hugo Martín', date: '2026-11-02' },
    ]);
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped).toHaveLength(2);
    for (const reason of outcome.skipped) expect(reason).toContain('2 nov 2026');
  });
});

describe('refine — move_shift into the night', () => {
  it('reads an end before the start as the next morning, not as negative hours', () => {
    const current = generateSchedule(ROSTER, [], [], TYPES, BASE, OCTOBER);
    const target = current.assignments.find((a) => a.date === '2026-10-14')!;
    const who = ROSTER.find((e) => e.id === target.employeeId)!.full_name;
    const outcome = applyOps(
      [{ op: 'move_shift', employee: who, date: '2026-10-14', start: '22:00', end: '02:00' }],
      current, BASE, EMPTY_OVERLAY, ROSTER, [], [], TYPES, OCTOBER,
    );
    const moved = outcome.result.assignments.find(
      (a) => a.date === '2026-10-14' && a.employeeId === target.employeeId && a.startMin === 22 * 60,
    )!;
    expect(moved.endMin).toBe(26 * 60);
    expect(moved.paidHours).toBeGreaterThan(0);
    expect(serverRefuses(outcome.result.assignments)).toBeNull();
  });

  it('refuses a move longer than sixteen hours', () => {
    const current = generateSchedule(ROSTER, [], [], TYPES, BASE, OCTOBER);
    const target = current.assignments.find((a) => a.date === '2026-10-14')!;
    const who = ROSTER.find((e) => e.id === target.employeeId)!.full_name;
    const outcome = applyOps(
      [{ op: 'move_shift', employee: who, date: '2026-10-14', start: '06:00', end: '23:30' }],
      current, BASE, EMPTY_OVERLAY, ROSTER, [], [], TYPES, OCTOBER,
    );
    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped).toHaveLength(1);
  });
});

describe('withinWindow — a draft already carrying a stray shift', () => {
  it('keeps what the server would take and hands back the rest', () => {
    const current = generateSchedule(ROSTER, [], [], TYPES, BASE, OCTOBER);
    const stray: Assignment = { ...current.assignments[0], id: 'stray', date: '2026-11-03' };
    const backwards: Assignment = {
      ...current.assignments[1],
      id: 'backwards',
      startMin: 22 * 60,
      endMin: 2 * 60,
      paidHours: -20,
    };
    const poisoned = [...current.assignments.slice(2), stray, backwards];
    expect(serverRefuses(poisoned)).not.toBeNull();

    const { inside, outside } = withinWindow(poisoned, FROM, TO);
    expect(outside.map((a) => a.id).sort()).toEqual(['backwards', 'stray']);
    expect(inside).toHaveLength(poisoned.length - 2);
    expect(serverRefuses(inside)).toBeNull();
  });

  it('keeps an overnight shift that starts on the last evening', () => {
    const current = generateSchedule(ROSTER, [], [], TYPES, BASE, OCTOBER);
    const night: Assignment = {
      ...current.assignments[0],
      id: 'night',
      date: '2026-10-31',
      startMin: 22 * 60,
      endMin: 30 * 60,
    };
    expect(withinWindow([night], FROM, TO).outside).toEqual([]);
  });
});

describe('cleanStrays / validPins — cleaning a stored draft once', () => {
  const current = generateSchedule(ROSTER, [], [], TYPES, BASE, OCTOBER);
  const stray: Assignment = { ...current.assignments[0], id: 'stray', date: '2026-11-03' };

  it('cuts the strays off a draft that is mostly this window', () => {
    const cleaned = cleanStrays([...current.assignments, stray], FROM, TO)!;
    expect(cleaned.dropped).toBe(1);
    expect(cleaned.assignments).toHaveLength(current.assignments.length);
    expect(serverRefuses(cleaned.assignments)).toBeNull();
  });

  it('has nothing to do with a clean draft', () => {
    expect(cleanStrays(current.assignments, FROM, TO)).toBeNull();
  });

  it('leaves another period entirely alone rather than saving it down to nothing', () => {
    // October's calendar still on screen after moving to November.
    expect(cleanStrays(current.assignments, TO, new Date(2026, 11, 1))).toBeNull();
  });

  it('drops only the pins that are wrong in themselves', () => {
    const backwards: Assignment = { ...current.assignments[1], id: 'bw', startMin: 22 * 60, endMin: 120 };
    const decemberPin: Assignment = { ...current.assignments[2], id: 'dec', date: '2026-12-10' };
    // Filed under the 31st, starting at midnight: the 1st of November.
    const midnight: Assignment = { ...current.assignments[3], id: 'mid', date: '2026-10-31', startMin: 1440, endMin: 1500 };
    const kept = validPins([current.assignments[0], backwards, decemberPin, midnight], FROM, TO).map((a) => a.id);
    expect(kept).toEqual([current.assignments[0].id, 'dec']);
  });
});

describe('startsOutside — a hand edit past midnight of the last day', () => {
  const base = generateSchedule(ROSTER, [], [], TYPES, BASE, OCTOBER).assignments[0];

  it('names the real start day of "0:00 +1" on the 31st', () => {
    const pressed: Assignment = { ...base, date: '2026-10-31', startMin: 1440, endMin: 1500 };
    expect(startsOutside(pressed, FROM, TO)).toBe('2026-11-01');
  });

  it('lets a night that starts on the 31st and runs into November through', () => {
    const night: Assignment = { ...base, date: '2026-10-31', startMin: 22 * 60, endMin: 26 * 60 };
    expect(startsOutside(night, FROM, TO)).toBeNull();
  });

  it('lets the "0:00 +1" of an earlier evening through, it is still October', () => {
    const pressed: Assignment = { ...base, date: '2026-10-14', startMin: 1440, endMin: 1500 };
    expect(startsOutside(pressed, FROM, TO)).toBeNull();
  });
});
