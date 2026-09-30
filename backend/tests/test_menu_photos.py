"""A dish's photo: put, changed and taken off by the manager, and served to
anybody who has its address.

Pinned here:

* THE BYTES (no database). The three kinds, each read with its size; the type
  declared has to be the type the bytes are; the walls, 512 KB and 4096
  pixels a side; anything else refused -- app/services/menu_photos.py.
* THE ROUTES. A photo goes on and comes back byte for byte, from a public
  address that is cached for a year; changing it changes the address and the
  old one is a 404; taking it off is a 204 and a 404; editing the dish keeps
  it; the menu carries the address and never the picture.
* WHO MAY. The manager; an employee sees it and is refused the rest -- before
  a byte of the body is read; a business is a 404 to another's dish, and the
  database refuses a photo under a neighbour's dish even without the API.
* GONE WITH THE DISH, its section, or a refused upload leaving the old one.
* CASA DEMO'S PHOTOS (migration 0039), on a folder of the test's own, and on
  the real one.
"""

from __future__ import annotations

import importlib.util
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from app.routers.menu_photos import CACHE_FOREVER, photo_url
from app.services import menu_photos
from app.services.menu_photos import MAX_BYTES, MAX_SIDE, NotAPhoto, PhotoTooLarge, inspect
from tests import menu_photo_samples as samples
from tests.test_casa_demo_menu import _crispy
from tests.test_casa_demo_menu import _load as _load_the_menu
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    _employee_token,
    _signup,
    client,
    skip_no_db,
)

MENU = "/api/v1/menu"
VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"

KINDS = [
    (samples.JPEG, "image/jpeg", samples.JPEG_SIZE),
    (samples.JPEG_PROGRESSIVE, "image/jpeg", samples.JPEG_PROGRESSIVE_SIZE),
    (samples.PNG, "image/png", samples.PNG_SIZE),
    (samples.WEBP_LOSSY, "image/webp", samples.WEBP_LOSSY_SIZE),
    (samples.WEBP_LOSSLESS, "image/webp", samples.WEBP_LOSSLESS_SIZE),
    (samples.WEBP_EXTENDED, "image/webp", samples.WEBP_EXTENDED_SIZE),
]
KIND_IDS = ["jpeg", "jpeg-progressive", "png", "webp-lossy", "webp-lossless", "webp-extended"]


def _padded(data: bytes, total: int) -> bytes:
    """The same image, `total` bytes long: bytes after a JPEG's end are ignored
    by a reader, and are what makes a file of an exact size here."""
    return data + b"\0" * (total - len(data))


def _png_saying(width: int, height: int) -> bytes:
    """The PNG sample with another size in its header (its CRC is then wrong,
    which nothing here reads)."""
    return (
        samples.PNG[:16]
        + width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + samples.PNG[24:]
    )


# --- The bytes ------------------------------------------------------------------


class TestTheBytes:
    @pytest.mark.parametrize("data, kind, size", KINDS, ids=KIND_IDS)
    def test_each_kind_is_read_with_its_size(self, data, kind, size):
        photo = inspect(data, kind)
        assert photo.content_type == kind
        assert (photo.width, photo.height) == size

    def test_the_type_is_compared_without_its_parameters_or_capitals(self):
        assert inspect(samples.JPEG, "Image/JPEG; q=0.9").content_type == "image/jpeg"

    @pytest.mark.parametrize(
        "declared",
        ["image/png", "image/webp", "image/jpg", "application/octet-stream", "", None],
    )
    def test_a_jpeg_sent_as_anything_else_is_refused(self, declared):
        with pytest.raises(NotAPhoto):
            inspect(samples.JPEG, declared)

    @pytest.mark.parametrize(
        "data, declared",
        [
            (b"", "image/jpeg"),
            (b"<html><script>alert(1)</script></html>", "image/jpeg"),
            (b'<svg xmlns="http://www.w3.org/2000/svg"/>', "image/png"),
            (b"GIF89a\x01\x00\x01\x00\x00\x00\x00;", "image/png"),
            # The magic, and nothing after it to read a size from.
            (b"\xff\xd8\xff", "image/jpeg"),
            (samples.PNG[:20], "image/png"),
            (samples.WEBP_LOSSY[:24], "image/webp"),
            # A RIFF that is not a WebP (a WAV), and a WebP of no known kind.
            (b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\0" * 20, "image/webp"),
            (samples.WEBP_LOSSY[:12] + b"VP9 " + samples.WEBP_LOSSY[16:], "image/webp"),
            # A frame header that says zero pixels.
            (_png_saying(0, 3), "image/png"),
        ],
        ids=[
            "empty",
            "html",
            "svg",
            "gif",
            "jpeg-magic-only",
            "png-cut",
            "webp-cut",
            "riff-wave",
            "webp-unknown-chunk",
            "zero-wide",
        ],
    )
    def test_what_is_not_a_photo_is_refused(self, data, declared):
        with pytest.raises(NotAPhoto):
            inspect(data, declared)

    def test_a_jpeg_that_reaches_its_scan_with_no_frame_is_refused(self):
        # SOI, then straight to SOS: there is no frame to say how big it is.
        with pytest.raises(NotAPhoto):
            inspect(b"\xff\xd8\xff\xda\x00\x08" + b"\0" * 20, "image/jpeg")

    def test_a_phone_photo_carries_its_exif_before_the_frame(self):
        # An APP1 segment of 30 KB (EXIF) between SOI and the rest: the frame
        # is found past it, not at a fixed place.
        exif = b"\xff\xe1" + (30_000).to_bytes(2, "big") + b"Exif\0\0" + b"\0" * (30_000 - 8)
        photo = inspect(samples.JPEG[:2] + exif + samples.JPEG[2:], "image/jpeg")
        assert (photo.width, photo.height) == samples.JPEG_SIZE

    def test_fill_bytes_before_a_marker_are_allowed(self):
        photo = inspect(samples.JPEG[:2] + b"\xff\xff" + samples.JPEG[2:], "image/jpeg")
        assert (photo.width, photo.height) == samples.JPEG_SIZE

    def test_the_byte_wall(self):
        assert inspect(_padded(samples.JPEG, MAX_BYTES), "image/jpeg")
        with pytest.raises(PhotoTooLarge):
            inspect(_padded(samples.JPEG, MAX_BYTES + 1), "image/jpeg")
        # The size is the first question: even bytes that are not a photo at
        # all are "too large" when they are.
        with pytest.raises(PhotoTooLarge):
            inspect(b"x" * (MAX_BYTES + 1), "image/jpeg")

    def test_the_pixel_wall(self):
        assert inspect(_png_saying(MAX_SIDE, MAX_SIDE), "image/png")
        # 92 bytes of file, 5000 pixels wide.
        assert len(samples.PNG_TOO_WIDE) < 200
        with pytest.raises(PhotoTooLarge):
            inspect(samples.PNG_TOO_WIDE, "image/png")
        with pytest.raises(PhotoTooLarge):
            inspect(_png_saying(3, MAX_SIDE + 1), "image/png")

    def test_the_three_types_are_the_ones_0038_keeps(self):
        spec = importlib.util.spec_from_file_location(
            "migration_0038", VERSIONS / "0038_menu_dish_photos.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        assert tuple(module.TYPES) == menu_photos.TYPES
        assert module.MAX_BYTES == MAX_BYTES


class TestTheAddress:
    def test_photo_url_is_the_route_that_serves_it(self):
        from app.main import app

        some = uuid.uuid4()
        assert app.url_path_for("menu_photo", photo_id=str(some)) == photo_url(some)

    def test_the_photo_route_asks_nobody_who_they_are(self):
        """The route has no dependency on who is asking: an <img> sends no token."""
        from app.routers import menu_photos as router_module

        [route] = router_module.router.routes
        assert route.methods == {"GET"}
        deps = [d.call.__name__ for d in route.dependant.dependencies]
        assert deps == ["get_admin_db"]


# --- Through the API ------------------------------------------------------------


def _manager(client) -> str:
    token, _org = _signup(client, "Photo Co")
    return token


def _section(client, token, name="Entrantes") -> dict:
    res = client.post(MENU + "/sections", json={"name": name}, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()


def _new_dish(client, token, section_id=None, name="Croquetas") -> dict:
    if section_id is None:
        section_id = _section(client, token)["id"]
    res = client.post(
        MENU + "/dishes",
        json={"section_id": section_id, "name": name, "price": 8.5},
        headers=_auth(token),
    )
    assert res.status_code == 201, res.text
    return res.json()


def _put(client, token, dish_id, data=samples.JPEG, content_type="image/jpeg"):
    headers = {"Content-Type": content_type}
    if token is not None:
        headers.update(_auth(token))
    return client.put(MENU + "/dishes/%s/photo" % dish_id, content=data, headers=headers)


def _put_ok(client, token, dish_id, data=samples.JPEG, content_type="image/jpeg") -> str:
    res = _put(client, token, dish_id, data, content_type)
    assert res.status_code == 200, res.text
    return res.json()["photo_url"]


def _take_off(client, token, dish_id):
    return client.delete(MENU + "/dishes/%s/photo" % dish_id, headers=_auth(token))


def _listed(client, token, dish_id) -> dict:
    res = client.get(MENU, headers=_auth(token))
    assert res.status_code == 200, res.text
    [dish] = [d for s in res.json()["sections"] for d in s["dishes"] if d["id"] == dish_id]
    return dish


def _fetch(client, url):
    """As an <img> asks: no Authorization header at all."""
    return client.get(url)


def _code(res) -> str:
    return res.json()["detail"]["code"]


def _photo_rows(**where) -> list:
    from app.db import admin_engine

    clause = " AND ".join("%s = :%s" % (k, k) for k in where) or "TRUE"
    with admin_engine.connect() as conn:
        return conn.execute(
            text(
                "SELECT id, org_id, dish_id, content_type, width, height, "
                "octet_length(data) FROM menu_dish_photo WHERE %s" % clause
            ),
            {k: str(v) for k, v in where.items()},
        ).all()


def _id_of(url: str) -> str:
    return url.rsplit("/", 1)[-1]


@skip_no_db
class TestPuttingAPhoto:
    def test_a_new_dish_has_none(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        assert dish["photo_url"] is None
        assert _listed(client, token, dish["id"])["photo_url"] is None

    def test_a_photo_goes_on_and_comes_back_byte_for_byte(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        res = _put(client, token, dish["id"])
        assert res.status_code == 200, res.text
        answered = res.json()
        url = answered["photo_url"]
        assert url == photo_url(uuid.UUID(_id_of(url)))
        # The dish, as it was, with its photo's address.
        assert {k: v for k, v in answered.items() if k != "photo_url"} == {
            k: v for k, v in dish.items() if k != "photo_url"
        }
        assert _listed(client, token, dish["id"])["photo_url"] == url

        served = _fetch(client, url)
        assert served.status_code == 200
        assert served.content == samples.JPEG
        assert served.headers["content-type"] == "image/jpeg"
        assert served.headers["cache-control"] == CACHE_FOREVER
        assert "immutable" in served.headers["cache-control"]
        assert served.headers["x-content-type-options"] == "nosniff"
        assert served.headers["cross-origin-resource-policy"] == "same-site"
        # An image is not a document: no page policy on it.
        assert "content-security-policy" not in served.headers

    @pytest.mark.parametrize("data, kind, size", KINDS, ids=KIND_IDS)
    def test_each_kind_goes_in_and_comes_out_as_itself(self, client, data, kind, size):
        token = _manager(client)
        dish = _new_dish(client, token)
        url = _put_ok(client, token, dish["id"], data, kind)
        served = _fetch(client, url)
        assert (served.content, served.headers["content-type"]) == (data, kind)
        [row] = _photo_rows(id=_id_of(url))
        assert (row.content_type, row.width, row.height) == (kind, size[0], size[1])

    def test_changing_it_changes_the_address_and_the_old_one_is_gone(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        first = _put_ok(client, token, dish["id"])
        second = _put_ok(client, token, dish["id"], samples.PNG, "image/png")
        assert second != first
        assert _listed(client, token, dish["id"])["photo_url"] == second
        gone = _fetch(client, first)
        assert gone.status_code == 404
        assert gone.headers["cache-control"] == "no-store"
        assert _fetch(client, second).content == samples.PNG
        # One photo per dish, not a pile of them.
        assert len(_photo_rows(dish_id=dish["id"])) == 1

    def test_the_same_photo_again_is_still_a_new_address(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        assert _put_ok(client, token, dish["id"]) != _put_ok(client, token, dish["id"])

    def test_taking_it_off(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        url = _put_ok(client, token, dish["id"])
        res = _take_off(client, token, dish["id"])
        assert res.status_code == 204
        assert _listed(client, token, dish["id"])["photo_url"] is None
        assert _fetch(client, url).status_code == 404
        # Already off: as asked.
        assert _take_off(client, token, dish["id"]).status_code == 204

    def test_editing_the_dish_keeps_its_photo(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        url = _put_ok(client, token, dish["id"])
        res = client.patch(
            MENU + "/dishes/%s" % dish["id"],
            json={"name": "Croquetas caseras", "available": False},
            headers=_auth(token),
        )
        assert res.status_code == 200, res.text
        assert res.json()["photo_url"] == url
        assert _fetch(client, url).status_code == 200

    def test_a_section_and_a_reorder_answer_with_the_photos(self, client):
        token = _manager(client)
        section = _section(client, token)
        a = _new_dish(client, token, section["id"], "A")
        b = _new_dish(client, token, section["id"], "B")
        url = _put_ok(client, token, b["id"])
        res = client.put(
            MENU + "/sections/%s/dishes/order" % section["id"],
            json={"ids": [b["id"], a["id"]]},
            headers=_auth(token),
        )
        assert res.status_code == 200, res.text
        [only] = res.json()["sections"]
        assert [(d["name"], d["photo_url"]) for d in only["dishes"]] == [("B", url), ("A", None)]
        renamed = client.patch(
            MENU + "/sections/%s" % section["id"], json={"name": "X"}, headers=_auth(token)
        )
        assert [d["photo_url"] for d in renamed.json()["dishes"]] == [url, None]

    def test_the_menu_is_read_without_the_pictures(self, client):
        """The address and nothing else: a menu of a hundred photos must not
        be a hundred pictures read out of the database on every phone."""
        from sqlalchemy import event

        from app.db import app_engine

        token = _manager(client)
        dish = _new_dish(client, token)
        _put_ok(client, token, dish["id"])
        seen = []

        def spy(_conn, _cursor, statement, *_args):
            seen.append(statement)

        event.listen(app_engine, "before_cursor_execute", spy)
        try:
            assert _listed(client, token, dish["id"])["photo_url"]
        finally:
            event.remove(app_engine, "before_cursor_execute", spy)
        read = [s for s in seen if "menu_dish_photo" in s]
        assert read, "the menu did not look at the photos at all"
        assert not [s for s in read if "menu_dish_photo.data" in s]

    def test_an_address_that_never_was_is_a_404(self, client):
        res = _fetch(client, photo_url(uuid.uuid4()))
        assert res.status_code == 404
        assert res.content == b""

    def test_an_address_that_is_not_one_is_refused(self, client):
        assert _fetch(client, "/api/v1/menu/photos/not-a-uuid").status_code == 422


@skip_no_db
class TestRefused:
    @pytest.mark.parametrize(
        "data, content_type",
        [
            (b"<html></html>", "image/jpeg"),
            (samples.PNG, "image/jpeg"),
            (samples.JPEG, "application/octet-stream"),
            (b'{"photo": "x"}', "application/json"),
            (b"", "image/jpeg"),
        ],
        ids=["html", "png-as-jpeg", "no-type", "json", "empty"],
    )
    def test_what_is_not_a_photo(self, client, data, content_type):
        token = _manager(client)
        dish = _new_dish(client, token)
        res = _put(client, token, dish["id"], data, content_type)
        assert res.status_code == 415
        assert _code(res) == "menu_photo_bad_type"
        assert res.json()["detail"]["params"] == {"types": list(menu_photos.TYPES)}
        assert _listed(client, token, dish["id"])["photo_url"] is None

    def test_one_byte_over_the_wall(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        res = _put(client, token, dish["id"], _padded(samples.JPEG, MAX_BYTES + 1))
        assert res.status_code == 413
        assert _code(res) == "menu_photo_too_large"
        assert res.json()["detail"]["params"] == {"max_bytes": MAX_BYTES, "max_side": MAX_SIDE}

    def test_exactly_the_wall_gets_past_the_body_limit_and_in(self, client):
        """512 KB is under the 1 MB every request is held to (app/body_limit.py):
        the photo's wall is the one that decides, not the envelope's."""
        from app.body_limit import MAX_BODY_BYTES

        assert MAX_BYTES < MAX_BODY_BYTES
        token = _manager(client)
        dish = _new_dish(client, token)
        big = _padded(samples.JPEG, MAX_BYTES)
        url = _put_ok(client, token, dish["id"], big)
        assert _fetch(client, url).content == big

    def test_over_the_body_limit_it_is_the_envelope_that_says_no(self, client):
        from app.body_limit import MAX_BODY_BYTES

        token = _manager(client)
        dish = _new_dish(client, token)
        res = _put(client, token, dish["id"], _padded(samples.JPEG, MAX_BODY_BYTES + 1))
        assert res.status_code == 413
        assert _code(res) == "request_too_large"

    def test_a_picture_too_big_in_pixels(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        res = _put(client, token, dish["id"], samples.PNG_TOO_WIDE, "image/png")
        assert res.status_code == 413
        assert _code(res) == "menu_photo_too_large"

    def test_a_refused_photo_leaves_the_one_it_had(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        url = _put_ok(client, token, dish["id"])
        assert _put(client, token, dish["id"], b"nope", "image/jpeg").status_code == 415
        assert _listed(client, token, dish["id"])["photo_url"] == url
        assert _fetch(client, url).status_code == 200

    def test_a_dish_that_is_not_there(self, client):
        token = _manager(client)
        missing = uuid.uuid4()
        res = _put(client, token, missing)
        assert res.status_code == 404
        assert _code(res) == "menu_dish_not_found"
        res = _take_off(client, token, missing)
        assert res.status_code == 404
        assert _code(res) == "menu_dish_not_found"


@skip_no_db
class TestWhoMay:
    def _staff(self, client):
        manager = _manager(client)
        employee = _add(client, manager, "Ana")
        return manager, _employee_token(client, manager, employee["id"])

    def test_an_employee_sees_the_photo_and_cannot_change_it(self, client):
        manager, staff = self._staff(client)
        dish = _new_dish(client, manager)
        url = _put_ok(client, manager, dish["id"])
        assert _listed(client, staff, dish["id"])["photo_url"] == url
        for res in (
            _put(client, staff, dish["id"], samples.PNG, "image/png"),
            _take_off(client, staff, dish["id"]),
        ):
            assert res.status_code == 403
            assert _code(res) == "manager_role_required"
        assert _listed(client, manager, dish["id"])["photo_url"] == url

    def test_an_employee_is_turned_away_before_the_body_is_read(self, client):
        """600 KB: over the photo's wall. The answer is the role's, not the
        size's -- and the body was never read: it is sent as a stream that
        notes when it is drawn on, which a 403 alone could not show (the
        role's answer would be the same after reading it)."""
        manager, staff = self._staff(client)
        dish = _new_dish(client, manager)
        drawn = []

        def body():
            drawn.append(True)
            yield _padded(samples.JPEG, 600 * 1024)

        headers = {"Content-Type": "image/jpeg", **_auth(staff)}
        res = client.put(MENU + "/dishes/%s/photo" % dish["id"], content=body(), headers=headers)
        assert res.status_code == 403
        assert _code(res) == "manager_role_required"
        assert drawn == []

    def test_nobody_signed_out_puts_a_photo(self, client):
        manager = _manager(client)
        dish = _new_dish(client, manager)
        assert _put(client, None, dish["id"]).status_code in (401, 403)
        assert client.delete(MENU + "/dishes/%s/photo" % dish["id"]).status_code in (401, 403)


@skip_no_db
class TestGoneWithTheDish:
    def test_deleting_the_dish_deletes_its_photo(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        url = _put_ok(client, token, dish["id"])
        assert _photo_rows(id=_id_of(url))
        res = client.delete(MENU + "/dishes/%s" % dish["id"], headers=_auth(token))
        assert res.status_code == 204
        assert _photo_rows(id=_id_of(url)) == []
        assert _fetch(client, url).status_code == 404

    def test_deleting_the_section_deletes_its_dishes_photos(self, client):
        token = _manager(client)
        section = _section(client, token)
        urls = [
            _put_ok(client, token, _new_dish(client, token, section["id"], n)["id"])
            for n in ("A", "B")
        ]
        res = client.delete(MENU + "/sections/%s" % section["id"], headers=_auth(token))
        assert res.status_code == 204
        for url in urls:
            assert _photo_rows(id=_id_of(url)) == []


@skip_no_db
class TestAnotherBusiness:
    def test_cannot_put_or_take_a_photo_on_your_dish(self, client):
        mine = _manager(client)
        theirs = _manager(client)
        dish = _new_dish(client, mine)
        url = _put_ok(client, mine, dish["id"])
        for res in (
            _put(client, theirs, dish["id"], samples.PNG, "image/png"),
            _take_off(client, theirs, dish["id"]),
        ):
            assert res.status_code == 404
            assert _code(res) == "menu_dish_not_found"
        assert _listed(client, mine, dish["id"])["photo_url"] == url
        assert _fetch(client, url).content == samples.JPEG
        # And their menu does not carry it.
        assert url not in client.get(MENU, headers=_auth(theirs)).text

    def test_the_database_refuses_a_photo_under_a_neighbours_dish(self, client):
        """The second barrier, the API taken out: as the runtime role, in A's
        context, a photo that is A's own -- so `org_isolation` lets it through
        -- on B's dish. The key on (dish_id, org_id) is what refuses it."""
        from sqlalchemy.exc import IntegrityError

        from app.db import app_engine

        mine = _manager(client)
        theirs = _manager(client)
        their_dish = _new_dish(client, theirs)
        my_org = client.get("/api/v1/auth/me", headers=_auth(mine)).json()["org_id"]
        with app_engine.connect() as conn:
            with pytest.raises(IntegrityError) as refused:
                with conn.begin():
                    conn.execute(
                        text("SELECT set_config('app.current_org_id', :org, true)"),
                        {"org": my_org},
                    )
                    conn.execute(
                        text(
                            "INSERT INTO menu_dish_photo (org_id, dish_id, content_type, data) "
                            "VALUES (:org, :dish, 'image/jpeg', :data)"
                        ),
                        {"org": my_org, "dish": their_dish["id"], "data": samples.JPEG},
                    )
        assert "menu_dish_photo_dish_id_org_id_fkey" in str(refused.value)
        assert _photo_rows(dish_id=their_dish["id"]) == []

    def test_the_database_holds_the_walls_too(self, client):
        """0038's CHECKs, for whatever writes past the API."""
        from sqlalchemy.exc import IntegrityError

        from app.db import admin_engine

        token = _manager(client)
        dish = _new_dish(client, token)
        org = client.get("/api/v1/auth/me", headers=_auth(token)).json()["org_id"]
        for kind, data in (
            ("image/gif", samples.JPEG),
            ("image/jpeg", b""),
            ("image/jpeg", b"x" * (MAX_BYTES + 1)),
        ):
            with pytest.raises(IntegrityError):
                with admin_engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO menu_dish_photo (org_id, dish_id, content_type, data) "
                            "VALUES (:org, :dish, :kind, :data)"
                        ),
                        {"org": org, "dish": dish["id"], "kind": kind, "data": data},
                    )

    def test_the_table_is_behind_row_level_security(self):
        from app.db import admin_engine

        with admin_engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname = 'menu_dish_photo'"
                )
            ).one()
        assert row == (True, True)


# --- Casa Demo's photos (0039) -------------------------------------------------------


def _migration(filename: str):
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PHOTOS = _migration("0039_casa_demo_photos.py")


def _load_photos(folder) -> int:
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        return PHOTOS.load(conn, folder)


def _by_name(client, token) -> dict:
    res = client.get(MENU, headers=_auth(token))
    assert res.status_code == 200, res.text
    return {d["name"]: d for s in res.json()["sections"] for d in s["dishes"]}


@pytest.fixture
def folder(tmp_path):
    """A folder like the real one, with one of everything that can go wrong."""
    here = tmp_path / "menu-photos"
    here.mkdir()
    (here / "grande.jpg").write_bytes(samples.JPEG)
    (here / "xl.png").write_bytes(samples.PNG)
    (here / "not-a-photo.jpg").write_bytes(b"hello")
    (here / "huge.jpg").write_bytes(_padded(samples.JPEG, MAX_BYTES + 1))
    (here / "nobody.jpg").write_bytes(samples.JPEG)
    # Outside the folder, and named from inside it: never to be read.
    (tmp_path / "outside.jpg").write_bytes(samples.JPEG)
    (here / "photos.json").write_text(
        json.dumps(
            {
                "Crispy Grande": "grande.jpg",
                # Case and the spaces round it aside, as 0037 compares.
                "  crispy XL ": "xl.png",
                # Its ñ in two code points, as a Mac may write it (NFD).
                "Crispy Pequen\u0303o": "grande.jpg",
                "Agua": "missing.jpg",
                "Coca-Cola": "../outside.jpg",
                "Caprisun": "not-a-photo.jpg",
                "Crispy Smash": "huge.jpg",
                "Not on the menu": "nobody.jpg",
            }
        ),
        encoding="utf-8",
    )
    return here


@skip_no_db
class TestCasaDemoPhotos:
    def test_the_photos_go_on_the_dishes(self, client, folder):
        token = _crispy(client)
        assert _load_the_menu() == 20
        assert _load_photos(folder) == 3
        dishes = _by_name(client, token)
        assert _fetch(client, dishes["Crispy Grande"]["photo_url"]).content == samples.JPEG
        served = _fetch(client, dishes["Crispy XL"]["photo_url"])
        assert (served.content, served.headers["content-type"]) == (samples.PNG, "image/png")
        with_photo = sorted(name for name, d in dishes.items() if d["photo_url"])
        assert with_photo == ["Crispy Grande", "Crispy Pequeño", "Crispy XL"]

    def test_a_second_run_adds_nothing(self, client, folder):
        token = _crispy(client)
        _load_the_menu()
        assert _load_photos(folder) == 3
        before = {n: d["photo_url"] for n, d in _by_name(client, token).items()}
        assert _load_photos(folder) == 0
        assert {n: d["photo_url"] for n, d in _by_name(client, token).items()} == before

    def test_a_photo_the_manager_put_is_kept(self, client, folder):
        token = _crispy(client)
        _load_the_menu()
        grande = _by_name(client, token)["Crispy Grande"]
        own = _put_ok(client, token, grande["id"], samples.WEBP_LOSSY, "image/webp")
        assert _load_photos(folder) == 2
        dishes = _by_name(client, token)
        assert dishes["Crispy Grande"]["photo_url"] == own
        assert dishes["Crispy XL"]["photo_url"]

    def test_no_business_there_is_nothing_to_do(self, client, folder):
        from app.db import admin_engine

        _crispy(client)
        with admin_engine.begin() as conn:
            conn.execute(
                text("UPDATE organization SET client_key = NULL WHERE client_key = 'casa-demo'")
            )
        assert _load_photos(folder) == 0

    def test_no_other_business_is_touched(self, client, folder):
        _crispy(client)
        _load_the_menu()
        other = _manager(client)
        dish = _new_dish(client, other, name="Crispy Grande")
        _load_photos(folder)
        assert _listed(client, other, dish["id"])["photo_url"] is None

    def test_no_folder_is_nothing(self, client, tmp_path):
        _crispy(client)
        _load_the_menu()
        assert _load_photos(tmp_path / "not-there") == 0


LABELLED = _migration("0040_menu_photo_labelled.py")


def _mark() -> int:
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        return LABELLED.mark(conn)


@skip_no_db
class TestLabelled:
    """0040: the photos cut from the till carry the dish's name already, so the
    tile does not print it again; an upload never does."""

    def test_an_upload_is_not_labelled(self, client):
        token = _manager(client)
        dish = _new_dish(client, token)
        res = _put(client, token, dish["id"])
        assert res.status_code == 200, res.text
        assert res.json()["photo_labelled"] is False
        assert _listed(client, token, dish["id"])["photo_labelled"] is False
        # And a dish with no photo is not either.
        bare = _new_dish(client, token, name="Sin foto")
        assert _listed(client, token, bare["id"])["photo_labelled"] is False

    def test_the_photos_cut_from_the_till_are(self, client, folder):
        token = _crispy(client)
        _load_the_menu()
        grande = _by_name(client, token)["Crispy Grande"]
        own = _put_ok(client, token, grande["id"], samples.WEBP_LOSSY, "image/webp")
        assert _load_photos(folder) == 2
        other = _manager(client)
        theirs = _new_dish(client, other, name="Crispy XL")
        _put_ok(client, other, theirs["id"])

        assert _mark() == 2
        dishes = _by_name(client, token)
        # The two 0039 put there: labelled.
        assert dishes["Crispy XL"]["photo_labelled"] is True
        assert dishes["Crispy Pequeño"]["photo_labelled"] is True
        # The manager's own: not, and still theirs.
        assert dishes["Crispy Grande"]["photo_url"] == own
        assert dishes["Crispy Grande"]["photo_labelled"] is False
        # Another business's: untouched.
        assert _listed(client, other, theirs["id"])["photo_labelled"] is False
        # Once.
        assert _mark() == 0

    def test_a_new_photo_over_a_labelled_one_is_not(self, client, folder):
        token = _crispy(client)
        _load_the_menu()
        _load_photos(folder)
        _mark()
        xl = _by_name(client, token)["Crispy XL"]
        assert xl["photo_labelled"] is True
        res = _put(client, token, xl["id"])
        assert res.status_code == 200, res.text
        assert res.json()["photo_labelled"] is False


# The real photos of the client this snapshot anonymises were removed with
# app/clients/casa-demo/menu-photos/; 0039 on a missing folder is covered above.
