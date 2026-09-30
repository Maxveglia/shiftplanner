// From what the model said to what the calendar holds.
//
// The model emits five fields (see `proposal.ts`). An `Assignment` has
// fourteen. This is where the other nine come from, and NONE of them are asked
// of the model:
//
//   templateName, color, isNight  <- `shiftAppearance`, from the clock
//   paidHours                     <- span minus the unpaid break
//   overtimeHours, extraHours, cost <- `priceAssignments`, unchanged
//   id, source                    <- ours
//
// WHY NOT LET THE MODEL SEND ITS OWN TOTALS. Because a rota whose shifts are
// legal but whose hours are wrong is worse than one that is obviously broken:
// it publishes, it pays people, and the error surfaces weeks later in a payroll
// nobody can reconcile. Arithmetic is free and exact here, and a model doing it
// is neither.
//
// The break is the one figure that is not purely derivable. A real template
// carries `unpaid_break_minutes`; a shift with no template gets
// `syntheticBreakMin`, the same rule the generator applies to its own band
// shifts -- so an eight-hour Tuesday is worth the same whoever placed it.

import { priceAssignments, syntheticBreakMin, type PricingPolicy } from './generate';
import { shiftAppearance } from './bands';
import { shiftTemplateLabel } from '../format';
import type { BareAssignment } from './proposal';
import type { YearBasis } from './rate';
import type { Assignment } from './types';
import type { EmployeeOut, ShiftTemplateOut } from '../../types';

/**
 * Prefix for ids of shifts the model proposed.
 *
 * Distinct from the generator's `a1, a2, ...` on purpose: proposed shifts are
 * replayed as `overlay.pinned` alongside generated ones, and two shifts sharing
 * an id would make React render one of them and the manager lose the other.
 */
const PROPOSED_ID_PREFIX = 'p';

/**
 * Fill in everything the model was not asked for.
 *
 * `templateId` is RESOLVED, not trusted: a model naming a template that does
 * not exist, or inventing a `band-` label, gets the band its own clock times
 * imply. That keeps the id consistent with the colour and the name beside it,
 * which is what the calendar actually draws.
 */
export function materialize(
  bare: BareAssignment[],
  employees: EmployeeOut[],
  templates: ShiftTemplateOut[],
  /** What a year of work is, to price a salary by the hour. See `rate.ts`. */
  year: YearBasis = {},
  /**
   * The business's pay policy, so a proposed shift is priced as the generator
   * and payroll price it. Left off, as before: no premiums, overtime at 1.
   */
  pricing?: PricingPolicy,
): Assignment[] {
  const byId = new Map(templates.map((t) => [t.id, t]));

  const built: Assignment[] = bare.map((b, i) => {
    const template = b.templateId ? byId.get(b.templateId) : undefined;
    const span = b.endMin - b.startMin;
    const breakMin = template
      ? Math.min(template.unpaid_break_minutes, span)
      : syntheticBreakMin(span);

    const look = shiftAppearance(
      b.startMin,
      b.endMin,
      template ? shiftTemplateLabel(template) : undefined,
    );

    return {
      id: `${PROPOSED_ID_PREFIX}${i + 1}`,
      employeeId: b.employeeId,
      date: b.date,
      startMin: b.startMin,
      endMin: b.endMin,
      templateId: template ? template.id : `band-${look.bandKey}`,
      templateName: look.label,
      color: look.color,
      isNight: look.isNight,
      paidHours: (span - breakMin) / 60,
      // Priced below. Zeroes here would be a lie if anything threw between.
      overtimeHours: 0,
      extraHours: 0,
      cost: 0,
      source: 'ai',
    };
  });

  // Weekly accumulation is order-dependent, and `priceAssignments` sorts by
  // (date, startMin) itself -- so this is the same arithmetic the generator,
  // the payroll view and the employee's own estimate all run.
  return priceAssignments(built, employees, 1, year, pricing).assignments;
}
