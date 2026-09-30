// Why a generated calendar came back with nothing in it.
//
// An empty grid used to look exactly like a grid nobody had generated yet, so
// the reason went on screen. The first version of that answer asked ONE day —
// the first open day of the period — and reported whatever it said. That is
// wrong twice over.
//
// It is wrong about WHO: somebody unavailable on the 1st and working from the
// 3rd is not why the month is empty. Only a person who cannot work on ANY open
// day of the period is part of the answer.
//
// And it is wrong about WHAT TO DO. A team hired on the 3rd, looked at through
// the week before, produces an empty calendar that is entirely correct — and
// the manager was told "there was nobody available to meet them, fix this and
// generate again". There is nothing to fix. They are looking at a period their
// team had not started yet, and the calendar is full from the day it does.
// Telling someone to repair something that works is worse than saying nothing.

import type { AbsenceOut, AbsenceTypeOut, EmployeeOut } from '../../types';
import { availability } from './availability';
import { isClosedOn } from './demand';
import type { DayRef, ScheduleResult, SchedulingSpec } from './types';

/**
 * Has this person simply not begun yet, by the end of the period?
 *
 * Read off their dates rather than off the blocked `kind`, because `contract`
 * covers three different situations and only one of them is waiting: a
 * contract that starts later IS waiting, a contract that ended is an obstacle,
 * and NO contract is the bug that once shipped an empty calendar to everyone.
 * Filing that last one under "nothing is wrong, your team starts later" would
 * hide the exact failure this whole banner exists to surface.
 */
function startsAfter(e: EmployeeOut, dateKey: string): boolean {
  const contract = e.current_contract;
  if (!contract) return false;
  const begins = [e.hire_date, contract.valid_from]
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop();
  return Boolean(begins && begins > dateKey);
}

export interface EmptyCalendarPerson {
  name: string;
  reason: string;
}

export interface EmptyCalendarReason {
  /**
   * `notStarted` — nobody has started yet, and the calendar is fine later.
   * `blocked`    — a real obstacle the manager can act on.
   */
  kind: 'notStarted' | 'blocked';
  people: EmptyCalendarPerson[];
}

/**
 * Null when the calendar is not empty, or when the emptiness is not about the
 * roster at all — in which case saying nothing beats naming the wrong cause.
 */
export function explainEmptyCalendar(
  result: ScheduleResult | null,
  spec: SchedulingSpec,
  days: DayRef[],
  roster: EmployeeOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
): EmptyCalendarReason | null {
  if (!result || result.assignments.length > 0) return null;
  const openDays = days.filter((d) => !isClosedOn(spec, d));
  if (openDays.length === 0 || roster.length === 0) return null;

  // The last open day is the one that decides. Someone "starting on the 3rd"
  // is still not started on the 2nd, but on the 30th they are — and if they
  // are available then, the empty calendar is somebody else's doing.
  const last = openDays[openDays.length - 1];

  const people: EmptyCalendarPerson[] = [];
  let everyoneWaiting = true;

  for (const e of roster) {
    if (openDays.some((d) => availability(e, absences, absenceTypes, d.date).ok)) {
      // This person could have worked. The roster is not the explanation.
      return null;
    }
    const why = availability(e, absences, absenceTypes, last.date);
    if (why.ok) return null;
    if (!startsAfter(e, last.date)) everyoneWaiting = false;
    people.push({ name: e.full_name, reason: why.reason });
  }

  return { kind: everyoneWaiting ? 'notStarted' : 'blocked', people };
}
