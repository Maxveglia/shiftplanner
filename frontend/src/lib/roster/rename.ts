// Changing what somebody is called, in the row where their name is read.
//
// One decision, kept away from React for the same reason the swipe arithmetic
// is: it is the part with edge cases, and a rule you can only exercise by
// typing into a real table is a rule nobody exercises.

/**
 * The name to save, or null if there is nothing to save.
 *
 * Three things are not a rename, and all three happen constantly: leaving the
 * box without touching it, tabbing through after selecting the text, and
 * clearing the field. The last one is the one that matters — a blank name
 * would be accepted by the server and would leave a row nobody can identify,
 * with no undo the way a removal has one. Blank means "I changed my mind", so
 * the old name stays and the box goes back to showing it.
 *
 * Surrounding and repeated whitespace is dropped rather than rejected: a name
 * pasted out of a spreadsheet arrives with both, and "Ana  Ruiz" differing
 * from "Ana Ruiz" is a difference nobody can see and everybody trips over
 * later, when they search for her.
 */
export function renameTo(draft: string, current: string): string | null {
  const cleaned = draft.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;
  return cleaned === current ? null : cleaned;
}
