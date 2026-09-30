"""Stock coming in: barcodes on the products, and deliveries (receipts).

The first half needs nothing: how a code is normalised, and what the schemas
refuse before a database is involved. The rest goes through the API as a
manager, like tests/test_inventory.py, and needs a database.

The part worth reading first is TestStock. Until receipts existed, "what went
since last time" was the difference between two counts, and it was wrong by
exactly one delivery the day a lorry arrived between them. The four numbers
the list now sends per product are what the screen does its sums with, so
their edges are pinned here one by one: strictly after the last count, the
window (previous, last] between counts, a product never counted, a product
counted once, and a delivery at the very instant of a count.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import event, text

from app.schemas.inventory import (
    InventoryBarcodeIn,
    InventoryCountLineIn,
    InventoryItemCreate,
    InventoryItemUpdate,
    InventoryReceiptCreate,
    InventoryReceiptLineIn,
)
from app.services.barcodes import barcode_key, clean_code
from tests.test_business_profile import (  # noqa: F401 - fixtures by name
    _auth,
    _signup,
    client,
    skip_no_db,
)
from tests.test_day_notes import _staff
from tests.test_store_recipes import _dish, _line, _sale, _section

API = "/api/v1/inventory"


# --- Normalising a code (no database) ----------------------------------------

# The same table is tested in the frontend; change one, change both.
BARCODE_CASES = [
    (" 8410188012345\r\n", "08410188012345"),
    ("036000291452", "00036000291452"),
    ("0036000291452", "00036000291452"),
    ("96385074", "00000096385074"),
    ("12345", "12345"),
    ("ABC-123", "ABC-123"),
    ("abc-123", "abc-123"),
    ("4 006381 333931", "04006381333931"),
]


@pytest.mark.parametrize("raw, key", BARCODE_CASES)
def test_barcode_key(raw, key):
    assert barcode_key(raw) == key


@pytest.mark.parametrize("raw", ["  ", "", "\r\n", "\t", "\x00\x1d", "\ufeff"])
def test_a_blank_code_is_not_a_code(raw):
    with pytest.raises(ValueError):
        barcode_key(raw)


def test_the_three_lengths_of_one_gtin_are_one_key():
    assert barcode_key("036000291452") == barcode_key("0036000291452") == barcode_key(
        "00036000291452"
    )


def test_only_ascii_digits_make_a_gtin():
    # Eight Arabic-Indic digits are eight digits to str.isdigit(), and nothing
    # a scanner sends. Kept as they are, not padded.
    assert barcode_key("٠١٢٣٤٥٦٧") == "٠١٢٣٤٥٦٧"
    # Ten digits are nobody's GTIN either.
    assert barcode_key("0123456789") == "0123456789"


def test_the_code_shown_back_keeps_its_spaces_and_loses_the_scanner_noise():
    assert clean_code(" 8410188012345\r\n") == "8410188012345"
    assert clean_code("4 006381 333931") == "4 006381 333931"
    assert clean_code("\x00AB\x1dC\t") == "ABC"
    # Trimmed like JavaScript's trim(), which also takes a BOM off the ends.
    assert clean_code("\ufeff 12 3\u00a0") == "12 3"


def test_the_schema_cleans_the_code_before_measuring_it():
    # 64 characters of code plus the scanner's CR/LF is still a 64-char code.
    assert InventoryBarcodeIn(code="7" * 64 + "\r\n").code == "7" * 64
    with pytest.raises(ValidationError):
        InventoryBarcodeIn(code="7" * 65)


@pytest.mark.parametrize("quantity", [0, -1, 0.0004, 1_000_000_000, 999_999_999.9996])
def test_a_quantity_the_column_cannot_hold_is_refused_before_it_is_written(quantity):
    # 0.0004 rounds to 0.000 in numeric(12, 3) and breaks the > 0 CHECK; 1e9 and
    # what rounds up to it overflow. Either would be a 500 at the INSERT.
    with pytest.raises(ValidationError):
        InventoryReceiptLineIn(item_id="00000000-0000-0000-0000-000000000000", quantity=quantity)


@pytest.mark.parametrize("units", [0, -2, 0.0001, 100_001])
def test_units_per_scan_must_be_storable_and_positive(units):
    with pytest.raises(ValidationError):
        InventoryBarcodeIn(code="1", units_per_scan=units)


def test_what_is_checked_is_what_is_stored():
    # Rounded here as Postgres will round it, so the answer and the row agree
    # (2.0004 used to be answered as 2.0004 and stored as 2.000).
    assert InventoryBarcodeIn(code="1", units_per_scan=2.0004).units_per_scan == 2.0
    # Rounds DOWN in Python and up to 1e9 in Postgres, unless what is sent on
    # is the rounded value.
    line = InventoryReceiptLineIn(
        item_id="00000000-0000-0000-0000-000000000000", quantity=999_999_999.9994999
    )
    assert line.quantity == 999_999_999.999


@pytest.mark.parametrize("quantity", [1_000_000_000, 999_999_999.9996, -0.0001])
def test_a_counted_quantity_the_column_cannot_hold_is_refused(quantity):
    with pytest.raises(ValidationError):
        InventoryCountLineIn(item_id="00000000-0000-0000-0000-000000000000", quantity=quantity)
    with pytest.raises(ValidationError):
        InventoryItemCreate(name="Harina", min_quantity=quantity)


def test_a_stray_nul_is_dropped_from_every_text():
    # Postgres cannot store a NUL in text: it was a 500 in all of these.
    assert InventoryBarcodeIn(code="1", label="caja\x00 de 24").label == "caja de 24"
    assert InventoryItemCreate(name="Harina\x00").name == "Harina"
    assert InventoryItemUpdate(name="\x00Sal").name == "Sal"
    assert InventoryReceiptCreate(
        supplier="Damm\x00", note="\x00", lines=[{"item_id": "00000000-0000-0000-0000-000000000000", "quantity": 1}]
    ).supplier == "Damm"


@pytest.mark.parametrize("quantity", [0, -1, 0.0004, 1_000_000_000, 999_999_999.9996])
def test_what_a_new_product_already_has_is_checked_like_a_delivery(quantity):
    # It becomes a receipt line, so it is refused where a line would be.
    with pytest.raises(ValidationError):
        InventoryItemCreate(name="Agua", initial_quantity=quantity)


def test_what_a_new_product_already_has_is_kept_as_a_delivery_would_be():
    made = InventoryItemCreate(
        name="Agua", initial_quantity=12.0004, initial_note="  Existencias\x00 al darlo de alta "
    )
    assert made.initial_quantity == 12.0
    assert made.initial_note == "Existencias al darlo de alta"
    assert InventoryItemCreate(name="Agua", initial_quantity=1, initial_note="  ").initial_note is None
    # Not said, not there: a product is still created without them.
    plain = InventoryItemCreate(name="Agua")
    assert plain.initial_quantity is None and plain.initial_note is None


# --- Helpers ------------------------------------------------------------------


def _item(client, token, **fields) -> dict:
    body = {"name": "Cerveza"}
    body.update(fields)
    res = client.post(API + "/items", json=body, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()


def _items(client, token, **params) -> list:
    res = client.get(API + "/items", params=params, headers=_auth(token))
    assert res.status_code == 200, res.text
    return res.json()


def _by_name(client, token) -> dict:
    return {i["name"]: i for i in _items(client, token, include_archived=True)}


def _barcode(client, token, item_id, code, **fields):
    body = {"code": code}
    body.update(fields)
    return client.post(
        API + "/items/%s/barcodes" % item_id, json=body, headers=_auth(token)
    )


def _count(client, token, lines, **fields):
    body = {"lines": lines}
    body.update(fields)
    res = client.post(API + "/counts", json=body, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()


def _receive(client, token, lines, **fields):
    body = {"lines": lines}
    body.update(fields)
    return client.post(API + "/receipts", json=body, headers=_auth(token))


def _received(client, token, lines, **fields) -> dict:
    res = _receive(client, token, lines, **fields)
    assert res.status_code == 201, res.text
    return res.json()


def _code_of(res) -> str:
    return res.json()["detail"]["code"]


# --- Barcodes -----------------------------------------------------------------


@skip_no_db
class TestBarcodes:
    def test_a_code_is_stored_as_read_and_compared_as_its_key(self, client):
        token = _signup(client)
        beer = _item(client, token)
        res = _barcode(
            client, token, beer["id"], " 8410188012345\r\n", units_per_scan=24, label=" caja de 24 "
        )
        assert res.status_code == 201, res.text
        made = res.json()
        assert made["code"] == "8410188012345"
        assert made["key"] == "08410188012345"
        assert made["units_per_scan"] == 24
        assert made["label"] == "caja de 24"
        [listed] = _items(client, token)
        assert listed["barcodes"] == [made]

    def test_one_scan_is_one_unit_unless_it_says_otherwise(self, client):
        token = _signup(client)
        beer = _item(client, token)
        made = _barcode(client, token, beer["id"], "96385074").json()
        assert made["units_per_scan"] == 1
        assert made["label"] is None

    def test_a_code_another_product_has_is_refused_with_its_name(self, client):
        # The UPC-A of the box is on the beer; the EAN-13 of the same box is
        # the same code, and the answer names the product that has it.
        token = _signup(client)
        beer = _item(client, token)
        ice = _item(client, token, name="Hielo")
        assert _barcode(client, token, beer["id"], "036000291452").status_code == 201
        res = _barcode(client, token, ice["id"], "0036000291452")
        assert res.status_code == 409
        assert res.json()["detail"]["code"] == "inventory_barcode_taken"
        assert res.json()["detail"]["params"] == {"product": "Cerveza"}

    def test_the_same_code_on_the_same_product_is_an_answer_not_a_conflict(self, client):
        # A save retried because its answer was lost: what it asks for is
        # already true, so it gets the code as it is -- not re-labelled, not
        # re-counted -- and a 200 instead of the 201 of a code made now.
        token = _signup(client)
        beer = _item(client, token)
        made = _barcode(client, token, beer["id"], "036000291452")
        assert made.status_code == 201
        again = _barcode(client, token, beer["id"], "0036000291452", units_per_scan=24, label="caja")
        assert again.status_code == 200
        assert again.json() == made.json()
        [listed] = _items(client, token)
        assert listed["barcodes"] == [made.json()]

    def test_the_same_code_twice_at_once_on_one_product_is_one_code(self, client, monkeypatch):
        """The repeat that only meets the UNIQUE constraint -- the check before
        the INSERT missed it -- is answered the same way: 200, the one code."""
        from app.routers import inventory as router_module

        token = _signup(client)
        beer = _item(client, token)
        made = _barcode(client, token, beer["id"], "8410188012345").json()

        real = router_module._owner_of
        calls = []

        def blind_first(*args, **kwargs):
            calls.append(1)
            return None if len(calls) == 1 else real(*args, **kwargs)

        monkeypatch.setattr(router_module, "_owner_of", blind_first)
        res = _barcode(client, token, beer["id"], "08410188012345", units_per_scan=6)
        assert res.status_code == 200
        assert res.json() == made
        assert len(calls) == 2
        assert _items(client, token)[0]["barcodes"] == [made]

    def test_the_same_code_in_two_businesses_is_two_products(self, client):
        mine = _signup(client)
        theirs = _signup(client)
        assert _barcode(client, mine, _item(client, mine)["id"], "8410188012345").status_code == 201
        assert (
            _barcode(client, theirs, _item(client, theirs)["id"], "8410188012345").status_code
            == 201
        )

    def test_a_blank_code_is_refused_with_its_own_code(self, client):
        token = _signup(client)
        beer = _item(client, token)
        res = _barcode(client, token, beer["id"], "  \r\n")
        assert res.status_code == 422
        assert _code_of(res) == "inventory_barcode_invalid"

    def test_deleting_a_code_frees_it(self, client):
        token = _signup(client)
        beer = _item(client, token)
        ice = _item(client, token, name="Hielo")
        made = _barcode(client, token, beer["id"], "ABC-123").json()
        url = API + "/items/%s/barcodes/%s" % (beer["id"], made["id"])
        assert client.delete(url, headers=_auth(token)).status_code == 204
        assert _by_name(client, token)["Cerveza"]["barcodes"] == []
        gone = client.delete(url, headers=_auth(token))
        assert gone.status_code == 404
        assert _code_of(gone) == "inventory_barcode_not_found"
        assert _barcode(client, token, ice["id"], "ABC-123").status_code == 201

    def test_a_code_is_deleted_through_its_own_product_only(self, client):
        token = _signup(client)
        beer = _item(client, token)
        ice = _item(client, token, name="Hielo")
        made = _barcode(client, token, beer["id"], "ABC-123").json()
        res = client.delete(
            API + "/items/%s/barcodes/%s" % (ice["id"], made["id"]), headers=_auth(token)
        )
        assert res.status_code == 404
        assert _code_of(res) == "inventory_barcode_not_found"
        assert len(_by_name(client, token)["Cerveza"]["barcodes"]) == 1

    def test_a_race_past_the_check_still_ends_at_the_constraint(self, client, monkeypatch):
        """Two requests for one code at once: the check before the INSERT can
        miss the other one, and the UNIQUE catches it. Still a 409 with the
        name, not a 500 -- which is what the savepoint is for."""
        from app.routers import inventory as router_module

        token = _signup(client)
        beer = _item(client, token)
        ice = _item(client, token, name="Hielo")
        _barcode(client, token, beer["id"], "8410188012345")

        real = router_module._owner_of
        calls = []

        def blind_first(*args, **kwargs):
            calls.append(1)
            return None if len(calls) == 1 else real(*args, **kwargs)

        monkeypatch.setattr(router_module, "_owner_of", blind_first)
        res = _barcode(client, token, ice["id"], "08410188012345")
        assert res.status_code == 409
        assert res.json()["detail"]["params"] == {"product": "Cerveza"}
        assert len(calls) == 2

    def test_an_archived_product_keeps_its_codes(self, client):
        token = _signup(client)
        beer = _item(client, token)
        _barcode(client, token, beer["id"], "96385074")
        client.patch(API + "/items/%s" % beer["id"], json={"archived": True}, headers=_auth(token))
        [archived] = _items(client, token, include_archived=True)
        assert [b["key"] for b in archived["barcodes"]] == ["00000096385074"]
        other = _item(client, token, name="Otra")
        res = _barcode(client, token, other["id"], "96385074")
        assert res.status_code == 409
        assert res.json()["detail"]["params"] == {"product": "Cerveza"}


@skip_no_db
class TestCreatingWithCodes:
    def test_a_product_is_created_with_its_codes_in_the_order_given(self, client):
        token = _signup(client)
        made = _item(
            client,
            token,
            barcodes=[
                {"code": "8410188012345"},
                {"code": "18410188012342", "units_per_scan": 24, "label": "caja"},
                {"code": "SHELF-7"},
            ],
        )
        assert [b["code"] for b in made["barcodes"]] == [
            "8410188012345",
            "18410188012342",
            "SHELF-7",
        ]
        [listed] = _items(client, token)
        assert listed["barcodes"] == made["barcodes"]
        assert listed["barcodes"][1]["units_per_scan"] == 24

    def test_a_taken_code_creates_neither_the_product_nor_its_other_codes(self, client):
        token = _signup(client)
        beer = _item(client, token)
        _barcode(client, token, beer["id"], "036000291452")
        res = client.post(
            API + "/items",
            json={
                "name": "Cerveza sin",
                "barcodes": [{"code": "NEW-1"}, {"code": "0036000291452"}],
            },
            headers=_auth(token),
        )
        assert res.status_code == 409
        assert res.json()["detail"]["code"] == "inventory_barcode_taken"
        assert res.json()["detail"]["params"] == {"product": "Cerveza"}
        assert [i["name"] for i in _items(client, token)] == ["Cerveza"]
        # NEW-1 was not kept either: it is still free to give.
        assert _barcode(client, token, beer["id"], "NEW-1").status_code == 201

    def test_two_spellings_of_one_code_in_one_request_clash(self, client):
        token = _signup(client)
        res = client.post(
            API + "/items",
            json={
                "name": "Refresco",
                "barcodes": [{"code": "036000291452"}, {"code": "0036000291452"}],
            },
            headers=_auth(token),
        )
        assert res.status_code == 409
        assert res.json()["detail"]["params"] == {"product": "Refresco"}
        assert _items(client, token) == []

    def test_a_blank_code_creates_nothing(self, client):
        token = _signup(client)
        res = client.post(
            API + "/items",
            json={"name": "Refresco", "barcodes": [{"code": "123"}, {"code": " \t "}]},
            headers=_auth(token),
        )
        assert res.status_code == 422
        assert _code_of(res) == "inventory_barcode_invalid"
        assert _items(client, token) == []

    def test_more_than_twenty_codes_is_refused(self, client):
        token = _signup(client)
        res = client.post(
            API + "/items",
            json={"name": "X", "barcodes": [{"code": "C%d" % n} for n in range(21)]},
            headers=_auth(token),
        )
        assert res.status_code == 422


# --- What a product already has when it is added ---------------------------------


NOTE = "Existencias al darlo de alta"


def _receipts(client, token) -> list:
    res = client.get(API + "/receipts", headers=_auth(token))
    assert res.status_code == 200, res.text
    return res.json()


def _add(client, token, **fields):
    body = {"name": "Agua"}
    body.update(fields)
    return client.post(API + "/items", json=body, headers=_auth(token))


@skip_no_db
class TestWhatIsAlreadyOnTheShelf:
    """Max, 28-sep-2026: a product just added must not need a count. What it
    already has is said when it is added, and kept as an ENTRY -- a receipt --
    so the stock (last count + received - sold) starts from it."""

    def test_a_product_added_with_twelve_has_twelve_without_a_count(self, client):
        token = _signup(client)
        before = datetime.now(timezone.utc) - timedelta(seconds=5)
        res = _add(client, token, unit="botellas", initial_quantity=12, initial_note=NOTE)
        assert res.status_code == 201, res.text
        made = res.json()
        after = datetime.now(timezone.utc) + timedelta(seconds=5)

        # In the answer already, and on the list the same way.
        for product in (made, _by_name(client, token)["Agua"]):
            assert product["received_since_count"] == 12
            assert product["last_received_at"] is not None
            at = datetime.fromisoformat(product["last_received_at"].replace("Z", "+00:00"))
            assert before <= at <= after
            # It is NOT a count.
            assert product["last_quantity"] is None
            assert product["last_counted_at"] is None
            assert product["received_between_counts"] is None
        assert client.get(API + "/counts", headers=_auth(token)).json() == []

        # An entry like any other in the history: its note, one line of 12.
        [receipt] = _receipts(client, token)
        assert receipt["note"] == NOTE
        assert receipt["supplier"] is None
        assert receipt["line_count"] == 1
        assert receipt["total_quantity"] == 12
        detail = client.get(API + "/receipts/%s" % receipt["id"], headers=_auth(token)).json()
        assert detail["lines"] == [
            {
                "item_id": made["id"],
                "item_name": "Agua",
                "unit": "botellas",
                "category": None,
                "quantity": 12,
                "photo_url": None,
            }
        ]

    def test_without_it_no_entry_is_made(self, client):
        token = _signup(client)
        beer = _item(client, token)
        _received(client, token, [{"item_id": beer["id"], "quantity": 6}])
        made = _add(client, token).json()
        assert made["received_since_count"] == 0
        assert made["last_received_at"] is None
        assert len(_receipts(client, token)) == 1

    def test_a_note_alone_is_no_entry(self, client):
        token = _signup(client)
        for sent in ({"initial_note": NOTE}, {"initial_note": NOTE, "initial_quantity": None}):
            res = _add(client, token, name="Agua %d" % len(sent), **sent)
            assert res.status_code == 201, res.text
            assert res.json()["received_since_count"] == 0
        assert _receipts(client, token) == []

    @pytest.mark.parametrize("quantity", [0, -3, 0.0004])
    def test_nothing_or_less_is_refused_and_nothing_is_kept(self, client, quantity):
        token = _signup(client)
        res = _add(client, token, initial_quantity=quantity, initial_note=NOTE)
        assert res.status_code == 422
        assert _items(client, token) == []
        assert _receipts(client, token) == []

    def test_a_refused_code_keeps_neither_the_product_nor_what_it_had(self, client):
        # One transaction: the code is another product's, so the new product,
        # its codes and its entry all go.
        token = _signup(client)
        beer = _item(client, token)
        _barcode(client, token, beer["id"], "036000291452")
        _received(client, token, [{"item_id": beer["id"], "quantity": 24}])
        res = _add(
            client,
            token,
            barcodes=[{"code": "NEW-1"}, {"code": "0036000291452"}],
            initial_quantity=12,
            initial_note=NOTE,
        )
        assert res.status_code == 409
        assert _code_of(res) == "inventory_barcode_taken"
        assert [i["name"] for i in _items(client, token)] == ["Cerveza"]
        [kept] = _receipts(client, token)
        assert kept["total_quantity"] == 24
        assert kept["note"] is None
        # A blank code is refused the same way: nothing kept either.
        res = _add(client, token, barcodes=[{"code": " \t "}], initial_quantity=12)
        assert res.status_code == 422
        assert _code_of(res) == "inventory_barcode_invalid"
        assert [i["name"] for i in _items(client, token)] == ["Cerveza"]
        assert len(_receipts(client, token)) == 1

    def test_the_first_count_takes_over_from_it(self, client):
        # Counted after it was added, the count is what is on the shelf: the
        # entry is already in it, not on top of it.
        token = _signup(client)
        made = _add(client, token, initial_quantity=12, initial_note=NOTE).json()
        _count(client, token, [{"item_id": made["id"], "quantity": 10}])
        agua = _by_name(client, token)["Agua"]
        assert agua["last_quantity"] == 10
        assert agua["received_since_count"] == 0

    def test_a_sale_takes_from_what_it_started_with(self, client):
        # "Agua" on the menu takes "Agua" off the shelf by its name: 12 - 3.
        token = _signup(client)
        made = _add(
            client, token, unit="botellas", min_quantity=10, initial_quantity=12, initial_note=NOTE
        ).json()
        dish = _dish(client, token, _section(client, token, "Bebidas"), "Agua", 2)
        [alert] = _sale(client, token, [_line(dish, 3)])["stock_alerts"]
        assert (alert["item_id"], alert["on_hand"]) == (made["id"], 9.0)
        agua = _by_name(client, token)["Agua"]
        assert agua["received_since_count"] == 12
        assert agua["sold_since_count"] == 3
        assert agua["last_quantity"] is None


# --- Receipts -----------------------------------------------------------------


@skip_no_db
class TestReceipts:
    def test_a_delivery_is_recorded_and_read_back(self, client):
        token = _signup(client)
        beer = _item(client, token, unit="botellas", category="Bebida")
        ice = _item(client, token, name="Hielo", unit="bolsas", category="Bebida")
        made = _received(
            client,
            token,
            [{"item_id": ice["id"], "quantity": 5}, {"item_id": beer["id"], "quantity": 24}],
            received_at="2026-09-03T08:30:00Z",
            supplier=" Mahou ",
            note="  ",
        )
        assert made["supplier"] == "Mahou"
        assert made["note"] is None
        assert made["received_at"].startswith("2026-09-03T08:30:00")
        # Ordered like a count: by category, then name.
        assert made["lines"] == [
            {"item_id": beer["id"], "item_name": "Cerveza", "unit": "botellas", "category": "Bebida", "quantity": 24, "photo_url": None},
            {"item_id": ice["id"], "item_name": "Hielo", "unit": "bolsas", "category": "Bebida", "quantity": 5, "photo_url": None},
        ]
        detail = client.get(API + "/receipts/%s" % made["id"], headers=_auth(token))
        assert detail.status_code == 200
        assert detail.json() == made

    def test_the_history_is_newest_first_with_its_totals(self, client):
        token = _signup(client)
        beer = _item(client, token)
        ice = _item(client, token, name="Hielo")
        late = _received(
            client,
            token,
            [{"item_id": beer["id"], "quantity": 24}, {"item_id": ice["id"], "quantity": 2.5}],
            received_at="2026-09-10T10:00:00Z",
        )
        # Typed in afterwards, but received earlier: it goes below.
        early = _received(
            client, token, [{"item_id": beer["id"], "quantity": 6}], received_at="2026-09-01T10:00:00Z"
        )
        res = client.get(API + "/receipts", headers=_auth(token))
        assert res.status_code == 200
        assert [r["id"] for r in res.json()] == [late["id"], early["id"]]
        first = res.json()[0]
        assert first["line_count"] == 2
        assert first["total_quantity"] == 26.5
        assert first["supplier"] is None

    def test_received_now_when_no_moment_is_given(self, client):
        token = _signup(client)
        beer = _item(client, token)
        before = datetime.now(timezone.utc) - timedelta(seconds=5)
        made = _received(client, token, [{"item_id": beer["id"], "quantity": 1}])
        at = datetime.fromisoformat(made["received_at"].replace("Z", "+00:00"))
        assert before <= at <= datetime.now(timezone.utc) + timedelta(seconds=5)

    def test_deleting_a_delivery(self, client):
        token = _signup(client)
        beer = _item(client, token)
        made = _received(client, token, [{"item_id": beer["id"], "quantity": 12}])
        url = API + "/receipts/%s" % made["id"]
        assert client.delete(url, headers=_auth(token)).status_code == 204
        assert client.get(API + "/receipts", headers=_auth(token)).json() == []
        gone = client.get(url, headers=_auth(token))
        assert gone.status_code == 404
        assert _code_of(gone) == "inventory_receipt_not_found"
        assert client.delete(url, headers=_auth(token)).status_code == 404
        [listed] = _items(client, token)
        assert listed["received_since_count"] == 0
        assert listed["last_received_at"] is None

    def test_the_same_product_twice_is_refused(self, client):
        token = _signup(client)
        beer = _item(client, token)
        res = _receive(
            client,
            token,
            [{"item_id": beer["id"], "quantity": 1}, {"item_id": beer["id"], "quantity": 2}],
        )
        assert res.status_code == 422
        assert _code_of(res) == "inventory_receipt_duplicate_item"

    def test_nothing_received_is_not_a_delivery(self, client):
        token = _signup(client)
        beer = _item(client, token)
        assert _receive(client, token, []).status_code == 422
        assert _receive(client, token, [{"item_id": beer["id"], "quantity": 0}]).status_code == 422
        assert _receive(client, token, [{"item_id": beer["id"], "quantity": 0.0004}]).status_code == 422
        assert client.get(API + "/receipts", headers=_auth(token)).json() == []

    def test_an_archived_product_can_still_come_in(self, client):
        token = _signup(client)
        beer = _item(client, token)
        client.patch(API + "/items/%s" % beer["id"], json={"archived": True}, headers=_auth(token))
        assert _receive(client, token, [{"item_id": beer["id"], "quantity": 3}]).status_code == 201

    def test_an_unknown_product_refuses_the_whole_delivery(self, client):
        mine = _signup(client)
        theirs = _signup(client)
        beer = _item(client, mine)
        their_beer = _item(client, theirs)
        res = _receive(
            client,
            mine,
            [{"item_id": beer["id"], "quantity": 1}, {"item_id": their_beer["id"], "quantity": 1}],
        )
        assert res.status_code == 404
        assert _code_of(res) == "inventory_item_not_found"
        assert client.get(API + "/receipts", headers=_auth(mine)).json() == []


# --- The stock: counts and deliveries together ----------------------------------


@skip_no_db
class TestStock:
    def test_a_realistic_fortnight(self, client):
        """Count 10, a delivery of 24, count 20, a delivery of 12.

        On the shelf now: 20 + 12 = 32. Went between the counts: 10 + 24 - 20
        = 14. Read off the counts alone, as before, it would have said the
        stock went UP by ten.
        """
        token = _signup(client)
        beer = _item(client, token)
        line = lambda q: [{"item_id": beer["id"], "quantity": q}]  # noqa: E731
        _count(client, token, line(10), counted_at="2026-09-01T10:00:00Z")
        _received(client, token, line(24), received_at="2026-09-03T08:00:00Z")
        _count(client, token, line(20), counted_at="2026-09-08T10:00:00Z")
        _received(client, token, line(12), received_at="2026-09-10T08:00:00Z")

        [listed] = _items(client, token)
        assert listed["last_quantity"] == 20
        assert listed["previous_quantity"] == 10
        assert listed["last_counted_at"].startswith("2026-09-08T10:00:00")
        assert listed["previous_counted_at"].startswith("2026-09-01T10:00:00")
        assert listed["received_between_counts"] == 24
        assert listed["received_since_count"] == 12
        assert listed["last_received_at"].startswith("2026-09-10T08:00:00")

    def test_a_product_never_counted_shows_everything_it_received(self, client):
        token = _signup(client)
        beer = _item(client, token)
        _received(client, token, [{"item_id": beer["id"], "quantity": 6}], received_at="2026-09-01T10:00:00Z")
        _received(client, token, [{"item_id": beer["id"], "quantity": 4.5}], received_at="2026-09-05T10:00:00Z")
        [listed] = _items(client, token)
        assert listed["last_quantity"] is None
        assert listed["received_since_count"] == 10.5
        assert listed["received_between_counts"] is None
        assert listed["last_received_at"].startswith("2026-09-05")

    def test_a_delivery_at_the_instant_of_a_count_is_in_that_count(self, client):
        token = _signup(client)
        beer = _item(client, token)
        line = lambda q: [{"item_id": beer["id"], "quantity": q}]  # noqa: E731
        _count(client, token, line(5), counted_at="2026-09-01T10:00:00Z")
        _received(client, token, line(24), received_at="2026-09-08T10:00:00Z")
        _count(client, token, line(29), counted_at="2026-09-08T10:00:00Z")
        [listed] = _items(client, token)
        assert listed["received_since_count"] == 0
        assert listed["received_between_counts"] == 24

    def test_a_delivery_at_the_instant_of_the_previous_count_is_not_between(self, client):
        # The other edge of (previous, last]: at the previous count it was
        # already on the shelf, so it belongs to that count and not after it.
        token = _signup(client)
        beer = _item(client, token)
        line = lambda q: [{"item_id": beer["id"], "quantity": q}]  # noqa: E731
        _received(client, token, line(24), received_at="2026-09-01T10:00:00Z")
        _count(client, token, line(30), counted_at="2026-09-01T10:00:00Z")
        _count(client, token, line(20), counted_at="2026-09-08T10:00:00Z")
        [listed] = _items(client, token)
        assert listed["received_between_counts"] == 0
        assert listed["received_since_count"] == 0

    def test_counted_once_there_is_no_between(self, client):
        token = _signup(client)
        beer = _item(client, token)
        line = lambda q: [{"item_id": beer["id"], "quantity": q}]  # noqa: E731
        _received(client, token, line(7), received_at="2026-08-30T10:00:00Z")
        _count(client, token, line(10), counted_at="2026-09-01T10:00:00Z")
        _received(client, token, line(3), received_at="2026-09-02T10:00:00Z")
        [listed] = _items(client, token)
        assert listed["previous_counted_at"] is None
        assert listed["received_between_counts"] is None
        # Before the only count: already in it. After: since.
        assert listed["received_since_count"] == 3

    def test_two_counts_and_no_delivery_is_zero_between_not_null(self, client):
        token = _signup(client)
        beer = _item(client, token)
        line = lambda q: [{"item_id": beer["id"], "quantity": q}]  # noqa: E731
        _count(client, token, line(10), counted_at="2026-09-01T10:00:00Z")
        _count(client, token, line(4), counted_at="2026-09-08T10:00:00Z")
        [listed] = _items(client, token)
        assert listed["received_between_counts"] == 0
        assert listed["received_since_count"] == 0
        assert listed["last_received_at"] is None

    def test_deliveries_older_than_the_previous_count_are_in_neither_window(self, client):
        token = _signup(client)
        beer = _item(client, token)
        line = lambda q: [{"item_id": beer["id"], "quantity": q}]  # noqa: E731
        _received(client, token, line(100), received_at="2026-08-01T10:00:00Z")
        _count(client, token, line(10), counted_at="2026-09-01T10:00:00Z")
        _count(client, token, line(8), counted_at="2026-09-08T10:00:00Z")
        [listed] = _items(client, token)
        assert listed["received_between_counts"] == 0
        assert listed["received_since_count"] == 0
        assert listed["last_received_at"].startswith("2026-08-01")

    def test_each_product_is_measured_against_its_own_counts(self, client):
        # One delivery, two products, counted on different days: the same
        # receipt is "between" for one and "since" for the other.
        token = _signup(client)
        beer = _item(client, token)
        ice = _item(client, token, name="Hielo")
        _count(client, token, [{"item_id": beer["id"], "quantity": 1}, {"item_id": ice["id"], "quantity": 1}], counted_at="2026-09-01T10:00:00Z")
        _received(
            client,
            token,
            [{"item_id": beer["id"], "quantity": 24}, {"item_id": ice["id"], "quantity": 10}],
            received_at="2026-09-03T10:00:00Z",
        )
        _count(client, token, [{"item_id": beer["id"], "quantity": 20}], counted_at="2026-09-05T10:00:00Z")
        by_name = _by_name(client, token)
        assert by_name["Cerveza"]["received_between_counts"] == 24
        assert by_name["Cerveza"]["received_since_count"] == 0
        assert by_name["Hielo"]["received_between_counts"] is None
        assert by_name["Hielo"]["received_since_count"] == 10

    def test_a_product_that_never_moved(self, client):
        token = _signup(client)
        _item(client, token)
        [listed] = _items(client, token)
        assert listed["received_since_count"] == 0
        assert listed["received_between_counts"] is None
        assert listed["previous_counted_at"] is None
        assert listed["last_received_at"] is None
        assert listed["barcodes"] == []

    def test_the_list_costs_the_same_for_one_product_as_for_six(self, client):
        """No query per product: the sums and the codes are one read each."""
        from app.db import app_engine

        def statements_for(token) -> int:
            seen = []

            def count(*_args):
                seen.append(1)

            event.listen(app_engine, "before_cursor_execute", count)
            try:
                _items(client, token)
            finally:
                event.remove(app_engine, "before_cursor_execute", count)
            return len(seen)

        def furnish(token, n):
            ids = [_item(client, token, name="P%d" % i)["id"] for i in range(n)]
            for i, item_id in enumerate(ids):
                _barcode(client, token, item_id, "CODE-%d" % i)
            lines = [{"item_id": i, "quantity": 1} for i in ids]
            _count(client, token, lines, counted_at="2026-09-01T10:00:00Z")
            _received(client, token, lines, received_at="2026-09-02T10:00:00Z")
            _count(client, token, lines, counted_at="2026-09-03T10:00:00Z")
            _received(client, token, lines, received_at="2026-09-04T10:00:00Z")

        one, six = _signup(client), _signup(client)
        furnish(one, 1)
        furnish(six, 6)
        assert statements_for(one) == statements_for(six)


# --- Isolation and who may -------------------------------------------------------


@skip_no_db
class TestIsolation:
    def test_another_business_cannot_see_or_touch_your_deliveries(self, client):
        mine = _signup(client)
        theirs = _signup(client)
        beer = _item(client, mine)
        made = _received(client, mine, [{"item_id": beer["id"], "quantity": 3}])
        url = API + "/receipts/%s" % made["id"]

        assert client.get(API + "/receipts", headers=_auth(theirs)).json() == []
        assert client.get(url, headers=_auth(theirs)).status_code == 404
        assert client.delete(url, headers=_auth(theirs)).status_code == 404
        # Still there for its owner.
        assert client.get(url, headers=_auth(mine)).status_code == 200

    def test_another_business_cannot_see_or_touch_your_codes(self, client):
        mine = _signup(client)
        theirs = _signup(client)
        beer = _item(client, mine)
        code = _barcode(client, mine, beer["id"], "8410188012345").json()

        res = _barcode(client, theirs, beer["id"], "X-1")
        assert res.status_code == 404
        assert _code_of(res) == "inventory_item_not_found"
        res = client.delete(
            API + "/items/%s/barcodes/%s" % (beer["id"], code["id"]), headers=_auth(theirs)
        )
        assert res.status_code == 404
        assert _code_of(res) == "inventory_item_not_found"
        # Through a product of their own, the code is simply not there.
        their_item = _item(client, theirs)
        res = client.delete(
            API + "/items/%s/barcodes/%s" % (their_item["id"], code["id"]), headers=_auth(theirs)
        )
        assert res.status_code == 404
        assert _code_of(res) == "inventory_barcode_not_found"
        assert len(_items(client, mine)[0]["barcodes"]) == 1

    def test_the_new_tables_are_behind_row_level_security(self):
        from app.db import AdminSessionLocal

        db = AdminSessionLocal()
        try:
            rows = db.execute(
                text(
                    "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity, "
                    "EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid "
                    "AND p.polname = 'org_isolation') "
                    "FROM pg_class c WHERE c.relname IN "
                    "('inventory_barcode', 'inventory_receipt', 'inventory_receipt_line')"
                )
            ).all()
        finally:
            db.close()
        assert sorted(r[0] for r in rows) == [
            "inventory_barcode",
            "inventory_receipt",
            "inventory_receipt_line",
        ]
        assert all(r[1] and r[2] and r[3] for r in rows)

    def test_the_runtime_role_sees_only_its_own_rows(self, client):
        """Below the API: RLS itself, with the WHERE taken away."""
        from app.db import AdminSessionLocal, AppSessionLocal, set_current_org
        from app.security import decode_access_token

        mine = _signup(client)
        theirs = _signup(client)
        beer = _item(client, mine)
        _barcode(client, mine, beer["id"], "8410188012345")
        _received(client, mine, [{"item_id": beer["id"], "quantity": 3}])
        their_org = decode_access_token(theirs)["org_id"]
        my_org = decode_access_token(mine)["org_id"]

        admin = AdminSessionLocal()
        try:
            for table in ("inventory_barcode", "inventory_receipt", "inventory_receipt_line"):
                assert admin.execute(
                    text("SELECT count(*) FROM %s WHERE org_id = :o" % table), {"o": my_org}
                ).scalar() == 1, table
        finally:
            admin.close()

        db = AppSessionLocal()
        try:
            set_current_org(db, their_org)
            for table in ("inventory_barcode", "inventory_receipt", "inventory_receipt_line"):
                assert db.execute(text("SELECT count(*) FROM %s" % table)).scalar() == 0, table
                assert (
                    db.execute(
                        text("DELETE FROM %s WHERE org_id = :o" % table), {"o": my_org}
                    ).rowcount
                    == 0
                ), table
            db.rollback()
        finally:
            db.close()


@skip_no_db
class TestManagersOnly:
    """Since 28-sep-2026 (app/access.py) an employee takes a delivery in and
    reads the stock and its deliveries; creating a product, touching its
    barcodes and deleting a delivery are still the manager's."""

    def test_an_employee_receives_but_does_not_edit_products(self, client):
        manager = _signup(client)
        staff, _email = _staff(client, manager)
        beer = _item(client, manager)
        code = _barcode(client, manager, beer["id"], "8410188012345").json()
        made = _received(client, manager, [{"item_id": beer["id"], "quantity": 1}])
        h = _auth(staff)

        def refused(res) -> bool:
            return (res.status_code, _code_of(res)) == (403, "manager_role_required")

        assert client.get(API + "/items", headers=h).status_code == 200
        assert refused(
            client.post(API + "/items", json={"name": "X", "barcodes": [{"code": "1"}]}, headers=h)
        )
        assert refused(_barcode(client, staff, beer["id"], "X-1"))
        assert refused(
            client.delete(API + "/items/%s/barcodes/%s" % (beer["id"], code["id"]), headers=h)
        )
        assert client.get(API + "/receipts", headers=h).status_code == 200
        assert client.get(API + "/receipts/%s" % made["id"], headers=h).status_code == 200
        theirs = _receive(client, staff, [{"item_id": beer["id"], "quantity": 1}])
        assert theirs.status_code == 201, theirs.text
        assert refused(client.delete(API + "/receipts/%s" % made["id"], headers=h))
        # What the employee may not do was not done: both deliveries are
        # there, the product has its one code and no new product was made.
        assert len(client.get(API + "/receipts", headers=_auth(manager)).json()) == 2
        [listed] = _items(client, manager)
        assert len(listed["barcodes"]) == 1

    def test_every_inventory_route_declares_its_permission(self):
        """Who may is app/access.py's table; tests/test_access_roles.py
        checks which permission each route asks for."""
        from app.routers import inventory as router_module

        for route in router_module.router.routes:
            perms = [
                d.call.permission
                for d in route.dependant.dependencies
                if hasattr(d.call, "permission")
            ]
            assert len(perms) == 1, route.path


@skip_no_db
class TestDates:
    """A count is "the last" because of its date, and a delivery counts on top
    of the stock for as long as it is after the last count -- so a date typed
    decades ahead is not a harmless typo, and one decades back is a 500 when
    the driver reads it back."""

    @pytest.mark.parametrize(
        "when",
        ["2062-09-03T08:30:00Z", "1999-12-31T23:00:00Z", "0001-01-01T00:00:00+14:00"],
    )
    def test_a_date_out_of_range_is_refused_with_its_code(self, client, when):
        token = _signup(client)
        beer = _item(client, token)
        line = [{"item_id": beer["id"], "quantity": 1}]
        res = _receive(client, token, line, received_at=when)
        assert res.status_code == 422
        assert _code_of(res) == "inventory_date_out_of_range"
        res = client.post(
            API + "/counts", json={"lines": line, "counted_at": when}, headers=_auth(token)
        )
        assert res.status_code == 422
        assert _code_of(res) == "inventory_date_out_of_range"
        assert client.get(API + "/receipts", headers=_auth(token)).json() == []

    def test_a_clock_a_few_hours_ahead_is_still_fine(self, client):
        token = _signup(client)
        beer = _item(client, token)
        soon = (datetime.now(timezone.utc) + timedelta(hours=5)).isoformat()
        made = _received(client, token, [{"item_id": beer["id"], "quantity": 1}], received_at=soon)
        assert made["lines"][0]["quantity"] == 1
        # And a date with no zone is read as UTC, not refused or crashed on.
        _count(client, token, [{"item_id": beer["id"], "quantity": 3}], counted_at="2026-09-01T10:00:00")


@skip_no_db
class TestSavingTwice:
    """The phone makes up a `client_ref` once per scanning session. A save the
    server kept but whose answer never arrived is sent again with the same one,
    and must not receive the same lorry twice."""

    def test_a_save_sent_again_gets_the_receipt_that_was_kept(self, client):
        token = _signup(client)
        beer = _item(client, token)
        ice = _item(client, token, name="Hielo")
        ref = str(uuid.uuid4())
        first = _receive(client, token, [{"item_id": beer["id"], "quantity": 24}], client_ref=ref)
        assert first.status_code == 201, first.text
        # The retry carries what was scanned since as well; the answer is the
        # receipt as it was KEPT, and the phone works out the rest from it.
        again = _receive(
            client,
            token,
            [{"item_id": beer["id"], "quantity": 30}, {"item_id": ice["id"], "quantity": 5}],
            client_ref=ref,
        )
        assert again.status_code == 200
        assert again.json() == first.json()
        assert len(client.get(API + "/receipts", headers=_auth(token)).json()) == 1
        by_name = _by_name(client, token)
        assert by_name["Cerveza"]["received_since_count"] == 24
        assert by_name["Hielo"]["received_since_count"] == 0

    def test_a_repeat_is_answered_before_the_request_is_judged(self, client):
        # A retry is a question about the first request: a second copy that
        # would be refused on its own is still answered with what was kept.
        token = _signup(client)
        beer = _item(client, token)
        ref = str(uuid.uuid4())
        first = _received(client, token, [{"item_id": beer["id"], "quantity": 1}], client_ref=ref)
        again = _receive(
            client,
            token,
            [{"item_id": beer["id"], "quantity": 1}, {"item_id": beer["id"], "quantity": 2}],
            client_ref=ref,
        )
        assert again.status_code == 200
        assert again.json()["id"] == first["id"]

    def test_without_a_ref_every_save_is_a_new_receipt(self, client):
        token = _signup(client)
        beer = _item(client, token)
        line = [{"item_id": beer["id"], "quantity": 1}]
        assert _receive(client, token, line).status_code == 201
        assert _receive(client, token, line).status_code == 201
        assert len(client.get(API + "/receipts", headers=_auth(token)).json()) == 2

    def test_a_ref_belongs_to_one_business(self, client):
        # Two businesses may happen to send the same ref; neither is told about
        # the other's receipt, and each keeps its own.
        mine = _signup(client)
        theirs = _signup(client)
        ref = str(uuid.uuid4())
        my_beer = _item(client, mine)
        their_beer = _item(client, theirs)
        kept = _received(client, mine, [{"item_id": my_beer["id"], "quantity": 24}], client_ref=ref)
        res = _receive(client, theirs, [{"item_id": their_beer["id"], "quantity": 6}], client_ref=ref)
        assert res.status_code == 201
        assert res.json()["id"] != kept["id"]
        assert res.json()["lines"][0]["item_id"] == their_beer["id"]
        assert [r["id"] for r in client.get(API + "/receipts", headers=_auth(theirs)).json()] == [
            res.json()["id"]
        ]
        assert client.get(API + "/receipts/%s" % kept["id"], headers=_auth(theirs)).status_code == 404
        # And the first business's repeat still finds its own.
        again = _receive(client, mine, [{"item_id": my_beer["id"], "quantity": 24}], client_ref=ref)
        assert again.status_code == 200
        assert again.json() == kept

    def test_two_saves_at_once_with_one_ref_make_one_receipt(self, client, monkeypatch):
        """Both miss the lookup; the second meets UNIQUE (org_id, client_ref)
        at the INSERT, and answers with the first one's receipt -- a 200, not a
        500 and not a second receipt. That is what the savepoint is for."""
        from app.routers import inventory as router_module

        token = _signup(client)
        beer = _item(client, token)
        ref = str(uuid.uuid4())
        first = _received(client, token, [{"item_id": beer["id"], "quantity": 24}], client_ref=ref)

        real = router_module._receipt_by_ref
        calls = []

        def blind_first(*args, **kwargs):
            calls.append(1)
            return None if len(calls) == 1 else real(*args, **kwargs)

        monkeypatch.setattr(router_module, "_receipt_by_ref", blind_first)
        res = _receive(client, token, [{"item_id": beer["id"], "quantity": 99}], client_ref=ref)
        assert res.status_code == 200
        assert res.json() == first
        assert len(calls) == 2
        assert len(client.get(API + "/receipts", headers=_auth(token)).json()) == 1
        assert _items(client, token)[0]["received_since_count"] == 24
