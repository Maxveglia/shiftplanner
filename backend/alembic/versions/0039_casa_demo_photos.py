from __future__ import annotations

"""Casa Demo's dishes get the photos of its till

Revision ID: 0039_casa_demo_photos
Revises: 0038_menu_dish_photos
Create Date: 2026-09-27

The photo of Casa Demo's till that its menu was typed from (0037) is a grid
of tiles, each with a picture of the product -- and "the menu must always come
with the photos; that is why I sent you the photos of everything" (Max,
27-sep-2026). So the tiles were cut out of that photo, one JPEG per product
that had a picture (all but "Agua"), without the strip where the till prints
the price: the price is the menu's to show, and a printed one would lie the
day it changes. They are in app/clients/casa-demo/menu-photos/, with
`photos.json` saying which dish each one is ({"<dish name>": "<file>"}, the
names as 0037 wrote them).

ADDING ONLY, like 0037. For every business filed under `casa-demo`, each dish
named in `photos.json` (compared without case or the spaces round it) that has
NO photo gets the one from the file. A photo the manager already put on a
dish is never replaced; a second run adds nothing; a database without that
business (a developer's, the CI's) is untouched.

READ FROM FILES, unlike 0037, which wrote its menu out in the migration: half
a megabyte of photos is not something to paste into Python. The files are in
the image (the Dockerfile copies backend/ whole), next to this. What is
checked here is what 0038's CHECKs would refuse -- a type other than JPEG,
PNG or WebP by its first bytes, or more than 512 KB -- and a file that fails
it, or is missing, is skipped rather than failing the deploy. A name in
`photos.json` must be a plain file name in that folder: nothing outside it is
read. The width and height are left NULL: the API reads them on upload, and
nothing here needs them.

If the folder is not there, nothing happens: this runs once, and a folder
added later is not read again -- such photos are the manager's to add, on the
menu screen.

The downgrade does nothing: by then the manager may have kept, changed or
removed these photos, and telling them apart from the ones loaded here is not
something to guess at. The photos are theirs.
"""

import json
import logging
import unicodedata
from pathlib import Path
from typing import List, Tuple

import sqlalchemy as sa
from alembic import op

revision = "0039_casa_demo_photos"
down_revision = "0038_menu_dish_photos"
branch_labels = None
depends_on = None

CLIENT_KEY = "casa-demo"
FOLDER = Path(__file__).resolve().parents[2] / "app" / "clients" / CLIENT_KEY / "menu-photos"
INDEX = "photos.json"

# 0038's CHECK on menu_dish_photo.data, written out for the reason 0038 gives.
MAX_BYTES = 512 * 1024

log = logging.getLogger("alembic.runtime.migration")


def _kind(data: bytes):
    """The content type the first bytes prove, among 0038's three; or None."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def photos(folder: Path) -> List[Tuple[str, bytes, str]]:
    """(dish name, bytes, content type) for every usable entry of the index.

    Empty when there is no index. Anything that 0038 would refuse, or that
    points outside the folder, is left out with a line in the log.
    """
    index = folder / INDEX
    if not index.is_file():
        log.info("%s: no %s, no photos to load", folder, INDEX)
        return []
    found = []
    for name, filename in json.loads(index.read_text(encoding="utf-8")).items():
        if not isinstance(filename, str) or Path(filename).name != filename:
            log.warning("%s: %r is not a file name in the folder, skipped", INDEX, filename)
            continue
        path = folder / filename
        if not path.is_file():
            log.warning("%s: %s for %r is not there, skipped", INDEX, filename, name)
            continue
        data = path.read_bytes()
        kind = _kind(data)
        if kind is None or not 0 < len(data) <= MAX_BYTES:
            log.warning("%s: %s is not a photo 0038 keeps, skipped", INDEX, filename)
            continue
        # NFC, as 0037's names are: a name typed on a Mac can arrive with its
        # ñ in two code points, and lower() would not see it as the same ñ.
        found.append((unicodedata.normalize("NFC", name), data, kind))
    return found


def load(bind, folder: Path = FOLDER) -> int:
    """Put the photos on the dishes of every business filed under `casa-demo`
    that have none; the number of photos added. Separate from `upgrade`, and
    the folder a parameter, so a test can run it -- twice, and on a folder of
    its own."""
    found = photos(folder)
    if not found:
        return 0
    added = 0
    orgs = bind.execute(
        sa.text("SELECT id FROM organization WHERE client_key = :key ORDER BY created_at"),
        {"key": CLIENT_KEY},
    ).scalars().all()
    for org_id in orgs:
        # Behind RLS, as in 0037: say which business this is.
        bind.execute(
            sa.text("SELECT set_config('app.current_org_id', :org, true)"),
            {"org": str(org_id)},
        )
        for name, data, kind in found:
            added += bind.execute(
                sa.text(
                    "INSERT INTO menu_dish_photo (org_id, dish_id, content_type, data) "
                    "SELECT d.org_id, d.id, :kind, :data FROM menu_dish d "
                    "WHERE d.org_id = :org AND lower(btrim(d.name)) = lower(btrim(:name)) "
                    "AND NOT EXISTS (SELECT 1 FROM menu_dish_photo p WHERE p.dish_id = d.id) "
                    "ON CONFLICT (dish_id) DO NOTHING"
                ),
                {"org": org_id, "name": name, "kind": kind, "data": data},
            ).rowcount
    return added


def upgrade() -> None:
    load(op.get_bind())


def downgrade() -> None:
    # See the module docstring: the photos are the manager's from the day
    # this ran.
    pass
