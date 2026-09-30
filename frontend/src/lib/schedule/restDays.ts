// Whose day off is which -- decided at the start of the week, not discovered
// at the end of it.
//
// A bar in Barcelona, open 17:00-03:00, four people on forty hours and two
// part-timers, planned for October. The generator came back with the four
// full-timers working Sunday to Thursday and ALL FOUR off on Friday, the
// busiest night of the week, covered by the two part-timers alone -- who
// ended the month at 135 and 120 hours on contracts of 20 and 16, while the
// full-timers were 20 short. And two hours of every Friday uncovered.
//
// Nothing broke a rule. The weekly rest (36 unbroken hours, art. 37.1 ET) was
// checked shift by shift, as a question of whether the week could still fit
// it -- which it always could, right up to the day it could not. The greedy
// pass walks the week from its first day, so every full-timer ran out of room
// on the same day, and that day was Friday because Friday is where the week
// runs out. (The week started on Sunday when this was written; it starts on
// Monday now, which moves the symptom and does not cure it.)
//
// So the day off is planned before any shift is placed: one per person per
// week, staggered across the team and put on the days that need the fewest
// hours. The legality check in generate.ts still stands behind it -- this
// only decides where the rest SHOULD fall, so it stops falling on everybody
// at once.

import type { EmployeeOut } from '../../types';
import { contractedMinHours } from './availability';
import { isClosedOn, needAt, windowFor } from './demand';
import type { DayRef, SchedulingSpec } from './types';

/** Person-hours a day needs: the sum of the floor over its open hours. */
function demandOf(spec: SchedulingSpec, day: DayRef): number {
  if (isClosedOn(spec, day)) return 0;
  const win = windowFor(spec, day);
  let total = 0;
  for (let h = Math.floor(win.openMin / 60); h < Math.ceil(win.closeMin / 60); h += 1) {
    total += needAt(spec, day, h);
  }
  return total;
}

/**
 * The planned day off of each person, for one Monday-to-Sunday week.
 *
 * Returns employee id -> date. Empty when there is nothing to plan:
 *  - no weekly rest in the spec (the law here does not ask for one);
 *  - the week is not whole inside the period -- the days outside it are empty
 *    as far as the generator is concerned, so the rest is already there;
 *  - the business closes one of its days -- that day is everybody's rest.
 *
 * People are placed most-hours first, because a full-timer has the fewest
 * days to spare and a part-timer rests most of the week anyway. Each one goes
 * to the day where one more person off costs least: that day's demand times
 * how many are off on it already, plus one. Ties go to the earlier day, so the
 * pattern is the same every week -- a day off that moves around is legal and
 * horrible to live with.
 */
export function planRestDays(
  spec: SchedulingSpec,
  roster: readonly EmployeeOut[],
  week: readonly DayRef[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (!spec.weeklyRestHours) return out;
  if (week.length !== 7) return out;
  if (week.some((d) => isClosedOn(spec, d))) return out;

  const demand = week.map((d) => demandOf(spec, d));
  const off = week.map(() => 0);
  const order = [...roster].sort(
    (a, b) => contractedMinHours(b) - contractedMinHours(a) || a.id.localeCompare(b.id),
  );
  for (const emp of order) {
    let best = 0;
    for (let i = 1; i < week.length; i += 1) {
      if (demand[i] * (off[i] + 1) < demand[best] * (off[best] + 1)) best = i;
    }
    off[best] += 1;
    out.set(emp.id, week[best].date);
  }
  return out;
}
