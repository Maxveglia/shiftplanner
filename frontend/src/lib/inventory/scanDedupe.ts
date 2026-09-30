// One box, one scan.
//
// The camera looks several times a second and reads the same box every time
// it looks, for as long as the box is in front of it. Counting every read
// would turn "I scanned one carton" into "I received eleven". So a code
// counts once, and then not again until it has been OUT of sight for the
// whole window -- measured from the LAST time it was seen, not the first, so
// a box held in front of the lens for ten seconds is still one box.
//
// A different code counts straight away: scanning a row of shelves, the next
// product must not wait. And the memory is per code, not "the last code":
// a carton with both an ITF-14 and an EAN in the frame shows the camera A, B,
// A, B..., and remembering only the last one would count both on every frame.

/** How long a code must be gone before it counts again. */
export const SCAN_REPEAT_MS = 1500;

export interface ScanDedupe {
  /** Should this read count? `now` in ms from any monotonic clock (performance.now()). */
  accept(code: string, now: number): boolean;
  /** Forget everything seen (a new scanning session). */
  reset(): void;
}

/**
 * The same box read two ways must still be one box.
 *
 * A UPC-A on an imported product can come back as its 12 digits or, from a
 * reader that treats it as EAN-13, with a leading zero; a gun sends a CR or a
 * TAB after it. This is the spec's barcode key (whitespace out, GTIN lengths
 * zero-padded to 14), used here only to tell reads apart -- what is handed
 * on is the code exactly as read, and the page normalises it itself.
 */
function dedupeKey(code: string): string {
  const bare = code.replace(/[\s\u0000-\u001f\u007f]/g, '');
  return /^\d+$/.test(bare) && [8, 12, 13, 14].includes(bare.length)
    ? bare.padStart(14, '0')
    : bare;
}

export function createScanDedupe(windowMs: number = SCAN_REPEAT_MS): ScanDedupe {
  const lastSeen = new Map<string, number>();
  return {
    accept(code, now) {
      const key = dedupeKey(code);
      if (!key) return false;
      // Forget what has been gone for a whole window, so the map stays the
      // size of what is in front of the camera rather than of the whole day.
      for (const [k, t] of lastSeen) {
        if (now - t >= windowMs) lastSeen.delete(k);
      }
      const seen = lastSeen.has(key);
      // Every sighting moves the mark, the ones that do not count included:
      // that is what makes "still in front of the lens" never count twice.
      lastSeen.set(key, now);
      return !seen;
    },
    reset() {
      lastSeen.clear();
    },
  };
}
