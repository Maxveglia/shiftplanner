// The words the server does not have yet, kept on this device.
//
// THE BUG THIS FIXES. With no Save button, a manager who types on a phone with
// no signal and taps the next day loses the note: the write fails in an editor
// that is already gone, the list is reloaded from the server, and the box is
// empty when they come back. Nothing said so. Closing the tab in the second
// after typing did the same.
//
// So every keystroke that leaves the box different from the server is written
// here, synchronously, and removed once the server has it. Whatever is still
// here when the page opens -- or when a write fails -- is a note that was not
// saved, and the page says so and offers to try again.
//
// Per USER, not per device: two managers sharing a tablet must not be offered
// each other's words. Storage can be missing or full (private mode, quota):
// every call swallows that, because losing the safety net must never break
// the typing it protects.

import type { DayNote } from '../../api/dayNotes';

export const JOURNAL_PREFIX = 'shiftplanner.dayNote.unsaved.';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface Journal {
  write: (date: string, text: string) => void;
  clear: (date: string) => void;
  /** Every date with words the server did not confirm, and those words. */
  readAll: () => Record<string, string>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `localStorage`, or null where touching it throws. */
export function browserStore(): Store | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function createJournal(scope: string, store: Store | null): Journal {
  const prefix = `${JOURNAL_PREFIX}${scope}.`;
  return {
    write: (date, text) => {
      try {
        store?.setItem(prefix + date, text);
      } catch {
        // Full or blocked: the note still saves the normal way.
      }
    },
    clear: (date) => {
      try {
        store?.removeItem(prefix + date);
      } catch {
        // Nothing to undo.
      }
    },
    readAll: () => {
      const out: Record<string, string> = {};
      try {
        if (!store) return out;
        for (let i = 0; i < store.length; i += 1) {
          const key = store.key(i);
          if (!key?.startsWith(prefix)) continue;
          const date = key.slice(prefix.length);
          const text = store.getItem(key);
          if (DATE.test(date) && text !== null) out[date] = text;
        }
      } catch {
        // Unreadable storage is an empty journal.
      }
      return out;
    },
  };
}

/**
 * The journal minus what the server already holds. An entry the server agrees
 * with is a write that landed after the tab stopped listening -- not a loss.
 * An empty entry is a deletion that did not land, so it only counts while the
 * note still exists. Before the list has loaded nothing can be ruled out.
 */
export function stillUnsaved(
  journal: Record<string, string>,
  notes: DayNote[] | undefined,
): Record<string, string> {
  if (!notes) return journal;
  const bodies = new Map(notes.map((n) => [n.note_date, n.body.trim()]));
  const out: Record<string, string> = {};
  for (const [date, text] of Object.entries(journal)) {
    if (text.trim() !== (bodies.get(date) ?? '')) out[date] = text;
  }
  return out;
}

/** A copy without `date`, or the same object when it was not there. */
export function without(map: Record<string, string>, date: string): Record<string, string> {
  if (!(date in map)) return map;
  const { [date]: _gone, ...rest } = map;
  return rest;
}
