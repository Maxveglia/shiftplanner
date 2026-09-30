"""Casa Demo's menu, loaded from the photo of its till (migration 0037).

The migration runs once per database, on a database where no business is
filed under `casa-demo` yet in every test run, so its `load` is imported and
run here against businesses the tests file there. What is pinned: the menu
the photo showed, in its sections and order; the four products without a
price are loaded but not for sale; a second run adds nothing; a menu the
manager has started is added to, not overwritten; and no other business is
touched.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from sqlalchemy import text

from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _auth,
    _signup,
    client,
    skip_no_db,
)

MENU = "/api/v1/menu"
MIGRATION = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0037_casa_demo_menu.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("migration_0037", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _file_under(org_id, client_key: str) -> None:
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE organization SET client_key = :key WHERE id = :org"),
            {"key": client_key, "org": str(org_id)},
        )


def _load() -> int:
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        return _migration().load(conn)


def _crispy(client) -> str:
    """A business filed under `casa-demo`, alone there: the ones earlier
    tests filed are moved out first, as the real folder holds one business."""
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE organization SET client_key = NULL WHERE client_key = 'casa-demo'")
        )
    token, org = _signup(client, "Casa Demo")
    _file_under(org, "casa-demo")
    return token


def _menu(client, token) -> list:
    resp = client.get(MENU, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return resp.json()["sections"]


def _flat(sections) -> list:
    return [
        (s["name"], d["name"], d["price"], d["available"])
        for s in sections
        for d in s["dishes"]
    ]


@skip_no_db
class TestCasaDemoMenu:
    def test_the_photo_becomes_the_menu(self, client):
        token = _crispy(client)
        assert _load() == 20
        sections = _menu(client, token)
        assert [s["name"] for s in sections] == ["Crispy", "Combos", "Ensaladas", "Bebidas"]
        flat = _flat(sections)
        assert len(flat) == 20
        # The sixteen with a price, for sale at it.
        priced = [(dish, price) for _, dish, price, available in flat if available]
        assert len(priced) == 16
        assert ("Crispy Grande", 10.0) in priced
        assert ("Combo Crispy XL", 15.0) in priced
        assert ("Crispy Smash", 3.5) in priced
        assert ("Agua", 1.0) in priced
        # The four the photo gave no price: there, but not sold at a price
        # nobody gave.
        unpriced = sorted(dish for _, dish, price, available in flat if not available)
        assert unpriced == [
            "Crispy Ahumado",
            "Crispy Wrap",
            "El del Puerto",
            "Ensalada Casa Demo",
        ]
        assert all(price is None for _, _, price, available in flat if not available)
        # In the order written, within each section.
        crispy = sections[0]["dishes"]
        assert [d["name"] for d in crispy[:3]] == ["Crispy Pequeño", "Crispy Grande", "Crispy XL"]
        assert [d["position"] for d in crispy] == list(range(len(crispy)))
        wrap = next(d for d in crispy if d["name"] == "Crispy Wrap")
        assert wrap["description"] == "2 variantes"

    def test_a_second_run_adds_nothing(self, client):
        token = _crispy(client)
        assert _load() == 20
        before = _flat(_menu(client, token))
        assert _load() == 0
        assert _flat(_menu(client, token)) == before

    def test_a_menu_already_started_is_added_to_not_overwritten(self, client):
        token = _crispy(client)
        # The manager wrote two things before the load: a section of their
        # own, with the water at their price, and an empty "Bebidas".
        own = client.post(MENU + "/sections", json={"name": "Lo de siempre"}, headers=_auth(token))
        assert own.status_code == 201, own.text
        water = client.post(
            MENU + "/dishes",
            json={"section_id": own.json()["id"], "name": "  agua ", "price": 1.2},
            headers=_auth(token),
        )
        assert water.status_code == 201, water.text
        drinks = client.post(MENU + "/sections", json={"name": "BEBIDAS"}, headers=_auth(token))
        assert drinks.status_code == 201, drinks.text

        assert _load() == 19
        sections = _menu(client, token)
        names = [s["name"] for s in sections]
        # Theirs first, as they left them; "Bebidas" found, not made twice.
        assert names == ["Lo de siempre", "BEBIDAS", "Crispy", "Combos", "Ensaladas"]
        flat = _flat(sections)
        waters = [(s, d, p) for s, d, p, _ in flat if d.strip().lower() == "agua"]
        assert waters == [("Lo de siempre", "agua", 1.2)]
        assert [d for s, d, _, _ in flat if s == "BEBIDAS"] == ["Caprisun", "Coca-Cola"]

    def test_no_other_business_is_touched(self, client):
        _crispy(client)
        other_token, _other = _signup(client, "Otro Bar")
        _load()
        assert _menu(client, other_token) == []
