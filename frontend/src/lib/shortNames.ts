// Names short enough for a narrow column, and never two of them the same.
//
// "Ana García López" -> "Ana G." is what a column sixteen characters wide can
// hold, and the manager knows their own staff. But a roster built by the
// onboarding starts as "Nueva incorporación 1", "Nueva incorporación 2" and
// "Nueva incorporación 3", and all three came out "Nueva i." -- three rows of
// hours nobody could put a face to.
//
// So each name starts at its shortest and only grows while it still collides
// with another one on the same list:
//
//   1. first word and the initial of the second   "Ana G."       "Nueva i."
//   2. first word and every later initial         "Ana G. L."    "Nueva i. 2"
//   3. the name in full
//
// Numbers stay whole at step 2, because a number IS the difference between
// "Nueva incorporación 2" and "3", and its initial would be the whole of it
// anyway until it reaches two digits.

const words = (full: string): string[] => full.trim().split(/\s+/).filter(Boolean);

const initial = (word: string): string => (/^\d+$/.test(word) ? word : `${word.charAt(0)}.`);

function atLevel(full: string, level: number): string {
  const parts = words(full);
  if (parts.length < 2 || level >= 3) return full.trim();
  if (level === 1) return `${parts[0]} ${initial(parts[1])}`;
  return [parts[0], ...parts.slice(1).map(initial)].join(' ');
}

/**
 * The short form of every name on the list, in the same order.
 *
 * Only the names that collide grow; everybody else keeps the shortest form.
 * Two people with the same full name stay the same -- there is nothing on the
 * page that could tell them apart, and inventing a suffix would be worse.
 */
export function shortNames(names: readonly string[]): string[] {
  const level = names.map(() => 1);
  // Three levels, so three passes settle it; the fourth is a guard.
  for (let pass = 0; pass < 4; pass++) {
    // Compared as a reader would: "José" typed on two keyboards can be two
    // different strings, and "ana G." beside "Ana G." is still one name.
    const shown = names.map((n, i) => atLevel(n, level[i]).normalize('NFC').toLocaleLowerCase());
    const seen = new Map<string, number>();
    for (const s of shown) seen.set(s, (seen.get(s) ?? 0) + 1);
    let grew = false;
    shown.forEach((s, i) => {
      if ((seen.get(s) ?? 0) > 1 && level[i] < 3) {
        level[i] += 1;
        grew = true;
      }
    });
    if (!grew) break;
  }
  return names.map((n, i) => atLevel(n, level[i]));
}
