// The whole path from a model's answer to a calendar somebody can work.
//
//   raw JSON -> parse (shape) -> materialize (the nine derived fields)
//            -> validate (rules) -> repair (drop what breaks them)
//            -> generateSchedule with the survivors PINNED
//            -> validate again
//
// The last two steps are the point. A proposal with shifts removed has holes in
// it, and the greedy pass is a hole-filler that cannot break a rule -- so the
// worst possible outcome of a bad proposal is the calendar this product built
// on its own, which is the outcome it had before the model was involved at all.
// There is no retry loop, nothing unbounded, and no second API call to pay for.
//
// WHAT THE MANAGER DECIDED STILL WINS. Shifts already pinned in the overlay are
// theirs, not the model's, and a proposal touching the same person on the same
// day is dropped rather than merged. "Give Sarah Friday off" has to keep
// meaning that when a model is asked to rebuild the month around it.

import { generateSchedule } from './generate';
import { materialize } from './materialize';
import { parseProposal, type RejectedShift } from './proposal';
import { repairProposal } from './repair';
import { validateSchedule, type Violation } from './validate';
import { EMPTY_OVERLAY, type ScheduleOverlay } from './overlay';
import type { PayPolicy } from './payroll';
import type { Assignment, DayRef, ScheduleResult, SchedulingSpec } from './types';
import type {
  AbsenceOut,
  AbsenceTypeOut,
  EmployeeOut,
  ShiftTemplateOut,
} from '../../types';

export interface ProposalReport {
  /** Rows that were well-formed JSON shifts. */
  proposed: number;
  /** Rows thrown out before any rule was applied, with the reason. */
  malformed: RejectedShift[];
  /** Proposed shifts removed for breaking a hard rule. */
  dropped: { assignment: Assignment; kind: Violation['kind'] }[];
  /** Proposed shifts that survived into the calendar. */
  kept: number;
  /** Shifts the greedy pass added around them. */
  filled: number;
  /**
   * Whether the FINAL calendar is clean.
   *
   * Expected to be true always: the survivors are legal and the greedy pass
   * cannot place an illegal shift. It is reported rather than asserted because
   * a false here is the one signal that the generator and the validator have
   * drifted apart, and silently shipping that is how the drift goes unnoticed.
   */
  valid: boolean;
  /** Anything the final check still objects to. Empty in the expected case. */
  remaining: Violation[];
}

export interface ProposalOutcome {
  result: ScheduleResult;
  report: ProposalReport;
}

/** `${employeeId}|${date}` -- one person, one day. */
function slot(a: { employeeId: string; date: string }): string {
  return `${a.employeeId}|${a.date}`;
}

/**
 * Build a calendar from a model's proposal, falling back to our own work.
 *
 * `raw` is whatever came back from the API: this function assumes nothing about
 * it beyond that it might be an array.
 */
export function scheduleFromProposal(
  raw: unknown,
  employees: EmployeeOut[],
  templates: ShiftTemplateOut[],
  absences: AbsenceOut[],
  absenceTypes: AbsenceTypeOut[],
  spec: SchedulingSpec,
  days: DayRef[],
  overlay: ScheduleOverlay = EMPTY_OVERLAY,
  /** The business's pay policy, priced in as `generateSchedule` prices it. */
  payPolicy?: PayPolicy,
): ProposalOutcome {
  const { shifts, rejected } = parseProposal(raw);
  const priced = materialize(
    shifts,
    employees,
    templates,
    spec,
    payPolicy
      ? { policy: payPolicy, nightWindow: spec.nightWindow, weekendDays: spec.weekendDays }
      : undefined,
  );

  // The manager's own shifts are not up for revision.
  const taken = new Set(overlay.pinned.map(slot));
  const notTheirs = priced.filter((a) => !taken.has(slot(a)));

  const firstPass = validateSchedule(
    notTheirs,
    employees,
    templates,
    absences,
    absenceTypes,
    spec,
    days,
    overlay,
  );
  const { kept, dropped } = repairProposal(
    notTheirs,
    firstPass,
    employees,
    spec,
    overlay,
  );

  const result = generateSchedule(
    employees,
    templates,
    absences,
    absenceTypes,
    spec,
    days,
    { ...overlay, pinned: [...overlay.pinned, ...kept] },
    payPolicy,
  );

  const finalCheck = validateSchedule(
    result.assignments,
    employees,
    templates,
    absences,
    absenceTypes,
    spec,
    days,
    overlay,
  );

  return {
    result,
    report: {
      proposed: shifts.length,
      malformed: rejected,
      dropped,
      kept: kept.length,
      filled: Math.max(0, result.assignments.length - kept.length - overlay.pinned.length),
      valid: finalCheck.ok,
      remaining: finalCheck.violations.filter((v) => v.hard),
    },
  };
}
