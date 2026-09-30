"""What a photo may be, read from its own bytes: a dish's, or a product's.

A photo arrives as the body of a PUT -- `PUT /menu/dishes/{id}/photo` for a
dish of the menu, `PUT /inventory/items/{id}/photo` for a product of the stock
-- with its Content-Type, is kept in Postgres (`menu_dish_photo`, migration
0038; `inventory_item_photo`, 0042) and is served back to every phone of the
team from a URL anybody can open (see `routers/menu_photos.py` and
`routers/inventory_photos.py`; the HTTP half both share is `app/photo_http.py`).
Nothing here decodes an image: the server has no Pillow and does not need one,
because the browser shrinks the photo before it is sent (a canvas, 800 px on
the long side, JPEG). What the server checks is that the bytes are what they
say they are, and small enough to be sent to twenty phones:

  1. The type is one of three -- JPEG, PNG, WebP. Not SVG, which is a document
     and can carry script; not GIF or HEIC, which the canvas does not produce
     and some browsers cannot show, so a whole team would see a broken image.
  2. The bytes begin the way that type begins (its "magic"), and the type
     declared is the one they prove. A PNG sent as a JPEG, or a page of HTML
     sent as a JPEG, is refused rather than stored under a label it does not
     wear; what is served back is served with `nosniff`, so the label is what
     a browser believes.
  3. The header that says how many pixels the picture has can be read, and
     says at most `MAX_SIDE` a side. The file size is not the size that
     matters to a phone: a 500 KB PNG can be 20,000 x 20,000 pixels of one
     colour, which is 1.6 GB to decode on every phone that opens the menu.
     The canvas sends 800; this wall is for anything that is not the canvas.
  4. At most `MAX_BYTES`. The body limit (app/body_limit.py) already stops a
     request at 1 MB; this is the photo's own wall, said again by the CHECK
     of both tables (0038, 0042).

What is NOT proved is that the rest of the file decodes: a JPEG whose header
is right and whose picture is cut short passes, and shows as far as it goes.
Checking that would take a decoder, and the one person who can upload a photo
is the manager of the business it is shown to.

Moved here from `app/services/menu_photos.py` (27-sep-2026) when the stock's
products got photos too; that module still answers with the same names.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Optional, Tuple

# 512 KB. An 800 px JPEG at the canvas's quality is 60-150 KB, so this is a
# wall, not a squeeze -- and the same number as the CHECK on both tables'
# column (0038, 0042).
MAX_BYTES = 512 * 1024

# Pixels on either side. Twice what a phone's screen is wide in device pixels
# and five times what the browser sends; a camera's own 4032 x 3024 still
# passes, for a client that uploads without shrinking.
MAX_SIDE = 4096

# The types a photo may be, as the Content-Type it is sent and served with.
# The CHECK of both tables (0038, 0042) holds the column to the same three.
JPEG = "image/jpeg"
PNG = "image/png"
WEBP = "image/webp"
TYPES = (JPEG, PNG, WEBP)


class PhotoRefused(Exception):
    """Not a photo this app keeps. The router says which of the two, in a code."""


class PhotoTooLarge(PhotoRefused):
    """Over `MAX_BYTES`, or over `MAX_SIDE` pixels on a side."""


class NotAPhoto(PhotoRefused):
    """Not a JPEG, PNG or WebP, not the type it was sent as, or no size to read."""


@dataclass(frozen=True)
class Photo:
    content_type: str
    width: int
    height: int


def media_type(header: Optional[str]) -> Optional[str]:
    """`image/JPEG; foo=bar` -> `image/jpeg`: the part a type is compared by."""
    if not header:
        return None
    return header.split(";", 1)[0].strip().lower() or None


def sniff(data: bytes) -> Optional[str]:
    """Which of the three types the bytes begin as, or None."""
    if data[:3] == b"\xff\xd8\xff":
        return JPEG
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return PNG
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return WEBP
    return None


# --- How many pixels, from the header alone ----------------------------------

Size = Tuple[int, int]

# Every start-of-frame marker, baseline and progressive and the rest, except
# the three that share the range and are not frames: DHT (C4), JPG (C8) and
# DAC (CC).
_JPEG_FRAMES = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}
# Markers that stand alone, with no length after them: TEM, the restarts, SOI.
_JPEG_BARE = frozenset({0x01, 0xD8, *range(0xD0, 0xD8)})


def _jpeg_size(data: bytes) -> Optional[Size]:
    """Walk the segments to the frame header, which holds the size.

    A photo from a phone carries its EXIF (up to 64 KB) and ICC profile before
    the frame, so the frame is not at a fixed place: each segment says its own
    length, and is stepped over. The image data itself (after SOS) is never
    walked -- a frame must come before it, and if none has, there is none.
    """
    i, n = 2, len(data)
    while i < n:
        if data[i] != 0xFF:
            return None
        while i < n and data[i] == 0xFF:  # fill bytes may pad a marker
            i += 1
        if i >= n:
            return None
        marker = data[i]
        i += 1
        if marker in _JPEG_BARE:
            continue
        if marker in (0xD9, 0xDA):  # end of image, or the scan, before any frame
            return None
        if i + 2 > n:
            return None
        length = int.from_bytes(data[i : i + 2], "big")
        if length < 2:
            return None
        if marker in _JPEG_FRAMES:
            # length (2), precision (1), height (2), width (2)
            if i + 7 > n:
                return None
            height = int.from_bytes(data[i + 3 : i + 5], "big")
            width = int.from_bytes(data[i + 5 : i + 7], "big")
            return width, height
        i += length
    return None


def _png_size(data: bytes) -> Optional[Size]:
    """The first chunk is IHDR by rule, and its first eight bytes are the size."""
    if len(data) < 24 or data[12:16] != b"IHDR":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _webp_size(data: bytes) -> Optional[Size]:
    """The first chunk says which of WebP's three kinds this is, and each
    keeps the size its own way (RFC 9649)."""
    chunk = data[12:16]
    if chunk == b"VP8 ":
        # Lossy: a 3-byte frame tag, the start code, then 14 bits a side.
        if len(data) < 30 or data[23:26] != b"\x9d\x01\x2a":
            return None
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        return width, height
    if chunk == b"VP8L":
        # Lossless: a signature byte, then 14 bits each of width-1, height-1.
        if len(data) < 25 or data[20] != 0x2F:
            return None
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8X":
        # Extended (alpha, animation, metadata): the canvas, 24 bits a side, less one.
        if len(data) < 30:
            return None
        return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
    return None


_SIZE: Dict[str, Callable[[bytes], Optional[Size]]] = {
    JPEG: _jpeg_size,
    PNG: _png_size,
    WEBP: _webp_size,
}


def inspect(data: bytes, declared: Optional[str]) -> Photo:
    """The photo these bytes are, sent as `declared` -- or why not.

    The size in bytes is checked first, before anything is read: it is the
    one answer that does not depend on what the bytes are.
    """
    if len(data) > MAX_BYTES:
        raise PhotoTooLarge("%d bytes, over %d" % (len(data), MAX_BYTES))
    kind = sniff(data)
    if kind is None:
        raise NotAPhoto("not a JPEG, PNG or WebP")
    if media_type(declared) != kind:
        raise NotAPhoto("sent as %r, but the bytes are %s" % (declared, kind))
    size = _SIZE[kind](data)
    if size is None or min(size) < 1:
        raise NotAPhoto("a %s whose size cannot be read" % kind)
    width, height = size
    if max(width, height) > MAX_SIDE:
        raise PhotoTooLarge("%d x %d pixels, over %d a side" % (width, height, MAX_SIDE))
    return Photo(content_type=kind, width=width, height=height)


__all__ = [
    "JPEG",
    "MAX_BYTES",
    "MAX_SIDE",
    "NotAPhoto",
    "PNG",
    "Photo",
    "PhotoRefused",
    "PhotoTooLarge",
    "TYPES",
    "WEBP",
    "inspect",
    "media_type",
    "sniff",
]
