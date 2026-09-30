// What this business taught us by correcting calendars, in the manager's own
// language.
//
// The third of a set, and the last one to be written: ./assumptions turns the
// server's gap codes into a sentence, ./declarations does the same for what the
// manager stated outright, and this does it for what was LEARNED. All three
// exist for one reason -- the server has no dictionary, so any prose it composes
// is English, and English on a Spanish screen is the bug this convention is for.
//
// Learned beliefs were the ones still arriving as prose. A Spanish manager
// opened the list of standing rules and read "2 extra on Friday between 20:00
// and 23:00" between two Spanish sentences, and the row that says what the
// product believes about their business was the row they could not read.
//
// The key IS the shape of the claim and `value` carries its numbers -- exactly
// what `_hint_from_op` writes on the server, and exactly what a declaration
// carries, because a hint and a declaration are the same claim from two
// different authorities. What differs is the wording of one of them: a learned
// busy window says how many MORE than the floor, where a declared one says how
// many.

import { plural, translate } from '../i18n';
import { formatHours, formatTime } from '../format';
import { weekdayName } from './spec';

/** The shape every caller has: what the server sent about one belief. */
export interface HintClaim {
  key: string;
  /** The claim's own numbers. Absent on a server older than this client. */
  value?: Record<string, unknown> | null;
  /**
   * The same sentence, written in English by the server.
   *
   * The fallback, and a deliberate one. A claim shape this bundle has no
   * sentence for means a newer server, and an English sentence that says the
   * right thing beats a Spanish one that says almost nothing.
   */
  claim?: string | null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function staffPhrase(staff: number): string {
  return plural(staff, 'calendar.assumed.people.one', 'calendar.assumed.people.other', {
    staff,
  });
}

/**
 * One learned belief, as a sentence.
 *
 * Every branch is on the KEY, never on the words the server sent: the claim is
 * there to be shown when nothing else can be, not to be read.
 */
export function describeHint(hint: HintClaim): string {
  const v = hint.value ?? {};
  const key = hint.key;

  // Every claim this product makes has numbers in it, so an empty `value` is
  // not a claim about nothing -- it is a server that predates sending them.
  // Writing the sentence from no numbers produces "at least 0 people", which
  // is worse than the English the old server already sent.
  if (Object.keys(v).length === 0) {
    return hint.claim?.trim() || translate('calendar.declared.unknown');
  }

  // A rule we NOTICED in how they retouch our calendars. Filed under
  // `stated:` on the server because it behaves like one (inert until they say
  // yes), but its sentence is ours, not theirs -- so, like every other claim
  // we compose, it is built here from its numbers, in their language. The
  // Spanish sentence the server stored is what the planner reads, and what
  // this falls back to for a pattern this bundle does not know yet.
  if (isFromEdits(key)) {
    const said = describeEdit(v);
    if (said) return said;
  }

  // A rule the manager stated carries its own sentence -- theirs -- and there
  // is nothing here to phrase. It comes first because its `value` is not empty
  // (it holds the text) so it would otherwise fall past every branch below and
  // out the bottom.
  if (key.startsWith('stated:')) {
    const text = typeof v.text === 'string' ? v.text.trim() : '';
    return text || hint.claim?.trim() || translate('calendar.declared.unknown');
  }

  if (key === 'min_staff') {
    return translate('calendar.assumed.what.min_staff', {
      people: staffPhrase(num(v.staff)),
    });
  }
  if (key === 'opening_hours') {
    return translate('calendar.assumed.generic.opening_hours', {
      from: formatTime(num(v.openMin)),
      to: formatTime(num(v.closeMin)),
    });
  }
  if (key === 'max_weekly_hours') {
    return translate('calendar.assumed.generic.max_weekly_hours', {
      hours: formatHours(num(v.hours)),
    });
  }
  if (key.startsWith('closed_weekday:')) {
    // Both ways round, because a correction can teach us either one: this
    // business closes on a day the brief never mentioned, or opens on one we
    // had down as closed.
    const day = weekdayName(num(v.weekday));
    return v.closed === false
      ? translate('calendar.learned.openOn', { day })
      : translate('calendar.declared.closed', { day });
  }
  if (key.startsWith('day_hours:')) {
    return translate('calendar.declared.dayHours', {
      day: weekdayName(num(v.weekday)),
      from: formatTime(num(v.openMin)),
      to: formatTime(num(v.closeMin)),
    });
  }
  if (key.startsWith('peak:')) {
    return translate('calendar.assumed.what.in_window', {
      people: staffPhrase(num(v.staff)),
      from: formatTime(num(v.startMin)),
      to: formatTime(num(v.endMin)),
    });
  }
  if (key.startsWith('busy_window:')) {
    // MORE than the floor, not a total. Saying "2 people from 8 to 11" for a
    // belief that means "two more than usual" understates it by the floor,
    // which on a busy Friday is most of the number.
    const weekday = num(v.weekday, -1);
    const extra = num(v.extra, num(v.staff));
    const from = formatTime(num(v.startMin));
    const to = formatTime(num(v.endMin));
    return weekday >= 0
      ? plural(extra, 'calendar.learned.extraOnDay.one', 'calendar.learned.extraOnDay.other', {
          day: weekdayName(weekday),
          from,
          to,
        })
      : plural(extra, 'calendar.learned.extraWindow.one', 'calendar.learned.extraWindow.other', {
          from,
          to,
        });
  }

  return hint.claim?.trim() || translate('calendar.declared.unknown');
}

/** Keys of the rules noticed in the manager's retouches (server: EDITS_PREFIX). */
export const EDITS_PREFIX = 'stated:edit:';

export function isFromEdits(key: string): boolean {
  return key.startsWith(EDITS_PREFIX);
}

const EDIT_BANDS = ['early', 'morning', 'afternoon', 'evening', 'night'];

/** One noticed pattern as a sentence, or null for a shape this bundle lacks. */
function describeEdit(v: Record<string, unknown>): string | null {
  if (v.pattern === 'trim' && typeof v.band === 'string' && EDIT_BANDS.includes(v.band)) {
    return translate('calendar.edits.trim', {
      day: weekdayName(num(v.weekday)),
      band: translate(`calendar.edits.band.${v.band}`),
    });
  }
  if (v.pattern === 'start') {
    return translate('calendar.edits.start', {
      day: weekdayName(num(v.weekday)),
      from: formatTime(num(v.fromMin)),
      to: formatTime(num(v.toMin)),
    });
  }
  if (v.pattern === 'no_nights' && typeof v.name === 'string' && v.name.trim()) {
    return translate('calendar.edits.noNights', { name: v.name.trim() });
  }
  return null;
}
