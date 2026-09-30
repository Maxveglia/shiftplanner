"""Roles and access: the manager, the team, and the till's tablet.

Max, 28-sep-2026 (app/access.py is the table, routers/access.py the window):

* THE GUARD. Every route of Inventario and Tienda declares exactly one guard
  -- `get_current_manager` or `require_permission(...)` -- and the permission
  this file's table says. A route added without being classified here fails.
* THE SWEEP. Every one of those routes, asked by a manager, an employee and a
  tablet with no body and made-up ids: what the role may not do is 403 with
  the right code (so the guard ran before the body was read), and what it
  may do is anything but 403.
* THE TABLET: no Turnos, charges at the till, voids, reads the statistics,
  types nothing in by hand; its token lasts ten years and a new password ends
  it.
* THE TEAM: counts, receives, reads suppliers and recipes; creates and edits
  nothing else.
* THE WINDOW (/access): the manager's alone, one business's alone, addresses
  unique in any case, at most 20 tablets.
* THE DATABASE: the roles and "a tablet is nobody" are CHECKs, not manners.
* LEAVING THE TEAM: taken off the roster, a person's login goes with them;
  one left behind before that (or linked to nobody) opens nothing, and the
  window lists it for the manager to delete.
* THE TILL IS THE TILL: whoever may not type a sale in by hand charges dishes
  of the menu, at the menu's prices, today -- "source": "till" is not a way
  around it. The manager is held to none of it.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.access import (
    MANAGER_ONLY,
    Perm,
    Role,
    apps_for,
    can,
    permissions_for,
    require_permission,
)
from app.clients import APP_KEYS
from app.security import create_access_token, decode_access_token, hash_password
from app.services.business_time import business_day
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    _signup,
    client,
    skip_no_db,
)

API = "/api/v1"
PASSWORD = "s3cret-pass"
MANAGER = "get_current_manager"

# Every route of the two shops, and what it asks for. The source of truth is
# app/access.py; this is the same table written from the other side, so that
# moving a route from one permission to another takes changing both.
EXPECTED = {
    ("GET", "/inventory/items"): Perm.INVENTORY_VIEW,
    ("POST", "/inventory/items"): Perm.INVENTORY_PRODUCTS,
    ("PATCH", "/inventory/items/{item_id}"): Perm.INVENTORY_PRODUCTS,
    ("POST", "/inventory/items/{item_id}/barcodes"): Perm.INVENTORY_PRODUCTS,
    ("DELETE", "/inventory/items/{item_id}/barcodes/{barcode_id}"): Perm.INVENTORY_PRODUCTS,
    ("PUT", "/inventory/items/{item_id}/photo"): Perm.INVENTORY_PRODUCTS,
    ("DELETE", "/inventory/items/{item_id}/photo"): Perm.INVENTORY_PRODUCTS,
    ("GET", "/inventory/counts"): Perm.INVENTORY_VIEW,
    ("GET", "/inventory/counts/{count_id}"): Perm.INVENTORY_VIEW,
    ("POST", "/inventory/counts"): Perm.INVENTORY_COUNT,
    ("DELETE", "/inventory/counts/{count_id}"): Perm.INVENTORY_RECORDS_DELETE,
    ("GET", "/inventory/receipts"): Perm.INVENTORY_VIEW,
    ("GET", "/inventory/receipts/{receipt_id}"): Perm.INVENTORY_VIEW,
    ("POST", "/inventory/receipts"): Perm.INVENTORY_RECEIVE,
    ("DELETE", "/inventory/receipts/{receipt_id}"): Perm.INVENTORY_RECORDS_DELETE,
    ("GET", "/inventory/suppliers"): Perm.INVENTORY_VIEW,
    ("POST", "/inventory/suppliers"): Perm.INVENTORY_SUPPLIERS,
    ("PATCH", "/inventory/suppliers/{supplier_id}"): Perm.INVENTORY_SUPPLIERS,
    ("DELETE", "/inventory/suppliers/{supplier_id}"): Perm.INVENTORY_SUPPLIERS,
    ("GET", "/menu"): Perm.MENU_VIEW,
    ("PUT", "/menu/sections/order"): Perm.MENU_EDIT,
    ("POST", "/menu/sections"): Perm.MENU_EDIT,
    ("PATCH", "/menu/sections/{section_id}"): Perm.MENU_EDIT,
    ("DELETE", "/menu/sections/{section_id}"): Perm.MENU_EDIT,
    ("PUT", "/menu/sections/{section_id}/dishes/order"): Perm.MENU_EDIT,
    ("POST", "/menu/dishes"): Perm.MENU_EDIT,
    ("PATCH", "/menu/dishes/{dish_id}"): Perm.MENU_EDIT,
    ("DELETE", "/menu/dishes/{dish_id}"): Perm.MENU_EDIT,
    ("PUT", "/menu/dishes/{dish_id}/photo"): Perm.MENU_EDIT,
    ("DELETE", "/menu/dishes/{dish_id}/photo"): Perm.MENU_EDIT,
    # The till's; a sale typed in by hand is checked inside (store.sales.manual).
    ("POST", "/store/sales"): Perm.STORE_CHARGE,
    ("GET", "/store/sales"): Perm.STORE_SALES_VIEW,
    ("GET", "/store/sales/{sale_id}"): Perm.STORE_SALES_VIEW,
    ("POST", "/store/sales/{sale_id}/void"): Perm.STORE_SALES_VOID,
    ("GET", "/store/stats"): Perm.STORE_STATS,
    ("GET", "/store/recipes"): Perm.STORE_RECIPES_VIEW,
    ("PUT", "/store/recipes/{dish_id}"): Perm.STORE_RECIPES_EDIT,
}

# The window, core and the manager's.
ACCESS_ROUTES = {
    ("GET", "/access"): Perm.ACCESS_MANAGE,
    ("POST", "/access/stores"): Perm.ACCESS_MANAGE,
    ("PUT", "/access/stores/{account_id}/password"): Perm.ACCESS_MANAGE,
    ("DELETE", "/access/stores/{account_id}"): Perm.ACCESS_MANAGE,
    ("DELETE", "/access/accounts/{account_id}"): Perm.ACCESS_MANAGE,
}


# --- The table ---------------------------------------------------------------------


class TestTheTable:
    def test_the_manager_may_do_everything_in_order(self):
        assert permissions_for("manager") == [p.value for p in Perm]
        assert permissions_for(Role.manager) == permissions_for("manager")

    def test_the_team_and_the_tablet_may_do_the_same(self):
        team = [
            "inventory.view",
            "inventory.count",
            "inventory.receive",
            "menu.view",
            "store.charge",
            "store.sales.view",
            "store.sales.void",
            "store.stats",
            "store.recipes.view",
        ]
        assert permissions_for("employee") == team
        assert permissions_for("store") == team

    def test_what_only_the_manager_has(self):
        assert MANAGER_ONLY == {
            Perm.INVENTORY_PRODUCTS,
            Perm.INVENTORY_RECORDS_DELETE,
            Perm.INVENTORY_SUPPLIERS,
            Perm.MENU_EDIT,
            Perm.STORE_SALES_MANUAL,
            Perm.STORE_STATS_FULL,
            Perm.STORE_RECIPES_EDIT,
            Perm.ACCESS_MANAGE,
        }

    def test_an_unknown_role_may_do_nothing(self):
        assert permissions_for("boss") == []

    def test_the_tablet_has_no_turnos(self):
        assert apps_for("store", ["shifts", "inventory", "store"]) == ["inventory", "store"]
        for role in ("manager", "employee"):
            assert apps_for(role, list(APP_KEYS)) == list(APP_KEYS)
        # In the profile's order, whatever it is.
        assert apps_for("store", ["store", "shifts", "inventory"]) == ["store", "inventory"]

    def test_a_permission_the_team_has_and_the_tablet_does_not_is_role_not_allowed(
        self, monkeypatch
    ):
        """No such permission today; the code path is checked with the table
        changed under it, since `can` reads the table at call time."""
        from fastapi import HTTPException

        from app import access
        from app.schemas.auth import UserOut

        monkeypatch.setitem(
            access._GRANTED, "store", access._GRANTED["store"] - {Perm.STORE_STATS}
        )
        tablet = UserOut(
            id=uuid.uuid4(),
            email="t@example.com",
            full_name="Barra",
            role="store",
            org_id=uuid.uuid4(),
            org_name="X",
            apps=["inventory", "store"],
            preparing=False,
            permissions=[],
        )
        assert not can(tablet, Perm.STORE_STATS)
        with pytest.raises(HTTPException) as refused:
            require_permission(Perm.STORE_STATS)(current_user=tablet)
        assert refused.value.status_code == 403
        assert refused.value.detail["code"] == "role_not_allowed"
        with pytest.raises(HTTPException) as refused:
            require_permission(Perm.MENU_EDIT)(current_user=tablet)
        assert refused.value.detail["code"] == "manager_role_required"


# --- The guard ---------------------------------------------------------------------


def _guards(route) -> list:
    found = []
    for dep in route.dependant.dependencies:
        if getattr(dep.call, "permission", None) is not None:
            found.append(dep.call.permission)
        elif dep.call.__name__ == MANAGER:
            found.append(MANAGER)
    return found


def _declared(app_keys) -> dict:
    from app.main import ROUTERS

    declared = {}
    for module, key in ROUTERS:
        if key not in app_keys:
            continue
        for route in module.router.routes:
            for method in route.methods:
                declared[(method, route.path)] = _guards(route)
    return declared


class TestGuard:
    def test_every_route_of_the_shops_declares_one_guard_the_one_in_the_table(self):
        declared = _declared({"inventory", "store"})
        problems = []
        for where, guards in sorted(declared.items()):
            if len(guards) != 1:
                problems.append("%s %s: %d guards %s" % (where + (len(guards), guards)))
            elif where not in EXPECTED:
                problems.append(
                    "%s %s: not in this file's table -- say who may (app/access.py)" % where
                )
            elif guards[0] != EXPECTED[where]:
                problems.append("%s %s: asks for %s, the table says %s" % (where + (guards[0], EXPECTED[where])))
        for where in sorted(set(EXPECTED) - set(declared)):
            problems.append("%s %s: in the table, but no such route" % where)
        assert not problems, "\n".join(problems)

    def test_the_window_is_the_managers(self):
        from app.routers import access as router_module

        declared = {
            (method, route.path): _guards(route)
            for route in router_module.router.routes
            for method in route.methods
        }
        assert declared == {where: [perm] for where, perm in ACCESS_ROUTES.items()}

    def test_the_guard_sees_the_routes(self):
        """A guard on the guard: a walk that finds nothing passes everything."""
        assert len(_declared({"inventory", "store"})) == len(EXPECTED) > 30


# --- Who is who --------------------------------------------------------------------


def _login(client, email, password=PASSWORD):
    return client.post(API + "/auth/login", json={"email": email, "password": password})


def _logged_in(client, email, password=PASSWORD) -> dict:
    res = _login(client, email, password)
    assert res.status_code == 200, res.text
    return res.json()


def _staff(client, manager_token, name="Ana") -> dict:
    """An employee with a login: {employee, email, token}."""
    employee = _add(client, manager_token, name)
    email = "staff+%s@example.com" % uuid.uuid4().hex[:8]
    res = client.post(
        API + "/employees/%s/account" % employee["id"],
        headers=_auth(manager_token),
        json={"email": email, "password": PASSWORD},
    )
    assert res.status_code == 201, res.text
    return {"employee": employee, "email": email, "token": _logged_in(client, email)["access_token"]}


def _new_store(client, manager_token, name="Barra", email=None, password=PASSWORD):
    return client.post(
        API + "/access/stores",
        json={
            "name": name,
            "email": email or "tienda+%s@example.com" % uuid.uuid4().hex[:8],
            "password": password,
        },
        headers=_auth(manager_token),
    )


def _store(client, manager_token, **fields) -> dict:
    """A tablet: {account, email, token}."""
    res = _new_store(client, manager_token, **fields)
    assert res.status_code == 201, res.text
    account = res.json()
    return {
        "account": account,
        "email": account["email"],
        "token": _logged_in(client, account["email"], fields.get("password", PASSWORD))[
            "access_token"
        ],
    }


def _code(res) -> str:
    return res.json()["detail"]["code"]


@pytest.fixture(scope="module")
def crew(client):
    """One business with all three: its manager, an employee, a tablet."""
    manager, org_id = _signup(client, "Roles Co")
    return {
        "org_id": org_id,
        "manager": manager,
        "employee": _staff(client, manager),
        "store": _store(client, manager),
    }


def _url(path: str) -> str:
    out = path
    while "{" in out:
        start, end = out.index("{"), out.index("}")
        out = out[:start] + str(uuid.uuid4()) + out[end + 1 :]
    return API + out


# --- The sweep ---------------------------------------------------------------------


@skip_no_db
class TestTheSweep:
    """No body and made-up ids: a refusal that comes back with the role's
    code was decided before the body was read -- a 422 would say otherwise."""

    @pytest.mark.parametrize("role", ["manager", "employee", "store"])
    def test_every_route_answers_as_the_table_says(self, client, crew, role):
        token = crew[role] if role == "manager" else crew[role]["token"]
        granted = set(permissions_for(role))
        wrong = []
        for (method, path), perm in sorted({**EXPECTED, **ACCESS_ROUTES}.items()):
            res = client.request(method, _url(path), headers=_auth(token))
            if perm.value in granted:
                if res.status_code == 403:
                    wrong.append("%s %s: refused %s" % (method, path, res.text[:120]))
            else:
                code = "manager_role_required" if perm in MANAGER_ONLY else "role_not_allowed"
                if res.status_code != 403 or _code(res) != code:
                    wrong.append(
                        "%s %s: %s %s, wanted 403 %s"
                        % (method, path, res.status_code, res.text[:120], code)
                    )
        assert not wrong, "\n".join(wrong)


# --- The tablet ---------------------------------------------------------------------


def _dish(client, token, name="Croquetas", price=9.5) -> dict:
    section = client.post(API + "/menu/sections", json={"name": "Carta"}, headers=_auth(token))
    assert section.status_code == 201, section.text
    dish = client.post(
        API + "/menu/dishes",
        json={"section_id": section.json()["id"], "name": name, "price": price},
        headers=_auth(token),
    )
    assert dish.status_code == 201, dish.text
    return dish.json()


def _today() -> date:
    """Today in the business's calendar, the one the till's day is checked
    against (routers/store.py)."""
    return business_day(datetime.now(timezone.utc))


def _sale_body(dish, source="till", **fields) -> dict:
    body = {
        "sold_on": _today().isoformat(),
        "client_ref": str(uuid.uuid4()),
        "source": source,
        "lines": [
            {"dish_id": dish["id"], "name": dish["name"], "unit_price": dish["price"], "quantity": 1}
        ],
    }
    if source == "till":
        body["payment_method"] = "card"
    body.update(fields)
    return body


@skip_no_db
class TestTheTablet:
    def test_it_is_told_it_has_no_turnos_everywhere(self, client, crew):
        tablet = crew["store"]
        session = _logged_in(client, tablet["email"])["user"]
        assert session["role"] == "store"
        assert session["apps"] == ["inventory", "store"]
        assert session["permissions"] == permissions_for("store")
        assert session["employee_id"] is None
        headers = _auth(tablet["token"])
        me = client.get(API + "/auth/me", headers=headers).json()
        assert (me["apps"], me["permissions"]) == (session["apps"], session["permissions"])
        workspace = client.get(API + "/workspace", headers=headers).json()
        assert workspace == {
            "apps": ["inventory", "store"],
            "preparing": False,
            "role": "store",
            "permissions": permissions_for("store"),
        }

    def test_every_door_of_turnos_is_shut_to_it(self, client, crew):
        headers = _auth(crew["store"]["token"])
        for path in (
            "/schedule/assignments",
            "/me/profile",
            "/employees/%s" % crew["employee"]["employee"]["id"],
            "/employees",
            "/day-notes/feed",
        ):
            res = client.get(API + path, headers=headers)
            assert (res.status_code, _code(res)) == (403, "app_not_enabled"), path

    def test_it_charges_voids_and_reads_the_numbers_but_types_nothing_in(self, client, crew):
        manager, headers = crew["manager"], _auth(crew["store"]["token"])
        dish = _dish(client, manager, "Bravas", 6)

        charged = client.post(API + "/store/sales", json=_sale_body(dish), headers=headers)
        assert charged.status_code == 201, charged.text
        sale = charged.json()
        assert (sale["source"], sale["payment_method"]) == ("till", "card")

        voided = client.post(
            API + "/store/sales/%s/void" % sale["id"], json={"reason": "Error"}, headers=headers
        )
        assert voided.status_code == 200, voided.text
        assert voided.json()["voided_by_name"] == "Barra"

        stats = client.get(
            API + "/store/stats",
            params={
                "from": (_today() - timedelta(days=7)).isoformat(),
                "to": (_today() + timedelta(days=1)).isoformat(),
            },
            headers=headers,
        )
        assert stats.status_code == 200, stats.text
        assert client.get(API + "/store/sales/%s" % sale["id"], headers=headers).status_code == 200

        for body in (_sale_body(dish, source="manual"), {**_sale_body(dish), "source": "manual"}):
            res = client.post(API + "/store/sales", json=body, headers=headers)
            assert (res.status_code, _code(res)) == (403, "manager_role_required"), res.text
        # Left out, the source is "manual" (the schema's default): refused too.
        body = _sale_body(dish)
        del body["source"]
        res = client.post(API + "/store/sales", json=body, headers=headers)
        assert (res.status_code, _code(res)) == (403, "manager_role_required")
        # And the manager still types one in.
        res = client.post(
            API + "/store/sales", json=_sale_body(dish, source="manual"), headers=_auth(manager)
        )
        assert res.status_code == 201, res.text

    def test_its_session_lasts_ten_years_and_the_teams_a_day(self, client, crew):
        tablet = decode_access_token(crew["store"]["token"])
        person = decode_access_token(crew["employee"]["token"])
        assert tablet["exp"] - tablet["iat"] == int(timedelta(days=3650).total_seconds())
        assert person["exp"] - person["iat"] == int(timedelta(minutes=1440).total_seconds())
        assert tablet["sv"] == person["sv"] == 0

    def test_a_new_password_signs_the_old_tablet_out(self, client):
        manager, _org = _signup(client, "Re-key Co")
        tablet = _store(client, manager)
        old = _auth(tablet["token"])
        assert client.get(API + "/auth/me", headers=old).status_code == 200

        res = client.put(
            API + "/access/stores/%s/password" % tablet["account"]["id"],
            json={"password": "otra-clave-1"},
            headers=_auth(manager),
        )
        assert res.status_code == 204, res.text
        assert client.get(API + "/auth/me", headers=old).status_code == 401
        assert client.get(API + "/store/sales", headers=old).status_code == 401

        assert _login(client, tablet["email"]).status_code == 401
        again = _logged_in(client, tablet["email"], "otra-clave-1")
        assert decode_access_token(again["access_token"])["sv"] == 1
        assert client.get(API + "/auth/me", headers=_auth(again["access_token"])).status_code == 200

    def test_deleting_it_signs_it_out_and_keeps_what_it_rang_up(self, client):
        manager, _org = _signup(client, "Adiós Co")
        tablet = _store(client, manager)
        dish = _dish(client, manager)
        sale = client.post(API + "/store/sales", json=_sale_body(dish), headers=_auth(tablet["token"]))
        assert sale.status_code == 201, sale.text
        voided = client.post(
            API + "/store/sales/%s/void" % sale.json()["id"], json={}, headers=_auth(tablet["token"])
        )
        assert voided.status_code == 200, voided.text

        res = client.delete(
            API + "/access/stores/%s" % tablet["account"]["id"], headers=_auth(manager)
        )
        assert res.status_code == 204, res.text
        assert client.get(API + "/auth/me", headers=_auth(tablet["token"])).status_code == 401
        assert _login(client, tablet["email"]).status_code == 401
        kept = client.get(API + "/store/sales/%s" % sale.json()["id"], headers=_auth(manager))
        assert kept.status_code == 200, kept.text
        assert kept.json()["voided_by_name"] == "Barra"


# --- The team -----------------------------------------------------------------------


@skip_no_db
class TestTheTeam:
    def test_an_employee_counts_receives_and_reads(self, client, crew):
        manager, staff = crew["manager"], _auth(crew["employee"]["token"])
        item = client.post(API + "/inventory/items", json={"name": "Cerveza"}, headers=_auth(manager))
        assert item.status_code == 201, item.text
        item = item.json()
        supplier = client.post(
            API + "/inventory/suppliers", json={"name": "Makro %s" % uuid.uuid4().hex[:4]},
            headers=_auth(manager),
        )
        assert supplier.status_code == 201, supplier.text

        count = client.post(
            API + "/inventory/counts",
            json={"lines": [{"item_id": item["id"], "quantity": 12}]},
            headers=staff,
        )
        assert count.status_code == 201, count.text
        receipt = client.post(
            API + "/inventory/receipts",
            json={"lines": [{"item_id": item["id"], "quantity": 24}], "client_ref": str(uuid.uuid4())},
            headers=staff,
        )
        assert receipt.status_code == 201, receipt.text
        for path in ("/inventory/suppliers", "/store/recipes", "/inventory/items", "/menu"):
            res = client.get(API + path, headers=staff)
            assert res.status_code == 200, (path, res.text)
        assert supplier.json()["id"] in {
            s["id"] for s in client.get(API + "/inventory/suppliers", headers=staff).json()
        }

        # What they may not: each refused, and nothing of it kept.
        dish = _dish(client, manager, "Tortilla", 4)
        refused = [
            client.post(API + "/inventory/items", json={"name": "Nuevo"}, headers=staff),
            client.patch(
                API + "/inventory/items/%s" % item["id"], json={"min_quantity": 5}, headers=staff
            ),
            client.post(API + "/inventory/suppliers", json={"name": "Otro"}, headers=staff),
            client.patch(
                API + "/menu/dishes/%s" % dish["id"], json={"available": False}, headers=staff
            ),
            client.patch(API + "/menu/dishes/%s" % dish["id"], json={"price": 1}, headers=staff),
            client.put(
                API + "/store/recipes/%s" % dish["id"],
                json={"items": [{"item_id": item["id"], "quantity": 1}], "components": []},
                headers=staff,
            ),
            client.delete(API + "/inventory/counts/%s" % count.json()["id"], headers=staff),
            client.delete(API + "/inventory/receipts/%s" % receipt.json()["id"], headers=staff),
            client.post(API + "/store/sales", json=_sale_body(dish, source="manual"), headers=staff),
        ]
        for res in refused:
            assert (res.status_code, _code(res)) == (403, "manager_role_required"), (
                res.request.method,
                str(res.request.url),
                res.text,
            )
        names = {i["name"] for i in client.get(API + "/inventory/items", headers=_auth(manager)).json()}
        assert "Nuevo" not in names
        [listed] = [
            d
            for s in client.get(API + "/menu", headers=_auth(manager)).json()["sections"]
            for d in s["dishes"]
            if d["id"] == dish["id"]
        ]
        assert (listed["available"], listed["price"]) == (True, 4)
        assert client.get(API + "/inventory/counts/%s" % count.json()["id"], headers=staff).status_code == 200

    def test_an_employee_still_has_their_rota(self, client, crew):
        """Turnos is as it was for the team: their own calendar."""
        staff = _auth(crew["employee"]["token"])
        session = client.get(API + "/auth/me", headers=staff).json()
        assert session["apps"] == list(APP_KEYS)
        assert session["permissions"] == permissions_for("employee")
        assert client.get(API + "/me/profile", headers=staff).status_code == 200


# --- The window -----------------------------------------------------------------------


@skip_no_db
class TestTheWindow:
    def test_it_is_the_managers_alone(self, client, crew):
        tablet_id = crew["store"]["account"]["id"]
        for who in ("employee", "store"):
            headers = _auth(crew[who]["token"])
            for res in (
                client.get(API + "/access", headers=headers),
                client.post(
                    API + "/access/stores",
                    json={"name": "X", "email": "x-%s@example.com" % uuid.uuid4().hex[:6], "password": PASSWORD},
                    headers=headers,
                ),
                client.put(
                    API + "/access/stores/%s/password" % tablet_id,
                    json={"password": "otra-clave-1"},
                    headers=headers,
                ),
                client.delete(API + "/access/stores/%s" % tablet_id, headers=headers),
            ):
                assert (res.status_code, _code(res)) == (403, "manager_role_required"), (who, res.text)
        # The tablet the others tried to touch is as it was.
        assert client.get(API + "/auth/me", headers=_auth(crew["store"]["token"])).status_code == 200

    def test_it_lists_the_business_as_it_is(self, client):
        manager, org_id = _signup(client, "Lista Co")
        me = client.get(API + "/auth/me", headers=_auth(manager)).json()
        zoe = _staff(client, manager, "Zoe")
        bea = _add(client, manager, "bea")  # no login, lower case: sorted by name anyway
        gone = _add(client, manager, "Carlos")
        assert client.delete(API + "/employees/%s" % gone["id"], headers=_auth(manager)).status_code == 204
        tablet = _store(client, manager, name="Terraza")

        res = client.get(API + "/access", headers=_auth(manager))
        assert res.status_code == 200, res.text
        body = res.json()
        assert [(m["id"], m["email"], m["full_name"]) for m in body["managers"]] == [
            (me["id"], me["email"], me["full_name"])
        ]
        assert [e["name"] for e in body["employees"]] == ["bea", "Zoe"]
        by_name = {e["name"]: e for e in body["employees"]}
        assert by_name["bea"]["account"] is None and by_name["bea"]["employee_id"] == bea["id"]
        account = by_name["Zoe"]["account"]
        assert account["email"] == zoe["email"] and account["is_active"] is True
        assert set(account) == {"id", "email", "is_active", "created_at", "last_seen_at"}
        assert body["stores"] == [tablet["account"]]
        assert set(tablet["account"]) == {"id", "name", "email", "created_at", "last_seen_at"}
        assert tablet["account"]["name"] == "Terraza"
        assert body["roles"] == {r: permissions_for(r) for r in ("manager", "employee", "store")}
        # Carlos was taken off with no login: nothing left behind.
        assert body["orphans"] == []

    def test_one_business_cannot_see_nor_touch_anothers_tablet(self, client, crew):
        other, _org = _signup(client, "Vecino Co")
        mine = crew["store"]["account"]
        listed = client.get(API + "/access", headers=_auth(other)).json()
        assert listed["stores"] == [] and mine["email"] not in str(listed)
        for res in (
            client.put(
                API + "/access/stores/%s/password" % mine["id"],
                json={"password": "robada-123"},
                headers=_auth(other),
            ),
            client.delete(API + "/access/stores/%s" % mine["id"], headers=_auth(other)),
        ):
            assert (res.status_code, _code(res)) == (404, "store_account_not_found")
        assert client.get(API + "/auth/me", headers=_auth(crew["store"]["token"])).status_code == 200

    def test_only_a_tablet_is_touched_through_it(self, client, crew):
        """The manager's own login and an employee's are not the window's."""
        manager = crew["manager"]
        ids = [
            client.get(API + "/auth/me", headers=_auth(manager)).json()["id"],
            client.get(API + "/auth/me", headers=_auth(crew["employee"]["token"])).json()["id"],
        ]
        for account_id in ids:
            for res in (
                client.put(
                    API + "/access/stores/%s/password" % account_id,
                    json={"password": "otra-clave-1"},
                    headers=_auth(manager),
                ),
                client.delete(API + "/access/stores/%s" % account_id, headers=_auth(manager)),
            ):
                assert (res.status_code, _code(res)) == (404, "store_account_not_found")
        assert client.get(API + "/auth/me", headers=_auth(manager)).status_code == 200

    def test_an_address_is_taken_in_any_case(self, client, crew):
        manager = crew["manager"]
        taken = crew["store"]["email"]
        owner = client.get(API + "/auth/me", headers=_auth(manager)).json()["email"]
        for email in (taken.upper(), "  %s " % taken, owner.upper(), crew["employee"]["email"].title()):
            res = _new_store(client, manager, email=email)
            assert (res.status_code, _code(res)) == (409, "email_taken"), (email, res.text)

    def test_it_keeps_the_address_as_login_compares_it(self, client):
        manager, _org = _signup(client, "Mayúsculas Co")
        typed = "  Tienda+%s@X.com " % uuid.uuid4().hex[:6]
        res = _new_store(client, manager, name="  Barra  ", email=typed)
        assert res.status_code == 201, res.text
        assert res.json()["email"] == typed.strip().lower()
        assert res.json()["name"] == "Barra"

    @pytest.mark.parametrize(
        "body",
        [
            {"name": "", "password": PASSWORD},
            {"name": "   ", "password": PASSWORD},
            {"name": "x" * 81, "password": PASSWORD},
            {"name": "Barra", "password": "corta"},
            {"name": "Barra", "password": "x" * 129},
            {"name": "Barra", "password": PASSWORD, "email": ""},
            {"name": "Barra", "password": PASSWORD, "email": "a" * 250 + "@x.com"},
        ],
        ids=["no-name", "blank-name", "long-name", "short-password", "long-password", "no-email", "long-email"],
    )
    def test_its_walls(self, client, crew, body):
        body = {"email": "w-%s@example.com" % uuid.uuid4().hex[:6], **body}
        res = client.post(API + "/access/stores", json=body, headers=_auth(crew["manager"]))
        assert res.status_code == 422, res.text

    def test_a_new_password_has_the_same_walls(self, client, crew):
        res = client.put(
            API + "/access/stores/%s/password" % crew["store"]["account"]["id"],
            json={"password": "corta"},
            headers=_auth(crew["manager"]),
        )
        assert res.status_code == 422

    def test_twenty_tablets_and_no_more(self, client):
        from app.db import admin_engine
        from app.routers.access import MAX_STORE_ACCOUNTS

        assert MAX_STORE_ACCOUNTS == 20
        manager, org_id = _signup(client, "Veinte Co")
        # Nineteen written straight in: twenty bcrypt hashes would be the
        # slowest thing in this file, and the count is what is under test.
        with admin_engine.begin() as conn:
            for n in range(MAX_STORE_ACCOUNTS - 1):
                conn.execute(
                    text(
                        "INSERT INTO user_account (org_id, email, hashed_password, full_name, role) "
                        "VALUES (:org, :email, 'x', :name, 'store')"
                    ),
                    {"org": org_id, "email": "t%d-%s@example.com" % (n, uuid.uuid4().hex[:6]), "name": "T%d" % n},
                )
        assert _new_store(client, manager).status_code == 201
        res = _new_store(client, manager)
        assert (res.status_code, _code(res)) == (409, "too_many_store_accounts")
        assert res.json()["detail"]["params"] == {"limit": 20}
        listed = client.get(API + "/access", headers=_auth(manager)).json()
        assert len(listed["stores"]) == MAX_STORE_ACCOUNTS
        # A neighbour's twenty are not this business's.
        neighbour, _org = _signup(client, "Veinte Vecino")
        assert _new_store(client, neighbour).status_code == 201


# --- Signing in -------------------------------------------------------------------------


@skip_no_db
class TestSigningIn:
    def test_the_address_is_read_without_case_or_spaces(self, client):
        manager, _org = _signup(client, "Login Co")
        email = "tienda+%s@x.com" % uuid.uuid4().hex[:6]
        tablet = _store(client, manager, email=email)
        typed = "  %s " % email.replace("tienda", "Tienda").replace("x.com", "X.com")
        session = _logged_in(client, typed)
        assert session["user"]["id"] == tablet["account"]["id"]
        assert session["user"]["email"] == email
        assert _login(client, typed, "wrong-pass").status_code == 401

    def test_two_rows_that_differ_only_in_case_the_exact_one_wins(self, client):
        """Rows from before addresses were normalised may exist; nothing makes
        a new one now, so the second is written straight in."""
        from app.db import admin_engine
        from app.security import hash_password

        manager, org_id = _signup(client, "Legado Co")
        lower = "legado+%s@x.com" % uuid.uuid4().hex[:6]
        mixed = lower.replace("legado", "Legado")
        tablet = _store(client, manager, email=lower)
        with admin_engine.begin() as conn:
            other = conn.execute(
                text(
                    "INSERT INTO user_account (org_id, email, hashed_password, full_name, role) "
                    "VALUES (:org, :email, :pw, 'Antigua', 'store') RETURNING id"
                ),
                {"org": org_id, "email": mixed, "pw": hash_password(PASSWORD)},
            ).scalar_one()
        assert _logged_in(client, mixed)["user"]["id"] == str(other)
        assert _logged_in(client, lower)["user"]["id"] == tablet["account"]["id"]

    def test_signup_keeps_the_address_normalised_and_takes_it_in_any_case(self, client):
        email = "Owner+%s@Example.com" % uuid.uuid4().hex[:6]
        body = {"org_name": "Alta Co", "email": "  %s " % email, "password": PASSWORD, "full_name": "O"}
        res = client.post(API + "/auth/signup", json=body)
        assert res.status_code == 201, res.text
        assert res.json()["user"]["email"] == email.lower()
        assert res.json()["user"]["permissions"] == permissions_for("manager")
        again = client.post(API + "/auth/signup", json={**body, "email": email.upper()})
        assert (again.status_code, _code(again)) == (409, "email_taken")
        assert _logged_in(client, email)["user"]["email"] == email.lower()

    def test_an_old_token_without_the_claim_still_works(self, client, crew):
        """Tokens issued before 0046 carry no "sv": read as 0, which every
        row starts at."""
        import jwt

        from app.config import settings

        payload = decode_access_token(crew["employee"]["token"])
        del payload["sv"]
        old = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        assert client.get(API + "/auth/me", headers=_auth(old)).status_code == 200
        payload["sv"] = 7
        future = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
        assert client.get(API + "/auth/me", headers=_auth(future)).status_code == 401


# --- The database -------------------------------------------------------------------------


@skip_no_db
class TestTheDatabase:
    def _insert(self, org_id, role, employee_id=None):
        from app.db import admin_engine

        with admin_engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO user_account (org_id, email, hashed_password, full_name, role, employee_id) "
                    "VALUES (:org, :email, 'x', 'X', :role, :emp)"
                ),
                {
                    "org": org_id,
                    "email": "db-%s@example.com" % uuid.uuid4().hex[:8],
                    "role": role,
                    "emp": employee_id,
                },
            )

    def test_a_tablet_is_nobody(self, client):
        manager, org_id = _signup(client, "CHECK Co")
        ana = _add(client, manager, "Ana")
        with pytest.raises(IntegrityError, match="ck_user_account_store_is_nobody"):
            self._insert(org_id, "store", ana["id"])
        self._insert(org_id, "store")
        self._insert(org_id, "employee", ana["id"])

    def test_who_charged_a_sale_is_never_rewritten(self, client):
        """`created_by_name` is not among what 0043's trigger lets move, and
        app_user has no UPDATE on it: neither the runtime role nor the owner
        rewrites who charged a sale."""
        from sqlalchemy.exc import ProgrammingError

        from app.db import admin_engine, app_engine

        manager, org_id = _signup(client, "Quién Cobró Co")
        me = _me(client, manager)
        dish = _dish(client, manager)
        sale = client.post(API + "/store/sales", json=_sale_body(dish), headers=_auth(manager))
        assert sale.status_code == 201, sale.text
        assert sale.json()["created_by_name"] == me["full_name"]
        rename = "UPDATE store_sale SET created_by_name = 'Otra persona' WHERE id = :s"
        forget = "UPDATE store_sale SET created_by_name = NULL WHERE id = :s"
        for sql in (rename, forget):
            with pytest.raises(ProgrammingError) as refused:
                with app_engine.begin() as conn:
                    conn.execute(text("SELECT set_config('app.current_org_id', :o, true)"), {"o": org_id})
                    conn.execute(text(sql), {"s": sale.json()["id"]})
            assert "permission denied" in str(refused.value).lower()
            with pytest.raises(ProgrammingError) as refused:
                with admin_engine.begin() as conn:
                    conn.execute(text(sql), {"s": sale.json()["id"]})
            assert "a sale is never edited" in str(refused.value).lower()
        got = client.get(API + "/store/sales/%s" % sale.json()["id"], headers=_auth(manager))
        assert got.json()["created_by_name"] == me["full_name"]

    def test_the_migration_names_the_sales_saved_before_it(self, client):
        """0046 fills in the name of every sale whose login is still there,
        of its own business -- past the trigger, which is on again after."""
        import importlib.util
        from pathlib import Path

        from sqlalchemy.exc import ProgrammingError

        from app.db import admin_engine

        path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0046_access_roles.py"
        spec = importlib.util.spec_from_file_location("migration_0046", path)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)

        manager, org_id = _signup(client, "Antes de 0046 Co")
        me = _me(client, manager)
        neighbour = _me(client, _signup(client, "Vecina 0046 Co")[0])
        saved = (
            "INSERT INTO store_sale (org_id, sold_on, client_ref, source, created_by) "
            "VALUES (:org, '2026-09-01', gen_random_uuid(), 'manual', :by) RETURNING id"
        )
        with admin_engine.begin() as conn:
            mine, nobodys, theirs = (
                conn.execute(text(saved), {"org": org_id, "by": by}).scalar_one()
                for by in (me["id"], None, neighbour["id"])
            )
        with admin_engine.begin() as conn:
            conn.execute(text("SET LOCAL lock_timeout = '10s'"))
            for stmt in migration.BACKFILL_STATEMENTS:
                conn.execute(text(stmt))
        with admin_engine.connect() as conn:
            names = dict(
                conn.execute(
                    text("SELECT id, created_by_name FROM store_sale WHERE id IN (:a, :b, :c)"),
                    {"a": mine, "b": nobodys, "c": theirs},
                ).all()
            )
            assert conn.execute(
                text("SELECT tgenabled FROM pg_trigger WHERE tgname = 'store_sale_written_once'")
            ).scalar_one() == "O"
        assert names == {mine: me["full_name"], nobodys: None, theirs: None}
        with pytest.raises(ProgrammingError, match="never edited"):
            with admin_engine.begin() as conn:
                conn.execute(text("UPDATE store_sale SET created_by_name = 'X' WHERE id = :s"), {"s": mine})

    def test_there_are_three_roles(self, client):
        _manager, org_id = _signup(client, "CHECK Co")
        with pytest.raises(IntegrityError, match="ck_user_account_role"):
            self._insert(org_id, "boss")
        for role in ("manager", "employee", "store"):
            self._insert(org_id, role)

    def test_the_back_office_counts_people_not_tablets(self, client):
        from app.db import AdminSessionLocal
        from app.services.backoffice import get_customer

        manager, org_id = _signup(client, "Oficina Co")
        _staff(client, manager)
        _store(client, manager)
        db = AdminSessionLocal()
        try:
            assert get_customer(db, uuid.UUID(org_id)).employee_logins == 1
        finally:
            db.close()

    def test_the_back_office_counts_only_logins_that_open_something(self, client):
        """The session's rule (app/deps.py, LIVE_EMPLOYEE_OF_LOGIN): a login
        left behind by a removal of before, or linked to nobody, lets nobody
        in, and is nobody of the team who can sign in."""
        from app.db import AdminSessionLocal
        from app.services.backoffice import get_customer

        manager, org_id = _signup(client, "Oficina Huérfana Co")
        _staff(client, manager, "Ana")
        dani = _staff(client, manager, "Dani")
        _removed_the_old_way(dani["employee"]["id"])
        _login_of_nobody(org_id)
        # Another business's person, linked by hand to this business's login:
        # not somebody of this team either.
        neighbour, _other = _signup(client, "Vecina Oficina Co")
        theirs = _add(client, neighbour, "Otra")
        stray_id, _email = _login_of_nobody(org_id, "Suelta")
        from app.db import admin_engine

        with admin_engine.begin() as conn:
            conn.execute(
                text("UPDATE user_account SET employee_id = :e WHERE id = :u"),
                {"e": theirs["id"], "u": stray_id},
            )
        db = AdminSessionLocal()
        try:
            assert get_customer(db, uuid.UUID(org_id)).employee_logins == 1
        finally:
            db.close()


# --- Leaving the team -------------------------------------------------------------------


def _accounts_with(email: str) -> int:
    from app.db import admin_engine

    with admin_engine.connect() as conn:
        return conn.execute(
            text("SELECT count(*) FROM user_account WHERE lower(email) = lower(:email)"),
            {"email": email},
        ).scalar_one()


def _removed_the_old_way(employee_id) -> None:
    """Off the roster the way it was done before a removal took the login
    with it: the mark and nothing else -- what production may hold."""
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE employee SET deleted_at = now() WHERE id = :id"), {"id": employee_id}
        )


def _login_of_nobody(org_id, name="Eva", email=None) -> tuple:
    """An employee's login linked to nobody (employee_id NULL, as ON DELETE
    SET NULL leaves it), written straight in: (id, email)."""
    from app.db import admin_engine

    email = email or "nadie+%s@example.com" % uuid.uuid4().hex[:8]
    with admin_engine.begin() as conn:
        account_id = conn.execute(
            text(
                "INSERT INTO user_account (org_id, email, hashed_password, full_name, role) "
                "VALUES (:org, :email, :pw, :name, 'employee') RETURNING id"
            ),
            {"org": org_id, "email": email, "pw": hash_password(PASSWORD), "name": name},
        ).scalar_one()
    return str(account_id), email


def _me(client, token) -> dict:
    res = client.get(API + "/auth/me", headers=_auth(token))
    assert res.status_code == 200, res.text
    return res.json()


@skip_no_db
class TestLeavingTheTeam:
    def test_taken_off_the_roster_their_login_goes_with_them(self, client):
        manager, _org = _signup(client, "Baja Co")
        dish = _dish(client, manager, "Bravas", 6)
        ana = _staff(client, manager, "Ana")
        staff = _auth(ana["token"])
        sale = client.post(API + "/store/sales", json=_sale_body(dish), headers=staff)
        assert sale.status_code == 201, sale.text
        sale_id = sale.json()["id"]
        voided = client.post(API + "/store/sales/%s/void" % sale_id, json={}, headers=staff)
        assert voided.status_code == 200, voided.text

        res = client.delete(API + "/employees/%s" % ana["employee"]["id"], headers=_auth(manager))
        assert res.status_code == 204, res.text

        # The session open on their phone ends, whatever it asks for.
        for method, path, body in (
            ("GET", "/auth/me", None),
            ("GET", "/store/sales", None),
            ("POST", "/store/sales", _sale_body(dish)),
            ("POST", "/store/sales/%s/void" % sale_id, {}),
        ):
            res = client.request(method, API + path, json=body, headers=staff)
            assert res.status_code == 401, (path, res.status_code, res.text)
            assert _code(res) == "session_invalid", (path, res.text)
        # Nor can they sign in again: the refusal of a wrong password.
        res = _login(client, ana["email"])
        assert (res.status_code, _code(res)) == (401, "invalid_credentials")
        # The login is gone, not left behind: nothing for the window to list.
        assert _accounts_with(ana["email"]) == 0
        listed = client.get(API + "/access", headers=_auth(manager)).json()
        assert listed["orphans"] == [] and ana["email"] not in str(listed)
        # What they did stays, and who voided it by name.
        kept = client.get(API + "/store/sales/%s" % sale_id, headers=_auth(manager))
        assert kept.status_code == 200, kept.text
        assert kept.json()["voided_by_name"] == "Ana"

        # Back on the roster, without a login: access is the manager's to give.
        restored = client.post(
            API + "/employees/%s/restore" % ana["employee"]["id"], headers=_auth(manager)
        )
        assert restored.status_code == 200, restored.text
        assert _login(client, ana["email"]).status_code == 401
        res = client.get(
            API + "/employees/%s/account" % ana["employee"]["id"], headers=_auth(manager)
        )
        assert (res.status_code, _code(res)) == (404, "employee_has_no_login_yet")
        again = client.post(
            API + "/employees/%s/account" % ana["employee"]["id"],
            json={"email": ana["email"], "password": "nueva-clave-1"},
            headers=_auth(manager),
        )
        assert again.status_code == 201, again.text
        assert _login(client, ana["email"], "nueva-clave-1").status_code == 200

    def test_a_manager_on_the_roster_keeps_their_login(self, client):
        """Only an employee's login goes with the person: the owner who is
        also on the roster is not locked out of their business."""
        from app.db import admin_engine

        manager, _org = _signup(client, "Dueña Co")
        me = _me(client, manager)
        herself = _add(client, manager, "Dueña")
        with admin_engine.begin() as conn:
            conn.execute(
                text("UPDATE user_account SET employee_id = :e WHERE id = :u"),
                {"e": herself["id"], "u": me["id"]},
            )
        res = client.delete(API + "/employees/%s" % herself["id"], headers=_auth(manager))
        assert res.status_code == 204, res.text
        assert _me(client, manager)["id"] == me["id"]
        assert _login(client, me["email"]).status_code == 200

    def test_a_sale_keeps_who_charged_it_when_they_leave(self, client):
        """Taking Ana off the team deletes her login, and `created_by` goes
        with it: the sale still says she charged it."""
        manager, _org = _signup(client, "Se Fue Co")
        dish = _dish(client, manager, "Bravas", 6)
        ana = _staff(client, manager, "Ana")
        sale = client.post(API + "/store/sales", json=_sale_body(dish), headers=_auth(ana["token"]))
        assert sale.status_code == 201, sale.text
        assert sale.json()["created_by_name"] == "Ana"
        sale_id = sale.json()["id"]

        res = client.delete(API + "/employees/%s" % ana["employee"]["id"], headers=_auth(manager))
        assert res.status_code == 204, res.text
        assert _accounts_with(ana["email"]) == 0
        got = client.get(API + "/store/sales/%s" % sale_id, headers=_auth(manager))
        assert got.status_code == 200, got.text
        assert got.json()["created_by_name"] == "Ana"
        voided = client.post(API + "/store/sales/%s/void" % sale_id, json={}, headers=_auth(manager))
        assert voided.status_code == 200, voided.text
        assert voided.json()["created_by_name"] == "Ana"
        from app.db import admin_engine

        with admin_engine.connect() as conn:
            assert conn.execute(
                text("SELECT created_by IS NULL FROM store_sale WHERE id = :s"), {"s": sale_id}
            ).scalar_one() is True

    def test_restoring_somebody_removed_the_old_way_does_not_bring_their_login_back(self, client):
        """A removal from before logins went with the person left Bea's login
        behind. Back on the roster, it would open the door again with her old
        password: restoring her deletes it. A restore of somebody already on
        the roster (a retry) touches nothing -- not the login given since."""
        manager, _org = _signup(client, "Vuelve Co")
        bea = _staff(client, manager, "Bea")
        _removed_the_old_way(bea["employee"]["id"])
        restored = client.post(
            API + "/employees/%s/restore" % bea["employee"]["id"], headers=_auth(manager)
        )
        assert restored.status_code == 200, restored.text
        res = _login(client, bea["email"])
        assert (res.status_code, _code(res)) == (401, "invalid_credentials")
        assert client.get(API + "/auth/me", headers=_auth(bea["token"])).status_code == 401
        assert _accounts_with(bea["email"]) == 0
        res = client.get(API + "/employees/%s/account" % bea["employee"]["id"], headers=_auth(manager))
        assert (res.status_code, _code(res)) == (404, "employee_has_no_login_yet")

        again = client.post(
            API + "/employees/%s/account" % bea["employee"]["id"],
            json={"email": bea["email"], "password": "nueva-clave-1"},
            headers=_auth(manager),
        )
        assert again.status_code == 201, again.text
        retry = client.post(API + "/employees/%s/restore" % bea["employee"]["id"], headers=_auth(manager))
        assert retry.status_code == 200, retry.text
        assert _login(client, bea["email"], "nueva-clave-1").status_code == 200

    def test_restoring_the_owner_on_the_roster_keeps_their_login(self, client):
        """Only an employee's login: the manager linked to somebody of the
        roster is not locked out by bringing that person back."""
        from app.db import admin_engine

        manager, _org = _signup(client, "Dueña Vuelve Co")
        me = _me(client, manager)
        herself = _add(client, manager, "Dueña")
        with admin_engine.begin() as conn:
            conn.execute(
                text("UPDATE user_account SET employee_id = :e WHERE id = :u"),
                {"e": herself["id"], "u": me["id"]},
            )
        _removed_the_old_way(herself["id"])
        res = client.post(API + "/employees/%s/restore" % herself["id"], headers=_auth(manager))
        assert res.status_code == 200, res.text
        assert _me(client, manager)["id"] == me["id"]
        assert _login(client, me["email"]).status_code == 200

    def test_a_manager_on_the_roster_is_not_that_persons_access(self, client):
        """GET/POST/DELETE /employees/{id}/account are about an EMPLOYEE's
        login. The owner linked to their own row of the roster is a manager:
        "Quitar acceso" on that row must not delete them, and the window
        does not show their login as that person's."""
        from app.db import admin_engine

        manager, _org = _signup(client, "Dueña Acceso Co")
        me = _me(client, manager)
        herself = _add(client, manager, "Dueña")
        with admin_engine.begin() as conn:
            conn.execute(
                text("UPDATE user_account SET employee_id = :e WHERE id = :u"),
                {"e": herself["id"], "u": me["id"]},
            )
        url = API + "/employees/%s/account" % herself["id"]
        res = client.get(url, headers=_auth(manager))
        assert (res.status_code, _code(res)) == (404, "employee_has_no_login_yet"), res.text
        res = client.delete(url, headers=_auth(manager))
        assert (res.status_code, _code(res)) == (404, "employee_has_no_login"), res.text
        assert _me(client, manager)["id"] == me["id"]
        assert _login(client, me["email"]).status_code == 200
        listed = client.get(API + "/access", headers=_auth(manager)).json()
        [row] = [e for e in listed["employees"] if e["employee_id"] == herself["id"]]
        assert row["account"] is None
        assert [m["id"] for m in listed["managers"]] == [me["id"]]

        # Giving that person a login of their own is an employee's login, and
        # taking it away takes that one -- the manager stays.
        email = "duena+%s@example.com" % uuid.uuid4().hex[:8]
        res = client.post(url, json={"email": email, "password": PASSWORD}, headers=_auth(manager))
        assert res.status_code == 201, res.text
        assert client.get(url, headers=_auth(manager)).json()["email"] == email
        listed = client.get(API + "/access", headers=_auth(manager)).json()
        [row] = [e for e in listed["employees"] if e["employee_id"] == herself["id"]]
        assert row["account"]["email"] == email
        assert client.delete(url, headers=_auth(manager)).status_code == 204
        assert _accounts_with(email) == 0
        assert _login(client, me["email"]).status_code == 200

    def test_a_login_with_nobody_live_behind_it_opens_nothing(self, client, monkeypatch):
        """What production may already hold: a person removed before their
        login went with them, and a login linked to nobody."""
        from app.routers import auth as auth_router

        manager, org_id = _signup(client, "Huérfanas Co")
        dish = _dish(client, manager)
        bea = _staff(client, manager, "Bea")
        _removed_the_old_way(bea["employee"]["id"])
        nobody_id, nobody_email = _login_of_nobody(org_id)
        nobody_token = create_access_token(subject=nobody_id, org_id=org_id, role="employee")

        for token in (bea["token"], nobody_token):
            for method, path, body in (
                ("GET", "/auth/me", None),
                ("GET", "/store/sales", None),
                ("POST", "/store/sales", _sale_body(dish)),
                ("GET", "/inventory/items", None),
            ):
                res = client.request(method, API + path, json=body, headers=_auth(token))
                assert res.status_code == 401, (path, res.status_code, res.text)
                assert _code(res) == "session_invalid", (path, res.text)

        # Signing in: the password is checked all the same -- the refusal
        # costs what a wrong password costs -- and the answer is the same.
        checked = []
        real = auth_router.verify_password
        monkeypatch.setattr(
            auth_router,
            "verify_password",
            lambda password, hashed: checked.append(hashed) or real(password, hashed),
        )
        for email in (bea["email"], nobody_email):
            right = _login(client, email)
            wrong = _login(client, email, "wrong-pass-1")
            assert right.status_code == wrong.status_code == 401, right.text
            assert right.json() == wrong.json()
            assert _code(right) == "invalid_credentials"
        assert len(checked) == 4
        # The manager signs in as ever.
        assert _login(client, _me(client, manager)["email"]).status_code == 200

    def test_the_window_lists_the_orphans_and_deletes_only_them(self, client):
        manager, org_id = _signup(client, "Ventana Co")
        me = _me(client, manager)
        carla = _staff(client, manager, "Carla")
        dani = _staff(client, manager, "Dani")
        dani_id = _me(client, dani["token"])["id"]
        _removed_the_old_way(dani["employee"]["id"])
        eva_id, eva_email = _login_of_nobody(org_id, "Eva")
        tablet = _store(client, manager)

        listed = client.get(API + "/access", headers=_auth(manager)).json()
        assert [(o["id"], o["full_name"], o["email"]) for o in listed["orphans"]] == [
            (dani_id, "Dani", dani["email"]),
            (eva_id, "Eva", eva_email),
        ]
        assert set(listed["orphans"][0]) == {"id", "full_name", "email", "created_at", "last_seen_at"}
        assert [e["name"] for e in listed["employees"]] == ["Carla"]

        # Not a way to delete anything else: the manager, a tablet, somebody
        # still on the team, none at all -- and another business's orphan.
        for account_id in (me["id"], tablet["account"]["id"], _me(client, carla["token"])["id"], uuid.uuid4()):
            res = client.delete(API + "/access/accounts/%s" % account_id, headers=_auth(manager))
            assert (res.status_code, _code(res)) == (404, "account_not_found"), res.text
        for token in (manager, tablet["token"], carla["token"]):
            assert client.get(API + "/auth/me", headers=_auth(token)).status_code == 200
        neighbour, _org = _signup(client, "Vecina Co")
        res = client.delete(API + "/access/accounts/%s" % eva_id, headers=_auth(neighbour))
        assert (res.status_code, _code(res)) == (404, "account_not_found")

        for orphan_id in (dani_id, eva_id):
            res = client.delete(API + "/access/accounts/%s" % orphan_id, headers=_auth(manager))
            assert res.status_code == 204, res.text
            res = client.delete(API + "/access/accounts/%s" % orphan_id, headers=_auth(manager))
            assert (res.status_code, _code(res)) == (404, "account_not_found")
        assert client.get(API + "/access", headers=_auth(manager)).json()["orphans"] == []
        assert _accounts_with(dani["email"]) == _accounts_with(eva_email) == 0


# --- The till is the till ------------------------------------------------------------------


def _line(dish, unit_price, quantity=1) -> dict:
    return {"dish_id": dish["id"], "name": dish["name"], "unit_price": unit_price, "quantity": quantity}


def _count_sales(client, manager) -> int:
    res = client.get(API + "/store/sales", params={"from": "2000-01-01"}, headers=_auth(manager))
    assert res.status_code == 200, res.text
    return len(res.json())


@skip_no_db
class TestTheTillIsTheTill:
    def test_the_team_charges_the_menu_at_its_prices_today(self, client):
        manager, _org = _signup(client, "Caja Co")
        dish = _dish(client, manager, "Croquetas", 9.5)
        market = _dish(client, manager, "Pescado del día", None)
        crew = {"employee": _staff(client, manager), "store": _store(client, manager)}
        today = _today()
        free = {"dish_id": None, "name": "Caja", "unit_price": 30000.47, "quantity": 1}

        def body(lines, sold_on=today) -> dict:
            return {**_sale_body(dish), "sold_on": sold_on.isoformat(), "lines": lines}

        refused = [
            (body([free]), 422, "till_line_needs_dish"),
            (body([_line(dish, 9.5), free]), 422, "till_line_needs_dish"),
            (body([_line(dish, 30000.47)]), 409, "menu_price_changed"),
            (body([_line(dish, 9.49)]), 409, "menu_price_changed"),
            (body([_line(dish, 9.5), _line(dish, 0)]), 409, "menu_price_changed"),
            (body([_line(market, 0)]), 409, "menu_price_changed"),
            (body([_line(market, 13.2), _line(dish, 9.5, 2)]), 409, "menu_price_changed"),
            (body([_line(dish, 9.5)], date(2024, 1, 15)), 422, "till_sale_not_today"),
            (body([_line(dish, 9.5)], today - timedelta(days=2)), 422, "till_sale_not_today"),
            (body([_line(dish, 9.5)], today + timedelta(days=2)), 422, "till_sale_not_today"),
        ]
        # What the till sends: dishes at the menu's price in whole units, a
        # day either side of today.
        charged = [
            body([_line(dish, 9.5, 3)]),
            body([_line(dish, 9.5, 2)]),
            body([_line(dish, 9.5)], today - timedelta(days=1)),
            body([_line(dish, 9.5)], today + timedelta(days=1)),
        ]
        before = _count_sales(client, manager)
        for who in ("employee", "store"):
            headers = _auth(crew[who]["token"])
            for sent, status_code, code in refused:
                res = client.post(
                    API + "/store/sales", json={**sent, "client_ref": str(uuid.uuid4())}, headers=headers
                )
                assert res.status_code == status_code, (who, sent, res.text)
                assert _code(res) == code, (who, sent, res.text)
            for sent in charged:
                res = client.post(
                    API + "/store/sales", json={**sent, "client_ref": str(uuid.uuid4())}, headers=headers
                )
                assert res.status_code == 201, (who, sent, res.text)
        # Nothing refused was kept.
        assert _count_sales(client, manager) == before + 2 * len(charged)

        # A price changed on the menu while the bill was open: the old one is
        # refused, the new one charged.
        assert client.patch(
            API + "/menu/dishes/%s" % dish["id"], json={"price": 10}, headers=_auth(manager)
        ).status_code == 200
        staff = _auth(crew["employee"]["token"])
        res = client.post(API + "/store/sales", json=body([_line(dish, 9.5)]), headers=staff)
        assert (res.status_code, _code(res)) == (409, "menu_price_changed")
        res = client.post(API + "/store/sales", json=body([_line(dish, 10)]), headers=staff)
        assert res.status_code == 201, res.text

        # The manager is held to none of it: a sale of theirs is what they say.
        for sent in (
            body([free]),
            body([_line(dish, 30000.47)]),
            body([_line(market, 0)]),
            body([_line(dish, 9.5)], date(2024, 1, 15)),
        ):
            res = client.post(
                API + "/store/sales", json={**sent, "client_ref": str(uuid.uuid4())}, headers=_auth(manager)
            )
            assert res.status_code == 201, (sent, res.text)

    def test_a_sale_says_who_charged_it(self, client):
        manager, _org = _signup(client, "Quién Co")
        me = _me(client, manager)
        dish = _dish(client, manager)
        tablet = _store(client, manager, name="Barra")
        charged = client.post(API + "/store/sales", json=_sale_body(dish), headers=_auth(tablet["token"]))
        assert charged.status_code == 201, charged.text
        assert charged.json()["created_by_name"] == "Barra"
        by_hand = client.post(
            API + "/store/sales", json=_sale_body(dish, source="manual"), headers=_auth(manager)
        )
        assert by_hand.status_code == 201, by_hand.text
        assert by_hand.json()["created_by_name"] == me["full_name"]

        def read(sale) -> dict:
            res = client.get(API + "/store/sales/%s" % sale.json()["id"], headers=_auth(manager))
            assert res.status_code == 200, res.text
            return res.json()

        assert read(charged)["created_by_name"] == "Barra"
        assert read(by_hand)["created_by_name"] == me["full_name"]
        # The tablet deleted: its sale still says it was the tablet's.
        res = client.delete(API + "/access/stores/%s" % tablet["account"]["id"], headers=_auth(manager))
        assert res.status_code == 204, res.text
        assert read(charged)["created_by_name"] == "Barra"
        assert read(by_hand)["created_by_name"] == me["full_name"]

    def test_the_team_charges_whole_units_of_one_to_999(self, client):
        """What the till's bill holds (lib/store/ticket.ts,
        MAX_TICKET_QUANTITY): a tap is one, and a line reaches 999 at most.
        0,001 of a dish, or 166 666,665 of it, is an amount typed in by
        another name -- the manager's."""
        manager, _org = _signup(client, "Unidades Co")
        dish = _dish(client, manager, "Croquetas", 9.5)
        crew = {"employee": _staff(client, manager), "store": _store(client, manager)}

        def body(*lines) -> dict:
            return {**_sale_body(dish), "client_ref": str(uuid.uuid4()), "lines": list(lines)}

        before = _count_sales(client, manager)
        for who in ("employee", "store"):
            headers = _auth(crew[who]["token"])
            for quantity in (0.001, 0.5, 1.5, 2.999, 1000, 166666.665, 999999):
                res = client.post(
                    API + "/store/sales", json=body(_line(dish, 9.5), _line(dish, 9.5, quantity)), headers=headers
                )
                assert (res.status_code, _code(res)) == (422, "till_quantity_invalid"), (who, quantity, res.text)
            for quantity in (1, 2, 999):
                res = client.post(API + "/store/sales", json=body(_line(dish, 9.5, quantity)), headers=headers)
                assert res.status_code == 201, (who, quantity, res.text)
                assert res.json()["lines"][0]["quantity"] == quantity
        assert _count_sales(client, manager) == before + 6
        # The manager is not held to it.
        res = client.post(API + "/store/sales", json=body(_line(dish, 9.5, 0.5)), headers=_auth(manager))
        assert res.status_code == 201, res.text

    def test_a_dish_with_no_price_is_not_the_tills_to_charge(self, client):
        """The till never lets one on the bill (lib/store/ticket.ts,
        whyNotAddable): one sent is a price that left the menu while the bill
        was open, or a figure made up. The manager charges it by hand."""
        manager, _org = _signup(client, "Sin Precio Co")
        dish = _dish(client, manager, "Croquetas", 9.5)
        market = _dish(client, manager, "Pescado del día", None)
        crew = {"employee": _staff(client, manager), "store": _store(client, manager)}

        def body(*lines) -> dict:
            return {**_sale_body(dish), "client_ref": str(uuid.uuid4()), "lines": list(lines)}

        before = _count_sales(client, manager)
        for who in ("employee", "store"):
            headers = _auth(crew[who]["token"])
            for price in (0.01, 13.2, 999999.99):
                res = client.post(API + "/store/sales", json=body(_line(market, price)), headers=headers)
                assert (res.status_code, _code(res)) == (409, "menu_price_changed"), (who, price, res.text)
                assert res.json()["detail"]["params"]["dish_id"] == market["id"]
        # A price taken off the menu while the bill was open: the same.
        assert client.patch(
            API + "/menu/dishes/%s" % dish["id"], json={"price": None}, headers=_auth(manager)
        ).status_code == 200
        res = client.post(API + "/store/sales", json=body(_line(dish, 9.5)), headers=_auth(crew["employee"]["token"]))
        assert (res.status_code, _code(res)) == (409, "menu_price_changed"), res.text
        assert _count_sales(client, manager) == before
        res = client.post(API + "/store/sales", json=body(_line(market, 13.2)), headers=_auth(manager))
        assert res.status_code == 201, res.text

    def test_a_line_is_named_as_the_menu_names_it(self, client):
        """The name sent is not the one kept: the statistics add the lines up
        under it, and a name made up would be a dish the menu never had. The
        manager's line keeps what they wrote."""
        manager, _org = _signup(client, "Nombres Co")
        dish = _dish(client, manager, "Croquetas", 9.5)
        crew = {"employee": _staff(client, manager), "store": _store(client, manager)}
        made_up = {**_line(dish, 9.5, 2), "name": "Caja fuerte del jefe"}
        for who in ("employee", "store"):
            res = client.post(
                API + "/store/sales",
                json={**_sale_body(dish), "lines": [made_up]},
                headers=_auth(crew[who]["token"]),
            )
            assert res.status_code == 201, (who, res.text)
            assert [line["name"] for line in res.json()["lines"]] == ["Croquetas"]
            kept = client.get(API + "/store/sales/%s" % res.json()["id"], headers=_auth(manager)).json()
            assert [line["name"] for line in kept["lines"]] == ["Croquetas"]
        # Renamed on the menu while the bill was open: the menu's name now.
        assert client.patch(
            API + "/menu/dishes/%s" % dish["id"], json={"name": "Croquetas caseras"}, headers=_auth(manager)
        ).status_code == 200
        res = client.post(
            API + "/store/sales", json={**_sale_body(dish), "lines": [_line(dish, 9.5)]},
            headers=_auth(crew["employee"]["token"]),
        )
        assert res.status_code == 201, res.text
        assert [line["name"] for line in res.json()["lines"]] == ["Croquetas caseras"]
        today = _today().isoformat()
        stats = client.get(
            API + "/store/stats", params={"from": today, "to": today}, headers=_auth(manager)
        )
        assert stats.status_code == 200, stats.text
        assert "Caja fuerte del jefe" not in stats.text
        assert [(d["name"], d["quantity"]) for d in stats.json()["top_dishes"]] == [("Croquetas caseras", 5)]
        # The manager's sale is what they say it is.
        res = client.post(
            API + "/store/sales", json={**_sale_body(dish), "lines": [{**made_up, "name": "Media ración"}]},
            headers=_auth(manager),
        )
        assert res.status_code == 201, res.text
        assert [line["name"] for line in res.json()["lines"]] == ["Media ración"]


# --- The window's walls, and the back office ---------------------------------------------------


@skip_no_db
class TestTheAddressAndTheBackOffice:
    @pytest.mark.parametrize(
        "shape",
        ["tienda-{}", "tienda-{}@", "@{}.com", "tienda-{}@x", "tien da-{}@x.com", "a-{}@b@x.com", "tienda-{}@x com"],
    )
    def test_a_tablets_address_has_the_shape_of_one(self, client, crew, shape):
        res = _new_store(client, crew["manager"], email=shape.format(uuid.uuid4().hex[:8]))
        assert res.status_code == 422, res.text
        assert _code(res) == "email_invalid", res.text

    @pytest.mark.parametrize("shape", ["maxi-{}@prueba", "maxi-{}", "maxi {}@x.com"])
    def test_a_persons_address_has_the_shape_of_one_too(self, client, crew, shape):
        # The same wall as the tablet's: a login nobody can type is not made,
        # and the person keeps no access until the manager writes it right.
        person = _add(client, crew["manager"], "Maxi")
        res = client.post(
            API + "/employees/%s/account" % person["id"],
            headers=_auth(crew["manager"]),
            json={"email": shape.format(uuid.uuid4().hex[:8]), "password": PASSWORD},
        )
        assert (res.status_code, _code(res)) == (422, "email_invalid"), res.text
        res = client.get(API + "/employees/%s/account" % person["id"], headers=_auth(crew["manager"]))
        assert res.status_code == 404, res.text

    def test_the_back_office_does_not_take_a_tablet_for_somebody_signing_in(self, client):
        from app.db import AdminSessionLocal, admin_engine
        from app.services.backoffice import compute_metrics, get_customer

        manager, org_id = _signup(client, "Tablet Sola Co")
        me = _me(client, manager)
        tablet = _store(client, manager)
        # Paying, and nobody of it has signed in for sixty days.
        with admin_engine.begin() as conn:
            conn.execute(
                text("UPDATE subscription SET status = 'active', activated_at = now() WHERE org_id = :o"),
                {"o": org_id},
            )
            conn.execute(
                text("UPDATE user_account SET last_seen_at = now() - interval '60 days' WHERE id = :u"),
                {"u": me["id"]},
            )
            conn.execute(
                text("UPDATE user_account SET last_seen_at = NULL WHERE id = :u"),
                {"u": tablet["account"]["id"]},
            )

        def looked_at():
            db = AdminSessionLocal()
            try:
                return compute_metrics(db).usage, get_customer(db, uuid.UUID(org_id)).last_active_at
            finally:
                db.close()

        usage, last_active = looked_at()
        # The tablet, on all day at the till.
        with admin_engine.begin() as conn:
            conn.execute(
                text("UPDATE user_account SET last_seen_at = now() WHERE id = :u"),
                {"u": tablet["account"]["id"]},
            )
        assert looked_at() == (usage, last_active)
        assert last_active is not None and last_active < datetime.now(timezone.utc) - timedelta(days=59)
