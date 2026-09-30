// What makes two readings of a barcode the same barcode -- the browser's copy
// of `barcode_key` in backend/app/services/barcodes.py.
//
// A scan is matched against the product list on the phone, before anything
// is sent, so the phone has to compare codes exactly as the server stores
// them. The server sends every code's key along with it (`barcodes[].key`),
// and this turns what the scanner just typed into the same shape. Both sides
// test the same table of cases; change one, change both.
//
//   1. Every whitespace and control character goes, anywhere in the code: a
//      scanner may send CR, LF or TAB around it, and a person types
//      "4 006381 333931" because that is how the box prints it.
//   2. Nothing left: there was no code.
//   3. All ASCII digits and 8, 12, 13 or 14 of them: a GTIN, left-padded with
//      zeros to 14 -- so the UPC-A `036000291452`, the EAN-13
//      `0036000291452` and the GTIN-14 `00036000291452` are one product.
//   4. Anything else (a Code 128 label, digits of another length) stays as
//      step 1 left it, case included.

// `\s` plus the Cc category is, character for character, what the server
// strips (Python's isspace() + Cc + U+FEFF); see the note in barcodes.py.
const BLANK = /[\s\p{Cc}]/gu;
const ASCII_DIGITS = /^[0-9]+$/;
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);
const GTIN_WIDTH = 14;

/** The key a code is compared by, or null when there is no code in it. */
export function barcodeKey(code: string): string | null {
  const key = code.replace(BLANK, '');
  if (key === '') return null;
  if (ASCII_DIGITS.test(key) && GTIN_LENGTHS.has(key.length)) {
    return key.padStart(GTIN_WIDTH, '0');
  }
  return key;
}

/**
 * The code as it is sent and shown back: control characters out, ends
 * trimmed, the spaces inside kept. The server cleans it the same way; doing it
 * here too keeps a scanner's trailing CR out of what the manager sees.
 */
export function cleanCode(code: string): string {
  return code.replace(/\p{Cc}/gu, '').trim();
}
