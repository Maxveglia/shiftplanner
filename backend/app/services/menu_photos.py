"""What a dish's photo may be: the same as any photo of this app.

The check lives in `app/services/photos.py` since the stock's products got
photos too (27-sep-2026, migration 0042): one wall for both, so a photo the
menu takes is a photo the stock takes. This module answers with the same names
it always did, for the menu and its tests.
"""
from __future__ import annotations

from app.services.photos import (
    JPEG,
    MAX_BYTES,
    MAX_SIDE,
    PNG,
    TYPES,
    WEBP,
    NotAPhoto,
    Photo,
    PhotoRefused,
    PhotoTooLarge,
    inspect,
    media_type,
    sniff,
)

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
