// The month the manager named, when they named one.
//
// "Rehazme el calendario de octubre" replanned September. Not a bug in the
// planner: the scope of a replan came from the toolbar and from whichever
// month folder happened to be open, and the SENTENCE was never read. The
// manager said October, watched September change, and was told in amber that
// the other eleven months had been left as they were.
//
// WHAT THIS DOES AND DOES NOT DO. It does not guess intent. `planScope` says
// plainly that no parser can tell "alternate the weekends" (a sentence about
// the year) from "give Ana more Fridays" (a sentence about a month), and this
// file does not try either. It reads one thing only: a month NAMED out loud,
// in the manager's own words, which is not an inference -- it is a date they
// typed. Everything else is left exactly as the manager set it in the bar.
//
// Both languages, always, whatever the interface is set to: a Catalan manager
// with the app in English still writes "octubre" half the time, and reading
// only the interface language would make the feature work for some sentences
// and not others with nothing on screen to explain the difference.

/** Locales whose month names are recognised, whatever the UI language is. */
const LOCALES = ['es-ES', 'en-GB'];

/** Lowercase, and without the accents a manager may or may not type. */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Month names and three-letter abbreviations -> month number, 1-12. */
function monthWords(): Map<string, number> {
  const out = new Map<string, number>();
  for (const locale of LOCALES) {
    for (let m = 0; m < 12; m += 1) {
      const date = new Date(2026, m, 1);
      for (const style of ['long', 'short'] as const) {
        const word = plain(
          date.toLocaleDateString(locale, { month: style }),
        ).replace(/\.$/, '');
        // Three letters is the shortest a month is ever written; anything
        // shorter would match parts of ordinary words.
        if (word.length >= 3) out.set(word, m + 1);
      }
    }
  }
  return out;
}

const WORDS = monthWords();

/**
 * The months of `within` that `text` names, in calendar order.
 *
 * `within` is the period on screen ("2026-09", "2026-10", ...): a month the
 * calendar does not cover cannot be replanned, so naming it is the same as
 * naming nothing. A bare month name with the year unsaid means the first one
 * of that name in the period, which on a twelve-month horizon is the next one
 * coming.
 *
 * "2026-10" written out is read too, because that is what a manager copying a
 * month key out of the product types back into it.
 */
export function monthsNamedIn(text: string, within: readonly string[]): string[] {
  if (within.length === 0) return [];
  const said = plain(text);
  const wanted = new Set<string>();

  // A year said next to the month name binds to it: "octubre de 2027" is not
  // this October. Read as a pair rather than as two independent finds.
  for (const [word, month] of WORDS) {
    // The whole word and nothing else: "mayo" lives inside "mayoría" and
    // "may" inside "maybe", and either would have replanned a month nobody
    // mentioned.
    const at = new RegExp(`\\b${word}\\b(?:\\s+(?:de[l]?\\s+|of\\s+)?(\\d{4}))?`);
    const found = said.match(at);
    if (!found) continue;
    const mm = String(month).padStart(2, '0');
    const year = found[1];
    for (const key of within) {
      if (key.slice(5) !== mm) continue;
      if (year && key.slice(0, 4) !== year) continue;
      wanted.add(key);
      if (!year) break; // the first one of that name, not every year of it
    }
  }

  for (const key of within) {
    if (said.includes(key)) wanted.add(key);
  }

  return within.filter((k) => wanted.has(k));
}
