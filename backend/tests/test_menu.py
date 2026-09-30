"""The menu: sections and dishes, written by the manager and read by the team.

Needs a database: these go through the API as a manager, as an employee and
as another business.
"""

import uuid

import pytest
from sqlalchemy import text

from app.schemas import limits
from app.schemas.menu import ALLERGENS
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    _employee_token,
    _signup,
    client,
    skip_no_db,
)

MENU = "/api/v1/menu"


def _manager(client) -> str:
    token, _org = _signup(client, "Menu Co")
    return token


def _menu(client, token) -> dict:
    res = client.get(MENU, headers=_auth(token))
    assert res.status_code == 200, res.text
    return res.json()


def _section(client, token, name="Entrantes") -> dict:
    res = client.post(MENU + "/sections", json={"name": name}, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()


def _post_dish(client, token, section_id, **fields):
    body = {"section_id": section_id, "name": "Croquetas"}
    body.update(fields)
    return client.post(MENU + "/dishes", json=body, headers=_auth(token))


def _dish(client, token, section_id, **fields) -> dict:
    res = _post_dish(client, token, section_id, **fields)
    assert res.status_code == 201, res.text
    return res.json()


def _patch_dish(client, token, dish_id, body):
    return client.patch(MENU + "/dishes/%s" % dish_id, json=body, headers=_auth(token))


def _names(menu: dict) -> list:
    return [(s["name"], [d["name"] for d in s["dishes"]]) for s in menu["sections"]]


def _code(res) -> str:
    return res.json()["detail"]["code"]


def _org_of(client, token) -> str:
    return client.get("/api/v1/auth/me", headers=_auth(token)).json()["org_id"]


def _as_admin(sql: str, params: dict) -> None:
    from app.db import AdminSessionLocal

    db = AdminSessionLocal()
    try:
        db.execute(text(sql), params)
        db.commit()
    finally:
        db.close()


# --- Reading ----------------------------------------------------------------


@skip_no_db
class TestTheShape:
    def test_an_empty_menu_is_an_empty_list_of_sections(self, client):
        assert _menu(client, _manager(client)) == {"sections": []}

    def test_the_menu_as_the_frontend_reads_it(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(
            client,
            token,
            section["id"],
            description="De jamón",
            price=8.5,
            allergens=["milk", "gluten"],
        )
        assert _menu(client, token) == {
            "sections": [
                {
                    "id": section["id"],
                    "name": "Entrantes",
                    "position": 0,
                    "dishes": [
                        {
                            "id": dish["id"],
                            "section_id": section["id"],
                            "name": "Croquetas",
                            "description": "De jamón",
                            "price": 8.5,
                            "allergens": ["gluten", "milk"],
                            "available": True,
                            "position": 0,
                            # No photo: tests/test_menu_photos.py.
                            "photo_url": None,
                            "photo_labelled": False,
                        }
                    ],
                }
            ]
        }


# --- Sections -----------------------------------------------------------------


@skip_no_db
class TestSections:
    def test_a_new_section_is_empty_and_goes_to_the_end(self, client):
        token = _manager(client)
        first = _section(client, token, "Entrantes")
        second = _section(client, token, "Principales")
        assert first["dishes"] == [] and first["position"] == 0
        assert second["position"] == 1
        assert _names(_menu(client, token)) == [("Entrantes", []), ("Principales", [])]

    def test_a_name_is_trimmed_and_a_nul_dropped(self, client):
        token = _manager(client)
        assert _section(client, token, "  Postres\x00 ")["name"] == "Postres"

    @pytest.mark.parametrize("name", ["", "   ", "\x00", "x" * 81])
    def test_a_blank_or_long_name_is_refused(self, client, name):
        token = _manager(client)
        res = client.post(MENU + "/sections", json={"name": name}, headers=_auth(token))
        assert res.status_code == 422

    def test_eighty_characters_with_spaces_around_them_are_eighty(self, client):
        token = _manager(client)
        assert _section(client, token, " %s " % ("x" * 80))["name"] == "x" * 80

    def test_renaming(self, client):
        token = _manager(client)
        section = _section(client, token)
        _dish(client, token, section["id"])
        res = client.patch(
            MENU + "/sections/%s" % section["id"],
            json={"name": "Para picar"},
            headers=_auth(token),
        )
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "Para picar"
        # Answered with its dishes, like every section the API sends.
        assert [d["name"] for d in res.json()["dishes"]] == ["Croquetas"]

    def test_renaming_to_blank_is_refused(self, client):
        token = _manager(client)
        section = _section(client, token)
        res = client.patch(
            MENU + "/sections/%s" % section["id"], json={"name": " "}, headers=_auth(token)
        )
        assert res.status_code == 422

    def test_deleting_a_section_takes_its_dishes(self, client):
        token = _manager(client)
        doomed = _section(client, token, "Entrantes")
        kept = _section(client, token, "Postres")
        dish = _dish(client, token, doomed["id"])
        _dish(client, token, kept["id"], name="Flan")
        res = client.delete(MENU + "/sections/%s" % doomed["id"], headers=_auth(token))
        assert res.status_code == 204
        assert _names(_menu(client, token)) == [("Postres", ["Flan"])]
        assert _patch_dish(client, token, dish["id"], {"name": "x"}).status_code == 404

    def test_an_unknown_section_is_not_found(self, client):
        token = _manager(client)
        missing = str(uuid.uuid4())
        res = client.delete(MENU + "/sections/%s" % missing, headers=_auth(token))
        assert res.status_code == 404
        assert _code(res) == "menu_section_not_found"
        res = client.patch(
            MENU + "/sections/%s" % missing, json={"name": "x"}, headers=_auth(token)
        )
        assert _code(res) == "menu_section_not_found"

    def test_the_ceiling(self, client):
        token = _manager(client)
        _as_admin(
            "INSERT INTO menu_section (org_id, name, position) "
            "SELECT :org, 'S' || n, n FROM generate_series(1, :n) AS n",
            {"org": _org_of(client, token), "n": limits.MENU_SECTIONS},
        )
        res = client.post(MENU + "/sections", json={"name": "Una más"}, headers=_auth(token))
        assert res.status_code == 422
        assert _code(res) == "menu_too_many"
        assert res.json()["detail"]["params"] == {
            "what": "sections",
            "limit": limits.MENU_SECTIONS,
        }

    def test_a_double_click_at_the_ceiling_does_not_pass_it(self, client):
        # Without the per-business lock, a dozen adds at 49 each counted 49
        # and six of them got in: 55 sections, one past the wall the reorder
        # is held to as well.
        import threading

        token = _manager(client)
        _as_admin(
            "INSERT INTO menu_section (org_id, name, position) "
            "SELECT :org, 'S' || n, n FROM generate_series(1, :n) AS n",
            {"org": _org_of(client, token), "n": limits.MENU_SECTIONS - 1},
        )
        start = threading.Barrier(12)
        codes = []

        def add(i):
            start.wait()
            res = client.post(
                MENU + "/sections", json={"name": "R%d" % i}, headers=_auth(token)
            )
            codes.append(res.status_code)

        threads = [threading.Thread(target=add, args=(i,)) for i in range(12)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert sorted(codes) == [201] + [422] * 11
        ids = [s["id"] for s in _menu(client, token)["sections"]]
        assert len(ids) == limits.MENU_SECTIONS
        res = client.put(
            MENU + "/sections/order", json={"ids": ids[::-1]}, headers=_auth(token)
        )
        assert res.status_code == 200, res.text


@skip_no_db
class TestSectionOrder:
    def _three(self, client, token):
        return [_section(client, token, n)["id"] for n in ("A", "B", "C")]

    def _order(self, client, token, ids):
        return client.put(
            MENU + "/sections/order", json={"ids": ids}, headers=_auth(token)
        )

    def test_reordering_answers_with_the_whole_menu(self, client):
        token = _manager(client)
        a, b, c = self._three(client, token)
        res = self._order(client, token, [c, a, b])
        assert res.status_code == 200, res.text
        assert [s["name"] for s in res.json()["sections"]] == ["C", "A", "B"]
        assert [s["position"] for s in res.json()["sections"]] == [0, 1, 2]
        assert [s["name"] for s in _menu(client, token)["sections"]] == ["C", "A", "B"]

    def test_a_new_section_still_goes_to_the_end_after_a_reorder(self, client):
        token = _manager(client)
        a, b, c = self._three(client, token)
        self._order(client, token, [c, b, a])
        _section(client, token, "D")
        assert [s["name"] for s in _menu(client, token)["sections"]] == [
            "C",
            "B",
            "A",
            "D",
        ]

    @pytest.mark.parametrize(
        "which",
        ["missing", "extra", "repeated", "empty"],
    )
    def test_anything_but_exactly_the_sections_is_refused(self, client, which):
        token = _manager(client)
        a, b, c = self._three(client, token)
        ids = {
            "missing": [a, b],
            "extra": [a, b, c, str(uuid.uuid4())],
            "repeated": [a, b, c, a],
            "empty": [],
        }[which]
        res = self._order(client, token, ids)
        assert res.status_code == 422
        assert _code(res) == "menu_order_mismatch"
        # And nothing moved.
        assert [s["name"] for s in _menu(client, token)["sections"]] == ["A", "B", "C"]

    def test_an_empty_menu_reorders_to_an_empty_menu(self, client):
        token = _manager(client)
        res = self._order(client, token, [])
        assert res.status_code == 200
        assert res.json() == {"sections": []}


# --- Dishes -------------------------------------------------------------------


@skip_no_db
class TestDishes:
    def test_a_dish_with_nothing_but_a_name(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"])
        assert dish["description"] is None
        assert dish["price"] is None
        assert dish["allergens"] == []
        assert dish["available"] is True
        assert dish["position"] == 0

    def test_a_new_dish_goes_to_the_end_of_its_section(self, client):
        token = _manager(client)
        section = _section(client, token)
        other = _section(client, token, "Postres")
        _dish(client, token, section["id"], name="Uno")
        _dish(client, token, other["id"], name="Flan")
        assert _dish(client, token, section["id"], name="Dos")["position"] == 1
        assert _names(_menu(client, token)) == [
            ("Entrantes", ["Uno", "Dos"]),
            ("Postres", ["Flan"]),
        ]

    def test_blank_text_is_not_said(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"], name=" Bravas ", description="  ")
        assert dish["name"] == "Bravas"
        assert dish["description"] is None

    @pytest.mark.parametrize(
        "fields",
        [
            {"name": "  "},
            {"name": "x" * 121},
            {"description": "x" * 501},
            {"price": -0.01},
            {"price": 100000},
            # Rounds to 100000.00, which numeric(8, 2) cannot hold under the
            # ceiling: refused as sent, not as an overflow on the way in.
            {"price": 99999.996},
            {"allergens": ["gluten", "bacon"]},
            {"allergens": ["Gluten"]},
        ],
    )
    def test_refused(self, client, fields):
        token = _manager(client)
        section = _section(client, token)
        assert _post_dish(client, token, section["id"], **fields).status_code == 422

    @pytest.mark.parametrize(
        "sent, stored",
        [
            (0, 0),
            (12.5, 12.5),
            (12.345, 12.35),
            # The float nearest 2.675 is a hair under it; the price is still
            # rounded as the manager wrote it.
            (2.675, 2.68),
            (99999.99, 99999.99),
            (99999.994, 99999.99),
        ],
    )
    def test_a_price_is_kept_to_the_cent(self, client, sent, stored):
        token = _manager(client)
        section = _section(client, token)
        assert _dish(client, token, section["id"], price=sent)["price"] == stored
        [listed] = _menu(client, token)["sections"][0]["dishes"]
        assert listed["price"] == stored

    def test_allergens_are_kept_once_and_in_the_legal_order(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(
            client,
            token,
            section["id"],
            allergens=["molluscs", "gluten", "milk", "gluten", "molluscs"],
        )
        assert dish["allergens"] == ["gluten", "milk", "molluscs"]

    def test_all_fourteen_allergens_are_known(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"], allergens=list(reversed(ALLERGENS)))
        assert dish["allergens"] == list(ALLERGENS)
        assert len(ALLERGENS) == 14

    def test_a_sold_out_dish_is_still_on_the_menu(self, client):
        token = _manager(client)
        section = _section(client, token)
        _dish(client, token, section["id"], available=False)
        [listed] = _menu(client, token)["sections"][0]["dishes"]
        assert listed["available"] is False

    def test_a_section_that_is_not_there_is_not_found(self, client):
        token = _manager(client)
        res = _post_dish(client, token, str(uuid.uuid4()))
        assert res.status_code == 404
        assert _code(res) == "menu_section_not_found"

    def test_the_ceiling_counts_the_whole_menu(self, client):
        token = _manager(client)
        first = _section(client, token)
        second = _section(client, token, "Postres")
        _as_admin(
            "INSERT INTO menu_dish (org_id, section_id, name, position) "
            "SELECT :org, :section, 'D' || n, n FROM generate_series(1, :n) AS n",
            {
                "org": _org_of(client, token),
                "section": first["id"],
                "n": limits.MENU_DISHES,
            },
        )
        # In another section: the wall is per business, not per section.
        res = _post_dish(client, token, second["id"])
        assert res.status_code == 422
        assert _code(res) == "menu_too_many"
        assert res.json()["detail"]["params"] == {
            "what": "dishes",
            "limit": limits.MENU_DISHES,
        }

    def test_deleting_a_dish(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"])
        res = client.delete(MENU + "/dishes/%s" % dish["id"], headers=_auth(token))
        assert res.status_code == 204
        assert _names(_menu(client, token)) == [("Entrantes", [])]
        res = client.delete(MENU + "/dishes/%s" % dish["id"], headers=_auth(token))
        assert res.status_code == 404
        assert _code(res) == "menu_dish_not_found"


@skip_no_db
class TestEditingADish:
    def test_only_what_is_sent_is_changed(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(
            client,
            token,
            section["id"],
            description="Caseras",
            price=9,
            allergens=["gluten"],
        )
        res = _patch_dish(client, token, dish["id"], {"available": False})
        assert res.status_code == 200, res.text
        edited = res.json()
        assert edited["available"] is False
        assert edited["name"] == "Croquetas"
        assert edited["description"] == "Caseras"
        assert edited["price"] == 9
        assert edited["allergens"] == ["gluten"]

    def test_null_clears_the_price_and_the_description(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"], description="Caseras", price=9)
        edited = _patch_dish(
            client, token, dish["id"], {"price": None, "description": None}
        ).json()
        assert edited["price"] is None
        assert edited["description"] is None

    def test_null_leaves_what_cannot_be_empty(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"], allergens=["eggs"])
        edited = _patch_dish(
            client,
            token,
            dish["id"],
            {"name": None, "allergens": None, "available": None, "section_id": None},
        ).json()
        assert edited["name"] == "Croquetas"
        assert edited["allergens"] == ["eggs"]
        assert edited["available"] is True
        assert edited["section_id"] == section["id"]

    def test_an_empty_list_clears_the_allergens(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"], allergens=["eggs"])
        assert _patch_dish(client, token, dish["id"], {"allergens": []}).json()[
            "allergens"
        ] == []

    @pytest.mark.parametrize(
        "body",
        [{"name": ""}, {"price": -1}, {"allergens": ["bacon"]}, {"description": "x" * 501}],
    )
    def test_the_same_rules_as_creating(self, client, body):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"])
        assert _patch_dish(client, token, dish["id"], body).status_code == 422

    def test_moving_a_dish_puts_it_at_the_end_of_the_other_section(self, client):
        token = _manager(client)
        starters = _section(client, token)
        mains = _section(client, token, "Principales")
        moving = _dish(client, token, starters["id"], name="Bravas")
        _dish(client, token, mains["id"], name="Pulpo")
        _dish(client, token, mains["id"], name="Chuletón")
        res = _patch_dish(client, token, moving["id"], {"section_id": mains["id"]})
        assert res.status_code == 200, res.text
        assert res.json()["section_id"] == mains["id"]
        assert res.json()["position"] == 2
        assert _names(_menu(client, token)) == [
            ("Entrantes", []),
            ("Principales", ["Pulpo", "Chuletón", "Bravas"]),
        ]

    def test_sending_its_own_section_does_not_move_it(self, client):
        token = _manager(client)
        section = _section(client, token)
        first = _dish(client, token, section["id"], name="Uno")
        _dish(client, token, section["id"], name="Dos")
        res = _patch_dish(client, token, first["id"], {"section_id": section["id"]})
        assert res.json()["position"] == 0
        assert _names(_menu(client, token)) == [("Entrantes", ["Uno", "Dos"])]

    def test_moving_to_a_section_that_is_not_there_is_not_found(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section["id"])
        res = _patch_dish(client, token, dish["id"], {"section_id": str(uuid.uuid4())})
        assert res.status_code == 404
        assert _code(res) == "menu_section_not_found"


@skip_no_db
class TestDishOrder:
    def _order(self, client, token, section_id, ids):
        return client.put(
            MENU + "/sections/%s/dishes/order" % section_id,
            json={"ids": ids},
            headers=_auth(token),
        )

    def test_reordering_a_section(self, client):
        token = _manager(client)
        section = _section(client, token)
        a, b, c = (_dish(client, token, section["id"], name=n)["id"] for n in "ABC")
        res = self._order(client, token, section["id"], [b, c, a])
        assert res.status_code == 200, res.text
        [only] = res.json()["sections"]
        assert [d["name"] for d in only["dishes"]] == ["B", "C", "A"]
        assert [d["position"] for d in only["dishes"]] == [0, 1, 2]
        assert _names(_menu(client, token)) == [("Entrantes", ["B", "C", "A"])]

    def test_a_dish_of_another_section_is_a_mismatch(self, client):
        token = _manager(client)
        section = _section(client, token)
        other = _section(client, token, "Postres")
        a = _dish(client, token, section["id"], name="A")["id"]
        stray = _dish(client, token, other["id"], name="Flan")["id"]
        res = self._order(client, token, section["id"], [a, stray])
        assert res.status_code == 422
        assert _code(res) == "menu_order_mismatch"

    @pytest.mark.parametrize("which", ["missing", "repeated"])
    def test_anything_but_exactly_the_dishes_is_refused(self, client, which):
        token = _manager(client)
        section = _section(client, token)
        a, b = (_dish(client, token, section["id"], name=n)["id"] for n in "AB")
        ids = {"missing": [b], "repeated": [b, a, b]}[which]
        res = self._order(client, token, section["id"], ids)
        assert res.status_code == 422
        assert _code(res) == "menu_order_mismatch"
        assert _names(_menu(client, token)) == [("Entrantes", ["A", "B"])]

    def test_a_section_that_is_not_there_is_not_found(self, client):
        token = _manager(client)
        res = self._order(client, token, str(uuid.uuid4()), [])
        assert res.status_code == 404
        assert _code(res) == "menu_section_not_found"


# --- Who may do what ------------------------------------------------------------


@skip_no_db
class TestTheTeam:
    def _staff(self, client):
        manager = _manager(client)
        employee = _add(client, manager, "Ana")
        return manager, _employee_token(client, manager, employee["id"])

    def test_an_employee_reads_the_menu(self, client):
        manager, staff = self._staff(client)
        section = _section(client, manager)
        _dish(client, manager, section["id"], available=False, allergens=["fish"])
        assert _menu(client, staff) == _menu(client, manager)

    def test_an_employee_cannot_change_it(self, client):
        manager, staff = self._staff(client)
        section = _section(client, manager)
        dish = _dish(client, manager, section["id"])
        head = _auth(staff)
        attempts = [
            client.post(MENU + "/sections", json={"name": "Mía"}, headers=head),
            client.patch(
                MENU + "/sections/%s" % section["id"], json={"name": "Mía"}, headers=head
            ),
            client.delete(MENU + "/sections/%s" % section["id"], headers=head),
            client.put(
                MENU + "/sections/order", json={"ids": [section["id"]]}, headers=head
            ),
            client.post(
                MENU + "/dishes",
                json={"section_id": section["id"], "name": "Mío"},
                headers=head,
            ),
            client.patch(
                MENU + "/dishes/%s" % dish["id"], json={"available": False}, headers=head
            ),
            client.delete(MENU + "/dishes/%s" % dish["id"], headers=head),
            client.put(
                MENU + "/sections/%s/dishes/order" % section["id"],
                json={"ids": [dish["id"]]},
                headers=head,
            ),
        ]
        for res in attempts:
            assert res.status_code == 403, res.request.url
            assert _code(res) == "manager_role_required"
        assert _names(_menu(client, manager)) == [("Entrantes", ["Croquetas"])]
        [listed] = _menu(client, manager)["sections"][0]["dishes"]
        assert listed["available"] is True

    def test_nobody_signed_out_reads_it(self, client):
        assert client.get(MENU).status_code in (401, 403)

    def test_every_route_but_the_menu_itself_asks_for_a_manager(self):
        """Reading is `menu.view`, the whole team's; everything else --
        `available` included -- is `menu.edit`, the manager's alone
        (app/access.py)."""
        from app.access import MANAGER_ONLY, Perm
        from app.routers import menu as router_module

        assert Perm.MENU_EDIT in MANAGER_ONLY and Perm.MENU_VIEW not in MANAGER_ONLY
        for route in router_module.router.routes:
            perms = [
                d.call.permission
                for d in route.dependant.dependencies
                if hasattr(d.call, "permission")
            ]
            if route.methods == {"GET"}:
                assert perms == [Perm.MENU_VIEW], route.path
            else:
                assert perms == [Perm.MENU_EDIT], (route.path, route.methods)


# --- Another business --------------------------------------------------------------


@skip_no_db
class TestAnotherBusiness:
    def test_cannot_see_or_touch_your_menu(self, client):
        mine = _manager(client)
        theirs = _manager(client)
        section = _section(client, mine)
        dish = _dish(client, mine, section["id"])
        head = _auth(theirs)

        assert _menu(client, theirs) == {"sections": []}

        for res, code in [
            (
                client.patch(
                    MENU + "/sections/%s" % section["id"], json={"name": "Suya"}, headers=head
                ),
                "menu_section_not_found",
            ),
            (
                client.delete(MENU + "/sections/%s" % section["id"], headers=head),
                "menu_section_not_found",
            ),
            (
                client.put(
                    MENU + "/sections/%s/dishes/order" % section["id"],
                    json={"ids": [dish["id"]]},
                    headers=head,
                ),
                "menu_section_not_found",
            ),
            (
                _post_dish(client, theirs, section["id"]),
                "menu_section_not_found",
            ),
            (
                _patch_dish(client, theirs, dish["id"], {"name": "Suyo"}),
                "menu_dish_not_found",
            ),
            (
                client.delete(MENU + "/dishes/%s" % dish["id"], headers=head),
                "menu_dish_not_found",
            ),
        ]:
            assert res.status_code == 404, res.request.url
            assert _code(res) == code

        # Your section is not theirs to reorder into their menu either.
        res = client.put(
            MENU + "/sections/order", json={"ids": [section["id"]]}, headers=head
        )
        assert res.status_code == 422
        assert _code(res) == "menu_order_mismatch"

        assert _names(_menu(client, mine)) == [("Entrantes", ["Croquetas"])]

    def test_cannot_move_a_dish_into_your_section(self, client):
        mine = _manager(client)
        theirs = _manager(client)
        my_section = _section(client, mine)
        their_section = _section(client, theirs)
        their_dish = _dish(client, theirs, their_section["id"])
        res = _patch_dish(client, theirs, their_dish["id"], {"section_id": my_section["id"]})
        assert res.status_code == 404
        assert _code(res) == "menu_section_not_found"
        assert _names(_menu(client, mine)) == [("Entrantes", [])]

    def test_both_tables_are_behind_row_level_security(self):
        from app.db import AdminSessionLocal

        db = AdminSessionLocal()
        try:
            rows = db.execute(
                text(
                    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname IN ('menu_section', 'menu_dish')"
                )
            ).all()
        finally:
            db.close()
        assert sorted(r[0] for r in rows) == ["menu_dish", "menu_section"]
        assert all(r[1] and r[2] for r in rows)

    def test_the_database_refuses_a_dish_under_a_neighbours_section(self, client):
        """The second barrier, with the API taken out of the picture.

        As the runtime role, in A's context, a dish that is A's own -- so
        `org_isolation` lets it through -- filed under B's section. A plain
        foreign key on section_id would take it: it is checked past row-level
        security, and B's section exists. The key on (section_id, org_id) is
        what refuses it.
        """
        from sqlalchemy.exc import IntegrityError

        from app.db import app_engine

        mine = _manager(client)
        theirs = _manager(client)
        their_section = _section(client, theirs)
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
                            "INSERT INTO menu_dish (org_id, section_id, name) "
                            "VALUES (:org, :section, 'Planted')"
                        ),
                        {"org": my_org, "section": their_section["id"]},
                    )
        assert "menu_dish_section_id_org_id_fkey" in str(refused.value)
        assert _names(_menu(client, theirs)) == [("Entrantes", [])]
