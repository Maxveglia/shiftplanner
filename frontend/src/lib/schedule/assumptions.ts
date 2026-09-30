// Turning "we decided this for you" into a sentence a manager can argue with.
//
// The server never sends prose it expects to be shown. A gap arrives as a
// FIELD, a REASON and the numbers that reason interpolates, and the sentence is
// built here -- which is what lets the same assumption read as "dos personas
// los lunes, porque dijiste que son días fuertes" in Spanish and as itself in
// English, and what keeps anything from branching on visible text.
//
// WHY THE SERVER'S `label` IS IGNORED. It carries the GENERIC default for the
// field ("2 people on shift whenever open"), which is the right sentence for a
// gap nobody could fill and the wrong one for every assumption that rests on
// something the brief actually said. Rendering it made a derived assumption
// describe a constant it had just overridden -- a number the manager never gave
// us, explained by a reason that was not the one we used. So the label stays
// server-side, and the number shown here is the one that is really in the spec.

import { plural, translate } from '../i18n';
import { formatHours, formatTime } from '../format';
import { weekdayName } from './spec';
import type { SpecGap } from '../../api/schedule';
import type { SchedulingSpec } from './types';

/** One decision the product made, ready to render. */
export interface Assumption {
  /**
   * Unique per row.
   *
   * NOT `field`: a brief that calls both Monday and Friday busy produces two
   * `coverage` assumptions, and keying on the field alone collapsed them into
   * one row in React and showed the manager half of what was decided.
   */
  key: string;
  field: string;
  /** What is in force, with its real number. */
  what: string;
  /**
   * Why that number -- the half that makes it arguable rather than arbitrary.
   *
   * Null when there was nothing to lean on. That is not a missing sentence, it
   * is the admission that separates a defensible assumption from a constant,
   * and the UI is expected to say so rather than to hide the row.
   */
  because: string | null;
  filledBy: 'default' | 'derived';
  loud: boolean;
}

function staffPhrase(staff: number): string {
  return plural(staff, 'calendar.assumed.people.one', 'calendar.assumed.people.other', {
    staff,
  });
}

/** What a generic default left standing, read from the spec rather than retyped. */
function genericWhat(gap: SpecGap, spec: SchedulingSpec): string {
  const field = gap.field;
  switch (field) {
    case 'opening_hours':
      return translate('calendar.assumed.generic.opening_hours', {
        from: formatTime(spec.openMin),
        to: formatTime(spec.closeMin),
      });
    case 'min_staff':
      return translate('calendar.assumed.generic.min_staff', {
        people: staffPhrase(spec.minStaff),
      });
    case 'max_weekly_hours':
      return translate('calendar.assumed.generic.max_weekly_hours', {
        hours: formatHours(spec.maxHoursPerWeek),
      });
    case 'min_rest':
      return translate('calendar.assumed.generic.min_rest', {
        hours: formatHours(spec.minRestHours),
      });
    default: {
      // coverage, closures, shift_length, horizon: shapes rather than figures,
      // so there is no number to read back out of the spec.
      const key = `calendar.assumed.generic.${field}`;
      const text = translate(key);
      // A field this bundle has no sentence for -- a newer server, an option
      // added after this build shipped. The server's label is English prose we
      // would rather not show, and it is still the lesser evil: a manager can
      // read a rough sentence and cannot read `calendar.assumed.generic.x`.
      return text === key ? gap.label : text;
    }
  }
}

/**
 * The sentence pair for one gap: what is in force, and why.
 *
 * `index` only disambiguates the key -- two assumptions about the same field
 * are two rows, and the order they arrive in is the order they were decided.
 */
export function describeAssumption(
  gap: SpecGap,
  spec: SchedulingSpec,
  index: number,
): Assumption {
  const p = gap.params ?? {};
  const base = { key: `${gap.field}-${index}`, field: gap.field, loud: gap.loud };

  switch (gap.reason) {
    case 'lowest_stated':
      return {
        ...base,
        filledBy: 'derived',
        what: translate('calendar.assumed.what.min_staff', {
          people: staffPhrase(p.staff ?? spec.minStaff),
        }),
        because: translate('calendar.assumed.why.lowest_stated'),
      };
    case 'ranked_weekday':
      return {
        ...base,
        filledBy: 'derived',
        what: translate('calendar.assumed.what.on_weekday', {
          people: staffPhrase(p.staff ?? 0),
          day: weekdayName(p.weekday ?? 0),
        }),
        because: translate('calendar.assumed.why.ranked_weekday', {
          floor: p.floor ?? spec.minStaff,
        }),
      };
    case 'ranked_window':
      return {
        ...base,
        filledBy: 'derived',
        what: translate('calendar.assumed.what.in_window', {
          people: staffPhrase(p.staff ?? 0),
          from: formatTime(p.startMin ?? 0),
          to: formatTime(p.endMin ?? 0),
        }),
        because: translate('calendar.assumed.why.ranked_window', {
          floor: p.floor ?? spec.minStaff,
        }),
      };
    // Inferred from the research rather than from the brief. Same shape, same
    // correctable number, different sentence -- the manager is owed the
    // difference between a rule that rests on something they said and one
    // that rests on what a model read about their trade in their city.
    case 'researched_weekday':
      return {
        ...base,
        filledBy: 'derived',
        what: translate('calendar.assumed.what.on_weekday', {
          people: staffPhrase(p.staff ?? 0),
          day: weekdayName(p.weekday ?? 0),
        }),
        because: translate('calendar.assumed.why.researched_weekday', {
          why: gap.why ?? '',
        }),
      };
    case 'researched_window':
      return {
        ...base,
        filledBy: 'derived',
        what: translate('calendar.assumed.what.in_window', {
          people: staffPhrase(p.staff ?? 0),
          from: formatTime(p.startMin ?? 0),
          to: formatTime(p.endMin ?? 0),
        }),
        because: translate('calendar.assumed.why.researched_window', {
          why: gap.why ?? '',
        }),
      };
    case 'researched_holiday':
      return {
        ...base,
        filledBy: 'derived',
        what: translate('calendar.assumed.what.closed_date', {
          date: gap.date ?? '',
        }),
        because: translate('calendar.assumed.why.researched_holiday', {
          why: gap.why ?? '',
        }),
      };
    default:
      // `generic`, and anything a newer server sends that this build has no
      // sentence for: fall back to describing the field, never to the label.
      return {
        ...base,
        filledBy: 'default',
        what: genericWhat(gap, spec),
        because: null,
      };
  }
}

/** Every decision behind the calendar on screen, in the order it was made. */
export function describeAssumptions(
  gaps: SpecGap[],
  spec: SchedulingSpec,
): Assumption[] {
  return gaps.map((g, i) => describeAssumption(g, spec, i));
}

/**
 * Can this row be corrected with a number, here, without rewriting the brief?
 *
 * Only the staffing assumptions. An opening hour or a closure is a shape rather
 * than a figure, and a stepper for it would be a worse editor than the sentence
 * the manager can already type -- so those rows stay read-only and say what they
 * are, which is still the point of the list.
 */
export function isCorrectable(gap: SpecGap): boolean {
  return (
    gap.reason === 'lowest_stated' ||
    gap.reason === 'ranked_weekday' ||
    gap.reason === 'ranked_window' ||
    // Inferred staffing is the row most worth being able to correct in place:
    // nobody typed it, so a wrong figure has no sentence behind it to rewrite.
    gap.reason === 'researched_weekday' ||
    gap.reason === 'researched_window'
  );
}

/** The number currently in force for a correctable row. */
export function assumedStaff(gap: SpecGap, spec: SchedulingSpec): number {
  return gap.params?.staff ?? spec.minStaff;
}

/**
 * The spec with one assumption replaced by the manager's own number.
 *
 * MATCHED BY SHAPE, NOT BY INDEX. The requirement this gap describes is the one
 * `assume()` appended for exactly this weekday or this window, and both sides
 * carry those in `params` -- so the row and the rule find each other even after
 * a regeneration has reordered the list. A gap whose rule is no longer there
 * (the brief changed under it) leaves the spec untouched rather than editing
 * whichever requirement happens to sit at that position.
 *
 * Pure: the caller regenerates, so a correction goes through the same generator
 * as everything else instead of patching the calendar behind its back.
 */
export function correctAssumption(
  spec: SchedulingSpec,
  gap: SpecGap,
  staff: number,
): SchedulingSpec {
  const p = gap.params ?? {};
  if (gap.reason === 'lowest_stated') {
    return { ...spec, minStaff: staff };
  }
  // Both sources correct the same way, because the rule they made is the
  // same shape -- matched by weekday or by window, never by index.
  if (gap.reason === 'ranked_weekday' || gap.reason === 'researched_weekday') {
    return {
      ...spec,
      coverage: (spec.coverage ?? []).map((req) =>
        req.startMin == null &&
        req.endMin == null &&
        req.weekdays.length === 1 &&
        req.weekdays[0] === p.weekday
          ? { ...req, staff }
          : req,
      ),
    };
  }
  if (gap.reason === 'ranked_window' || gap.reason === 'researched_window') {
    return {
      ...spec,
      coverage: (spec.coverage ?? []).map((req) =>
        req.weekdays.length === 0 &&
        req.startMin === p.startMin &&
        req.endMin === p.endMin
          ? { ...req, staff }
          : req,
      ),
    };
  }
  return spec;
}
