// The notes as the server last sent them, with what is still on its way there.
//
// The list is asked again while a save is in flight: the poll that waits for a
// reading runs every few seconds, and every save invalidates the list when it
// lands. Any of those answers left the server BEFORE the save reached it, so
// it carries the previous words. Taken as it came, it replaced the optimistic
// copy -- and the editor, remounted per day, would open on the old text and
// save the next keystroke over the new. Replaying the saves and deletes still
// in flight onto every answer keeps the list at what the manager last wrote.

import type { DayNote } from '../../api/dayNotes';
import { removeNote, upsertNote } from './insight';

/** A change the server has not confirmed yet, in the order it was made. */
export type InFlight =
  | { kind: 'save'; date: string; body: string }
  | { kind: 'delete'; date: string };

export function withInFlight(list: DayNote[], changes: InFlight[]): DayNote[] {
  return changes.reduce(
    (acc, c) =>
      c.kind === 'save'
        ? upsertNote(acc, { note_date: c.date, body: c.body.trim() })
        : removeNote(acc, c.date),
    list,
  );
}
