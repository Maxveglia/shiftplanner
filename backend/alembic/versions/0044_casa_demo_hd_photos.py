from __future__ import annotations

"""Casa Demo's dishes get sharper photos, where they still have 0039's

Revision ID: 0044_casa_demo_hd_photos
Revises: 0043_till_payments
Create Date: 2026-09-27

The photos 0039 put on Casa Demo's menu were cut from a photo of its till,
and each tile of that photo was some 180 pixels a side: on a phone's screen,
which has two or three device pixels to every one the page lays out, a tile
the width of the screen showed them soft. On 27-sep-2026 Max had them made
again, enlarged by an AI to some 730-800 pixels, and put them in
app/clients/casa-demo/menu-photos/ OVER the old ones, under the same file
names and the same `photos.json`. This puts them on the dishes that are still
showing the old ones.

ONLY WHERE THE PHOTO IS STILL 0039'S, BYTE FOR BYTE. `ORIGINALS` below is the
sha256 of every file as 0039 read it (the folder at 80ba8d8, which is what
production loaded: the files had not changed since the commit that added
0039). For every business filed under `casa-demo`, and every dish named in
`photos.json` (found as 0039 found it: without case, the spaces round it, or
the way a Mac may spell its ñ), the photo is replaced only if the sha256 of
its bytes is that file's original. A photo the manager put there since, or a
dish they left without one, is not touched; a database without that business
(a developer's, the CI's) is untouched.

A NEW ROW, NOT AN UPDATE, as the API does when a photo is changed (0038): the
old one is deleted and the new one gets a new random `id`. The id is the
photo's URL, and that URL is cached by every browser for a year -- updating
the bytes under the same id would leave every phone that has seen the menu
showing the old picture. `labelled` is carried over from the old row (0040:
these were cut from the till, so the name is printed on them, and the
enlarged ones still carry it). `content_type`, `width` and `height` are read
from the new file's own bytes, as an upload would have them; 0039 left the
size NULL, and there is no reason to go on doing so.

A FILE THAT CANNOT BE USED IS SKIPPED, with a line in the log, rather than
failing the deploy, like 0039: one that is missing, is not a JPEG, PNG or
WebP by its first bytes, is over 512 KB, or whose size in pixels cannot be
read or is over 4096 a side (app/services/photos.py's walls, written out
here for the reason 0038 gives). So is a file that is still the original --
the enlarged one never arrived -- because putting the same bytes back under
a new id would change nothing but the address, and would do it again on
every run.

ONCE, AND IT CAN RUN AGAIN: a second run finds no photo whose bytes are an
original (they are all the new ones, or the manager's), and changes nothing.
On a new database 0039 already loads the new files -- they are the ones in
the folder -- and this finds nothing to do.

The files must be in the folder when this is deployed: it runs once, and if
it ran over the old files it would find every one "still the original" and
be done. tests/test_casa_demo_hd_photos.py fails while any of them is.

AS THE TABLES' OWNER, like 0036-0040: the migration's role reads and writes
past the policies (`organization` is behind one too, and without that no
business would be found, here or in 0039). Even so it says which business it
is working for before it touches a photo, as 0039 does.

The downgrade does nothing, for 0039's reason: by then the manager may have
kept, changed or removed these photos, and the old ones are not kept
anywhere to put back -- only their hashes are here. The photos are theirs.
"""

import hashlib
import json
import logging
import unicodedata
from pathlib import Path
from typing import Dict, List, NamedTuple, Optional, Tuple

import sqlalchemy as sa
from alembic import op

revision = "0044_casa_demo_hd_photos"
down_revision = "0043_till_payments"
branch_labels = None
depends_on = None

CLIENT_KEY = "casa-demo"
FOLDER = Path(__file__).resolve().parents[2] / "app" / "clients" / CLIENT_KEY / "menu-photos"
INDEX = "photos.json"

# The sha256 of each file 0039 loaded, as it was in the folder then (80ba8d8):
# about 180 px a side, 8-14 KB. A photo whose bytes hash to its file's entry
# here is one 0039 put there and nobody has changed.
ORIGINALS: Dict[str, str] = {
    "crispy-pequeno.jpg": "dd267685dcfd364cd1bc41eef0112a62937cbf1af07eb0e5d7aba6e6db8f9570",
    "crispy-grande.jpg": "33dca166d373decbf2d5db40ec8b9483f859632c9f22e3826c7137c083b2dee6",
    "crispy-xl.jpg": "2f6bffe5215e554373ff4ec4f7682ae259b91e17afba307a9ce788ccae0c5a8b",
    "crispy-curry-pequeno.jpg": "66dc0ddd5a3b53b19b7f8f3873a7193adb0d7dcc6a7f4638bcef08c9c1dbd51d",
    "crispy-curry-grande.jpg": "afa7bcab259f2987f3b4cd1985dd8708b9688aa737b8cda7ad87f07d59923d3c",
    "crispy-mango-curry-pequeno.jpg": "ade4ac9a32934336d0f43a1bc34835e9729e74f4e9758b05d8f47e1c8b299c64",
    "crispy-curry-mango-grande.jpg": "a94eee41fb7f50ea8eaeeb43628b9cfff1691702e3bda130ab9cc234220726a2",
    "crispy-smash.jpg": "7f85cc2c4ecf90e8ee586a46ac6acbec29545edc2b25f630e0929a04e83b1435",
    "crispy-wrap.jpg": "599c08f6872560700d92f815444f0f556c9545d000cf9ae5b47077e7c2dd84e1",
    "crispy-ahumado.jpg": "a35145391feeba78c55c408f330169bffbf15a93e97b4a489c332e22504a33a8",
    "combo-crispy-pequeno.jpg": "4fa85bccfbd8d1e332a92bd01c11d11e08ca25068d2e04a35e13820de12c54b2",
    "combo-crispy-grande.jpg": "c8950de131436e217d06ef16cd472f03c2ede5a100edffe3553991e50d207478",
    "combo-crispy-xl.jpg": "4a6927a982362889ccf2080bbfe85df6d3f9442bc80d2dac92427d64a0957abc",
    "combo-crispy-smash.jpg": "0e92048efb1ab4a296c0cb1c1ad3a95f2246b773f8c7e18924a8e8126d04e3b8",
    "combo-crispy-wrap.jpg": "aa5f294ce550547a30a44777ad0c79116d978aa6b3fc4d8acf7ba3746e4dc73d",
    "el-del-pueblo.jpg": "83ea9ab6e959185f2fd3e4b93420c7c9b344d1b7410dfdd8cff1772496c4e5c0",
    "ensalada-casa-demo.jpg": "86d559232bd546f0640b666f0a39e6fa8a9cb616abc2eab36dc751d6f6ab4a48",
    "caprisun.jpg": "45dacdcfb1369bc9797a21b07cf09eca1e5f2caae49f91279d60cf1c3cd8f0f3",
    "coca-cola.jpg": "f650a346d50875241dfbb5b7d95a6296da6495c6ce39618fb4380900bb668d1a",
}

# 0038's CHECK on menu_dish_photo.data, and app/services/photos.py's wall on
# pixels, written out for the reason 0038 gives.
MAX_BYTES = 512 * 1024
MAX_SIDE = 4096

log = logging.getLogger("alembic.runtime.migration")


class NewPhoto(NamedTuple):
    name: str
    filename: str
    original: str
    data: bytes
    content_type: str
    width: int
    height: int


def _kind(data: bytes) -> Optional[str]:
    """The content type the first bytes prove, among 0038's three; or None."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


# How many pixels, from the header alone: app/services/photos.py's readers,
# written out so this does not move, or break, when that module does (it was
# moved once already, the day this was written).

_JPEG_FRAMES = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}
_JPEG_BARE = frozenset({0x01, 0xD8, *range(0xD0, 0xD8)})


def _jpeg_size(data: bytes) -> Optional[Tuple[int, int]]:
    i, n = 2, len(data)
    while i < n:
        if data[i] != 0xFF:
            return None
        while i < n and data[i] == 0xFF:
            i += 1
        if i >= n:
            return None
        marker = data[i]
        i += 1
        if marker in _JPEG_BARE:
            continue
        if marker in (0xD9, 0xDA):
            return None
        if i + 2 > n:
            return None
        length = int.from_bytes(data[i : i + 2], "big")
        if length < 2:
            return None
        if marker in _JPEG_FRAMES:
            if i + 7 > n:
                return None
            height = int.from_bytes(data[i + 3 : i + 5], "big")
            width = int.from_bytes(data[i + 5 : i + 7], "big")
            return width, height
        i += length
    return None


def _png_size(data: bytes) -> Optional[Tuple[int, int]]:
    if len(data) < 24 or data[12:16] != b"IHDR":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def _webp_size(data: bytes) -> Optional[Tuple[int, int]]:
    chunk = data[12:16]
    if chunk == b"VP8 ":
        if len(data) < 30 or data[23:26] != b"\x9d\x01\x2a":
            return None
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        return width, height
    if chunk == b"VP8L":
        if len(data) < 25 or data[20] != 0x2F:
            return None
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8X":
        if len(data) < 30:
            return None
        return int.from_bytes(data[24:27], "little") + 1, int.from_bytes(data[27:30], "little") + 1
    return None


_SIZE = {"image/jpeg": _jpeg_size, "image/png": _png_size, "image/webp": _webp_size}


def size(data: bytes) -> Optional[Tuple[str, int, int]]:
    """(content type, width, height) of a photo 0038 keeps and the API would
    take; None if it is not one."""
    kind = _kind(data)
    if kind is None or not 0 < len(data) <= MAX_BYTES:
        return None
    found = _SIZE[kind](data)
    if found is None or min(found) < 1 or max(found) > MAX_SIDE:
        return None
    return (kind,) + found


def new_photos(folder: Path, originals: Dict[str, str]) -> List[NewPhoto]:
    """Every entry of the index whose file is a usable photo and is no longer
    the original. Empty when there is no index; anything else is left out
    with a line in the log."""
    index = folder / INDEX
    if not index.is_file():
        log.info("%s: no %s, no photos to replace", folder, INDEX)
        return []
    found = []
    for name, filename in json.loads(index.read_text(encoding="utf-8")).items():
        if not isinstance(filename, str) or Path(filename).name != filename:
            log.warning("%s: %r is not a file name in the folder, skipped", INDEX, filename)
            continue
        original = originals.get(filename)
        if original is None:
            log.warning("%s: no original known for %s, skipped", INDEX, filename)
            continue
        path = folder / filename
        if not path.is_file():
            log.warning("%s: %s for %r is not there, skipped", INDEX, filename, name)
            continue
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() == original:
            log.warning("%s: %s is still the original, skipped", INDEX, filename)
            continue
        photo = size(data)
        if photo is None:
            log.warning("%s: %s is not a photo 0038 keeps, skipped", INDEX, filename)
            continue
        kind, width, height = photo
        found.append(
            NewPhoto(
                # NFC, as 0039: a Mac may write the ñ in two code points.
                name=unicodedata.normalize("NFC", name),
                filename=filename,
                original=original,
                data=data,
                content_type=kind,
                width=width,
                height=height,
            )
        )
    return found


def replace(bind, folder: Path = FOLDER, originals: Optional[Dict[str, str]] = None) -> int:
    """Put the new photos on the dishes of every business filed under
    `casa-demo` whose photo is still the original; the number replaced.
    Separate from `upgrade`, and the folder and the hashes parameters, so a
    test can run it -- twice, and on files of its own."""
    found = new_photos(folder, ORIGINALS if originals is None else originals)
    if not found:
        return 0
    replaced = 0
    orgs = bind.execute(
        sa.text("SELECT id FROM organization WHERE client_key = :key ORDER BY created_at"),
        {"key": CLIENT_KEY},
    ).scalars().all()
    for org_id in orgs:
        # Behind RLS, as in 0039: say which business this is.
        bind.execute(
            sa.text("SELECT set_config('app.current_org_id', :org, true)"),
            {"org": str(org_id)},
        )
        for photo in found:
            current = bind.execute(
                sa.text(
                    "SELECT p.id, p.dish_id, p.labelled, p.data FROM menu_dish_photo p "
                    "JOIN menu_dish d ON d.id = p.dish_id AND d.org_id = p.org_id "
                    "WHERE p.org_id = :org AND lower(btrim(d.name)) = lower(btrim(:name))"
                ),
                {"org": org_id, "name": photo.name},
            ).all()
            for photo_id, dish_id, labelled, data in current:
                if hashlib.sha256(bytes(data)).hexdigest() != photo.original:
                    continue  # the manager's, or already the new one
                bind.execute(
                    sa.text("DELETE FROM menu_dish_photo WHERE id = :id AND org_id = :org"),
                    {"id": photo_id, "org": org_id},
                )
                bind.execute(
                    sa.text(
                        "INSERT INTO menu_dish_photo "
                        "(org_id, dish_id, content_type, data, width, height, labelled) "
                        "VALUES (:org, :dish, :kind, :data, :width, :height, :labelled)"
                    ),
                    {
                        "org": org_id,
                        "dish": dish_id,
                        "kind": photo.content_type,
                        "data": photo.data,
                        "width": photo.width,
                        "height": photo.height,
                        "labelled": labelled,
                    },
                )
                replaced += 1
    log.info("%s: %d photo(s) replaced with the enlarged ones", CLIENT_KEY, replaced)
    return replaced


def upgrade() -> None:
    replace(op.get_bind())


def downgrade() -> None:
    # See the module docstring: the photos are the manager's from the day
    # this ran, and the old ones are not kept to put back.
    pass
