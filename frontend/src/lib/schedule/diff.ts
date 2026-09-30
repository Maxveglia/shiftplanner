// What changed between two calendars, said per person.
//
// After an adjustment, and before a publish, the manager needs one thing the
// calendar itself does not show: who this touches. A calendar with one shift
// moved looks like the calendar before it. So two results are compared and
// the difference is grouped by employee -- what they lost, what they gained,
// and what merely moved -- in a shape the screen can read out as "Sarah:
// Friday off. Luis covers Friday 16:00 to 22:00."
//
// Pure, and keyed on what a shift IS rather than on its id: the generator
// hands out fresh ids on every pass, so the same person on the same day at
// the same hours is the same shift whatever it is called. A shift that
// changed hours on the same day is reported as moved rather than as one
// removal and one addition, because that is how the manager thinks of it.

import type { Assignment, ScheduleResult } from './types';

export interface ShiftRef {
  date: string;
  startMin: number;
  endMin: number;
}

export interface MovedShift {
  date: string;
  from: ShiftRef;
  to: ShiftRef;
}

export interface PersonChanges {
  employeeId: string;
  added: ShiftRef[];
  removed: ShiftRef[];
  moved: MovedShift[];
}

export interface ScheduleDiff {
  /** Only the people with a change, in the order of their first change. */
  people: PersonChanges[];
  /** Added + removed + moved, across everyone. */
  total: number;
}

function ref(a: Assignment): ShiftRef {
  return { date: a.date, startMin: a.startMin, endMin: a.endMin };
}

/**
 * Who, when, from and to: the identity of a shift regardless of its id.
 * The one definition of "same shift" for the diff, the refill and the tests.
 */
export function slotKey(a: Assignment): string {
  return `${a.employeeId}|${a.date}|${a.startMin}|${a.endMin}`;
}

function byDateThenTime(x: ShiftRef, y: ShiftRef): number {
  return x.date.localeCompare(y.date) || x.startMin - y.startMin || x.endMin - y.endMin;
}

export function diffAssignments(
  before: Assignment[],
  after: Assignment[],
): ScheduleDiff {
  const beforeKeys = new Set(before.map(slotKey));
  const afterKeys = new Set(after.map(slotKey));

  // Insertion-ordered by construction: a Map keeps the order people were
  // first touched, which is the order the screen reads them out in.
  const changes = new Map<string, { removed: ShiftRef[]; added: ShiftRef[] }>();
  const bucket = (employeeId: string) => {
    let b = changes.get(employeeId);
    if (!b) {
      b = { removed: [], added: [] };
      changes.set(employeeId, b);
    }
    return b;
  };
  for (const a of before) if (!afterKeys.has(slotKey(a))) bucket(a.employeeId).removed.push(ref(a));
  for (const a of after) if (!beforeKeys.has(slotKey(a))) bucket(a.employeeId).added.push(ref(a));

  const people: PersonChanges[] = [];
  let total = 0;
  for (const [employeeId, b] of changes) {
    const removed = b.removed.sort(byDateThenTime);
    const added = b.added.sort(byDateThenTime);
    // A removal and an addition on the same day, for the same person, is one
    // shift that moved. Paired in date order, one to one; a day with two
    // removals and one addition reports one move and one removal.
    const moved: MovedShift[] = [];
    const leftRemoved: ShiftRef[] = [];
    const leftAdded = [...added];
    for (const r of removed) {
      const i = leftAdded.findIndex((a) => a.date === r.date);
      if (i >= 0) {
        moved.push({ date: r.date, from: r, to: leftAdded[i] });
        leftAdded.splice(i, 1);
      } else {
        leftRemoved.push(r);
      }
    }
    people.push({ employeeId, added: leftAdded, removed: leftRemoved, moved });
    total += leftAdded.length + leftRemoved.length + moved.length;
  }
  return { people, total };
}

export function diffSchedules(before: ScheduleResult, after: ScheduleResult): ScheduleDiff {
  return diffAssignments(before.assignments, after.assignments);
}
