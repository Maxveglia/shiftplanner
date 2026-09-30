// Who works here, as a table rather than as a sentence to type.
//
// The interview asks this one itself -- the model flags the turn with
// `form: "roster"` -- and the manager answers it by filling in a row per
// person: what they are called, and the hours a week their contract is for.
// A chat is bad at this answer for the same reason it was bad at opening
// hours: six people is six names and six numbers, every manager writes them
// differently, and a model reading "ana 40 luis y marta media jornada" has to
// guess what half a day is here.
//
// This module is only the writing-down. The row goes up as an ordinary
// manager message, in the manager's language, so the model reads it like
// anything else they typed and carries the names into the brief -- which is
// what puts them on the roster, since the brief is what the planner reads.
//
// Hours are optional on purpose: somebody with no fixed contract is a real
// answer, and demanding a number would make the manager invent one.

import { translate } from '../i18n';
import { formatDecimal } from '../format';

/**
 * What a row says about someone's hours.
 *
 * Three answers and not two, because a form that offers only a number and
 * "no fixed hours" makes every untouched row claim the second. `null` is the
 * row nobody has got to yet; `'none'` is the manager saying out loud that
 * this person has no fixed contract. The first is not repeated to the model
 * as a fact, the second is.
 */
export type ContractHours = number | 'none' | null;

/** One person, as the form holds them while it is being filled in. */
export interface RosterEntry {
  /** Stable across re-renders, so typing in one row cannot reorder another. */
  id: string;
  name: string;
  weeklyHours: ContractHours;
}

/** A row nobody has filled in yet. */
export function emptyEntry(): RosterEntry {
  return {
    id: Math.random().toString(36).slice(2),
    name: '',
    weeklyHours: null,
  };
}

/**
 * The table as it opens, for a business that already said how many they are.
 *
 * A row each: the manager counted their people one question ago, and making
 * them press "add someone" five times to say the same thing again is the
 * interview forgetting what it was just told. One empty row when nobody
 * counted -- never none, or there is nothing to type into.
 */
export function entriesFor(people: number | null): RosterEntry[] {
  const rows = people && people > 0 ? people : 1;
  return Array.from({ length: rows }, emptyEntry);
}

/**
 * The contract lengths offered in the hours column, longest first.
 *
 * A list and not a free number box because picking is faster than typing and
 * because these are the contracts that actually exist: full time, the common
 * part-times, and the short ones. Anything else is still sayable -- the last
 * option opens a box -- so the list never becomes the limit of what a
 * contract may be.
 */
export const HOURS_OPTIONS = [40, 38, 37.5, 35, 30, 25, 20, 16, 15, 12, 10, 8];

/** The rows that say something. A blank row is not an answer. */
export function namedEntries(entries: RosterEntry[]): RosterEntry[] {
  return entries.filter((e) => e.name.trim().length > 0);
}

/**
 * The hours as a number, or null for anything that is not one.
 *
 * Null and zero are different answers -- "nobody said" and "a contract for no
 * hours" -- and only the first is one a manager means, so an empty box stays
 * null rather than becoming a figure the calendar would then defend.
 */
export function parseHours(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const n = Number.parseFloat(text.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 80) return null;
  return n;
}

/**
 * Hours without a trailing `.0`, and with the decimal mark of the language the
 * manager is reading: 40 and 37.5 both read as they are said.
 *
 * It used to write a comma in either language, so the sentence this module
 * sends up on the manager's behalf told an English manager they had said
 * "37,5". The answer goes into the transcript as their own words -- a number
 * spelled the way they would never spell it is the one place that shows.
 */
function hoursText(hours: number): string {
  return formatDecimal(hours);
}

/**
 * What the manager is taken to have said, from the rows they filled in.
 *
 * One sentence, in their language, naming each person with their hours --
 * the shape the model is told to expect, and the shape it has to be able to
 * carry into the brief unchanged.
 */
export function composeRosterAnswer(entries: RosterEntry[]): string {
  const people = namedEntries(entries);
  if (people.length === 0) return '';
  const list = people
    .map((p) => {
      const name = p.name.trim();
      if (p.weeklyHours === null) {
        return translate('interview.roster.said.unsaid', { name });
      }
      if (p.weeklyHours === 'none') {
        return translate('interview.roster.said.noHours', { name });
      }
      return translate('interview.roster.said.person', {
        name,
        hours: hoursText(p.weeklyHours),
      });
    })
    .join(', ');
  return translate(
    people.length === 1
      ? 'interview.roster.said.one'
      : 'interview.roster.said.other',
    { count: people.length, list },
  );
}
