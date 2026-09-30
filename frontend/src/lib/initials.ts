// The letters on a person's round badge: the sidebar's user block draws them
// where a photo would go. Pure, so it is tested without a DOM.

/**
 * Up to two capitals: the first letter of the first word and of the last.
 * "María de los Ángeles Rodríguez" is "MR", not "MD": the last word is the
 * surname people are told apart by, and the particles between are skipped.
 * Counted in letters, not UTF-16 units, so an accented or astral first
 * letter is not cut in half. With no name, the first letter of `fallback`
 * (the email); with neither, an empty string.
 */
export function initialsOf(name: string | null | undefined, fallback?: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const first = (word: string | undefined) => Array.from(word ?? '')[0] ?? '';
  if (words.length === 0) return first((fallback ?? '').trim()).toLocaleUpperCase();
  const letters = words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
  return letters.toLocaleUpperCase();
}
