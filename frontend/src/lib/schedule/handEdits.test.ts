// An adjustment that comes back after the manager edited by hand.
//
// The race this guards: the sentence goes out with the calendar as it was,
// the manager drags a shift in while the AI is thinking, and the answer --
// built on the calendar as it WAS -- is written over the one on screen. That
// is exactly what `applyPlan` did, and the shift they had just placed was
// gone with no trace. These tests replay that sequence with the real
// `applyOps`, so the "before" is the product's own code path.

import { describe, expect, it } from 'vitest';
import { applyOps, type EditOp } from './refine';
import { generateSchedule, summarize } from './generate';
import { EMPTY_OVERLAY, blackoutKey, withBlackouts, withPinned, withoutPinned } from './overlay';
import { slotKey } from './diff';
import { keepHandEdits, handEditNote, keepableOn, refusedHandEditNote } from './handEdits';
import type { Assignment, ScheduleResult } from './types';
import { absence, absenceType, days, employee, spec } from '../../test/factories';
import type { EmployeeOut } from '../../types';

const WEEK = days('2026-03-01', 7);
const WEDNESDAY = '2026-03-04';
const TYPES = [absenceType({ id: 'vac' })];
const ROSTER: EmployeeOut[] = [
  employee({ id: 'e1', full_name: 'Sarah Chen' }),
  employee({ id: 'e2', full_name: 'Hugo Martín' }),
  employee({ id: 'e3', full_name: 'Adri Blanco' }),
  employee({ id: 'e4', full_name: 'Uri Sanz' }),
];
const BASE = spec({ openMin: 9 * 60, closeMin: 17 * 60, minStaff: 1 });

/** The calendar on screen when the sentence was sent. */
function snapshot(): ScheduleResult {
  return generateSchedule(ROSTER, [], [], TYPES, BASE, WEEK);
}

/** What the AI's operations make of the calendar they were shown. */
function answer(ops: EditOp[], shown: ScheduleResult) {
  return applyOps(ops, shown, BASE, EMPTY_OVERLAY, ROSTER, [], [], TYPES, WEEK);
}

/** A shift placed by hand, the way `handleAddShift` places one. */
function handShift(employeeId: string, date: string, startMin: number, endMin: number): Assignment {
  return {
    id: `manual-${employeeId}-${date}`,
    employeeId,
    date,
    startMin,
    endMin,
    templateId: 'manual',
    templateName: 'Manual',
    color: '#000',
    isNight: false,
    paidHours: (endMin - startMin) / 60,
    overtimeHours: 0,
    extraHours: 0,
    cost: 0,
    source: 'manual',
  } as Assignment;
}

describe('keepHandEdits — an AI answer lands on the calendar as it is now', () => {
  it('keeps a shift added and one removed by hand while the AI was working', () => {
    const shown = snapshot();
    // The sentence: "Sarah is off on Wednesday".
    const ops: EditOp[] = [{ op: 'day_off', employee: 'Sarah Chen', date: WEDNESDAY }];

    // Meanwhile, by hand: Hugo gets an evening on Saturday, and one of the
    // shifts on Monday is taken off.
    const saturday = '2026-03-07';
    const added = handShift('e2', saturday, 13 * 60, 17 * 60);
    const mondayShift = shown.assignments.find(
      (a) => a.date === '2026-03-02' && a.employeeId !== 'e1',
    )!;
    expect(mondayShift).toBeDefined();
    const current = [
      ...shown.assignments.filter((a) => a.id !== mondayShift.id && !(a.employeeId === 'e2' && a.date === saturday)),
      added,
    ];
    let currentOverlay = withPinned(EMPTY_OVERLAY, [added]);
    currentOverlay = withBlackouts(
      withoutPinned(currentOverlay, (a) => a.id === mondayShift.id),
      [{ employeeId: mondayShift.employeeId, date: mondayShift.date }],
    );

    // The AI answers, built on what it was shown.
    const outcome = answer(ops, shown);

    // What `applyPlan` used to write: the answer as it came. Both hand edits
    // are gone -- this is the bug.
    const naive = outcome.result.assignments.map(slotKey);
    expect(naive).not.toContain(slotKey(added));
    expect(naive).toContain(slotKey(mondayShift));

    const landed = keepHandEdits({
      base: shown.assignments,
      current,
      next: outcome.result.assignments,
      baseOverlay: EMPTY_OVERLAY,
      currentOverlay,
      nextOverlay: outcome.overlay,
    });
    const keys = landed.assignments.map(slotKey);
    // The hand edits stand...
    expect(keys).toContain(slotKey(added));
    expect(keys).not.toContain(slotKey(mondayShift));
    // ...and so does the adjustment.
    expect(landed.assignments.some((a) => a.employeeId === 'e1' && a.date === WEDNESDAY)).toBe(false);
    // The pins and blackouts of both survive, so a later rebuild keeps them.
    expect(landed.overlay!.pinned.map(slotKey)).toContain(slotKey(added));
    expect(landed.overlay!.blackouts).toContain(blackoutKey(mondayShift.employeeId, mondayShift.date));
    expect(landed.overlay!.blackouts).toContain(blackoutKey('e1', WEDNESDAY));
    // Nothing the two disagreed on, so nothing to say.
    expect(landed.conflicts).toEqual([]);
  });

  it('lets the hand edit win on a day the AI also changed, and says so', () => {
    const shown = snapshot();
    const ops: EditOp[] = [{ op: 'day_off', employee: 'Sarah Chen', date: WEDNESDAY }];
    // The manager, meanwhile, puts Sarah on Wednesday afternoon by hand.
    const mine = handShift('e1', WEDNESDAY, 13 * 60, 17 * 60);
    const current = [
      ...shown.assignments.filter((a) => !(a.employeeId === 'e1' && a.date === WEDNESDAY)),
      mine,
    ];
    const currentOverlay = withPinned(EMPTY_OVERLAY, [mine]);
    const outcome = answer(ops, shown);

    const landed = keepHandEdits({
      base: shown.assignments,
      current,
      next: outcome.result.assignments,
      baseOverlay: EMPTY_OVERLAY,
      currentOverlay,
      nextOverlay: outcome.overlay,
    });
    const sarahWednesday = landed.assignments.filter(
      (a) => a.employeeId === 'e1' && a.date === WEDNESDAY,
    );
    expect(sarahWednesday.map(slotKey)).toEqual([slotKey(mine)]);
    // Her blackout from the AI is dropped with it: a pin and a blackout on
    // the same day would contradict each other on the next rebuild.
    expect(landed.overlay!.blackouts).not.toContain(blackoutKey('e1', WEDNESDAY));
    expect(landed.conflicts).toEqual([{ employeeId: 'e1', date: WEDNESDAY }]);
    expect(handEditNote(landed.conflicts, ROSTER)).toContain('Sarah Chen');
  });

  it('keeps hand edits through a replan that rewrote every day', () => {
    // "Reorganize with AI" answers a whole month, not operations; the answer
    // here is a rebuild with fresh ids. A hand-removed shift must not come
    // back under a new name.
    const shown = snapshot();
    const gone = shown.assignments[0];
    const current = shown.assignments.filter((a) => a.id !== gone.id);
    const replanned = generateSchedule(ROSTER, [], [], TYPES, { ...BASE, minStaff: 2 }, WEEK);

    const landed = keepHandEdits({ base: shown.assignments, current, next: replanned.assignments });
    const cell = landed.assignments.filter(
      (a) => a.employeeId === gone.employeeId && a.date === gone.date,
    );
    expect(cell).toEqual([]);
    expect(landed.touched).toBe(true);
  });

  it('returns the answer itself when nothing was edited by hand', () => {
    const shown = snapshot();
    const outcome = answer([{ op: 'day_off', employee: 'Sarah Chen', date: WEDNESDAY }], shown);
    const landed = keepHandEdits({
      base: shown.assignments,
      current: shown.assignments,
      next: outcome.result.assignments,
      baseOverlay: EMPTY_OVERLAY,
      currentOverlay: EMPTY_OVERLAY,
      nextOverlay: outcome.overlay,
    });
    expect(landed.assignments).toBe(outcome.result.assignments);
    expect(landed.overlay).toBe(outcome.overlay);
    expect(landed.touched).toBe(false);
  });

  it('does not report a conflict where the hand and the AI did the same thing', () => {
    // Both took Sarah off Wednesday: nothing of the answer was lost.
    const shown = snapshot();
    const ops: EditOp[] = [{ op: 'day_off', employee: 'Sarah Chen', date: WEDNESDAY }];
    const outcome = answer(ops, shown);
    const current = shown.assignments.filter(
      (a) => !(a.employeeId === 'e1' && a.date === WEDNESDAY),
    );
    const currentOverlay = withBlackouts(EMPTY_OVERLAY, [{ employeeId: 'e1', date: WEDNESDAY }]);
    // The AI's refill of the hole lands on other people's cells, not Sarah's;
    // her own cell is where the two met.
    const landed = keepHandEdits({
      base: shown.assignments,
      current,
      next: outcome.result.assignments,
      baseOverlay: EMPTY_OVERLAY,
      currentOverlay,
      nextOverlay: outcome.overlay,
    });
    expect(landed.conflicts).toEqual([]);
    expect(handEditNote(landed.conflicts, ROSTER)).toBeNull();
  });
});

describe('keepHandEdits — what the answer settles is not the hand\'s to undo', () => {
  it('drops a hand edit for somebody the sentence let go, instead of crashing the landing', () => {
    // "Uri is leaving": the answer is rebuilt over a team without him. The
    // manager, meanwhile, stretched one of Uri's shifts by hand.
    const shown = snapshot();
    const uri = shown.assignments.find((a) => a.employeeId === 'e4')
      ?? handShift('e4', WEDNESDAY, 9 * 60, 13 * 60);
    const stretched = { ...uri, id: 'stretched', endMin: uri.endMin + 60 };
    const current = [...shown.assignments.filter((a) => a.id !== uri.id), stretched];
    const team = ROSTER.filter((e) => e.id !== 'e4');
    const next = generateSchedule(team, [], [], TYPES, BASE, WEEK).assignments;

    // Kept regardless, the landing cannot even be costed: `summarize` has
    // nobody to cost Uri's shift against. That throw used to leave the
    // adjust button spinning for good.
    const blind = keepHandEdits({ base: shown.assignments, current, next });
    expect(() => summarize(blind.assignments, team, [], TYPES, BASE, WEEK)).toThrow();

    const landed = keepHandEdits({
      base: shown.assignments,
      current,
      next,
      mayKeep: keepableOn(team, [], TYPES),
    });
    expect(landed.assignments.some((a) => a.employeeId === 'e4')).toBe(false);
    expect(landed.refused).toEqual([{ employeeId: 'e4', date: stretched.date }]);
    expect(() => summarize(landed.assignments, team, [], TYPES, BASE, WEEK)).not.toThrow();
    expect(
      refusedHandEditNote(landed.refused, team, new Map([['e4', 'Uri Sanz']])),
    ).toContain('Uri Sanz');
  });

  it('does not keep a hand-placed shift on a day the sentence made an absence', () => {
    // "Hugo is off sick this week" wrote an absence; meanwhile Hugo was put on
    // Thursday by hand. The absence takes the shift (PR #130), hand or not.
    const shown = snapshot();
    const thursday = '2026-03-05';
    const mine = handShift('e2', thursday, 13 * 60, 17 * 60);
    const current = [
      ...shown.assignments.filter((a) => !(a.employeeId === 'e2' && a.date === thursday)),
      mine,
    ];
    const sick = absence({
      employee_id: 'e2',
      absence_type_id: 'vac',
      start_at: '2026-03-02T00:00:00',
      end_at: '2026-03-08T23:59:00',
    });
    const next = generateSchedule(ROSTER, [], [sick], TYPES, BASE, WEEK).assignments;

    const landed = keepHandEdits({
      base: shown.assignments,
      current,
      next,
      mayKeep: keepableOn(ROSTER, [sick], TYPES),
    });
    expect(landed.assignments.map(slotKey)).not.toContain(slotKey(mine));
    expect(landed.assignments.some((a) => a.employeeId === 'e2')).toBe(false);
    expect(landed.refused).toEqual([{ employeeId: 'e2', date: thursday }]);
    expect(refusedHandEditNote(landed.refused, ROSTER)).toContain('Hugo');
  });
});
