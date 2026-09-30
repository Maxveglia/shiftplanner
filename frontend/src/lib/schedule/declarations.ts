// What the manager told us, written back to them in their own language.
//
// The twin of ./assumptions, and deliberately so: both take a claim the server
// describes in codes and numbers, and both build the sentence here. The server
// composes no prose either of them renders, because a server with no dictionary
// can only write English, and English on a Spanish screen is the bug this whole
// convention exists to prevent.
//
// What separates the two is authority, and it is the thing worth showing. An
// assumption is ours and asks to be checked. A declaration is theirs — they
// answered a question or corrected a calendar — and the only thing it needs
// offering is a way to take it back.

import { plural, translate } from '../i18n';
import { formatHours, formatTime } from '../format';
import { weekdayName } from './spec';
import type { Declaration } from '../../api/schedule';

export interface DeclaredRule {
  key: string;
  /** What is in force, in the manager's language. */
  what: string;
}

function staffPhrase(staff: number): string {
  return plural(staff, 'calendar.assumed.people.one', 'calendar.assumed.people.other', {
    staff,
  });
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * One declaration, as a sentence.
 *
 * The KEY carries the shape of the claim and `value` carries its numbers —
 * exactly the split `_hint_from_op` writes on the server, which is what lets
 * "four at the peak" said twice be one row instead of two.
 */
export function describeDeclaration(d: Declaration): DeclaredRule {
  const v = d.value ?? {};

  if (d.key.startsWith('day_hours:')) {
    return {
      key: d.key,
      what: translate('calendar.declared.dayHours', {
        day: weekdayName(num(v.weekday)),
        from: formatTime(num(v.openMin)),
        to: formatTime(num(v.closeMin)),
      }),
    };
  }
  if (d.key === 'min_staff') {
    return {
      key: d.key,
      what: translate('calendar.assumed.what.min_staff', {
        people: staffPhrase(num(v.staff)),
      }),
    };
  }
  if (d.key === 'opening_hours') {
    return {
      key: d.key,
      what: translate('calendar.assumed.generic.opening_hours', {
        from: formatTime(num(v.openMin)),
        to: formatTime(num(v.closeMin)),
      }),
    };
  }
  if (d.key === 'max_weekly_hours') {
    return {
      key: d.key,
      what: translate('calendar.assumed.generic.max_weekly_hours', {
        hours: formatHours(num(v.hours)),
      }),
    };
  }
  if (d.key.startsWith('closed_weekday:')) {
    return {
      key: d.key,
      what: translate('calendar.declared.closed', {
        day: weekdayName(num(v.weekday)),
      }),
    };
  }
  if (d.key.startsWith('peak:') || d.key.startsWith('busy_window:')) {
    // A busy window says how many MORE than the floor; a peak says how many.
    // The server has already resolved that into the spec, and the number it
    // sends back here is the one it wrote.
    const weekday = num(v.weekday, -1);
    const people = staffPhrase(num(v.staff, num(v.extra)));
    const from = formatTime(num(v.startMin));
    const to = formatTime(num(v.endMin));
    return {
      key: d.key,
      what:
        weekday >= 0
          ? translate('calendar.declared.windowOnDay', {
              people,
              day: weekdayName(weekday),
              from,
              to,
            })
          : translate('calendar.assumed.what.in_window', { people, from, to }),
    };
  }

  // A claim shape this bundle has no sentence for -- a newer server. Naming the
  // field it decided is thin, and it is still something a person can read.
  return { key: d.key, what: translate('calendar.declared.unknown') };
}

export function describeDeclarations(declared: Declaration[]): DeclaredRule[] {
  return declared.map(describeDeclaration);
}
