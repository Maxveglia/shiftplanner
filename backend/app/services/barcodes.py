"""What makes two readings of a barcode the same barcode.

A product's code arrives three ways -- a USB or Bluetooth scanner that types
it and presses Enter, the phone's camera, and a manager copying the digits off
the box -- and the three do not agree on spelling. A scanner may send a CR, an
LF or a TAB after the code (or before it: some are configured with a prefix).
A person types "4 006381 333931" because that is how it is printed under the
bars. And the same product is one number in three lengths: the American UPC-A
`036000291452` (12 digits) is the EAN-13 `0036000291452` and the GTIN-14
`00036000291452`, and which of the three a reader reports depends on the
reader, not on the box.

So a code is stored twice: as it was read (`code`, trimmed, for showing back)
and as its KEY, which is what is compared, what the uniqueness is on, and what
a scan is looked up by. The key is:

  1. The code with every whitespace and control character removed, anywhere
     in it -- not only at the ends.
  2. If that leaves nothing, there was no code.
  3. If what is left is all ASCII digits and 8, 12, 13 or 14 of them, it is a
     GTIN, and it is left-padded with zeros to 14. That is GS1's own rule for
     comparing GTINs of different lengths, so an EAN-8 `96385074` becomes
     `00000096385074` and cannot collide with anything that is not the same
     product.
  4. Anything else -- a Code 128 label the business printed itself, digits of
     some other length -- is kept exactly as step 1 left it. Case included:
     `ABC-123` and `abc-123` are different labels as far as we know, and
     folding them would merge two products on a guess.

THE SAME RULES LIVE IN THE BROWSER (`frontend/src/lib/inventory/barcodeKey.ts`),
because a scan is matched against the list on the phone before anything is
sent. Both sides test the same table of cases; change one, change both. What
counts as "whitespace or control" is pinned so the two agree character for
character: Python's `str.isspace()` plus the Cc category plus U+FEFF is exactly
JavaScript's `/[\\s\\p{Cc}]/u` (U+FEFF is `\\s` in JS and not in Python; the rest
of the two sets coincide once Cc is added -- checked over every code point).

No check digit is verified. A misread digit would fail its check, but so would
a code a business made up for a shelf label, and refusing that is worse than
storing a typo the manager can see and delete.
"""
from __future__ import annotations

import re
import unicodedata

# The lengths that are a GTIN when they are all digits: EAN-8, UPC-A, EAN-13,
# GTIN-14. Nothing else is padded -- a 10-digit number is somebody's own code.
GTIN_LENGTHS = frozenset({8, 12, 13, 14})
GTIN_WIDTH = 14

# [0-9] and not \d: Python's \d matches every Unicode digit, and "٣" is not a
# barcode digit a scanner will ever send.
_ASCII_DIGITS = re.compile(r"[0-9]+")

# The ends a code is trimmed of: what JavaScript's trim() removes, which is
# Python's whitespace plus U+FEFF (the same one-character gap as below).
_ENDS = re.compile(r"^[\s\ufeff]+|[\s\ufeff]+$")


def _is_blank(ch: str) -> bool:
    return ch.isspace() or ch == "\ufeff" or unicodedata.category(ch) == "Cc"


def clean_code(code: str) -> str:
    """The code as it is shown back: control characters out, ends trimmed.

    Spaces INSIDE are kept ("4 006381 333931" is how the box prints it); a
    control character never is -- a scanner's CR or GS means nothing on a
    screen, and a NUL is a thing Postgres refuses to store in text at all.
    """
    return _ENDS.sub("", "".join(ch for ch in code if unicodedata.category(ch) != "Cc"))


def barcode_key(code: str) -> str:
    """The form two codes are compared in. ValueError if there is no code."""
    key = "".join(ch for ch in code if not _is_blank(ch))
    if not key:
        raise ValueError("a barcode must not be blank")
    if _ASCII_DIGITS.fullmatch(key) and len(key) in GTIN_LENGTHS:
        return key.rjust(GTIN_WIDTH, "0")
    return key
