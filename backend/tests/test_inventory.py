"""The stock: products, and the counts taken of them.

Needs a database: these go through the API as a manager.
"""

import pytest
from sqlalchemy import text

from tests.test_business_profile import (  # noqa: F401 - fixtures by name
    _auth,
    _signup,
    client,
    skip_no_db,
)


def _item(client, token, **fields) -> dict:
    body = {"name": "Cerveza"}
    body.update(fields)
    res = client.post("/api/v1/inventory/items", json=body, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()


def _count(client, token, lines, **fields):
    body = {"lines": lines}
    body.update(fields)
    return client.post("/api/v1/inventory/counts", json=body, headers=_auth(token))


def _items(client, token, **params) -> list:
    res = client.get("/api/v1/inventory/items", params=params, headers=_auth(token))
    assert res.status_code == 200, res.text
    return res.json()


@skip_no_db
class TestProducts:
    def test_a_new_product_has_never_been_counted(self, client):
        token = _signup(client)
        made = _item(client, token, unit="botellas", category="Bebida", min_quantity=24)
        assert made["name"] == "Cerveza"
        assert made["unit"] == "botellas"
        assert made["min_quantity"] == 24
        [listed] = _items(client, token)
        assert listed["id"] == made["id"]
        assert listed["last_quantity"] is None
        assert listed["last_counted_at"] is None

    def test_blank_text_is_stored_as_not_said(self, client):
        token = _signup(client)
        made = _item(client, token, name="  Hielo ", unit="  ", category="")
        assert made["name"] == "Hielo"
        assert made["unit"] is None
        assert made["category"] is None

    def test_a_blank_name_is_refused(self, client):
        token = _signup(client)
        res = client.post(
            "/api/v1/inventory/items", json={"name": "   "}, headers=_auth(token)
        )
        assert res.status_code == 422

    def test_editing_changes_only_what_is_sent(self, client):
        token = _signup(client)
        made = _item(client, token, unit="botellas", min_quantity=10)
        res = client.patch(
            "/api/v1/inventory/items/%s" % made["id"],
            json={"min_quantity": None},
            headers=_auth(token),
        )
        assert res.status_code == 200
        assert res.json()["min_quantity"] is None
        assert res.json()["unit"] == "botellas"

    def test_archiving_takes_it_off_the_list_and_restoring_brings_it_back(self, client):
        token = _signup(client)
        made = _item(client, token)
        url = "/api/v1/inventory/items/%s" % made["id"]
        client.patch(url, json={"archived": True}, headers=_auth(token))
        assert _items(client, token) == []
        [archived] = _items(client, token, include_archived=True)
        assert archived["archived_at"] is not None
        client.patch(url, json={"archived": False}, headers=_auth(token))
        [back] = _items(client, token)
        assert back["archived_at"] is None


@skip_no_db
class TestCounts:
    def test_the_list_shows_the_last_count_and_the_one_before(self, client):
        token = _signup(client)
        beer = _item(client, token)
        ice = _item(client, token, name="Hielo")
        assert _count(
            client,
            token,
            [{"item_id": beer["id"], "quantity": 48}, {"item_id": ice["id"], "quantity": 5}],
            counted_at="2026-09-01T10:00:00Z",
        ).status_code == 201
        assert _count(
            client,
            token,
            [{"item_id": beer["id"], "quantity": 30.5}],
            counted_at="2026-09-08T10:00:00Z",
        ).status_code == 201
        by_name = {i["name"]: i for i in _items(client, token)}
        assert by_name["Cerveza"]["last_quantity"] == 30.5
        assert by_name["Cerveza"]["previous_quantity"] == 48
        assert by_name["Cerveza"]["last_counted_at"].startswith("2026-09-08")
        # Not counted the second time: its last count is still the first one.
        assert by_name["Hielo"]["last_quantity"] == 5
        assert by_name["Hielo"]["previous_quantity"] is None

    def test_a_count_typed_in_late_does_not_pass_for_the_latest(self, client):
        # Ordered by when it was counted, not by when it was saved.
        token = _signup(client)
        beer = _item(client, token)
        _count(client, token, [{"item_id": beer["id"], "quantity": 10}], counted_at="2026-09-10T10:00:00Z")
        _count(client, token, [{"item_id": beer["id"], "quantity": 99}], counted_at="2026-09-01T10:00:00Z")
        [listed] = _items(client, token)
        assert listed["last_quantity"] == 10
        assert listed["previous_quantity"] == 99

    def test_history_and_detail(self, client):
        token = _signup(client)
        beer = _item(client, token, unit="botellas")
        made = _count(
            client, token, [{"item_id": beer["id"], "quantity": 12}], note=" cierre "
        ).json()
        assert made["note"] == "cierre"
        res = client.get("/api/v1/inventory/counts", headers=_auth(token))
        [summary] = res.json()
        assert summary["id"] == made["id"]
        assert summary["line_count"] == 1
        detail = client.get(
            "/api/v1/inventory/counts/%s" % made["id"], headers=_auth(token)
        ).json()
        assert detail["lines"] == [
            {
                "item_id": beer["id"],
                "item_name": "Cerveza",
                "unit": "botellas",
                "category": None,
                "quantity": 12,
                "photo_url": None,
            }
        ]

    def test_deleting_a_count_forgets_its_quantities(self, client):
        token = _signup(client)
        beer = _item(client, token)
        made = _count(client, token, [{"item_id": beer["id"], "quantity": 12}]).json()
        res = client.delete(
            "/api/v1/inventory/counts/%s" % made["id"], headers=_auth(token)
        )
        assert res.status_code == 204
        [listed] = _items(client, token)
        assert listed["last_quantity"] is None
        assert client.get("/api/v1/inventory/counts", headers=_auth(token)).json() == []

    def test_an_empty_count_is_refused(self, client):
        token = _signup(client)
        assert _count(client, token, []).status_code == 422

    def test_a_negative_quantity_is_refused(self, client):
        token = _signup(client)
        beer = _item(client, token)
        assert _count(client, token, [{"item_id": beer["id"], "quantity": -1}]).status_code == 422

    def test_the_same_product_twice_is_refused(self, client):
        token = _signup(client)
        beer = _item(client, token)
        res = _count(
            client,
            token,
            [{"item_id": beer["id"], "quantity": 1}, {"item_id": beer["id"], "quantity": 2}],
        )
        assert res.status_code == 422
        assert res.json()["detail"]["code"] == "inventory_count_duplicate_item"


@skip_no_db
class TestIsolation:
    def test_another_business_cannot_see_or_count_your_products(self, client):
        mine = _signup(client)
        theirs = _signup(client)
        beer = _item(client, mine)
        made = _count(client, mine, [{"item_id": beer["id"], "quantity": 3}]).json()

        assert _items(client, theirs) == []
        assert client.get("/api/v1/inventory/counts", headers=_auth(theirs)).json() == []
        assert (
            client.get("/api/v1/inventory/counts/%s" % made["id"], headers=_auth(theirs)).status_code
            == 404
        )
        assert (
            client.delete("/api/v1/inventory/counts/%s" % made["id"], headers=_auth(theirs)).status_code
            == 404
        )
        assert (
            client.patch(
                "/api/v1/inventory/items/%s" % beer["id"],
                json={"name": "Mía"},
                headers=_auth(theirs),
            ).status_code
            == 404
        )
        res = _count(client, theirs, [{"item_id": beer["id"], "quantity": 1}])
        assert res.status_code == 404
        assert res.json()["detail"]["code"] == "inventory_item_not_found"

    def test_every_inventory_table_is_behind_row_level_security(self):
        from app.db import AdminSessionLocal

        db = AdminSessionLocal()
        try:
            rows = db.execute(
                text(
                    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname IN ('inventory_item', 'inventory_count', 'inventory_count_line')"
                )
            ).all()
        finally:
            db.close()
        assert sorted(r[0] for r in rows) == [
            "inventory_count",
            "inventory_count_line",
            "inventory_item",
        ]
        assert all(r[1] and r[2] for r in rows)
