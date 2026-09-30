"""A product's photo: put, changed and taken off by the manager, served to
anybody who has its address, and shown wherever the product is.

The mirror of tests/test_menu_photos.py, for the stock (migration 0042).
Pinned here:

* THE ADDRESS. `photo_url` is the route that serves it; the route asks nobody
  who they are; 0042 keeps the same types and wall as the API.
* THE ROUTES. A photo goes on and comes back byte for byte, from a public
  address cached for a year; changing it changes the address and the old one
  is a 404; taking it off is a 204 and a 404; editing or archiving the product
  keeps it; the list carries the address and never the picture, in the same
  number of reads whatever the number of photos.
* REFUSED with the menu's codes: not a photo (415), too big (413), and the
  photo it had is left.
* WHO MAY. The manager; an employee is refused before a byte is read; a
  business without Inventario is refused at the door; another business gets a
  404, and the database refuses a photo under a neighbour's product.
* GONE WITH THE PRODUCT, and with the business.
* WHERE THE FACE SHOWS: a count's lines, a delivery's lines, a recipe's
  ingredients -- without a read per row.
* THE MENU IS AS IT WAS: its photos, its codes, its own addresses.
"""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import event, text

from app import clients
from app.clients import ClientProfile
from app.photo_http import CACHE_FOREVER
from app.routers.inventory_photos import photo_url
from app.services import menu_photos, photos
from app.services.photos import MAX_BYTES, MAX_SIDE
from tests import menu_photo_samples as samples
from tests.conftest import NO_APPS_CLIENT_KEY
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    _employee_token,
    _signup,
    client,
    skip_no_db,
)

API = "/api/v1"
INVENTORY = API + "/inventory"
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
    """The same image, `total` bytes long (bytes after a JPEG's end are ignored)."""
    return data + b"\0" * (total - len(data))


def _migration(filename: str):
    spec = importlib.util.spec_from_file_location(filename[:-3], VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# --- The address -------------------------------------------------------------------


class TestTheAddress:
    def test_photo_url_is_the_route_that_serves_it(self):
        from app.main import app

        some = uuid.uuid4()
        assert app.url_path_for("inventory_photo", photo_id=str(some)) == photo_url(some)

    def test_the_photo_route_asks_nobody_who_they_are(self):
        """No dependency on who is asking: an <img> sends no token."""
        from app.routers import inventory_photos as router_module

        [route] = router_module.router.routes
        assert route.methods == {"GET"}
        deps = [d.call.__name__ for d in route.dependant.dependencies]
        assert deps == ["get_admin_db"]

    def test_the_photo_routes_of_the_inventory_ask_for_a_manager(self):
        """`inventory.products`, which only the manager has (app/access.py)."""
        from app.access import MANAGER_ONLY, Perm
        from app.routers import inventory as router_module

        assert Perm.INVENTORY_PRODUCTS in MANAGER_ONLY
        photo_routes = [r for r in router_module.router.routes if r.path.endswith("/photo")]
        assert sorted(m for r in photo_routes for m in r.methods) == ["DELETE", "PUT"]
        for route in photo_routes:
            calls = [d.call for d in route.dependant.dependencies]
            guards = [c for c in calls if getattr(c, "permission", None) is not None]
            assert [g.permission for g in guards] == [Perm.INVENTORY_PRODUCTS], route.path
            if "PUT" in route.methods:
                # The permission first, the body after: see test_an_employee_
                # is_turned_away_before_the_body_is_read.
                names = [c.__name__ for c in calls]
                assert names.index(guards[0].__name__) < names.index("read_upload")

    def test_the_types_and_the_wall_are_the_ones_0042_keeps(self):
        module = _migration("0042_inventory_item_photos.py")
        assert tuple(module.TYPES) == photos.TYPES
        assert module.MAX_BYTES == MAX_BYTES
        assert module.down_revision == "0041_store_recipes"

    def test_the_menu_and_the_stock_check_a_photo_the_same_way(self):
        """One wall for both: the menu's module is the shared one by its old names."""
        for name in menu_photos.__all__:
            assert getattr(menu_photos, name) is getattr(photos, name), name


# --- Through the API -------------------------------------------------------------


def _manager(client) -> str:
    token, _org = _signup(client, "Stock Photo Co")
    return token


def _org_of(client, token) -> str:
    return client.get(API + "/auth/me", headers=_auth(token)).json()["org_id"]


def _product(client, token, name="Cerveza", **fields) -> dict:
    body = {"name": name, "unit": "botellas"}
    body.update(fields)
    res = client.post(INVENTORY + "/items", json=body, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()


def _put(client, token, item_id, data=samples.JPEG, content_type="image/jpeg"):
    headers = {"Content-Type": content_type}
    if token is not None:
        headers.update(_auth(token))
    return client.put(INVENTORY + "/items/%s/photo" % item_id, content=data, headers=headers)


def _put_ok(client, token, item_id, data=samples.JPEG, content_type="image/jpeg") -> str:
    res = _put(client, token, item_id, data, content_type)
    assert res.status_code == 200, res.text
    return res.json()["photo_url"]


def _take_off(client, token, item_id):
    return client.delete(INVENTORY + "/items/%s/photo" % item_id, headers=_auth(token))


def _listed(client, token, item_id) -> dict:
    res = client.get(
        INVENTORY + "/items", params={"include_archived": True}, headers=_auth(token)
    )
    assert res.status_code == 200, res.text
    [item] = [i for i in res.json() if i["id"] == item_id]
    return item


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
                "SELECT id, org_id, item_id, content_type, width, height, "
                "octet_length(data) FROM inventory_item_photo WHERE %s" % clause
            ),
            {k: str(v) for k, v in where.items()},
        ).all()


def _id_of(url: str) -> str:
    return url.rsplit("/", 1)[-1]


class _Statements:
    """Every statement the runtime role sends while the block runs."""

    def __enter__(self):
        from app.db import app_engine

        self.seen = []
        self._engine = app_engine
        event.listen(app_engine, "before_cursor_execute", self._spy)
        return self.seen

    def _spy(self, _conn, _cursor, statement, *_args):
        self.seen.append(statement)

    def __exit__(self, *_exc):
        event.remove(self._engine, "before_cursor_execute", self._spy)
        return False


@skip_no_db
class TestPuttingAPhoto:
    def test_a_new_product_has_none(self, client):
        token = _manager(client)
        item = _product(client, token)
        assert item["photo_url"] is None
        assert _listed(client, token, item["id"])["photo_url"] is None

    def test_a_photo_goes_on_and_comes_back_byte_for_byte(self, client):
        token = _manager(client)
        item = _product(client, token, category="Bebida", min_quantity=24)
        res = _put(client, token, item["id"])
        assert res.status_code == 200, res.text
        answered = res.json()
        url = answered["photo_url"]
        assert url == photo_url(uuid.UUID(_id_of(url)))
        assert url.startswith("/api/v1/inventory/photos/")
        # The product, as it was, with its photo's address.
        assert {k: v for k, v in answered.items() if k != "photo_url"} == {
            k: v for k, v in item.items() if k != "photo_url"
        }
        assert _listed(client, token, item["id"])["photo_url"] == url

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
        item = _product(client, token)
        url = _put_ok(client, token, item["id"], data, kind)
        served = _fetch(client, url)
        assert (served.content, served.headers["content-type"]) == (data, kind)
        [row] = _photo_rows(id=_id_of(url))
        assert (row.content_type, row.width, row.height) == (kind, size[0], size[1])

    def test_changing_it_changes_the_address_and_the_old_one_is_gone(self, client):
        token = _manager(client)
        item = _product(client, token)
        first = _put_ok(client, token, item["id"])
        second = _put_ok(client, token, item["id"], samples.PNG, "image/png")
        assert second != first
        assert _listed(client, token, item["id"])["photo_url"] == second
        gone = _fetch(client, first)
        assert gone.status_code == 404
        assert gone.headers["cache-control"] == "no-store"
        assert _fetch(client, second).content == samples.PNG
        # One photo per product, not a pile of them.
        assert len(_photo_rows(item_id=item["id"])) == 1

    def test_the_same_photo_again_is_still_a_new_address(self, client):
        token = _manager(client)
        item = _product(client, token)
        assert _put_ok(client, token, item["id"]) != _put_ok(client, token, item["id"])

    def test_taking_it_off(self, client):
        token = _manager(client)
        item = _product(client, token)
        url = _put_ok(client, token, item["id"])
        res = _take_off(client, token, item["id"])
        assert res.status_code == 204
        assert res.content == b""
        assert _listed(client, token, item["id"])["photo_url"] is None
        assert _fetch(client, url).status_code == 404
        assert _photo_rows(item_id=item["id"]) == []
        # Already off: as asked.
        assert _take_off(client, token, item["id"]).status_code == 204

    def test_editing_or_archiving_the_product_keeps_its_photo(self, client):
        token = _manager(client)
        item = _product(client, token)
        url = _put_ok(client, token, item["id"])
        res = client.patch(
            INVENTORY + "/items/%s" % item["id"],
            json={"name": "Cerveza tercio", "min_quantity": 12},
            headers=_auth(token),
        )
        assert res.status_code == 200, res.text
        assert res.json()["photo_url"] == url
        res = client.patch(
            INVENTORY + "/items/%s" % item["id"], json={"archived": True}, headers=_auth(token)
        )
        assert res.status_code == 200, res.text
        assert res.json()["photo_url"] == url
        assert _listed(client, token, item["id"])["photo_url"] == url
        assert _fetch(client, url).status_code == 200

    def test_an_archived_product_can_be_given_one(self, client):
        token = _manager(client)
        item = _product(client, token)
        client.patch(
            INVENTORY + "/items/%s" % item["id"], json={"archived": True}, headers=_auth(token)
        )
        url = _put_ok(client, token, item["id"])
        assert _listed(client, token, item["id"])["photo_url"] == url

    def test_the_answer_says_the_rest_of_the_product_as_the_list_does(self, client):
        """The PUT answers with the product as the list has it -- codes and
        stock included -- so the screen can put it in the list as it is."""
        token = _manager(client)
        item = _product(client, token, barcodes=[{"code": "8410188012345"}])
        client.post(
            INVENTORY + "/counts",
            json={"lines": [{"item_id": item["id"], "quantity": 7}]},
            headers=_auth(token),
        )
        res = _put(client, token, item["id"])
        assert res.status_code == 200, res.text
        assert res.json() == _listed(client, token, item["id"])
        assert res.json()["last_quantity"] == 7
        assert [b["code"] for b in res.json()["barcodes"]] == ["8410188012345"]

    def test_the_list_is_read_without_the_pictures(self, client):
        """The address and nothing else: a list of a hundred photos must not
        be a hundred pictures read out of the database on every phone."""
        token = _manager(client)
        item = _product(client, token)
        _put_ok(client, token, item["id"])
        with _Statements() as seen:
            assert _listed(client, token, item["id"])["photo_url"]
        read = [s for s in seen if "inventory_item_photo" in s]
        assert read, "the list did not look at the photos at all"
        assert not [s for s in read if "inventory_item_photo.data" in s]

    def test_the_list_costs_the_same_with_one_photo_as_with_six(self, client):
        """In the same read as the products: never one read per photo."""

        def furnish(n) -> str:
            token = _manager(client)
            for i in range(n):
                _put_ok(client, token, _product(client, token, "P%d" % i)["id"])
            return token

        def statements_for(token) -> int:
            with _Statements() as seen:
                res = client.get(INVENTORY + "/items", headers=_auth(token))
            assert res.status_code == 200
            assert all(i["photo_url"] for i in res.json())
            return len(seen)

        one, six = furnish(1), furnish(6)
        assert statements_for(one) == statements_for(six)

    def test_an_address_that_never_was_is_a_404(self, client):
        res = _fetch(client, photo_url(uuid.uuid4()))
        assert res.status_code == 404
        assert res.content == b""
        assert res.headers["cache-control"] == "no-store"

    def test_an_address_that_is_not_one_is_refused(self, client):
        assert _fetch(client, "/api/v1/inventory/photos/not-a-uuid").status_code == 422


@skip_no_db
class TestRefused:
    @pytest.mark.parametrize(
        "data, content_type",
        [
            (b"<html></html>", "image/jpeg"),
            (samples.PNG, "image/jpeg"),
            (samples.JPEG, "application/octet-stream"),
            (b'{"photo": "x"}', "application/json"),
            (b'<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml"),
            (b"GIF89a\x01\x00\x01\x00\x00\x00\x00;", "image/gif"),
            (b"", "image/jpeg"),
        ],
        ids=["html", "png-as-jpeg", "no-type", "json", "svg", "gif", "empty"],
    )
    def test_what_is_not_a_photo(self, client, data, content_type):
        token = _manager(client)
        item = _product(client, token)
        res = _put(client, token, item["id"], data, content_type)
        assert res.status_code == 415
        assert _code(res) == "menu_photo_bad_type"
        assert res.json()["detail"]["params"] == {"types": list(photos.TYPES)}
        assert _listed(client, token, item["id"])["photo_url"] is None
        assert _photo_rows(item_id=item["id"]) == []

    def test_one_byte_over_the_wall(self, client):
        token = _manager(client)
        item = _product(client, token)
        res = _put(client, token, item["id"], _padded(samples.JPEG, MAX_BYTES + 1))
        assert res.status_code == 413
        assert _code(res) == "menu_photo_too_large"
        assert res.json()["detail"]["params"] == {"max_bytes": MAX_BYTES, "max_side": MAX_SIDE}

    def test_exactly_the_wall_gets_in(self, client):
        token = _manager(client)
        item = _product(client, token)
        big = _padded(samples.JPEG, MAX_BYTES)
        url = _put_ok(client, token, item["id"], big)
        assert _fetch(client, url).content == big

    def test_over_the_body_limit_it_is_the_envelope_that_says_no(self, client):
        from app.body_limit import MAX_BODY_BYTES

        token = _manager(client)
        item = _product(client, token)
        res = _put(client, token, item["id"], _padded(samples.JPEG, MAX_BODY_BYTES + 1))
        assert res.status_code == 413
        assert _code(res) == "request_too_large"

    def test_a_picture_too_big_in_pixels(self, client):
        token = _manager(client)
        item = _product(client, token)
        res = _put(client, token, item["id"], samples.PNG_TOO_WIDE, "image/png")
        assert res.status_code == 413
        assert _code(res) == "menu_photo_too_large"

    def test_a_refused_photo_leaves_the_one_it_had(self, client):
        token = _manager(client)
        item = _product(client, token)
        url = _put_ok(client, token, item["id"])
        assert _put(client, token, item["id"], b"nope", "image/jpeg").status_code == 415
        too_big = _padded(samples.JPEG, MAX_BYTES + 1)
        assert _put(client, token, item["id"], too_big).status_code == 413
        assert _listed(client, token, item["id"])["photo_url"] == url
        assert _fetch(client, url).status_code == 200

    def test_a_product_that_is_not_there(self, client):
        token = _manager(client)
        missing = uuid.uuid4()
        for res in (_put(client, token, missing), _take_off(client, token, missing)):
            assert res.status_code == 404
            assert _code(res) == "inventory_item_not_found"


@skip_no_db
class TestWhoMay:
    def _staff(self, client):
        manager = _manager(client)
        employee = _add(client, manager, "Ana")
        return manager, _employee_token(client, manager, employee["id"])

    def test_an_employee_can_neither_put_nor_take_off(self, client):
        manager, staff = self._staff(client)
        item = _product(client, manager)
        url = _put_ok(client, manager, item["id"])
        for res in (
            _put(client, staff, item["id"], samples.PNG, "image/png"),
            _take_off(client, staff, item["id"]),
        ):
            assert res.status_code == 403
            assert _code(res) == "manager_role_required"
        assert _listed(client, manager, item["id"])["photo_url"] == url

    def test_an_employee_is_turned_away_before_the_body_is_read(self, client):
        """600 KB: over the photo's wall. The answer is the role's, and the
        body was never drawn on."""
        manager, staff = self._staff(client)
        item = _product(client, manager)
        drawn = []

        def body():
            drawn.append(True)
            yield _padded(samples.JPEG, 600 * 1024)

        headers = {"Content-Type": "image/jpeg", **_auth(staff)}
        res = client.put(
            INVENTORY + "/items/%s/photo" % item["id"], content=body(), headers=headers
        )
        assert res.status_code == 403
        assert _code(res) == "manager_role_required"
        assert drawn == []

    def test_nobody_signed_out_puts_a_photo(self, client):
        manager = _manager(client)
        item = _product(client, manager)
        assert _put(client, None, item["id"]).status_code in (401, 403)
        assert client.delete(INVENTORY + "/items/%s/photo" % item["id"]).status_code in (401, 403)
        assert _photo_rows(item_id=item["id"]) == []

    def test_a_business_without_the_inventory_is_refused_at_its_door(self, client, monkeypatch):
        """A shop with a menu and no stock: its dishes take photos, and the
        stock's photo routes are behind Inventario's door like the rest of it."""
        key = "pytest-shop-%s" % uuid.uuid4().hex[:8]
        filed = clients.profiles()
        shop_only = ClientProfile(name="Solo tienda", apps=["shifts", "store"])
        monkeypatch.setattr(clients, "profiles", lambda: {**filed, key: shop_only})
        token, org_id = _signup(client, "Solo tienda")
        item = _product(client, token)
        _file_under(org_id, key)
        for res in (_put(client, token, item["id"]), _take_off(client, token, item["id"])):
            assert res.status_code == 403
            assert _code(res) == "app_not_enabled"
            assert res.json()["detail"]["params"] == {"app": "inventory"}
        assert _photo_rows(item_id=item["id"]) == []
        # Its menu's photos are its own business, and go on.
        section = client.post(
            API + "/menu/sections", json={"name": "Carta"}, headers=_auth(token)
        ).json()
        dish = client.post(
            API + "/menu/dishes",
            json={"section_id": section["id"], "name": "Crispy"},
            headers=_auth(token),
        ).json()
        res = client.put(
            API + "/menu/dishes/%s/photo" % dish["id"],
            content=samples.JPEG,
            headers={"Content-Type": "image/jpeg", **_auth(token)},
        )
        assert res.status_code == 200, res.text

    def test_the_address_asks_for_no_app_either(self, client):
        """An <img> has no business to ask about: a photo put while the stock
        was on is served by its address after it is switched off -- the same
        as the menu's. What stops a new one is that no list gives it out."""
        token, org_id = _signup(client, "Apagado")
        item = _product(client, token)
        url = _put_ok(client, token, item["id"])
        _file_under(org_id, NO_APPS_CLIENT_KEY)
        assert client.get(INVENTORY + "/items", headers=_auth(token)).status_code == 403
        assert _fetch(client, url).content == samples.JPEG


def _file_under(org_id: str, client_key) -> None:
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE organization SET client_key = :key WHERE id = :org"),
            {"key": client_key, "org": org_id},
        )


@skip_no_db
class TestAnotherBusiness:
    def test_cannot_put_or_take_a_photo_on_your_product(self, client):
        mine = _manager(client)
        theirs = _manager(client)
        item = _product(client, mine)
        url = _put_ok(client, mine, item["id"])
        for res in (
            _put(client, theirs, item["id"], samples.PNG, "image/png"),
            _take_off(client, theirs, item["id"]),
        ):
            assert res.status_code == 404
            assert _code(res) == "inventory_item_not_found"
        assert _listed(client, mine, item["id"])["photo_url"] == url
        assert _fetch(client, url).content == samples.JPEG
        # And their list does not carry it.
        assert url not in client.get(INVENTORY + "/items", headers=_auth(theirs)).text

    def test_the_database_refuses_a_photo_under_a_neighbours_product(self, client):
        """The second barrier, the API taken out: as the runtime role, in A's
        context, a photo that is A's own -- so `org_isolation` lets it through
        -- on B's product. The key on (item_id, org_id) is what refuses it."""
        from sqlalchemy.exc import IntegrityError

        from app.db import app_engine

        mine = _manager(client)
        theirs = _manager(client)
        their_item = _product(client, theirs)
        my_org = _org_of(client, mine)
        with app_engine.connect() as conn:
            with pytest.raises(IntegrityError) as refused:
                with conn.begin():
                    conn.execute(
                        text("SELECT set_config('app.current_org_id', :org, true)"),
                        {"org": my_org},
                    )
                    conn.execute(
                        text(
                            "INSERT INTO inventory_item_photo "
                            "(org_id, item_id, content_type, data, width, height) "
                            "VALUES (:org, :item, 'image/jpeg', :data, 3, 2)"
                        ),
                        {"org": my_org, "item": their_item["id"], "data": samples.JPEG},
                    )
        assert "inventory_item_photo_item_id_org_id_fkey" in str(refused.value)
        assert _photo_rows(item_id=their_item["id"]) == []

    def test_the_runtime_role_sees_only_its_own_photos(self, client):
        mine = _manager(client)
        theirs = _manager(client)
        their_item = _product(client, theirs)
        _put_ok(client, theirs, their_item["id"])
        from app.db import app_engine

        with app_engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("SELECT set_config('app.current_org_id', :org, true)"),
                    {"org": _org_of(client, mine)},
                )
                seen = conn.execute(
                    text("SELECT count(*) FROM inventory_item_photo WHERE item_id = :i"),
                    {"i": their_item["id"]},
                ).scalar()
        assert seen == 0
        assert len(_photo_rows(item_id=their_item["id"])) == 1

    def test_the_database_holds_the_walls_too(self, client):
        """0042's CHECKs and NOT NULLs, for whatever writes past the API."""
        from sqlalchemy.exc import IntegrityError

        from app.db import admin_engine

        token = _manager(client)
        item = _product(client, token)
        org = _org_of(client, token)
        for kind, data, width, height in (
            ("image/gif", samples.JPEG, 3, 2),
            ("image/svg+xml", samples.JPEG, 3, 2),
            ("image/jpeg", b"", 3, 2),
            ("image/jpeg", b"x" * (MAX_BYTES + 1), 3, 2),
            ("image/jpeg", samples.JPEG, 0, 2),
            ("image/jpeg", samples.JPEG, 3, None),
        ):
            with pytest.raises(IntegrityError):
                with admin_engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO inventory_item_photo "
                            "(org_id, item_id, content_type, data, width, height) "
                            "VALUES (:org, :item, :kind, :data, :w, :h)"
                        ),
                        {
                            "org": org,
                            "item": item["id"],
                            "kind": kind,
                            "data": data,
                            "w": width,
                            "h": height,
                        },
                    )
        assert _photo_rows(item_id=item["id"]) == []

    def test_one_photo_per_product_in_the_database_too(self, client):
        from sqlalchemy.exc import IntegrityError

        from app.db import admin_engine

        token = _manager(client)
        item = _product(client, token)
        _put_ok(client, token, item["id"])
        with pytest.raises(IntegrityError, match="inventory_item_photo_item_id_key"):
            with admin_engine.begin() as conn:
                conn.execute(
                    text(
                        "INSERT INTO inventory_item_photo "
                        "(org_id, item_id, content_type, data, width, height) "
                        "VALUES (:org, :item, 'image/jpeg', :data, 3, 2)"
                    ),
                    {"org": _org_of(client, token), "item": item["id"], "data": samples.JPEG},
                )

    def test_the_table_is_behind_row_level_security(self):
        from app.db import admin_engine

        with admin_engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname = 'inventory_item_photo'"
                )
            ).one()
            storage = conn.execute(
                text(
                    "SELECT attstorage FROM pg_attribute "
                    "WHERE attrelid = 'inventory_item_photo'::regclass AND attname = 'data'"
                )
            ).scalar()
        assert row == (True, True)
        # EXTERNAL: out of line, never compressed again.
        assert storage == "e"


@skip_no_db
class TestGoneWithTheProduct:
    def test_deleting_the_product_deletes_its_photo(self, client):
        """The API archives products rather than deleting them; whatever does
        delete one (the business going, a hand in the database) takes its
        photo in the same statement."""
        from app.db import admin_engine

        token = _manager(client)
        item = _product(client, token)
        url = _put_ok(client, token, item["id"])
        assert _photo_rows(id=_id_of(url))
        with admin_engine.begin() as conn:
            conn.execute(text("DELETE FROM inventory_item WHERE id = :i"), {"i": item["id"]})
        assert _photo_rows(id=_id_of(url)) == []
        assert _fetch(client, url).status_code == 404

    def test_deleting_the_business_deletes_its_photos(self, client):
        token, org_id = _signup(client, "Se va")
        urls = [_put_ok(client, token, _product(client, token, n)["id"]) for n in ("A", "B")]
        res = client.request(
            "DELETE",
            API + "/org",
            json={"confirm": _org_name(org_id)},
            headers=_auth(token),
        )
        assert res.status_code == 204, res.text
        assert _photo_rows(org_id=org_id) == []
        for url in urls:
            assert _fetch(client, url).status_code == 404


def _org_name(org_id: str) -> str:
    from app.db import admin_engine

    with admin_engine.connect() as conn:
        return conn.execute(
            text("SELECT name FROM organization WHERE id = :o"), {"o": org_id}
        ).scalar_one()


# --- Where the face shows -------------------------------------------------------------


def _count(client, token, lines) -> dict:
    res = client.post(
        INVENTORY + "/counts",
        json={"lines": [{"item_id": i["id"], "quantity": q} for i, q in lines]},
        headers=_auth(token),
    )
    assert res.status_code == 201, res.text
    return res.json()


def _receipt(client, token, lines) -> dict:
    res = client.post(
        INVENTORY + "/receipts",
        json={"lines": [{"item_id": i["id"], "quantity": q} for i, q in lines]},
        headers=_auth(token),
    )
    assert res.status_code == 201, res.text
    return res.json()


def _photos_by_name(lines, name_key="item_name") -> dict:
    return {line[name_key]: line["photo_url"] for line in lines}


@skip_no_db
class TestWhereTheFaceShows:
    def _two(self, client):
        """Two products, one with a photo and one without."""
        token = _manager(client)
        beer = _product(client, token, "Cerveza")
        ice = _product(client, token, "Hielo", unit="bolsas")
        url = _put_ok(client, token, beer["id"])
        return token, beer, ice, url

    def test_a_count_carries_the_photos_of_its_products(self, client):
        token, beer, ice, url = self._two(client)
        made = _count(client, token, [(beer, 12), (ice, 3)])
        assert _photos_by_name(made["lines"]) == {"Cerveza": url, "Hielo": None}
        again = client.get(INVENTORY + "/counts/%s" % made["id"], headers=_auth(token))
        assert again.json() == made

    def test_a_delivery_carries_the_photos_of_its_products(self, client):
        token, beer, ice, url = self._two(client)
        made = _receipt(client, token, [(beer, 24), (ice, 5)])
        assert _photos_by_name(made["lines"]) == {"Cerveza": url, "Hielo": None}
        again = client.get(INVENTORY + "/receipts/%s" % made["id"], headers=_auth(token))
        assert again.json() == made

    def test_the_face_is_the_one_it_has_now(self, client):
        """A count taken before the photo shows the photo put after it: the
        lines show the product, and the product has the face it has today."""
        token, beer, ice, _url = self._two(client)
        made = _count(client, token, [(ice, 3)])
        assert made["lines"][0]["photo_url"] is None
        url = _put_ok(client, token, ice["id"])
        again = client.get(INVENTORY + "/counts/%s" % made["id"], headers=_auth(token)).json()
        assert again["lines"][0]["photo_url"] == url
        _take_off(client, token, ice["id"])
        again = client.get(INVENTORY + "/counts/%s" % made["id"], headers=_auth(token)).json()
        assert again["lines"][0]["photo_url"] is None

    def test_a_recipe_carries_the_photos_of_its_ingredients(self, client):
        token, beer, ice, url = self._two(client)
        section = client.post(
            API + "/menu/sections", json={"name": "Barra"}, headers=_auth(token)
        ).json()

        def dish(name):
            res = client.post(
                API + "/menu/dishes",
                json={"section_id": section["id"], "name": name, "price": 3},
                headers=_auth(token),
            )
            assert res.status_code == 201, res.text
            return res.json()

        cana, combo = dish("Caña"), dish("Caña y tapa")
        res = client.put(
            API + "/store/recipes/%s" % cana["id"],
            json={
                "items": [{"item_id": beer["id"], "quantity": 1}, {"item_id": ice["id"], "quantity": 0.1}],
                "components": [],
            },
            headers=_auth(token),
        )
        assert res.status_code == 200, res.text
        assert _photos_by_name(res.json()["items"], "name") == {"Cerveza": url, "Hielo": None}
        assert _photos_by_name(res.json()["expanded"], "name") == {"Cerveza": url, "Hielo": None}
        res = client.put(
            API + "/store/recipes/%s" % combo["id"],
            json={"items": [], "components": [{"dish_id": cana["id"], "quantity": 1}]},
            headers=_auth(token),
        )
        assert res.status_code == 200, res.text
        # Through a combo, the expanded ingredients carry theirs too.
        assert _photos_by_name(res.json()["expanded"], "name") == {"Cerveza": url, "Hielo": None}

        listed = client.get(API + "/store/recipes", headers=_auth(token))
        assert listed.status_code == 200
        dishes = {d["name"]: d for s in listed.json()["sections"] for d in s["dishes"]}
        assert _photos_by_name(dishes["Caña"]["items"], "name") == {"Cerveza": url, "Hielo": None}
        assert _photos_by_name(dishes["Caña y tapa"]["expanded"], "name") == {
            "Cerveza": url,
            "Hielo": None,
        }

    def test_no_line_reads_a_picture_nor_a_photo_of_its_own(self, client):
        """A count of six products with photos is read in the same statements
        as a count of one, and none of them reads the bytes."""

        def furnish(n):
            token = _manager(client)
            products = [_product(client, token, "P%d" % i) for i in range(n)]
            for p in products:
                _put_ok(client, token, p["id"])
            return token, _count(client, token, [(p, 1) for p in products]), _receipt(
                client, token, [(p, 1) for p in products]
            )

        def statements_for(token, count, receipt) -> list:
            with _Statements() as seen:
                for path in ("/counts/%s" % count["id"], "/receipts/%s" % receipt["id"]):
                    res = client.get(INVENTORY + path, headers=_auth(token))
                    assert res.status_code == 200
                    assert all(line["photo_url"] for line in res.json()["lines"])
                recipes = client.get(API + "/store/recipes", headers=_auth(token))
                assert recipes.status_code == 200
            return list(seen)

        one, six = furnish(1), furnish(6)
        seen_one, seen_six = statements_for(*one), statements_for(*six)
        assert len(seen_one) == len(seen_six)
        assert not [s for s in seen_six if "inventory_item_photo.data" in s]


# --- The menu is as it was ---------------------------------------------------------------


@skip_no_db
class TestTheMenuIsAsItWas:
    def test_a_dish_photo_still_goes_on_with_its_own_address(self, client):
        token = _manager(client)
        section = client.post(
            API + "/menu/sections", json={"name": "Entrantes"}, headers=_auth(token)
        ).json()
        dish = client.post(
            API + "/menu/dishes",
            json={"section_id": section["id"], "name": "Croquetas", "price": 8.5},
            headers=_auth(token),
        ).json()
        res = client.put(
            API + "/menu/dishes/%s/photo" % dish["id"],
            content=samples.PNG,
            headers={"Content-Type": "image/png", **_auth(token)},
        )
        assert res.status_code == 200, res.text
        dish_url = res.json()["photo_url"]
        assert dish_url.startswith("/api/v1/menu/photos/")
        served = _fetch(client, dish_url)
        assert (served.content, served.headers["cache-control"]) == (samples.PNG, CACHE_FOREVER)

        item = _product(client, token)
        item_url = _put_ok(client, token, item["id"])
        # Two tables, two addresses: neither id opens at the other's.
        assert _fetch(client, "/api/v1/inventory/photos/%s" % _id_of(dish_url)).status_code == 404
        assert _fetch(client, "/api/v1/menu/photos/%s" % _id_of(item_url)).status_code == 404

    def test_the_menu_refuses_with_the_same_codes(self, client):
        token = _manager(client)
        section = client.post(
            API + "/menu/sections", json={"name": "Entrantes"}, headers=_auth(token)
        ).json()
        dish = client.post(
            API + "/menu/dishes",
            json={"section_id": section["id"], "name": "Croquetas"},
            headers=_auth(token),
        ).json()
        url = API + "/menu/dishes/%s/photo" % dish["id"]
        res = client.put(url, content=b"<html>", headers={"Content-Type": "image/jpeg", **_auth(token)})
        assert (res.status_code, _code(res)) == (415, "menu_photo_bad_type")
        assert "A dish photo" in res.json()["detail"]["message"]
        res = client.put(
            url,
            content=_padded(samples.JPEG, MAX_BYTES + 1),
            headers={"Content-Type": "image/jpeg", **_auth(token)},
        )
        assert (res.status_code, _code(res)) == (413, "menu_photo_too_large")
        assert "A dish photo" in res.json()["detail"]["message"]
