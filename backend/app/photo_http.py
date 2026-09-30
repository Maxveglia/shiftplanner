"""A photo over HTTP: the PUT that brings one, and the GET that gives it back.

Two things of this app have a photo, and both go the same way: a dish of the
menu (routers/menu.py puts it, routers/menu_photos.py serves it; migration
0038) and a product of the stock (routers/inventory.py, routers/
inventory_photos.py; 0042). What the bytes may be is app/services/photos.py;
this is the part of it that is HTTP, written once so that the two cannot drift:
a photo the menu takes is one the stock takes, refused with the same codes and
served with the same headers.

ON THE WAY IN, the photo is the whole body of the PUT, as sent -- not JSON, not
a form -- with its own Content-Type. `read_upload` is the dependency that reads
it; a route declares it AFTER the manager, and FastAPI resolves dependencies in
that order, so an employee is turned away before a byte is read. Refused in a
code: 413 `menu_photo_too_large`, 415 `menu_photo_bad_type`. The codes are the
menu's, which had photos first; a product's photo is refused for the same
reasons and in the same words (the screen's sentence does not name the menu).

ON THE WAY OUT, to anybody who has the address -- an <img> sends no token --
so the address is the photo's random id, and the bytes behind an id never
change: a new photo is a new row with a new id. That is what lets the answer
be cached for a year, `immutable`. See routers/menu_photos.py for why that is
private enough.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request, Response, status

from app.errors import detail
from app.services import photos

# --- In ------------------------------------------------------------------------


@dataclass(frozen=True)
class Upload:
    """The body of a photo PUT, as it came: its bytes and what it said it was."""

    data: bytes
    content_type: Optional[str]


async def read_upload(request: Request) -> Upload:
    """The photo is the whole body, as sent.

    A dependency, and async, because reading a body is; the route itself stays
    a plain `def` in the thread pool like every other route. How much can be
    read at all is app/body_limit.py's to say: 1 MB, twice the photo's own
    wall.
    """
    return Upload(await request.body(), request.headers.get("content-type"))


def checked(upload: Upload, whose: str) -> photos.Photo:
    """The photo, or the reason in a code: 413 too big, 415 not a photo.

    `whose` -- "dish", "product" -- only names it in the English sentence.
    """
    try:
        return photos.inspect(upload.data, upload.content_type)
    except photos.PhotoTooLarge as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=detail(
                "menu_photo_too_large",
                "A %s photo is at most %d bytes and %d pixels a side (%s)"
                % (whose, photos.MAX_BYTES, photos.MAX_SIDE, exc),
                max_bytes=photos.MAX_BYTES,
                max_side=photos.MAX_SIDE,
            ),
        )
    except photos.NotAPhoto as exc:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=detail(
                "menu_photo_bad_type",
                "A %s photo is a JPEG, PNG or WebP, sent as its own type (%s)"
                % (whose, exc),
                types=list(photos.TYPES),
            ),
        )


# What the OpenAPI schema says a photo PUT's body is: one of the three types,
# as raw bytes.
PHOTO_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            t: {"schema": {"type": "string", "format": "binary"}}
            for t in photos.TYPES
        },
    }
}


# --- Out -----------------------------------------------------------------------

# A year, and never asked about again: the bytes behind an id do not change.
# Private: kept by the phone that loaded it, never by a cache in between -- a
# photo taken off by mistake must not live on in a shared cache for a year,
# should one (a CDN) ever be put in front of this.
CACHE_FOREVER = "private, max-age=31536000, immutable"

# For the OpenAPI schema of a GET that serves one.
SERVED = {
    200: {
        "content": {
            t: {"schema": {"type": "string", "format": "binary"}}
            for t in photos.TYPES
        },
        "description": "The photo",
    },
    404: {"description": "No such photo (never was, or replaced, or deleted)"},
}


def served(content_type: str, data: bytes) -> Response:
    """The photo's bytes, as the type they proved on the way in."""
    return Response(
        content=bytes(data),
        media_type=content_type,
        headers={
            "Cache-Control": CACHE_FOREVER,
            # Also set for every response by app/security_headers.py; said
            # here too, because for this answer it is the point: the type
            # the bytes proved on the way in is the one a browser believes.
            "X-Content-Type-Options": "nosniff",
            # The photos are for this app's own pages -- the same origin in
            # production, another port of localhost in development -- and a
            # page elsewhere that learned an address cannot show one. (The
            # rest of the API has no such header because it needs a token; see
            # app/security_headers.py.)
            "Cross-Origin-Resource-Policy": "same-site",
        },
    )


def not_found() -> Response:
    """No photo at that address: never was, replaced, or taken off.

    Bare: the only reader is an <img>, which shows nothing either way, and a
    code here would be a sentence nobody reads. Not cached, so a 404 is not
    remembered for an address -- although a new photo never comes back at an
    old one.
    """
    return Response(status_code=404, headers={"Cache-Control": "no-store"})


__all__ = [
    "CACHE_FOREVER",
    "PHOTO_BODY",
    "SERVED",
    "Upload",
    "checked",
    "not_found",
    "read_upload",
    "served",
]
