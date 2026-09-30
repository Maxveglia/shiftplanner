// What an edit cost the business, in the two units that matter.
//
// A day off, a week of sick leave, somebody leaving: each of them takes hours
// out of a rota, and the deterministic pass fills the hole it left on those
// days with whoever happens to fit. Sometimes that is the end of it. Sometimes
// it leaves the shop short at seven in the evening, or leaves a 40-hour
// contract with 31 hours in it -- and NOTHING SAID SO. The calendar came back,
// the diff showed the shifts that moved, and the two facts a manager is
// actually accountable for were not among them.
//
// This module is that accounting, and it exists to answer one question: is
// this edit worth asking the planner to rearrange the week over? Answering it
// by measurement rather than by rule is what keeps the rearrangement honest in
// both directions -- it is not run for a day off that cost nothing, and the
// rearrangement it does run is only KEPT if these same numbers come back
// better. The model proposes; this decides.
//
// TWO UNITS, AND THEY ARE NOT INTERCHANGEABLE.
//
//   Uncovered hours are the BUSINESS's loss: an hour the rota says needs two
//   people and has one. Nobody is there to serve.
//
//   Shortfalls are the PERSON's loss: somebody whose contract says 40 and
//   whose month says 31. They are owed those hours.
//
// A rearrangement can trade one for the other, so both are carried separately
// all the way to the comparison; a single "score" would let nine hours off
// somebody's contract disappear behind one covered evening.
//
// ONLY WHAT THIS EDIT CAUSED. Everything is measured as a DIFFERENCE between
// the calendar before and after. A rota with an evening nobody has ever
// covered is not this edit's doing, and a manager who has been living with
// that gap on purpose must not have their week rearranged over it -- the same
// rule `applyOps` already follows when it refills only the days an edit
// vacated.

import { contractedMinHours } from './availability';
import type { CoverageGap, ScheduleResult } from './types';
import type { EmployeeOut } from '../../types';

/** One person left short of their contract by an edit. */
export interface Shortfall {
  employeeId: string;
  /** Hours they are short, against what they had before the edit. */
  hours: number;
}

/** What an edit cost, as a difference between two calendars. */
export interface Damage {
  /**
   * Person-hours of cover the edit removed and nothing replaced.
   *
   * Summed over `need - have`, so an hour needing two people and having none
   * counts twice. That is the right weight: it is two people missing.
   */
  uncoveredHours: number;
  /** The dates where that cover went missing, in order. */
  dates: string[];
  /** Who the edit left short of their contract, worst first. */
  shortfalls: Shortfall[];
}

export const NO_DAMAGE: Damage = {
  uncoveredHours: 0,
  dates: [],
  shortfalls: [],
};

/** A gap's own identity: an hour of a day. */
function gapKey(g: CoverageGap): string {
  return `${g.date}|${g.hour}`;
}

/** How many people that hour is missing. */
function missing(g: CoverageGap): number {
  return Math.max(0, g.need - g.have);
}

/**
 * What changed for the worse between two calendars.
 *
 * `before` is the rota as the manager last saw it, `after` the one the edit
 * and the deterministic refill produced. Improvements are not netted off
 * against losses: an edit that covered Tuesday and uncovered Thursday has
 * damaged Thursday, and Thursday is what needs rearranging.
 */
export function damageBetween(
  before: ScheduleResult,
  after: ScheduleResult,
  employees: EmployeeOut[],
): Damage {
  const was = new Map(before.gaps.map((g) => [gapKey(g), missing(g)]));
  const dates = new Set<string>();
  let uncoveredHours = 0;

  for (const gap of after.gaps) {
    const now = missing(gap);
    const then = was.get(gapKey(gap)) ?? 0;
    if (now > then) {
      uncoveredHours += now - then;
      dates.add(gap.date);
    }
  }

  // `belowMinimum` is the product's one definition of "short of contract" --
  // prorated over the days somebody was actually available, with a tolerance.
  // Reused rather than recomputed, so this cannot drift from the figure the
  // calendar shows. What is added here is HOW short, which that flag does not
  // carry and the planner needs in order to fix it.
  const wasShort = new Set(before.belowMinimum);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const shortfalls: Shortfall[] = [];

  for (const id of after.belowMinimum) {
    if (wasShort.has(id)) continue; // already short; not this edit's doing
    const employee = byId.get(id);
    if (!employee) continue;
    const had = before.hoursByEmployee[id] ?? 0;
    const has = after.hoursByEmployee[id] ?? 0;
    const lost = had - has;
    if (lost > 0) shortfalls.push({ employeeId: id, hours: lost });
  }

  // Somebody who was ALREADY short and got shorter is damage too, and the
  // loop above skips them by design -- they would otherwise be reported on
  // every unrelated edit for the rest of the month. This catches the ones the
  // edit made materially worse.
  for (const id of wasShort) {
    const had = before.hoursByEmployee[id] ?? 0;
    const has = after.hoursByEmployee[id] ?? 0;
    const lost = had - has;
    // An hour is noise; a shift is not. The threshold is deliberately coarse:
    // this decides whether to spend a call on the planner.
    if (lost >= 4 && byId.has(id)) shortfalls.push({ employeeId: id, hours: lost });
  }

  shortfalls.sort((a, b) => b.hours - a.hours);

  return {
    uncoveredHours,
    dates: [...dates].sort(),
    shortfalls,
  };
}

/**
 * Is this worth asking the planner to rearrange?
 *
 * Deliberately a low bar on the business side and a coarse one on the person
 * side. An uncovered hour is somebody not being served and there is no
 * threshold at which that stops mattering; an employee being four hours light
 * is a shift, which is the smallest thing a rearrangement can actually move.
 *
 * What stops this from firing constantly is not the threshold -- it is that
 * the deterministic refill has already run, so most edits arrive here having
 * cost nothing at all.
 */
export function worthRearranging(damage: Damage): boolean {
  return damage.uncoveredHours > 0 || damage.shortfalls.length > 0;
}

/**
 * Is the rearrangement the planner came back with actually better?
 *
 * THE WHOLE SAFETY OF THIS FEATURE IS THIS FUNCTION. The planner may move
 * anybody, which is a thing a manager tolerates only in exchange for a rota
 * that is genuinely better -- so what it returns is kept only when it beats
 * the deterministic calendar on the measure that prompted the call, and loses
 * on neither.
 *
 * Neither number may get worse. A rearrangement that covers the shop by
 * leaving a part-timer nine hours light has not improved anything; it has
 * moved the cost onto somebody who will read it on their phone.
 */
export function isBetter(current: Damage, proposed: Damage): boolean {
  const shortHours = (d: Damage) => d.shortfalls.reduce((s, f) => s + f.hours, 0);
  const coverImproved = proposed.uncoveredHours < current.uncoveredHours;
  const hoursImproved = shortHours(proposed) < shortHours(current);
  const coverHeld = proposed.uncoveredHours <= current.uncoveredHours;
  const hoursHeld = shortHours(proposed) <= shortHours(current);
  return (coverImproved && hoursHeld) || (hoursImproved && coverHeld);
}

/**
 * The damage, in the words the planner is given.
 *
 * Written as lines of fact with no instruction in them: what to DO about it is
 * said once, in the planner's own prompt, and saying it twice in almost the
 * same words is how the two drift apart -- the same rule `buildPlanContext`
 * follows for the manager's brief.
 *
 * PEOPLE ARE IDS HERE, not names. These lines are appended to the planning
 * context and go nowhere else, so they are held to that file's rule: the model
 * is told WHO lost hours in the only vocabulary it can answer in, and the name
 * stays on this side. `employees` is still needed -- it is where the contract
 * behind the shortfall is read from.
 */
export function damageLines(
  damage: Damage,
  employees: EmployeeOut[],
): string[] {
  if (!worthRearranging(damage)) return [];
  const lines = ['', 'WHAT THE LAST CHANGE COST, AND WHAT NEEDS REPAIRING:'];

  if (damage.uncoveredHours > 0) {
    const days = damage.dates.join(', ');
    lines.push(
      `  ${Math.round(damage.uncoveredHours)} person-hour(s) of cover were lost` +
        ` on ${days}, and the deterministic pass could not replace them.`,
    );
  }
  for (const short of damage.shortfalls) {
    const employee = employees.find((e) => e.id === short.employeeId);
    const contracted = employee ? contractedMinHours(employee) : 0;
    lines.push(
      `  ${short.employeeId} lost ` +
        `${Math.round(short.hours)} h` +
        (contracted > 0 ? ` against a ${contracted} h/week contract` : '') +
        ', and is now below what that contract asks for.',
    );
  }
  return lines;
}
