// The arithmetic behind the launcher's movement, kept apart from the page so it
// can be tested without a DOM (see vitest.config.ts: there is none on purpose).
// The page only measures rectangles and hands the numbers here.

/**
 * How far a tile leans towards the pointer, in degrees.
 *
 * The side under the pointer sinks, as if pressed: a pointer at the right edge
 * turns the tile about its vertical axis so the right side moves away, one at
 * the top tips the top away. Positions outside the tile are clamped to its
 * edge, so a fast pointer leaving it cannot throw it past `max`.
 */
export function tiltFor(
  x: number,
  y: number,
  width: number,
  height: number,
  max: number,
): { rx: number; ry: number } {
  if (width <= 0 || height <= 0) return { rx: 0, ry: 0 };
  const nx = clamp((x / width) * 2 - 1, -1, 1);
  const ny = clamp((y / height) * 2 - 1, -1, 1);
  return { rx: round2(-ny * max), ry: round2(nx * max) };
}

/**
 * The radius a circle centred on (x, y) needs to cover the whole viewport:
 * the distance to its farthest corner. The reveal that carries a manager into
 * an app grows from the tile they chose to exactly this, and no further, so
 * it ends the moment the screen is covered wherever the tile sits.
 */
export function coverRadius(x: number, y: number, width: number, height: number): number {
  return Math.ceil(Math.hypot(Math.max(x, width - x), Math.max(y, height - y)));
}

/**
 * Which tile an arrow key moves focus to, wrapping round at either end;
 * `null` for keys that do not move it. Left/right and up/down both work
 * because the tiles sit in a row on a wide screen and in a column on a phone.
 */
export function nextTile(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Whether a click on a tile is ours to animate. A click with a modifier or
 * another button is the browser's -- a new tab, a new window -- and the tile
 * is a real link precisely so those keep working.
 */
export function isPlainClick(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** The name a greeting uses: the first word of the full name, or nothing. */
export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * A line with a name in it, from its untranslated template (`t(key)` with no
 * values, `{name}` still in it), and where the name sits, counted in letters
 * as LetterTitle draws the line -- not in UTF-16 units, which an accent or an
 * emoji in the name would throw off. Found from the template, not by looking
 * for the name in the finished line: a business called "se" would be found
 * again in "se está preparando".
 */
export function namedLine(
  template: string,
  name: string,
): { text: string; highlight?: { at: number; length: number } } {
  const at = template.indexOf('{name}');
  if (at < 0) return { text: template };
  return {
    // A function, so a `$&` in somebody's name is not read as a pattern.
    text: template.replace('{name}', () => name),
    highlight: { at: Array.from(template.slice(0, at)).length, length: Array.from(name).length },
  };
}

/**
 * A line of text split into words, each letter keeping its position in the
 * whole line -- the stagger of the letters and the colour of the name both
 * count along the line, not along the word. Runs of spaces collapse to the
 * one gap the page puts between words.
 */
export function greetingWords(text: string): { letters: { ch: string; i: number }[] }[] {
  const words: { letters: { ch: string; i: number }[] }[] = [];
  let current: { ch: string; i: number }[] = [];
  Array.from(text).forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (current.length) words.push({ letters: current });
      current = [];
    } else {
      current.push({ ch, i });
    }
  });
  if (current.length) words.push({ letters: current });
  return words;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round2(n: number): number {
  // `+ 0` folds -0 into 0: a tile at rest should read as untilted, not as
  // tilted by minus nothing.
  return Math.round(n * 100) / 100 + 0;
}
