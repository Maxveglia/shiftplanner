// Pressing an hour that is already worked.
//
// Reported from production: "es posible poner una hora sobre otra y cuenta
// como si hubieran dos personas". Both halves were true and they are fixed in
// different files -- the counting in ./coverage, the creating here.
//
// What a press inside somebody's own shift means is now the obvious thing:
// make that shift reach here. Not a second shift on top, which nobody can
// work and the server refuses to store.

import { describe, expect, it } from 'vitest';
import { PRESSED_SHIFT_MIN, placeShift } from './placeShift';
import { spec as makeSpec } from '../../test/factories';
import type { Assignment, SchedulingSpec } from './types';

const DATE = '2026-10-15';

/** Spain: nine ordinary hours a day (art. 34.3 ET), from the rules table. */
const SPAIN: SchedulingSpec = makeSpec({
  openMin: 16 * 60,
  closeMin: 27 * 60,
  maxDailyHours: 9,
});

function shift(over: Partial<Assignment> = {}): Assignment {
  const startMin = over.startMin ?? 17 * 60;
  const endMin = over.endMin ?? 20 * 60;
  return {
    id: 'a1',
    employeeId: 'e1',
    date: DATE,
    startMin,
    endMin,
    templateId: 'band-evening',
    templateName: 'Evening',
    color: 'blue',
    isNight: false,
    paidHours: (endMin - startMin) / 60,
    overtimeHours: 0,
    extraHours: 0,
    cost: 100,
    source: 'ai',
    ...over,
  } as Assignment;
}

/** The shift a press would create on empty hours. */
function creator(employeeId = 'e1') {
  return (startMin: number): Assignment =>
    shift({
      id: 'new',
      employeeId,
      startMin,
      endMin: startMin + PRESSED_SHIFT_MIN,
      source: 'manual',
    });
}

function press(
  assignments: Assignment[],
  startAt: number,
  over: Partial<SchedulingSpec> = {},
  employeeId = 'e1',
) {
  return placeShift({
    assignments,
    employeeId,
    date: DATE,
    startAt,
    spec: { ...SPAIN, ...over },
    create: creator(employeeId),
  });
}

describe('pressing empty hours', () => {
  it('still makes a new shift', () => {
    const out = press([], 18 * 60);
    expect(out.assignments).toHaveLength(1);
    expect(out.assignments[0].startMin).toBe(18 * 60);
  });

  it('makes a new shift when the person works elsewhere that day', () => {
    // A split day: two separate stretches, nowhere near each other.
    const out = press([shift({ startMin: 17 * 60, endMin: 19 * 60 })], 23 * 60);
    expect(out.assignments).toHaveLength(2);
  });

  it('does not touch somebody else’s shift', () => {
    const theirs = shift({ id: 'other', employeeId: 'e2' });
    const out = press([theirs], 18 * 60, {}, 'e1');

    expect(out.assignments).toHaveLength(2);
    expect(out.assignments.find((a) => a.id === 'other')).toEqual(theirs);
  });
});

describe('pressing inside a shift the person already works', () => {
  it('extends it instead of laying a second one on top', () => {
    // THE BUG. This used to come back with two shifts covering 18:00, and the
    // coverage strip then read one person as two.
    const out = press([shift({ startMin: 17 * 60, endMin: 20 * 60 })], 18 * 60);

    expect(out.assignments).toHaveLength(1);
    expect(out.assignments[0].id).toBe('a1');
  });

  it('reaches forward to where the press landed', () => {
    const out = press([shift({ startMin: 17 * 60, endMin: 20 * 60 })], 20 * 60);

    expect(out.assignments[0].startMin).toBe(17 * 60);
    expect(out.assignments[0].endMin).toBe(21 * 60); // the pressed hour
  });

  it('reaches backward when the press is before it', () => {
    const out = press([shift({ startMin: 18 * 60, endMin: 20 * 60 })], 17 * 60);

    expect(out.assignments[0].startMin).toBe(17 * 60);
    expect(out.assignments[0].endMin).toBe(20 * 60);
  });

  it('treats a press that merely touches the end as an extension', () => {
    // Pressing the hour a shift stops is asking for one hour more, not for a
    // second shift starting the minute the first one ends.
    const out = press([shift({ startMin: 17 * 60, endMin: 19 * 60 })], 19 * 60);
    expect(out.assignments).toHaveLength(1);
    expect(out.assignments[0].endMin).toBe(20 * 60);
  });

  it('re-prices the hours it gained', () => {
    const out = press([shift({ startMin: 17 * 60, endMin: 20 * 60 })], 20 * 60);
    // Four hours of span now, and the paid hours follow the span.
    expect(out.assignments[0].paidHours).toBeGreaterThan(3);
    expect(out.assignments[0].source).toBe('manual');
  });
});

describe('the day ceiling', () => {
  // A press reaches one hour and only from the shift's own edge: pressing two
  // hours past the end is a separate stretch, not an extension, and the split
  // day above covers that. So a shift grows an hour at a time.

  it('grows up to the ceiling and stops there', () => {
    // Eight hours, pressed at the hour it ends. The union is exactly nine,
    // which is the whole of what Spain allows (art. 34.3 ET).
    const eight = shift({ startMin: 16 * 60, endMin: 24 * 60 });
    const out = press([eight], 24 * 60);

    expect(out.assignments[0].endMin).toBe(25 * 60);
  });

  it('never merges past it', () => {
    // Nine hours already, pressed at the hour it ends: the union would be
    // ten, so it is cut back to the ceiling.
    const nine = shift({ startMin: 16 * 60, endMin: 25 * 60 });
    const out = press([nine], 25 * 60);

    expect(out.assignments[0].endMin).toBe(25 * 60);
  });

  it('leaves a shift already at the ceiling exactly as it was', () => {
    // Silently doing nothing beats silently creating an overlap, and the day
    // limit is reported by the validator either way.
    const nine = shift({ startMin: 16 * 60, endMin: 25 * 60 });
    const out = press([nine], 25 * 60);

    expect(out.assignments[0]).toEqual(nine);
    expect(out.changed).toBeNull();
  });

  it('applies the union whole where no ceiling is stated', () => {
    // A jurisdiction with nothing seeded behaves as it always did: the field
    // is absent and every reader keeps its own default, which here is none.
    // The same press that stops at nine above reaches ten here.
    const nine = shift({ startMin: 16 * 60, endMin: 25 * 60 });
    const out = press([nine], 25 * 60, { maxDailyHours: null });

    expect(out.assignments[0].endMin).toBe(26 * 60);
  });
});
