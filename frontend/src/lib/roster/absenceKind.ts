// From what the manager said to a kind of leave the business actually has.
//
// "Juanito está enfermo del 15 al 22" has to end up as a row in `absence`, and
// a row in `absence` needs an `absence_type_id`. The model cannot supply one --
// it has never seen the org's types, and it must not: an id invented to fill a
// field is a wrong payslip that surfaces a month later. So it names the KIND in
// a word, and the resolving happens here, against the types the business has.
//
// WHY A CODE AND NOT A NAME. The four types seeded at signup carry stable codes
// (VAC, SICK, PERS, UNPAID) and names the manager may rewrite in any language.
// Matching on the name would break the day somebody renamed "Sick" to "Baja
// médica"; matching on the code cannot.
//
// AND WHY "unknown" IS NOT A FAILURE. Whether a week off is paid, whether it
// comes out of a holiday balance, and whether the hours come back are three
// facts about somebody's contract and their country's law. "No puede trabajar
// esa semana" says none of them. Guessing is the one thing that must not
// happen here, so this returns `null` and the caller asks the manager -- see
// `AbsenceKindModal`. The question is worth interrupting for precisely because
// the answer is invisible in the rota: the calendar looks identical either way,
// and the difference only shows up in the payslip and the working year.

import type { AbsenceTypeOut } from '../../types';

/** What the model is allowed to say about a stretch of time off. */
export type AbsenceKind = 'sick' | 'vacation' | 'personal' | 'unpaid' | 'unknown';

const KINDS: AbsenceKind[] = ['sick', 'vacation', 'personal', 'unpaid', 'unknown'];

/** The seeded code each kind means, in the order worth trying. */
const CODES: Record<Exclude<AbsenceKind, 'unknown'>, string[]> = {
  sick: ['SICK'],
  vacation: ['VAC'],
  personal: ['PERS'],
  // An unpaid stretch falls back to Personal, which is seeded unpaid too. A
  // business that deleted UNPAID still has somewhere honest to put it.
  unpaid: ['UNPAID', 'PERS'],
};

/** Narrow whatever the model wrote to a kind, defaulting to "unknown". */
export function toAbsenceKind(raw: unknown): AbsenceKind {
  const value = String(raw ?? '').trim().toLowerCase();
  return (KINDS as string[]).includes(value) ? (value as AbsenceKind) : 'unknown';
}

/**
 * The org's own type for a kind, or null when the manager has to be asked.
 *
 * Null for "unknown", and null for a kind whose type this business does not
 * have -- a manager who deleted "Sick" is telling us that word means nothing
 * here, and picking the nearest survivor would file an illness as a holiday.
 */
export function typeForKind(
  kind: AbsenceKind,
  types: AbsenceTypeOut[],
): AbsenceTypeOut | null {
  if (kind === 'unknown') return null;
  for (const code of CODES[kind]) {
    const hit = types.find((t) => t.code === code);
    if (hit) return hit;
  }
  return null;
}

/**
 * What choosing this type does, as flags rather than as a sentence.
 *
 * The modal shows the consequence next to every option, because "vacation" and
 * "unpaid" are indistinguishable on a calendar and the manager is being asked
 * to decide between them. Read off the type, never assumed: a business whose
 * sick leave does consume balance says so in its own row, and the question has
 * to tell that manager the truth about THEIR set-up.
 */
export interface AbsenceConsequence {
  paid: boolean;
  consumesBalance: boolean;
  recoverable: boolean;
}

export function consequenceOf(type: AbsenceTypeOut): AbsenceConsequence {
  return {
    paid: type.is_paid,
    consumesBalance: type.consumes_balance,
    recoverable: type.is_recoverable === true,
  };
}

/**
 * The last day of an absence, as the instant the rota reads it at.
 *
 * 23:59:59 on the last day, NOT midnight on the next one. `availability()`
 * discards an absence whose end is before the day starts, so an end of
 * "the 23rd at 00:00" still overlaps the 23rd and blocks a day the manager
 * never asked to block. One second is the whole difference between a week off
 * and eight days off.
 */
export function absenceBounds(from: string, to: string): [string, string] {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return [
    new Date(y1, m1 - 1, d1, 0, 0, 0).toISOString(),
    new Date(y2, m2 - 1, d2, 23, 59, 59).toISOString(),
  ];
}
