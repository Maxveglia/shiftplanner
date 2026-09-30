// What to do with a calendar the model got partly wrong.
//
// THE KEY INSIGHT, and the reason this file is short: we do not have to ask the
// model again. A shift removed for breaking a rule leaves a HOLE, and this
// codebase already contains something that fills holes correctly -- the greedy
// pass in `generateSchedule`, which is exactly a hole-filler that respects
// rest, contracts and availability by construction.
//
// So the repair is not a retry loop. It is:
//
//     propose (model) -> parse -> price -> validate
//       -> DROP what breaks a hard rule
//       -> generateSchedule(..., overlay: { pinned: survivors })
//
// The survivors are replayed as pinned shifts, the greedy pass covers what is
// left, and the result is validated once more. That is the same mechanism the
// manager's own adjustments already use ("replay the decisions FIRST, then let
// the greedy pass fill what is still uncovered around them"), pointed at a
// different author. It costs nothing, it always terminates, and the worst case
// is a calendar the product could have built on its own.
//
// WHY DROPPING, NOT TRIMMING. A shift that runs an hour past closing could be
// cut back to fit. It is not, because a trimmed shift is a shift nobody chose:
// the model placed eight hours for a reason and six hours of it may be worse
// than none, while the greedy pass placing its own is at least a decision the
// product stands behind. The one thing we must never do is keep it.

import type { Assignment } from './types';
import type { ValidationResult, Violation } from './validate';
import { weekKey } from './validate';
import { weeklyCeiling } from './generate';
import type { EmployeeOut } from '../../types';
import type { SchedulingSpec } from './types';
import { EMPTY_OVERLAY, type ScheduleOverlay } from './overlay';

export interface RepairResult {
  /** The shifts that may stand. Feed these to the generator as `pinned`. */
  kept: Assignment[];
  /** What was taken out, with the violation that took it. */
  dropped: { assignment: Assignment; kind: Violation['kind'] }[];
}

/**
 * Remove every shift implicated in a hard violation.
 *
 * Soft findings are left alone: under-coverage is for the greedy pass to fix
 * and for the manager to judge, not something to solve by deleting more work.
 *
 * The two rules that are not simply "drop the shift":
 *
 * - **A pair** (an overlap, or too little rest) names two shifts and only one
 *   is at fault -- the LATER one. Dropping both would take out a shift that was
 *   perfectly legal until the model put something after it.
 * - **A count** (a day with more shifts than splits allow, a week over its
 *   ceiling) has no single culprit. The latest shifts go first, which keeps the
 *   earliest part of the week intact and leaves the hole where the generator is
 *   most able to fill it.
 */
export function repairProposal(
  assignments: Assignment[],
  result: ValidationResult,
  employees: EmployeeOut[],
  spec: SchedulingSpec,
  overlay: ScheduleOverlay = EMPTY_OVERLAY,
): RepairResult {
  const byId = new Map(assignments.map((a) => [a.id, a]));
  /** id -> the violation that condemned it. First one wins; they all drop it. */
  const condemned = new Map<string, Violation['kind']>();
  const condemn = (id: string, kind: Violation['kind']) => {
    if (!condemned.has(id) && byId.has(id)) condemned.set(id, kind);
  };

  /** Later shifts first: the ones a count-based rule should shed. */
  const latestFirst = (ids: string[]): Assignment[] =>
    ids
      .map((id) => byId.get(id))
      .filter((a): a is Assignment => a != null)
      .sort((x, y) =>
        x.date === y.date
          ? y.startMin - x.startMin
          : y.date.localeCompare(x.date),
      );

  for (const v of result.violations) {
    if (!v.hard) continue;

    switch (v.kind) {
      case 'overlap':
      case 'rest': {
        // assignmentIds is [previous, current]; the current one is the fault.
        const [, later] = v.assignmentIds;
        if (later) condemn(later, v.kind);
        break;
      }
      case 'weekly_rest': {
        // The week owes a day and a half, and the cheapest way to give it
        // back is to drop the LAST shift of the week -- not the week, which
        // is what condemning every id in the finding would do.
        const [last] = latestFirst(v.assignmentIds);
        if (last) condemn(last.id, v.kind);
        break;
      }
      case 'daily_hours':
      case 'split_not_allowed':
      case 'too_many_shifts': {
        // Keep the earliest shift of the day, shed the rest.
        const ordered = latestFirst(v.assignmentIds);
        for (const a of ordered.slice(0, Math.max(0, ordered.length - 1))) {
          condemn(a.id, v.kind);
        }
        break;
      }
      default: {
        for (const id of v.assignmentIds) condemn(id, v.kind);
      }
    }
  }

  let kept = assignments.filter((a) => !condemned.has(a.id));

  // ---- the count-based rules, recomputed on what actually survived --------
  //
  // These cannot be read off the violation list: it was written against the
  // ORIGINAL calendar, and dropping an unavailable person may already have
  // brought a week back under its ceiling. Deleting more on the strength of a
  // stale finding would cost cover nobody asked to lose.

  kept = shedOverCeiling(kept, employees, spec, overlay, condemned);
  kept = shedOverSplitCap(kept, spec, condemned);

  const dropped = assignments
    .filter((a) => condemned.has(a.id))
    .map((a) => ({ assignment: a, kind: condemned.get(a.id) as Violation['kind'] }));

  return { kept, dropped };
}

/** Drop the latest shifts of any week that is still over its ceiling. */
function shedOverCeiling(
  kept: Assignment[],
  employees: EmployeeOut[],
  spec: SchedulingSpec,
  overlay: ScheduleOverlay,
  condemned: Map<string, Violation['kind']>,
): Assignment[] {
  const empById = new Map(employees.map((e) => [e.id, e]));
  const buckets = new Map<string, Assignment[]>();
  for (const a of kept) {
    const key = `${a.employeeId}|${weekKey(a.date)}`;
    const list = buckets.get(key) ?? [];
    list.push(a);
    buckets.set(key, list);
  }

  const out = new Set(kept.map((a) => a.id));
  for (const [key, list] of buckets) {
    const emp = empById.get(list[0].employeeId);
    if (!emp) continue;
    const ceiling = weeklyCeiling(spec, emp, overlay);
    let hours = list.reduce((sum, a) => sum + a.paidHours, 0);
    if (hours <= ceiling) continue;

    const ordered = [...list].sort((x, y) =>
      x.date === y.date ? y.startMin - x.startMin : y.date.localeCompare(x.date),
    );
    for (const a of ordered) {
      if (hours <= ceiling) break;
      out.delete(a.id);
      condemned.set(a.id, 'weekly_ceiling');
      hours -= a.paidHours;
    }
    void key;
  }
  return kept.filter((a) => out.has(a.id));
}

/** Un-split the people over the day's split cap, latest half first. */
function shedOverSplitCap(
  kept: Assignment[],
  spec: SchedulingSpec,
  condemned: Map<string, Violation['kind']>,
): Assignment[] {
  const cap = Math.max(
    0,
    spec.splitShiftPeople ?? (spec.allowSplitShifts === true ? 1 : 0),
  );

  /** date -> employeeId -> that person's shifts on it. */
  const byDate = new Map<string, Map<string, Assignment[]>>();
  for (const a of kept) {
    const day = byDate.get(a.date) ?? new Map<string, Assignment[]>();
    const list = day.get(a.employeeId) ?? [];
    list.push(a);
    day.set(a.employeeId, list);
    byDate.set(a.date, day);
  }

  const out = new Set(kept.map((a) => a.id));
  for (const [, day] of byDate) {
    const splitters = [...day.entries()].filter(([, list]) => list.length > 1);
    if (splitters.length <= cap) continue;
    // Whoever splits latest in the day gives it up first.
    splitters.sort((a, b) => {
      const lastA = Math.max(...a[1].map((s) => s.startMin));
      const lastB = Math.max(...b[1].map((s) => s.startMin));
      return lastB - lastA;
    });
    for (const [, list] of splitters.slice(0, splitters.length - cap)) {
      const ordered = [...list].sort((x, y) => y.startMin - x.startMin);
      for (const a of ordered.slice(0, ordered.length - 1)) {
        out.delete(a.id);
        condemned.set(a.id, 'split_cap');
      }
    }
  }
  return kept.filter((a) => out.has(a.id));
}
