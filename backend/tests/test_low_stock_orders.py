"""Low stock and the order to the supplier, and "Agua" on the menu taking
"Agua" off the shelf (Max, 27-sep-2026).

* SUPPLIERS: a business's own, a name and a phone as the manager writes it;
  a product says which one it is bought from and how much of it is ordered
  at a time. Deleting a supplier leaves its products without one.
* THE ALERT ON A SALE: the answer to saving a sale says which of the products
  it took from are now below their minimum, whether each is critical (nothing
  left, or half the minimum or less) and whether THIS sale made it so.
* THE AUTOMATIC LINK: a dish with no recipe of its own, called the same as
  one product of the inventory, takes one of it per unit sold.

The pure parts first -- names, phones, the rule of critical, the book -- and
then everything through the API, as a manager, an employee, another business
and a shop without the Inventario, and the tables themselves.
"""

import uuid
from decimal import Decimal
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import event, text

from app import clients
from app.clients import ClientProfile
from app.routers.inventory import is_critical
from app.routers.inventory_suppliers import phone_is_valid
from app.schemas.inventory import InventoryItemCreate, InventorySupplierIn
from app.services import recipes
from app.services.recipes import RecipeBook, name_key
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    _employee_token,
    _signup,
    client,
    skip_no_db,
)
from tests.test_store_recipes import (
    _code,
    _count,
    _dish,
    _file_under,
    _line,
    _post_sale,
    _receive,
    _recipe,
    _recipes,
    _sale,
    _section,
    _stock,
    _taken,
)

API = "/api/v1"
SUPPLIERS = API + "/inventory/suppliers"
VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"

D = Decimal


# --- Without a database ---------------------------------------------------------------


class TestNames:
    @pytest.mark.parametrize(
        "a, b",
        [
            ("agua", "Água"),
            ("Agua", "  AGUA  "),
            ("Agua", "Água"),  # the accent as a combining mark, as a Mac may spell it
            ("Coca  Cola", "coca cola"),
            ("Coca\tCola", "Coca Cola"),
            ("Piña colada", "PINA COLADA"),
            ("Café", "cafe"),
        ],
    )
    def test_the_same_name(self, a, b):
        assert name_key(a) == name_key(b)

    @pytest.mark.parametrize(
        "pasted",
        ["Agua\u200b", "\ufeffAgua", "Ag\u00adua", "A\u200dgua"],
    )
    def test_invisible_characters_pasted_from_the_web_do_not_count(self, pasted):
        # A zero-width space, a BOM, a soft hyphen, a zero-width joiner:
        # category Cf, invisible on screen, and "Agua" all the same.
        assert name_key(pasted) == name_key("Agua")

    @pytest.mark.parametrize("a, b", [("Agua", "Agua con gas"), ("Coca Cola", "CocaCola")])
    def test_not_the_same_name(self, a, b):
        assert name_key(a) != name_key(b)


class TestTheBook:
    def _ids(self, n):
        return [uuid.uuid4() for _ in range(n)]

    def test_one_product_called_the_same_is_linked(self):
        agua, pollo = self._ids(2)
        dish, other = self._ids(2)
        book = RecipeBook()
        book.link([(dish, "Agua"), (other, "Patatas")], [(agua, "água"), (pollo, "Pollo")])
        assert book.auto == {dish: agua}
        assert book.ambiguous == {}
        assert recipes.expand(book, [(dish, D("3"))]) == {agua: D("3.000")}
        assert recipes.expand(book, [(other, D("3"))]) == {}
        assert book.has_recipe(dish) is False

    def test_two_products_called_the_same_is_no_link(self):
        a, b = self._ids(2)
        dish = uuid.uuid4()
        book = RecipeBook()
        book.link([(dish, "Agua")], [(a, "Agua"), (b, "agua ")])
        assert book.auto == {}
        assert book.ambiguous == {dish: sorted([a, b], key=str)}
        assert recipes.expand(book, [(dish, D("1"))]) == {}

    def test_a_recipe_of_its_own_wins(self):
        agua, botella = self._ids(2)
        dish = uuid.uuid4()
        book = RecipeBook(items={dish: [(botella, D("0.5"))]})
        book.link([(dish, "Agua")], [(agua, "Agua")])
        assert book.auto == {}
        assert recipes.expand(book, [(dish, D("2"))]) == {botella: D("1.000")}

    def test_a_component_with_no_recipe_takes_its_product(self):
        agua, pollo = self._ids(2)
        crispy, water, combo = self._ids(3)
        book = RecipeBook(
            items={crispy: [(pollo, D("0.75"))]},
            components={combo: [(crispy, D("1")), (water, D("2"))]},
        )
        book.link([(crispy, "Crispy"), (water, "Agua"), (combo, "Combo")], [(agua, "Agua")])
        assert recipes.expand(book, [(combo, D("2"))]) == {pollo: D("1.500"), agua: D("4.000")}


class TestPhones:
    @pytest.mark.parametrize(
        "phone",
        [
            "+34 612 34 56 78",
            "612345678",
            "(93) 123-45-67",
            "+1 (415) 555-0100",
            "1234567",  # seven digits
            "123456789012345",  # fifteen
        ],
    )
    def test_a_phone(self, phone):
        assert phone_is_valid(phone)

    @pytest.mark.parametrize(
        "phone",
        [
            "123456",  # six digits
            "1234567890123456",  # sixteen
            "612.345.678",
            "612/345/678",
            "34+612345678",  # a + that is not the first
            "++34 612345678",
            "tel 612345678",
            "612 345 678 ext 2",
            "٦١٢٣٤٥٦",  # Arabic-Indic digits
            "6" + " " * 40 + "12345678",  # more than 40 characters
        ],
    )
    def test_not_a_phone(self, phone):
        assert not phone_is_valid(phone)


class TestCritical:
    @pytest.mark.parametrize(
        "on_hand, minimum, critical",
        [
            (3, 4, False),
            (2, 4, True),  # half the minimum
            (2.001, 4, False),
            (0, 4, True),
            (-1, 4, True),
            (0, 0, True),  # nothing left is critical, whatever the minimum
            (None, 4, False),  # nothing known
            (1, None, False),  # no minimum
        ],
    )
    def test_nothing_left_or_half_the_minimum(self, on_hand, minimum, critical):
        assert is_critical(on_hand, minimum) is critical


class TestSchemas:
    @pytest.mark.parametrize("sent", [0, -1, 0.0004, 1_000_000_000])
    def test_an_order_quantity_the_column_cannot_hold_is_refused(self, sent):
        with pytest.raises(ValidationError):
            InventoryItemCreate(name="Pollo", order_quantity=sent)

    def test_an_order_quantity_is_kept_to_the_thousandth(self):
        assert InventoryItemCreate(name="Pollo", order_quantity=1.5).order_quantity == 1.5
        assert InventoryItemCreate(name="Pollo", order_quantity=1 / 3).order_quantity == 0.333

    def test_a_supplier_name_is_trimmed_before_its_length_is_checked(self):
        assert InventorySupplierIn(name="  Makro  ").name == "Makro"
        assert InventorySupplierIn(name="x" * 120 + "  ").name == "x" * 120
        for name in ("", "   ", "x" * 121):
            with pytest.raises(ValidationError):
                InventorySupplierIn(name=name)

    def test_a_blank_phone_is_no_phone(self):
        assert InventorySupplierIn(name="Makro", phone="   ").phone is None
        assert InventorySupplierIn(name="Makro", phone=" 612 345 678 ").phone == "612 345 678"


class TestTheMigration:
    def test_it_follows_0044_on_the_one_line_of_migrations(self):
        """It was the head; 0046_access_roles came after it (28-sep-2026).
        The one-head rule itself is tests/test_planner_notes.py's."""
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        cfg = Config(str(VERSIONS.parents[1] / "alembic.ini"))
        cfg.set_main_option("script_location", str(VERSIONS.parent))
        script = ScriptDirectory.from_config(cfg)
        [head] = script.get_heads()
        on_the_line = [r.revision for r in script.walk_revisions("base", head)]
        assert "0045_suppliers_and_orders" in on_the_line
        revision = script.get_revision("0045_suppliers_and_orders")
        assert revision.down_revision == "0044_casa_demo_hd_photos"


# --- Through the API ----------------------------------------------------------------------


def _manager(client) -> str:
    token, _org = _signup(client, "Pedidos Co")
    return token


def _supplier(client, token, name="Makro", phone="+34 612 34 56 78") -> dict:
    res = client.post(SUPPLIERS, json={"name": name, "phone": phone}, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()


def _suppliers(client, token) -> list:
    res = client.get(SUPPLIERS, headers=_auth(token))
    assert res.status_code == 200, res.text
    return res.json()


def _item(client, token, name, unit="ud", **fields) -> dict:
    res = client.post(
        API + "/inventory/items", json={"name": name, "unit": unit, **fields}, headers=_auth(token)
    )
    assert res.status_code == 201, res.text
    return res.json()


def _patch_item(client, token, item_id, **fields):
    return client.patch(
        API + "/inventory/items/%s" % item_id, json=fields, headers=_auth(token)
    )


def _void(client, token, sale_id):
    res = client.post(API + "/store/sales/%s/void" % sale_id, json={}, headers=_auth(token))
    assert res.status_code == 200, res.text
    return res.json()


def _as_runtime(org_id: str):
    """A transaction as app_user, inside the business."""
    from app.db import app_engine

    conn = app_engine.connect()
    trans = conn.begin()
    conn.execute(text("SELECT set_config('app.current_org_id', :org, true)"), {"org": org_id})
    return conn, trans


def _org_id(client, token) -> str:
    return client.get(API + "/auth/me", headers=_auth(token)).json()["org_id"]


@skip_no_db
class TestSuppliers:
    def test_add_list_change_and_delete(self, client):
        token = _manager(client)
        makro = _supplier(client, token, "Makro", "+34 612 34 56 78")
        assert set(makro) == {"id", "name", "phone", "item_count"}
        assert (makro["name"], makro["phone"], makro["item_count"]) == (
            "Makro",
            "+34 612 34 56 78",
            0,
        )
        _supplier(client, token, "coca-cola europacific", None)
        assert [s["name"] for s in _suppliers(client, token)] == [
            "coca-cola europacific",
            "Makro",
        ]

        res = client.patch(
            SUPPLIERS + "/%s" % makro["id"],
            json={"name": " Makro Sabadell ", "phone": "(93) 123-45-67"},
            headers=_auth(token),
        )
        assert res.status_code == 200, res.text
        assert (res.json()["name"], res.json()["phone"]) == ("Makro Sabadell", "(93) 123-45-67")
        # Only what is sent changes; a null phone takes it off.
        res = client.patch(SUPPLIERS + "/%s" % makro["id"], json={"phone": None}, headers=_auth(token))
        assert (res.json()["name"], res.json()["phone"]) == ("Makro Sabadell", None)

        res = client.delete(SUPPLIERS + "/%s" % makro["id"], headers=_auth(token))
        assert res.status_code == 204
        assert [s["name"] for s in _suppliers(client, token)] == ["coca-cola europacific"]
        res = client.delete(SUPPLIERS + "/%s" % makro["id"], headers=_auth(token))
        assert (res.status_code, _code(res)) == (404, "inventory_supplier_not_found")

    def test_one_name_per_business_whatever_its_case(self, client):
        token = _manager(client)
        makro = _supplier(client, token, "Makro")
        res = client.post(SUPPLIERS, json={"name": " MAKRO "}, headers=_auth(token))
        assert (res.status_code, _code(res)) == (409, "inventory_supplier_name_taken")
        assert res.json()["detail"]["params"] == {"name": "Makro"}

        other = _supplier(client, token, "Mercadona", None)
        res = client.patch(SUPPLIERS + "/%s" % other["id"], json={"name": "makro"}, headers=_auth(token))
        assert (res.status_code, _code(res)) == (409, "inventory_supplier_name_taken")
        # Its own name in another case is not taken by anybody else.
        res = client.patch(SUPPLIERS + "/%s" % makro["id"], json={"name": "MAKRO"}, headers=_auth(token))
        assert (res.status_code, res.json()["name"]) == (200, "MAKRO")
        # Another business can have its own Makro.
        _supplier(client, _manager(client), "Makro")

    def test_the_unique_index_answers_like_the_check(self, client, monkeypatch):
        """A second save that slips past the check meets the index: a 409, not
        a 500."""
        from app.routers import inventory_suppliers as router_module

        token = _manager(client)
        _supplier(client, token, "Makro")
        real, calls = router_module._holder, []

        def blind_first(*args, **kwargs):
            calls.append(1)
            return None if len(calls) == 1 else real(*args, **kwargs)

        monkeypatch.setattr(router_module, "_holder", blind_first)
        res = client.post(SUPPLIERS, json={"name": "makro"}, headers=_auth(token))
        assert (res.status_code, _code(res)) == (409, "inventory_supplier_name_taken")
        assert res.json()["detail"]["params"] == {"name": "Makro"}
        assert len(calls) == 2
        assert [s["name"] for s in _suppliers(client, token)] == ["Makro"]

        # And a rename that slips past it, the same way.
        other = _supplier(client, token, "Mercadona", None)
        calls.clear()
        res = client.patch(SUPPLIERS + "/%s" % other["id"], json={"name": "MAKRO"}, headers=_auth(token))
        assert (res.status_code, _code(res)) == (409, "inventory_supplier_name_taken")
        assert res.json()["detail"]["params"] == {"name": "Makro"}
        assert [s["name"] for s in _suppliers(client, token)] == ["Makro", "Mercadona"]

    @pytest.mark.parametrize("phone", ["612.345.678", "123", "+34 612 34 56 78 90 12 34", "llamar"])
    def test_a_phone_that_is_not_one_is_refused(self, client, phone):
        token = _manager(client)
        res = client.post(SUPPLIERS, json={"name": "Makro", "phone": phone}, headers=_auth(token))
        assert (res.status_code, _code(res)) == (422, "inventory_supplier_phone_invalid")
        makro = _supplier(client, token, "Makro")
        res = client.patch(SUPPLIERS + "/%s" % makro["id"], json={"phone": phone}, headers=_auth(token))
        assert (res.status_code, _code(res)) == (422, "inventory_supplier_phone_invalid")
        assert _suppliers(client, token)[0]["phone"] == makro["phone"]

    def test_a_name_is_required(self, client):
        token = _manager(client)
        for body in ({"name": "  "}, {"phone": "612345678"}, {"name": "x" * 121}):
            assert client.post(SUPPLIERS, json=body, headers=_auth(token)).status_code == 422

    def test_another_business_neither_sees_nor_touches_them(self, client):
        mine, theirs = _manager(client), _manager(client)
        their_makro = _supplier(client, theirs, "Makro")
        assert _suppliers(client, mine) == []
        path = SUPPLIERS + "/%s" % their_makro["id"]
        for res in (
            client.patch(path, json={"name": "Robado"}, headers=_auth(mine)),
            client.delete(path, headers=_auth(mine)),
        ):
            assert (res.status_code, _code(res)) == (404, "inventory_supplier_not_found")
        # Nor can one of my products say it is bought from theirs.
        res = client.post(
            API + "/inventory/items",
            json={"name": "Pollo", "supplier_id": their_makro["id"]},
            headers=_auth(mine),
        )
        assert (res.status_code, _code(res)) == (404, "inventory_supplier_not_found")
        pollo = _item(client, mine, "Pollo")
        res = _patch_item(client, mine, pollo["id"], supplier_id=their_makro["id"])
        assert (res.status_code, _code(res)) == (404, "inventory_supplier_not_found")
        assert _suppliers(client, theirs)[0]["name"] == "Makro"

    def test_deleting_one_leaves_its_products_without_a_supplier(self, client):
        token = _manager(client)
        makro = _supplier(client, token, "Makro")
        other = _supplier(client, token, "Mercadona", None)
        pollo = _item(client, token, "Pollo", "kg", supplier_id=makro["id"], order_quantity=10, min_quantity=5)
        viejo = _item(client, token, "Aceite viejo", "l", supplier_id=makro["id"])
        _patch_item(client, token, viejo["id"], archived=True)
        agua = _item(client, token, "Agua", supplier_id=other["id"])
        # The archived one is not counted: it is not on the list.
        counts = {s["name"]: s["item_count"] for s in _suppliers(client, token)}
        assert counts == {"Makro": 1, "Mercadona": 1}

        res = client.delete(SUPPLIERS + "/%s" % makro["id"], headers=_auth(token))
        assert res.status_code == 204, res.text
        stock = _stock(client, token)
        assert stock["Pollo"]["supplier"] is None
        assert stock["Aceite viejo"]["supplier"] is None
        # Nothing else about the product moved.
        assert (stock["Pollo"]["order_quantity"], stock["Pollo"]["min_quantity"]) == (10, 5)
        assert stock["Agua"]["supplier"]["id"] == other["id"]
        assert pollo["supplier"]["id"] == makro["id"] and agua["supplier"]["name"] == "Mercadona"

    def test_an_employee_reads_the_list_and_changes_nothing(self, client):
        """The list is the team's since 28-sep-2026 -- ordering from the till
        needs it (app/access.py); adding, changing and deleting are not."""
        manager = _manager(client)
        makro = _supplier(client, manager, "Makro")
        staff = _employee_token(client, manager, _add(client, manager, "Ana")["id"])
        listed = client.get(SUPPLIERS, headers=_auth(staff))
        assert listed.status_code == 200, listed.text
        assert [s["name"] for s in listed.json()] == ["Makro"]
        for res in (
            client.post(SUPPLIERS, json={"name": "X"}, headers=_auth(staff)),
            client.patch(SUPPLIERS + "/%s" % makro["id"], json={"name": "X"}, headers=_auth(staff)),
            client.delete(SUPPLIERS + "/%s" % makro["id"], headers=_auth(staff)),
        ):
            assert (res.status_code, _code(res)) == (403, "manager_role_required")
        assert [s["name"] for s in _suppliers(client, manager)] == ["Makro"]

    def test_every_supplier_route_declares_its_permission(self):
        from app.access import Perm
        from app.routers import inventory_suppliers as router_module

        for route in router_module.router.routes:
            perms = [
                d.call.permission
                for d in route.dependant.dependencies
                if hasattr(d.call, "permission")
            ]
            expected = Perm.INVENTORY_VIEW if route.methods == {"GET"} else Perm.INVENTORY_SUPPLIERS
            assert perms == [expected], (route.path, route.methods)


@skip_no_db
class TestTheProduct:
    def test_a_product_says_who_it_is_bought_from_and_how_much_is_ordered(self, client):
        token = _manager(client)
        makro = _supplier(client, token, "Makro", "612 345 678")
        pollo = _item(client, token, "Pollo", "kg", supplier_id=makro["id"], order_quantity=10)
        assert pollo["supplier"] == {"id": makro["id"], "name": "Makro", "phone": "612 345 678"}
        assert pollo["order_quantity"] == 10
        assert _stock(client, token)["Pollo"]["supplier"] == pollo["supplier"]

        res = _patch_item(client, token, pollo["id"], order_quantity=1.5)
        assert (res.status_code, res.json()["order_quantity"]) == (200, 1.5)
        assert res.json()["supplier"]["id"] == makro["id"]
        # The supplier renamed is the product's supplier renamed.
        client.patch(SUPPLIERS + "/%s" % makro["id"], json={"name": "Makro Sabadell"}, headers=_auth(token))
        assert _stock(client, token)["Pollo"]["supplier"]["name"] == "Makro Sabadell"

        res = _patch_item(client, token, pollo["id"], supplier_id=None, order_quantity=None)
        assert (res.json()["supplier"], res.json()["order_quantity"]) == (None, None)

    def test_without_them_it_is_as_it_was(self, client):
        token = _manager(client)
        agua = _item(client, token, "Agua")
        assert (agua["supplier"], agua["order_quantity"]) == (None, None)
        res = _patch_item(client, token, agua["id"], order_quantity=0)
        assert res.status_code == 422
        res = _patch_item(client, token, agua["id"], supplier_id=str(uuid.uuid4()))
        assert (res.status_code, _code(res)) == (404, "inventory_supplier_not_found")

    def test_the_list_costs_the_same_with_suppliers(self, client):
        """The supplier is read in the same query as the product."""
        from app.db import app_engine

        def statements_for(token) -> int:
            seen = []

            def count(*_args):
                seen.append(1)

            event.listen(app_engine, "before_cursor_execute", count)
            try:
                _stock(client, token)
            finally:
                event.remove(app_engine, "before_cursor_execute", count)
            return len(seen)

        bare, stocked = _manager(client), _manager(client)
        _item(client, bare, "Agua")
        for i in range(4):
            supplier = _supplier(client, stocked, "S%d" % i, None)
            _item(client, stocked, "P%d" % i, supplier_id=supplier["id"])
        assert statements_for(bare) == statements_for(stocked)


# --- What a sale leaves low ---------------------------------------------------------------


def _water(client, token, received=10, minimum=4, **fields):
    """Agua on the shelf and on the menu (linked by its name), with `received`
    in stock -- never counted, so everything received and sold is the stock."""
    section = _section(client, token, "Bebidas")
    agua = _item(client, token, "Agua", "botellas", min_quantity=minimum, **fields)
    if received:
        _receive(client, token, [(agua, received)], "2026-09-01T10:00:00Z")
    dish = _dish(client, token, section, "Agua", 2)
    return agua, dish


def _alerts(client, token, lines, **kwargs) -> list:
    return _sale(client, token, lines, **kwargs)["stock_alerts"]


@skip_no_db
class TestTheAlertOnASale:
    def test_below_the_minimum_then_critical_then_still_critical(self, client):
        token = _manager(client)
        makro = _supplier(client, token, "Makro", "612 345 678")
        agua, dish = _water(client, token, supplier_id=makro["id"], order_quantity=24)

        # 10 - 7 = 3: below 4, above half of it.
        [alert] = _alerts(client, token, [_line(dish, 7)])
        assert alert == {
            "item_id": agua["id"],
            "name": "Agua",
            "unit": "botellas",
            "on_hand": 3.0,
            "min_quantity": 4.0,
            "critical": False,
            "became_critical": False,
            "supplier": {"id": makro["id"], "name": "Makro", "phone": "612 345 678"},
            "order_quantity": 24.0,
            "photo_url": None,
        }
        # 3 - 1 = 2: half the minimum -- this sale made it critical.
        [alert] = _alerts(client, token, [_line(dish, 1)])
        assert (alert["on_hand"], alert["critical"], alert["became_critical"]) == (2.0, True, True)
        # 2 - 1 = 1: still critical, and not this sale's doing.
        [alert] = _alerts(client, token, [_line(dish, 1)])
        assert (alert["on_hand"], alert["critical"], alert["became_critical"]) == (1.0, True, False)
        # Below zero: more sold than there was. Still not news.
        [alert] = _alerts(client, token, [_line(dish, 3)])
        assert (alert["on_hand"], alert["critical"], alert["became_critical"]) == (-2.0, True, False)

    def test_straight_from_fine_to_nothing_left(self, client):
        token = _manager(client)
        _agua, dish = _water(client, token)
        [alert] = _alerts(client, token, [_line(dish, 10)])
        assert (alert["on_hand"], alert["critical"], alert["became_critical"]) == (0.0, True, True)

    def test_above_the_minimum_is_no_alert(self, client):
        token = _manager(client)
        _agua, dish = _water(client, token)
        assert _alerts(client, token, [_line(dish, 6)]) == []  # 4 left: at the minimum, not below

    def test_a_product_with_no_minimum_never_alerts(self, client):
        token = _manager(client)
        _agua, dish = _water(client, token, received=1, minimum=None)
        assert _alerts(client, token, [_line(dish, 5)]) == []

    def test_only_what_this_sale_took_from(self, client):
        token = _manager(client)
        _agua, agua_dish = _water(client, token)
        section = _section(client, token, "Cocina")
        _item(client, token, "Pollo", "kg", min_quantity=5)  # low, and not in this sale
        croquetas = _dish(client, token, section, "Croquetas", 9)
        [alert] = _alerts(
            client,
            token,
            [
                _line(agua_dish, 7),
                _line(croquetas, 1),  # no recipe, no product of its name
                {"dish_id": None, "name": "Caja del día", "unit_price": 10, "quantity": 1},
            ],
        )
        assert alert["name"] == "Agua"

    def test_every_product_of_a_recipe_in_one_answer(self, client):
        token = _manager(client)
        section = _section(client, token)
        pollo = _item(client, token, "Pollo", "kg", min_quantity=2)
        pan = _item(client, token, "Pan", "ud", min_quantity=10)
        _receive(client, token, [(pollo, 3), (pan, 40)], "2026-09-01T10:00:00Z")
        bocata = _dish(client, token, section, "Bocata de pollo", 6)
        _recipe(client, token, bocata, items=[(pollo, 0.5), (pan, 1)])
        # 4 bocatas: pollo 3 - 2 = 1 (critical, now); pan 40 - 4 = 36 (fine).
        [alert] = _alerts(client, token, [_line(bocata, 4)])
        assert (alert["name"], alert["on_hand"], alert["became_critical"]) == ("Pollo", 1.0, True)

    def test_an_archived_product_is_off_the_list_and_does_not_alert(self, client):
        token = _manager(client)
        section = _section(client, token)
        aceite = _item(client, token, "Aceite", "l", min_quantity=5)
        patatas = _dish(client, token, section, "Patatas", 3)
        _recipe(client, token, patatas, items=[(aceite, 1)])
        _patch_item(client, token, aceite["id"], archived=True)
        # Still taken off by its recipe -- and never counted, so below zero.
        sale = _sale(client, token, [_line(patatas, 1)])
        assert _taken(sale["id"]) == {aceite["id"]: D("1.000")}
        assert sale["stock_alerts"] == []

    def test_a_voided_sale_gives_back_what_it_took(self, client):
        """The sale that emptied the shelf is voided: the stock is back, and
        the next sale finds it where it was."""
        token = _manager(client)
        agua, dish = _water(client, token)
        emptied = _sale(client, token, [_line(dish, 8)])
        assert emptied["stock_alerts"][0]["became_critical"] is True
        voided = _void(client, token, emptied["id"])
        assert "stock_alerts" not in voided
        read = client.get(API + "/store/sales/%s" % emptied["id"], headers=_auth(token)).json()
        assert "stock_alerts" not in read
        assert _alerts(client, token, [_line(dish, 1)]) == []  # 10 - 1 = 9
        # And a sale that makes it critical again says so again.
        [alert] = _alerts(client, token, [_line(dish, 7)])
        assert (alert["on_hand"], alert["became_critical"]) == (2.0, True)
        assert agua["id"] == alert["item_id"]

    def test_the_same_save_sent_again_says_the_same(self, client):
        """Its answer was lost, so the till never opened the order: the
        repeat is answered with the same alerts, worked out the same way."""
        token = _manager(client)
        _agua, dish = _water(client, token)
        ref = str(uuid.uuid4())
        first = _sale(client, token, [_line(dish, 8)], client_ref=ref)
        assert first["stock_alerts"][0]["became_critical"] is True
        again = _post_sale(client, token, [_line(dish, 1)], client_ref=ref)
        assert (again.status_code, again.json()) == (200, first)

    def test_a_repeat_of_a_voided_sale_alerts_nothing(self, client):
        token = _manager(client)
        _agua, dish = _water(client, token)
        ref = str(uuid.uuid4())
        first = _sale(client, token, [_line(dish, 8)], client_ref=ref)
        _void(client, token, first["id"])
        again = _post_sale(client, token, [_line(dish, 8)], client_ref=ref)
        assert again.status_code == 200
        assert again.json()["stock_alerts"] == []

    def test_a_sale_a_count_already_reflects_moves_nothing(self, client):
        """Typed in late, for a day the last count already saw: the stock is
        where it was, so the product is low but nothing BECAME critical."""
        token = _manager(client)
        agua, dish = _water(client, token, received=0)
        # 22:00 in Madrid, after closing: the 10th's sales are in it.
        _count(client, token, [(agua, 3)], "2026-09-10T20:00:00Z", after_close=True)
        [alert] = _alerts(client, token, [_line(dish, 3)], sold_on="2026-09-10")
        assert (alert["on_hand"], alert["critical"], alert["became_critical"]) == (3.0, False, False)
        [alert] = _alerts(client, token, [_line(dish, 3)], sold_on="2026-09-11")
        assert (alert["on_hand"], alert["critical"], alert["became_critical"]) == (0.0, True, True)

    def test_never_counted_nor_received_the_first_sale_makes_it_critical(self, client):
        token = _manager(client)
        _agua, dish = _water(client, token, received=0)
        [alert] = _alerts(client, token, [_line(dish, 1)])
        assert (alert["on_hand"], alert["critical"], alert["became_critical"]) == (-1.0, True, True)
        [alert] = _alerts(client, token, [_line(dish, 1)])
        assert alert["became_critical"] is False

    def test_a_shop_without_the_inventory_hears_nothing_of_the_stock(self, client, monkeypatch):
        key = "pytest-shop-%s" % uuid.uuid4().hex[:8]
        filed = clients.profiles()
        shop_only = ClientProfile(name="Solo tienda", apps=["shifts", "store"])
        monkeypatch.setattr(clients, "profiles", lambda: {**filed, key: shop_only})
        token, org_id = _signup(client, "Solo tienda")
        _agua, dish = _water(client, token, received=0)
        _file_under(org_id, key)
        sale = _sale(client, token, [_line(dish, 3)])
        assert sale["stock_alerts"] == []

    def test_a_sale_costs_the_same_for_one_product_as_for_six(self, client):
        """One read of the stock for every product the sale left low, never
        one per product."""
        from app.db import app_engine

        def statements_for(token, lines) -> int:
            seen = []

            def count(*_args):
                seen.append(1)

            event.listen(app_engine, "before_cursor_execute", count)
            try:
                alerts = _alerts(client, token, lines)
            finally:
                event.remove(app_engine, "before_cursor_execute", count)
            assert all(a["became_critical"] for a in alerts) and alerts
            return len(seen)

        def furnish(token, n):
            section = _section(client, token)
            lines = []
            for i in range(n):
                product = _item(client, token, "P%d" % i, min_quantity=4)
                _receive(client, token, [(product, 5)], "2026-09-01T10:00:00Z")
                lines.append(_line(_dish(client, token, section, "P%d" % i, 1), 4))
            return lines

        one, six = _manager(client), _manager(client)
        assert statements_for(one, furnish(one, 1)) == statements_for(six, furnish(six, 6))


# --- "Agua" on the menu, Agua on the shelf -----------------------------------------------


@skip_no_db
class TestTheAutomaticLink:
    def test_selling_one_water_takes_one_water(self, client):
        token = _manager(client)
        agua, dish = _water(client, token, minimum=None)
        sale = _sale(client, token, [_line(dish, 1)])
        assert _taken(sale["id"]) == {agua["id"]: D("1.000")}
        stock = _stock(client, token)["Agua"]
        assert stock["received_since_count"] - stock["sold_since_count"] == 9

        listed = _recipes(client, token)["Agua"]
        assert listed["has_recipe"] is False
        assert (listed["items"], listed["components"]) == ([], [])
        assert listed["auto_item"] == {
            "item_id": agua["id"],
            "name": "Agua",
            "unit": "botellas",
            "photo_url": None,
        }
        assert (listed["auto_ambiguous"], listed["auto_matches"]) == (False, [])
        assert listed["expanded"] == [
            {
                "item_id": agua["id"],
                "name": "Agua",
                "unit": "botellas",
                "quantity": 1.0,
                "archived": False,
                "photo_url": None,
            }
        ]

    def test_a_combo_takes_its_component_that_has_no_recipe(self, client):
        token = _manager(client)
        section = _section(client, token)
        pollo = _item(client, token, "Pollo", "kg")
        agua = _item(client, token, "Agua")
        crispy = _dish(client, token, section, "Crispy", 9)
        water = _dish(client, token, section, "agua", 2)
        combo = _dish(client, token, section, "Combo Crispy", 10)
        _recipe(client, token, crispy, items=[(pollo, 0.75)])
        _recipe(client, token, combo, components=[(crispy, 1), (water, 1)])

        sale = _sale(client, token, [_line(combo, 2)])
        assert _taken(sale["id"]) == {pollo["id"]: D("1.500"), agua["id"]: D("2.000")}
        listed = _recipes(client, token)
        assert {e["name"]: e["quantity"] for e in listed["Combo Crispy"]["expanded"]} == {
            "Agua": 1.0,
            "Pollo": 0.75,
        }
        # The combo has a recipe of its own, so no link of its own.
        assert listed["Combo Crispy"]["auto_item"] is None

    def test_a_recipe_of_its_own_always_wins(self, client):
        token = _manager(client)
        section = _section(client, token)
        agua = _item(client, token, "Agua")
        garrafa = _item(client, token, "Garrafa", "l")
        dish = _dish(client, token, section, "Agua", 2)
        saved = _recipe(client, token, dish, items=[(garrafa, 0.5)])
        assert (saved["has_recipe"], saved["auto_item"]) == (True, None)
        sale = _sale(client, token, [_line(dish, 2)])
        assert _taken(sale["id"]) == {garrafa["id"]: D("1.000")}

        # An empty recipe is no recipe: the link is back.
        cleared = _recipe(client, token, dish)
        assert (cleared["has_recipe"], cleared["auto_item"]["item_id"]) == (False, agua["id"])
        sale = _sale(client, token, [_line(dish, 2)])
        assert _taken(sale["id"]) == {agua["id"]: D("2.000")}

    def test_two_products_called_the_same_take_nothing_and_say_so(self, client):
        token = _manager(client)
        section = _section(client, token)
        a = _item(client, token, "Agua", "botellas")
        b = _item(client, token, "AGUA ", "garrafas")
        dish = _dish(client, token, section, "Agua", 2)
        sale = _sale(client, token, [_line(dish, 3)])
        assert _taken(sale["id"]) == {}
        listed = _recipes(client, token)["Agua"]
        assert (listed["auto_item"], listed["auto_ambiguous"], listed["expanded"]) == (None, True, [])
        assert sorted(m["item_id"] for m in listed["auto_matches"]) == sorted([a["id"], b["id"]])
        assert set(listed["auto_matches"][0]) == {"item_id", "name", "unit", "photo_url"}

    def test_an_archived_product_is_not_linked(self, client):
        token = _manager(client)
        section = _section(client, token)
        old = _item(client, token, "Agua")
        _patch_item(client, token, old["id"], archived=True)
        dish = _dish(client, token, section, "Agua", 2)
        assert _taken(_sale(client, token, [_line(dish)])["id"]) == {}
        assert _recipes(client, token)["Agua"]["auto_item"] is None
        # With the archived one out of the way, the one on the list is the match.
        new = _item(client, token, "Água")
        assert _taken(_sale(client, token, [_line(dish)])["id"]) == {new["id"]: D("1.000")}
        listed = _recipes(client, token)["Agua"]
        assert (listed["auto_item"]["item_id"], listed["auto_ambiguous"]) == (new["id"], False)

    def test_without_case_or_accents(self, client):
        token = _manager(client)
        section = _section(client, token)
        agua = _item(client, token, "Água")
        dish = _dish(client, token, section, "  agua ", 2)
        assert _taken(_sale(client, token, [_line(dish, 2)])["id"]) == {agua["id"]: D("2.000")}

    def test_what_a_sale_took_does_not_change_when_the_product_is_renamed(self, client):
        token = _manager(client)
        agua, dish = _water(client, token, minimum=None)
        sale = _sale(client, token, [_line(dish, 2)])
        res = _patch_item(client, token, agua["id"], name="Agua mineral")
        assert res.status_code == 200
        assert _taken(sale["id"]) == {agua["id"]: D("2.000")}
        # The next sale of "Agua" has nothing of its name to take.
        assert _taken(_sale(client, token, [_line(dish, 1)])["id"]) == {}
        assert _recipes(client, token)["Agua"]["auto_item"] is None

    def test_another_business_is_never_linked(self, client):
        mine, theirs = _manager(client), _manager(client)
        _item(client, theirs, "Agua")
        section = _section(client, mine)
        dish = _dish(client, mine, section, "Agua", 2)
        assert _taken(_sale(client, mine, [_line(dish)])["id"]) == {}
        assert _recipes(client, mine)["Agua"]["auto_item"] is None


# --- The tables -------------------------------------------------------------------------


@skip_no_db
class TestTheNameBehindARecipe:
    def test_a_dish_with_its_own_recipe_still_says_which_product_is_called_the_same(
        self, client
    ):
        """Emptying its recipe would bring the link back; the editor says so
        before, from `name_match`."""
        token = _manager(client)
        agua, dish = _water(client, token, minimum=None)
        hielo = _item(client, token, "Hielo", "kg")
        _recipe(client, token, dish, items=[(hielo, 0.1)])
        listed = _recipes(client, token)["Agua"]
        assert listed["has_recipe"] is True
        assert listed["auto_item"] is None
        assert listed["name_match"] == {
            "item_id": agua["id"],
            "name": "Agua",
            "unit": "botellas",
            "photo_url": None,
        }
        # And a dish called like nothing has none.
        section = _section(client, token, "Postres")
        _dish(client, token, section, "Tarta", 4)
        assert _recipes(client, token)["Tarta"]["name_match"] is None


@skip_no_db
class TestTwoSalesAtOnce:
    def test_a_sale_reads_the_stock_only_after_the_one_before_has_committed(
        self, client
    ):
        """Two sales saved together each read the stock with their own rows and
        not the other's (water at 7, minimum 10: both answer 6, the shelf ends
        at 5, and neither says it became critical). So a sale waits for the
        business's alert lock before it reads, and that lock is held until the
        sale before it commits. Held here from outside: the sale waits, and
        goes on the moment it is let go."""
        import threading

        from app.db import admin_engine

        token = _manager(client)
        agua, dish = _water(client, token, received=7, minimum=10)
        key = {"k": "stock-alerts:%s" % _org_id(client, token)}
        answers = {}
        done = threading.Event()

        def sell():
            answers["sale"] = _post_sale(
                client, token, [_line(dish, 1)], client_ref=str(uuid.uuid4())
            )
            done.set()

        with admin_engine.connect() as conn:
            conn.execute(text("SELECT pg_advisory_lock(hashtextextended(:k, 0))"), key)
            try:
                thread = threading.Thread(target=sell)
                thread.start()
                assert not done.wait(1.5), "the sale read the stock past the lock"
            finally:
                conn.execute(text("SELECT pg_advisory_unlock(hashtextextended(:k, 0))"), key)
        assert done.wait(20)
        thread.join(5)
        assert answers["sale"].status_code == 201, answers["sale"].text
        [alert] = answers["sale"].json()["stock_alerts"]
        assert alert["on_hand"] == 6


@skip_no_db
class TestTheTables:
    def test_suppliers_are_behind_row_level_security(self, client):
        from app.db import admin_engine

        with admin_engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname = 'inventory_supplier'"
                )
            ).one()
        assert tuple(row) == (True, True)

        mine, theirs = _manager(client), _manager(client)
        their_makro = _supplier(client, theirs, "Makro")
        conn, trans = _as_runtime(_org_id(client, mine))
        try:
            seen = conn.execute(
                text("SELECT count(*) FROM inventory_supplier WHERE id = :s"),
                {"s": their_makro["id"]},
            ).scalar()
        finally:
            trans.rollback()
            conn.close()
        assert seen == 0

    def test_the_database_refuses_a_neighbours_supplier(self, client):
        """The key is on (supplier_id, org_id): even past the API, a product
        cannot name another business's supplier. Checked at the commit."""
        from sqlalchemy.exc import IntegrityError

        mine, theirs = _manager(client), _manager(client)
        pollo = _item(client, mine, "Pollo")
        their_makro = _supplier(client, theirs, "Makro")
        conn, trans = _as_runtime(_org_id(client, mine))
        try:
            with pytest.raises(IntegrityError, match="inventory_item_supplier_fkey"):
                conn.execute(
                    text("UPDATE inventory_item SET supplier_id = :s WHERE id = :i"),
                    {"s": their_makro["id"], "i": pollo["id"]},
                )
                trans.commit()
        finally:
            conn.close()
        assert _stock(client, mine)["Pollo"]["supplier"] is None

    def test_the_database_refuses_deleting_a_supplier_a_product_still_names(self, client):
        """The key only refuses: leaving the products without a supplier is
        the route's to do, and a delete that forgets fails rather than leave a
        product pointing at nothing."""
        from sqlalchemy.exc import IntegrityError

        token = _manager(client)
        makro = _supplier(client, token, "Makro")
        _item(client, token, "Pollo", supplier_id=makro["id"])
        conn, trans = _as_runtime(_org_id(client, token))
        try:
            with pytest.raises(IntegrityError, match="inventory_item_supplier_fkey"):
                conn.execute(text("DELETE FROM inventory_supplier WHERE id = :s"), {"s": makro["id"]})
                trans.commit()
        finally:
            conn.close()
        assert _stock(client, token)["Pollo"]["supplier"]["id"] == makro["id"]

    @pytest.mark.parametrize(
        "phone, name",
        [("612.345.678", "Makro"), ("123", "Makro"), (None, ""), (None, "x" * 121)],
    )
    def test_the_database_says_what_the_route_says(self, client, phone, name):
        from sqlalchemy.exc import IntegrityError

        token = _manager(client)
        org_id = _org_id(client, token)
        conn, trans = _as_runtime(org_id)
        try:
            with pytest.raises(IntegrityError, match="inventory_supplier_(phone|name)_check"):
                conn.execute(
                    text("INSERT INTO inventory_supplier (org_id, name, phone) VALUES (:o, :n, :p)"),
                    {"o": org_id, "n": name, "p": phone},
                )
        finally:
            trans.rollback()
            conn.close()

    def test_deleting_a_supplier_waits_for_a_product_being_given_it(self, client):
        """A product is being saved with the supplier (its lock and its row
        written, not yet committed) when the supplier is deleted: the delete
        waits, and then leaves that product without a supplier too -- a 204,
        not the key's error at the commit."""
        import threading

        token = _manager(client)
        makro = _supplier(client, token, "Makro")
        pollo = _item(client, token, "Pollo")
        answer = {}
        conn, trans = _as_runtime(_org_id(client, token))
        try:
            conn.execute(
                text("SELECT id FROM inventory_supplier WHERE id = :s FOR KEY SHARE"),
                {"s": makro["id"]},
            )
            conn.execute(
                text("UPDATE inventory_item SET supplier_id = :s WHERE id = :i"),
                {"s": makro["id"], "i": pollo["id"]},
            )
            waiter = threading.Thread(
                target=lambda: answer.update(
                    res=client.delete(SUPPLIERS + "/%s" % makro["id"], headers=_auth(token))
                )
            )
            waiter.start()
            waiter.join(1.0)
            assert waiter.is_alive(), "the delete did not wait for the product"
            trans.commit()
        finally:
            conn.close()
        waiter.join(10)
        assert answer["res"].status_code == 204, answer["res"].text
        assert _stock(client, token)["Pollo"]["supplier"] is None
        assert _suppliers(client, token) == []

    def test_a_product_given_a_supplier_being_deleted_hears_it_is_gone(self, client):
        """The other way round: the supplier is being deleted when a product
        is given it. The product waits, and hears 404 -- not the key's error
        at the commit."""
        import threading

        token = _manager(client)
        makro = _supplier(client, token, "Makro")
        pollo = _item(client, token, "Pollo")
        answer = {}
        conn, trans = _as_runtime(_org_id(client, token))
        try:
            conn.execute(
                text("SELECT id FROM inventory_supplier WHERE id = :s FOR UPDATE"),
                {"s": makro["id"]},
            )
            conn.execute(text("DELETE FROM inventory_supplier WHERE id = :s"), {"s": makro["id"]})
            waiter = threading.Thread(
                target=lambda: answer.update(
                    res=_patch_item(client, token, pollo["id"], supplier_id=makro["id"])
                )
            )
            waiter.start()
            waiter.join(1.0)
            assert waiter.is_alive(), "the product did not wait for the delete"
            trans.commit()
        finally:
            conn.close()
        waiter.join(10)
        res = answer["res"]
        assert (res.status_code, _code(res)) == (404, "inventory_supplier_not_found")
        assert _stock(client, token)["Pollo"]["supplier"] is None

    def test_a_business_with_suppliers_can_still_be_deleted(self, client):
        from app.db import admin_engine

        token = _manager(client)
        makro = _supplier(client, token, "Makro")
        _item(client, token, "Pollo", supplier_id=makro["id"], order_quantity=5)
        _item(client, token, "Agua", supplier_id=makro["id"])
        me = client.get(API + "/auth/me", headers=_auth(token)).json()
        res = client.request(
            "DELETE", API + "/org", json={"confirm": me["org_name"]}, headers=_auth(token)
        )
        assert res.status_code == 204, res.text
        with admin_engine.connect() as conn:
            left = conn.execute(
                text("SELECT count(*) FROM inventory_supplier WHERE org_id = :o"),
                {"o": me["org_id"]},
            ).scalar()
        assert left == 0
