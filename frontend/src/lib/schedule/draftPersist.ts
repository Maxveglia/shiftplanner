// How the draft calendar is written to, and read back from, the browser.
//
// The draft used to live only in memory: a reload -- or the browser deciding
// to discard the tab -- started the manager over from an empty calendar, and
// the ten minutes of refining that produced it were gone. Now it is kept in
// localStorage, under the workspace it belongs to, and comes back exactly as
// it was left.
//
// Kept free of React and of the DOM so the two parts that can go wrong can be
// tested: turning the draft into text and back (a Date has to come back a
// Date, not a string), and deciding what to drop when the browser refuses the
// write. Only `anchor` is a Date today, but the encoding is general so the
// next Date added to the draft is not a bug.

/**
 * Bumped when the SHAPE of something in the draft changes in a way an old
 * copy could not be read as. A mismatch throws the stored draft away rather
 * than feeding a page state it was not written for.
 */
export const DRAFT_VERSION = 1;

/**
 * The one key that may be dropped to make the draft fit. `history` holds a
 * full copy of the calendar for every step the manager can take back, and a
 * year of shifts ten steps deep is more than a browser gives one site. Losing
 * the ability to undo after a reload is a smaller loss than losing the draft.
 */
export const DROPPABLE_KEY = 'history';

interface Envelope {
  version: number;
  entries: [string, unknown][];
}

const DATE_TAG = '__date';

/** Draft entries -> text. Dates are tagged so they survive the round trip. */
export function encodeDraft(entries: Iterable<[string, unknown]>): string {
  const env: Envelope = { version: DRAFT_VERSION, entries: [...entries] };
  return JSON.stringify(env, function replacer(this: Record<string, unknown>, key, value) {
    // By the time the replacer sees a Date it is already an ISO string; the
    // object it hangs off still holds the Date itself.
    const raw = this[key];
    return raw instanceof Date ? { [DATE_TAG]: raw.toISOString() } : value;
  });
}

/** Text -> draft entries, or null for anything unreadable or of another version. */
export function decodeDraft(text: string | null): [string, unknown][] | null {
  if (!text) return null;
  try {
    const env = JSON.parse(text, (_key, value) =>
      value && typeof value === 'object' && typeof value[DATE_TAG] === 'string'
        ? new Date(value[DATE_TAG])
        : value,
    ) as Partial<Envelope>;
    if (env?.version !== DRAFT_VERSION || !Array.isArray(env.entries)) return null;
    return env.entries;
  } catch {
    return null;
  }
}

/**
 * Write the draft, dropping `history` if that is what it takes to fit.
 *
 * Returns what was written: 'full', 'without-history', or 'failed' when even
 * the trimmed draft is refused (storage disabled, or a calendar bigger than
 * the browser allows). A failure is not an error the manager can act on, so
 * callers log it and keep the draft in memory as before.
 */
export function writeDraft(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  entries: Map<string, unknown>,
): 'full' | 'without-history' | 'failed' {
  try {
    storage.setItem(key, encodeDraft(entries));
    return 'full';
  } catch {
    /* fall through: too big, or storage refused */
  }
  const trimmed = new Map(entries);
  trimmed.delete(DROPPABLE_KEY);
  try {
    storage.setItem(key, encodeDraft(trimmed));
    return 'without-history';
  } catch {
    return 'failed';
  }
}

/** Where one workspace's draft is kept. Scoped so two logins never share one. */
export function draftStorageKey(scope: string): string {
  return `shiftplanner.draft.${scope}`;
}
