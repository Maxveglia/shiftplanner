"""Recipes: what each product of the Tienda is made of, and what a sale takes
off the stock (Max, 27-sep-2026).

The arithmetic and the shape of the graph need no database and are pinned
first. The rest goes through the API -- the recipes, the sales, the stock and
the counts -- as a manager, as an employee, as another business and as a
business without the apps.
"""

import importlib.util
import uuid
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, localcontext
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import event, text

from app import clients
from app.clients import ClientProfile
from app.schemas.recipes import (
    COMPONENT_QUANTITY_CEILING,
    ITEM_QUANTITY_CEILING,
    RecipeComponentIn,
    RecipeIn,
    RecipeItemIn,
)
from app.services import recipes
from app.services.recipes import MAX_DEPTH, RecipeBook
from tests import menu_photo_samples as samples
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    _employee_token,
    _signup,
    client,
    skip_no_db,
)

API = "/api/v1"
VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"

D = Decimal


# --- The arithmetic, without a database --------------------------------------------


def _ids(n):
    return [uuid.uuid4() for _ in range(n)]


class TestExpanding:
    def test_the_example_max_gave(self):
        """Crispy Grande = 0.75 kg chicken + 0.1 kg onion; Combo Grande =
        1 Crispy Grande + 1 Patatas (0.2 kg potato). Three combos and two
        Crispy Grande: chicken 3.75, onion 0.5, potato 0.6 -- exactly."""
        pollo, cebolla, patata = _ids(3)
        crispy, patatas, combo = _ids(3)
        book = RecipeBook(
            items={
                crispy: [(pollo, D("0.75")), (cebolla, D("0.1"))],
                patatas: [(patata, D("0.2"))],
            },
            components={combo: [(crispy, D("1")), (patatas, D("1"))]},
        )
        taken = recipes.expand(book, [(combo, D("3")), (crispy, D("2"))])
        assert taken == {pollo: D("3.750"), cebolla: D("0.500"), patata: D("0.600")}
        assert recipes.per_unit(book, combo) == {
            pollo: D("0.750"),
            cebolla: D("0.100"),
            patata: D("0.200"),
        }

    def test_rounded_once_at_the_end_not_at_every_step(self):
        """A third of a kilo in half a portion, three times: 0.333 x 0.5 x 3 =
        0.4995, which is 0.500. Rounding the half portion first (0.1665 ->
        0.167) and multiplying after would say 0.501."""
        queso, media, combo = _ids(3)
        book = RecipeBook(
            items={media: [(queso, D("0.333"))]},
            components={combo: [(media, D("0.5"))]},
        )
        assert recipes.expand(book, [(combo, D("3"))]) == {queso: D("0.500")}
        # One unit, rounded as a sale of one would be.
        assert recipes.per_unit(book, combo) == {queso: D("0.167")}

    @pytest.mark.parametrize(
        "per_unit, sold, taken",
        [
            (D("0.75"), D("1"), D("0.750")),  # three quarters
            (D("0.5"), D("3"), D("1.500")),  # a half
            (D("0.333"), D("3"), D("0.999")),  # a third, as the column keeps it
            (D("0.333"), D("1.5"), D("0.500")),  # 0.4995, half up
            (D("1"), D("0.25"), D("0.250")),  # a quarter of a portion sold
        ],
    )
    def test_fractions(self, per_unit, sold, taken):
        item, dish = _ids(2)
        book = RecipeBook(items={dish: [(item, per_unit)]})
        assert recipes.expand(book, [(dish, sold)]) == {item: taken}

    def test_what_rounds_to_nothing_is_not_kept(self):
        sal, pizca, plato = _ids(3)
        book = RecipeBook(
            items={pizca: [(sal, D("0.001"))]},
            components={plato: [(pizca, D("0.001"))]},
        )
        assert recipes.expand(book, [(plato, D("1"))]) == {}
        assert recipes.expand(book, [(plato, D("1000"))]) == {sal: D("0.001")}

    def test_combos_inside_combos_multiply_and_add_up(self):
        """Menú Familiar = 2 Combo Grande + 1 Crispy Grande; the chicken of the
        Crispy is counted three times over, the potato twice."""
        pollo, patata = _ids(2)
        crispy, patatas, combo, familiar = _ids(4)
        book = RecipeBook(
            items={crispy: [(pollo, D("0.75"))], patatas: [(patata, D("0.2"))]},
            components={
                combo: [(crispy, D("1")), (patatas, D("1"))],
                familiar: [(combo, D("2")), (crispy, D("1"))],
            },
        )
        assert recipes.expand(book, [(familiar, D("2"))]) == {
            pollo: D("4.500"),
            patata: D("0.800"),
        }

    def test_a_dish_with_ingredients_and_components_takes_both(self):
        pollo, salsa = _ids(2)
        crispy, extra = _ids(2)
        book = RecipeBook(
            items={crispy: [(pollo, D("0.75"))], extra: [(salsa, D("0.05"))]},
            components={extra: [(crispy, D("1"))]},
        )
        assert recipes.expand(book, [(extra, D("2"))]) == {
            pollo: D("1.500"),
            salsa: D("0.100"),
        }

    def test_the_same_product_from_several_paths_is_one_line(self):
        pollo = uuid.uuid4()
        a, b, combo = _ids(3)
        book = RecipeBook(
            items={a: [(pollo, D("0.25"))], b: [(pollo, D("0.5"))], combo: [(pollo, D("0.125"))]},
            components={combo: [(a, D("1")), (b, D("2"))]},
        )
        # 0.125 + 0.25 + 2 x 0.5 = 1.375, per combo.
        assert recipes.expand(book, [(combo, D("2")), (a, D("1"))]) == {pollo: D("3.000")}

    def test_no_recipe_and_unknown_dishes_take_nothing(self):
        assert recipes.expand(RecipeBook(), [(uuid.uuid4(), D("5"))]) == {}

    def test_every_digit_is_kept_until_the_end(self):
        """Big factors, and no digit lost on the way: the default context of
        28 digits would have rounded the product in the middle."""
        item, a, b, c = _ids(4)
        book = RecipeBook(
            items={c: [(item, D("99999.999"))]},
            components={a: [(b, D("999.999"))], b: [(c, D("999.999"))]},
        )
        with localcontext() as ctx:
            ctx.prec = 100
            exact = D("99999.999") * D("999.999") * D("999.999") * D("999999.999")
            rounded = exact.quantize(D("0.001"), rounding=ROUND_HALF_UP)
        assert len(exact.as_tuple().digits) > 28
        assert recipes.expand(book, [(a, D("999999.999"))]) == {item: rounded}

    def test_a_circle_in_stored_data_does_not_hang_a_sale(self):
        """The API never writes one; if one were ever there, the edge that
        closes it takes nothing rather than looping for ever."""
        pollo = uuid.uuid4()
        a, b = _ids(2)
        book = RecipeBook(
            items={a: [(pollo, D("1"))], b: [(pollo, D("2"))]},
            components={a: [(b, D("1"))], b: [(a, D("1"))]},
        )
        assert recipes.expand(book, [(a, D("1"))]) == {pollo: D("3.000")}


class TestTheShapeOfTheGraph:
    def test_no_circle(self):
        a, b, c = _ids(3)
        assert recipes.cycle_through({a: [b, c], b: [c]}, a) is None

    def test_a_dish_inside_itself(self):
        a = uuid.uuid4()
        assert recipes.cycle_through({a: [a]}, a) == [a, a]

    def test_a_circle_through_others_names_every_dish_on_it(self):
        a, b, c, d = _ids(4)
        graph = {a: [d, b], b: [c], c: [a], d: []}
        assert recipes.cycle_through(graph, a) == [a, b, c, a]

    def test_depth_is_levels_of_components(self):
        chain = _ids(MAX_DEPTH + 2)
        graph = {chain[i]: [chain[i + 1]] for i in range(len(chain) - 1)}
        # A dish with no components is at no level; one that includes it, one.
        assert recipes.depth_through(graph, chain[-1]) == len(chain) - 1
        assert recipes.depth_through(graph, chain[0]) == len(chain) - 1
        assert recipes.depth_through({chain[0]: []}, chain[0]) == 0

    def test_depth_counts_the_combos_that_already_include_the_dish(self):
        top, middle, dish, below = _ids(4)
        graph = {top: [middle], middle: [dish], dish: [below]}
        assert recipes.depth_through(graph, dish) == 3


class TestSchema:
    @pytest.mark.parametrize(
        "sent, kept", [(0.75, 0.75), (0.5, 0.5), (1 / 3, 0.333), (2 / 3, 0.667), (0.0005, 0.001)]
    )
    def test_a_quantity_is_kept_to_the_thousandth_half_up(self, sent, kept):
        item = RecipeItemIn(item_id=uuid.uuid4(), quantity=sent)
        assert item.quantity == kept
        assert RecipeComponentIn(dish_id=uuid.uuid4(), quantity=sent).quantity == kept

    @pytest.mark.parametrize(
        "sent", [0, -1, 0.0004, ITEM_QUANTITY_CEILING, ITEM_QUANTITY_CEILING - 0.0004]
    )
    def test_an_ingredient_quantity_the_column_cannot_hold_is_refused(self, sent):
        with pytest.raises(ValidationError):
            RecipeItemIn(item_id=uuid.uuid4(), quantity=sent)

    @pytest.mark.parametrize("sent", [0, COMPONENT_QUANTITY_CEILING])
    def test_a_component_quantity_past_the_wall_is_refused(self, sent):
        with pytest.raises(ValidationError):
            RecipeComponentIn(dish_id=uuid.uuid4(), quantity=sent)

    def test_both_lists_are_required(self):
        """A client that forgets one does not wipe it without meaning to."""
        assert RecipeIn(items=[], components=[]).items == []
        with pytest.raises(ValidationError):
            RecipeIn(items=[])
        with pytest.raises(ValidationError):
            RecipeIn(components=[])


class TestTheDayOfACount:
    """Which day's sales a count already reflects, on Madrid's clock."""

    @pytest.mark.parametrize(
        "counted_at, after_close, through",
        [
            # 09:00 in Madrid (summer, UTC+2): before opening -> the day before.
            ("2026-09-10T07:00:00+00:00", None, "2026-09-09"),
            # 11:59 is still before noon; 12:00 is not.
            ("2026-09-10T09:59:00+00:00", None, "2026-09-09"),
            ("2026-09-10T10:00:00+00:00", None, "2026-09-10"),
            # 23:00: after closing -> the day itself.
            ("2026-09-10T21:00:00+00:00", None, "2026-09-10"),
            # 00:30 on the 11th in Madrid is still the 10th in UTC.
            ("2026-09-10T22:30:00+00:00", None, "2026-09-10"),
            # The manager's word beats the hour, both ways.
            ("2026-09-10T21:00:00+00:00", False, "2026-09-09"),
            ("2026-09-10T07:00:00+00:00", True, "2026-09-10"),
            # Winter, UTC+1: 11:30Z is 12:30 in Madrid.
            ("2026-01-15T11:30:00+00:00", None, "2026-01-15"),
            ("2026-01-15T10:30:00+00:00", None, "2026-01-14"),
            # No zone: read as UTC.
            ("2026-09-10T07:00:00", None, "2026-09-09"),
            # A late close: 02:30 on the 11th in Madrid, "after closing", is
            # the night of the 10th -- not the 11th, whose sales are to come.
            ("2026-09-11T00:30:00+00:00", True, "2026-09-10"),
            # Before opening at that hour is the same day: the two agree.
            ("2026-09-11T00:30:00+00:00", False, "2026-09-10"),
            # From six it is the day itself again.
            ("2026-09-11T04:00:00+00:00", True, "2026-09-11"),
        ],
    )
    def test_sales_through(self, counted_at, after_close, through):
        from app.routers.inventory import _sales_through

        moment = datetime.fromisoformat(counted_at)
        assert _sales_through(moment, after_close).isoformat() == through


# --- Through the API ----------------------------------------------------------------


def _manager(client) -> str:
    token, _org = _signup(client, "Recetas Co")
    return token


def _section(client, token, name="Carta") -> str:
    res = client.post(API + "/menu/sections", json={"name": name}, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _dish(client, token, section_id, name, price=10) -> dict:
    res = client.post(
        API + "/menu/dishes",
        json={"section_id": section_id, "name": name, "price": price},
        headers=_auth(token),
    )
    assert res.status_code == 201, res.text
    return res.json()


def _product(client, token, name, unit="kg") -> dict:
    res = client.post(
        API + "/inventory/items", json={"name": name, "unit": unit}, headers=_auth(token)
    )
    assert res.status_code == 201, res.text
    return res.json()


def _put(client, token, dish_id, items=(), components=()):
    return client.put(
        API + "/store/recipes/%s" % dish_id,
        json={
            "items": [{"item_id": i["id"], "quantity": q} for i, q in items],
            "components": [{"dish_id": d["id"], "quantity": q} for d, q in components],
        },
        headers=_auth(token),
    )


def _recipe(client, token, dish, items=(), components=()) -> dict:
    res = _put(client, token, dish["id"], items, components)
    assert res.status_code == 200, res.text
    return res.json()


def _recipes(client, token) -> dict:
    res = client.get(API + "/store/recipes", headers=_auth(token))
    assert res.status_code == 200, res.text
    return {d["name"]: d for s in res.json()["sections"] for d in s["dishes"]}


def _line(dish, quantity=1) -> dict:
    return {
        "dish_id": dish["id"],
        "name": dish["name"],
        "unit_price": dish["price"],
        "quantity": quantity,
    }


def _post_sale(client, token, lines, sold_on="2026-09-10", client_ref=None):
    return client.post(
        API + "/store/sales",
        json={
            "sold_on": sold_on,
            "client_ref": client_ref or str(uuid.uuid4()),
            "lines": lines,
        },
        headers=_auth(token),
    )


def _sale(client, token, lines, sold_on="2026-09-10", client_ref=None) -> dict:
    res = _post_sale(client, token, lines, sold_on, client_ref)
    assert res.status_code == 201, res.text
    return res.json()


def _stock(client, token) -> dict:
    res = client.get(
        API + "/inventory/items", params={"include_archived": True}, headers=_auth(token)
    )
    assert res.status_code == 200, res.text
    return {i["name"]: i for i in res.json()}


def _count(client, token, lines, counted_at, after_close=None) -> dict:
    body = {
        "counted_at": counted_at,
        "lines": [{"item_id": i["id"], "quantity": q} for i, q in lines],
    }
    if after_close is not None:
        body["after_close"] = after_close
    res = client.post(API + "/inventory/counts", json=body, headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()


def _receive(client, token, lines, received_at) -> None:
    res = client.post(
        API + "/inventory/receipts",
        json={
            "received_at": received_at,
            "lines": [{"item_id": i["id"], "quantity": q} for i, q in lines],
        },
        headers=_auth(token),
    )
    assert res.status_code == 201, res.text


def _code(res) -> str:
    return res.json()["detail"]["code"]


def _taken(sale_id) -> dict:
    """What a sale took, as stored: {product id: Decimal}."""
    from app.db import admin_engine

    with admin_engine.connect() as conn:
        rows = conn.execute(
            text("SELECT item_id, quantity FROM store_sale_consumption WHERE sale_id = :s"),
            {"s": sale_id},
        ).all()
    return {str(item_id): quantity for item_id, quantity in rows}


def _crispy_menu(client, token) -> dict:
    """Max's example: Crispy Grande, Patatas and the Combo Grande of both."""
    section = _section(client, token)
    menu = {
        "pollo": _product(client, token, "Pollo"),
        "cebolla": _product(client, token, "Cebolla"),
        "patata": _product(client, token, "Patata"),
        "crispy": _dish(client, token, section, "Crispy Grande", 10),
        "patatas": _dish(client, token, section, "Patatas", 3),
        "combo": _dish(client, token, section, "Combo Crispy Grande", 11),
    }
    _recipe(client, token, menu["crispy"], items=[(menu["pollo"], 0.75), (menu["cebolla"], 0.1)])
    _recipe(client, token, menu["patatas"], items=[(menu["patata"], 0.2)])
    _recipe(client, token, menu["combo"], components=[(menu["crispy"], 1), (menu["patatas"], 1)])
    return menu


@skip_no_db
class TestTheExample:
    def test_three_combos_and_two_crispy(self, client):
        token = _manager(client)
        m = _crispy_menu(client, token)
        sale = _sale(client, token, [_line(m["combo"], 3), _line(m["crispy"], 2)])

        assert _taken(sale["id"]) == {
            m["pollo"]["id"]: D("3.750"),
            m["cebolla"]["id"]: D("0.500"),
            m["patata"]["id"]: D("0.600"),
        }
        # Never counted: the stock is what the sales took, below zero.
        stock = _stock(client, token)
        assert stock["Pollo"]["sold_since_count"] == 3.75
        assert stock["Cebolla"]["sold_since_count"] == 0.5
        assert stock["Patata"]["sold_since_count"] == 0.6
        assert stock["Pollo"]["sold_between_counts"] is None
        # And the answer to the sale is the sale, nothing about recipes --
        # only which products it left below their minimum: none has one here.
        assert set(sale) == {
            "id",
            "sold_on",
            "note",
            "total",
            "created_at",
            "payment_method",
            "source",
            "created_by_name",
            "voided_at",
            "voided_by_name",
            "void_reason",
            "lines",
            "stock_alerts",
        }
        assert sale["stock_alerts"] == []

    def test_the_list_says_what_each_product_is_and_takes(self, client):
        token = _manager(client)
        m = _crispy_menu(client, token)
        listed = _recipes(client, token)

        combo = listed["Combo Crispy Grande"]
        assert combo["has_recipe"] is True
        assert combo["items"] == []
        assert combo["components"] == [
            {"dish_id": m["crispy"]["id"], "name": "Crispy Grande", "quantity": 1.0},
            {"dish_id": m["patatas"]["id"], "name": "Patatas", "quantity": 1.0},
        ]
        assert combo["expanded"] == [
            {"item_id": m["cebolla"]["id"], "name": "Cebolla", "unit": "kg", "quantity": 0.1, "archived": False, "photo_url": None},
            {"item_id": m["patata"]["id"], "name": "Patata", "unit": "kg", "quantity": 0.2, "archived": False, "photo_url": None},
            {"item_id": m["pollo"]["id"], "name": "Pollo", "unit": "kg", "quantity": 0.75, "archived": False, "photo_url": None},
        ]
        crispy = listed["Crispy Grande"]
        assert crispy["items"] == [
            {"item_id": m["cebolla"]["id"], "name": "Cebolla", "unit": "kg", "quantity": 0.1, "archived": False, "photo_url": None},
            {"item_id": m["pollo"]["id"], "name": "Pollo", "unit": "kg", "quantity": 0.75, "archived": False, "photo_url": None},
        ]
        assert crispy["components"] == []

    def test_every_dish_of_the_menu_is_listed_in_its_order_with_or_without(self, client):
        token = _manager(client)
        first = _section(client, token, "Primero")
        second = _section(client, token, "Bebidas")
        a = _dish(client, token, first, "Zeta")
        _dish(client, token, first, "Alfa")
        _dish(client, token, second, "Agua", 1)
        pollo = _product(client, token, "Pollo")
        _recipe(client, token, a, items=[(pollo, 1)])

        res = client.get(API + "/store/recipes", headers=_auth(token))
        sections = res.json()["sections"]
        assert [(s["name"], [d["name"] for d in s["dishes"]]) for s in sections] == [
            ("Primero", ["Zeta", "Alfa"]),
            ("Bebidas", ["Agua"]),
        ]
        by_name = {d["name"]: d for s in sections for d in s["dishes"]}
        assert by_name["Zeta"]["has_recipe"] is True
        assert by_name["Alfa"] == {
            "id": by_name["Alfa"]["id"],
            "section_id": first,
            "name": "Alfa",
            "photo_url": None,
            "has_recipe": False,
            "items": [],
            "components": [],
            "expanded": [],
            "auto_item": None,
            "auto_ambiguous": False,
            "auto_matches": [],
            "name_match": None,
        }

    def test_each_dish_comes_with_its_photo_from_the_menu(self, client):
        # Max, 28-sep-2026: "que en esta pantalla también salgan los logos de
        # cada producto". The same address the menu gives, read in the same
        # query as the dish; none for a dish without one.
        token = _manager(client)
        section = _section(client, token)
        crispy = _dish(client, token, section, "Crispy")
        agua = _dish(client, token, section, "Agua", 1)
        res = client.put(
            API + "/menu/dishes/%s/photo" % crispy["id"],
            content=samples.JPEG,
            headers={**_auth(token), "Content-Type": "image/jpeg"},
        )
        assert res.status_code == 200, res.text
        url = res.json()["photo_url"]
        assert url.startswith(API + "/menu/photos/")

        listed = _recipes(client, token)
        assert listed["Crispy"]["photo_url"] == url
        assert listed["Agua"]["photo_url"] is None
        # A save answers with the dish as the list has it, photo included.
        pollo = _product(client, token, "Pollo")
        assert _recipe(client, token, crispy, items=[(pollo, 1)])["photo_url"] == url
        assert _recipe(client, token, agua)["photo_url"] is None

        res = client.delete(API + "/menu/dishes/%s/photo" % crispy["id"], headers=_auth(token))
        assert res.status_code == 204, res.text
        assert _recipes(client, token)["Crispy"]["photo_url"] is None


@skip_no_db
class TestEditing:
    def test_a_save_replaces_the_whole_recipe_and_answers_with_the_dish(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Crispy")
        pollo, cebolla = _product(client, token, "Pollo"), _product(client, token, "Cebolla")

        first = _recipe(client, token, dish, items=[(pollo, 0.75), (cebolla, 0.1)])
        assert [i["name"] for i in first["items"]] == ["Cebolla", "Pollo"]
        second = _recipe(client, token, dish, items=[(pollo, 1)])
        assert second["items"] == [
            {"item_id": pollo["id"], "name": "Pollo", "unit": "kg", "quantity": 1.0, "archived": False, "photo_url": None}
        ]
        assert second == _recipes(client, token)["Crispy"]

        empty = _recipe(client, token, dish)
        assert (empty["has_recipe"], empty["items"], empty["components"], empty["expanded"]) == (
            False,
            [],
            [],
            [],
        )

    def test_fractions_as_the_screen_sends_them(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Plato")
        a, b, c = (_product(client, token, n) for n in ("Tres cuartos", "Medio", "Tercio"))
        saved = _recipe(client, token, dish, items=[(a, 3 / 4), (b, 1 / 2), (c, 1 / 3)])
        assert {i["name"]: i["quantity"] for i in saved["items"]} == {
            "Tres cuartos": 0.75,
            "Medio": 0.5,
            "Tercio": 0.333,
        }
        sale = _sale(client, token, [_line(dish, 3)])
        assert _taken(sale["id"]) == {a["id"]: D("2.250"), b["id"]: D("1.500"), c["id"]: D("0.999")}

    def test_half_a_portion_of_a_third_is_rounded_once(self, client):
        token = _manager(client)
        section = _section(client, token)
        queso = _product(client, token, "Queso")
        racion = _dish(client, token, section, "Ración de queso")
        media = _dish(client, token, section, "Media ración")
        _recipe(client, token, racion, items=[(queso, 1 / 3)])
        shown = _recipe(client, token, media, components=[(racion, 0.5)])
        assert shown["expanded"][0]["quantity"] == 0.167
        sale = _sale(client, token, [_line(media, 3)])
        assert _taken(sale["id"]) == {queso["id"]: D("0.500")}

    def test_combos_inside_combos(self, client):
        token = _manager(client)
        m = _crispy_menu(client, token)
        section = _section(client, token, "Menús")
        familiar = _dish(client, token, section, "Menú Familiar", 30)
        _recipe(client, token, familiar, components=[(m["combo"], 2), (m["crispy"], 1)])
        assert {e["name"]: e["quantity"] for e in _recipes(client, token)["Menú Familiar"]["expanded"]} == {
            "Pollo": 2.25,
            "Cebolla": 0.3,
            "Patata": 0.4,
        }
        sale = _sale(client, token, [_line(familiar, 2)])
        assert _taken(sale["id"]) == {
            m["pollo"]["id"]: D("4.500"),
            m["cebolla"]["id"]: D("0.600"),
            m["patata"]["id"]: D("0.800"),
        }

    def test_an_archived_product_stays_in_the_recipe_and_says_so(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Crispy")
        pollo = _product(client, token, "Pollo")
        _recipe(client, token, dish, items=[(pollo, 0.75)])
        res = client.patch(
            API + "/inventory/items/%s" % pollo["id"], json={"archived": True}, headers=_auth(token)
        )
        assert res.status_code == 200, res.text
        listed = _recipes(client, token)["Crispy"]
        assert listed["items"][0]["archived"] is True
        assert listed["expanded"][0]["archived"] is True
        sale = _sale(client, token, [_line(dish)])
        assert _taken(sale["id"]) == {pollo["id"]: D("0.750")}

    def test_a_dish_inside_a_combo_cannot_be_taken_off_the_menu(self, client):
        """It would leave the combo in silence: the combo would go on selling
        and stop taking that dish's ingredients. The manager is told which."""
        token = _manager(client)
        m = _crispy_menu(client, token)
        res = client.delete(API + "/menu/dishes/%s" % m["patatas"]["id"], headers=_auth(token))
        assert res.status_code == 409, res.text
        assert res.json()["detail"]["code"] == "menu_dish_in_combo"
        assert res.json()["detail"]["params"] == {"combos": "Combo Crispy Grande"}
        combo = _recipes(client, token)["Combo Crispy Grande"]
        assert sorted(c["name"] for c in combo["components"]) == ["Crispy Grande", "Patatas"]

        # Out of the combo first, and then it goes.
        _recipe(client, token, m["combo"], components=[(m["crispy"], 1)])
        gone = client.delete(API + "/menu/dishes/%s" % m["patatas"]["id"], headers=_auth(token))
        assert gone.status_code == 204, gone.text

    def test_a_combo_taken_off_the_menu_takes_its_own_recipe(self, client):
        token = _manager(client)
        m = _crispy_menu(client, token)
        before = _sale(client, token, [_line(m["combo"])])
        gone = client.delete(API + "/menu/dishes/%s" % m["combo"]["id"], headers=_auth(token))
        assert gone.status_code == 204, gone.text
        assert "Combo Crispy Grande" not in _recipes(client, token)
        # A sale already saved keeps what it took.
        assert _taken(before["id"])[m["patata"]["id"]] == D("0.200")
        # And the dishes it was made of can go now.
        res = client.delete(API + "/menu/dishes/%s" % m["patatas"]["id"], headers=_auth(token))
        assert res.status_code == 204, res.text

    def test_a_section_whose_dish_is_in_a_combo_elsewhere_stays(self, client):
        token = _manager(client)
        patata = _product(client, token, "Patata")
        sides = _section(client, token, "Acompañamientos")
        combos = _section(client, token, "Combos")
        patatas = _dish(client, token, sides, "Patatas", 3)
        combo = _dish(client, token, combos, "Combo Patatas", 5)
        _recipe(client, token, patatas, items=[(patata, 0.2)])
        _recipe(client, token, combo, components=[(patatas, 2)])
        res = client.delete(API + "/menu/sections/%s" % sides, headers=_auth(token))
        assert res.status_code == 409, res.text
        assert res.json()["detail"]["code"] == "menu_section_in_combo"
        assert res.json()["detail"]["params"] == {"combos": "Combo Patatas"}
        assert "Patatas" in _recipes(client, token)
        # The combos' own section can go: its combo takes its recipe with it.
        res = client.delete(API + "/menu/sections/%s" % combos, headers=_auth(token))
        assert res.status_code == 204, res.text
        res = client.delete(API + "/menu/sections/%s" % sides, headers=_auth(token))
        assert res.status_code == 204, res.text

    def test_a_section_with_a_combo_and_its_dishes_goes_whole(self, client):
        token = _manager(client)
        section = _section(client, token, "Todo")
        pollo = _product(client, token, "Pollo")
        grande = _dish(client, token, section, "Crispy Grande")
        combo = _dish(client, token, section, "Combo Crispy Grande")
        _recipe(client, token, grande, items=[(pollo, 0.75)])
        _recipe(client, token, combo, components=[(grande, 1)])
        res = client.delete(API + "/menu/sections/%s" % section, headers=_auth(token))
        assert res.status_code == 204, res.text
        assert _recipes(client, token) == {}


    def test_a_business_with_combos_can_still_be_deleted(self, client):
        token = _manager(client)
        _crispy_menu(client, token)
        name = client.get(API + "/auth/me", headers=_auth(token)).json()["org_name"]
        res = client.request("DELETE", API + "/org", json={"confirm": name}, headers=_auth(token))
        assert res.status_code == 204, res.text

    def test_a_business_whose_sales_took_stock_can_still_be_deleted(self, client):
        """What a sale took is refused DELETE to the runtime role (0043); the
        cascade from the business runs as the table's owner, voided sales
        included."""
        from app.db import admin_engine

        token = _manager(client)
        m = _crispy_menu(client, token)
        voided = _sale(client, token, [_line(m["combo"])])
        _sale(client, token, [_line(m["crispy"])])
        res = client.post(
            API + "/store/sales/%s/void" % voided["id"], json={}, headers=_auth(token)
        )
        assert res.status_code == 200, res.text
        me = client.get(API + "/auth/me", headers=_auth(token)).json()
        res = client.request(
            "DELETE", API + "/org", json={"confirm": me["org_name"]}, headers=_auth(token)
        )
        assert res.status_code == 204, res.text
        with admin_engine.connect() as conn:
            left = conn.execute(
                text("SELECT count(*) FROM store_sale_consumption WHERE org_id = :o"),
                {"o": me["org_id"]},
            ).scalar()
        assert left == 0


@skip_no_db
class TestWhatARecipeCannotBe:
    def test_a_dish_inside_itself(self, client):
        token = _manager(client)
        section = _section(client, token)
        a = _dish(client, token, section, "Combo A")
        res = _put(client, token, a["id"], components=[(a, 1)])
        assert (res.status_code, _code(res)) == (422, "recipe_cycle")
        assert res.json()["detail"]["params"]["path"] == ["Combo A", "Combo A"]

    def test_a_circle_through_another_dish(self, client):
        token = _manager(client)
        section = _section(client, token)
        a = _dish(client, token, section, "Combo A")
        b = _dish(client, token, section, "Combo B")
        _recipe(client, token, a, components=[(b, 1)])
        res = _put(client, token, b["id"], components=[(a, 1)])
        assert (res.status_code, _code(res)) == (422, "recipe_cycle")
        assert res.json()["detail"]["params"]["path"] == ["Combo B", "Combo A", "Combo B"]
        # Nothing of it was kept.
        assert _recipes(client, token)["Combo B"]["has_recipe"] is False

    def test_a_circle_three_dishes_round(self, client):
        token = _manager(client)
        section = _section(client, token)
        a, b, c = (_dish(client, token, section, n) for n in ("A", "B", "C"))
        pollo = _product(client, token, "Pollo")
        _recipe(client, token, a, components=[(b, 1)])
        _recipe(client, token, b, components=[(c, 1)])
        res = _put(client, token, c["id"], items=[(pollo, 1)], components=[(a, 2)])
        assert (res.status_code, _code(res)) == (422, "recipe_cycle")
        assert res.json()["detail"]["params"]["path"] == ["C", "A", "B", "C"]
        assert _recipes(client, token)["C"]["items"] == []

    def test_five_levels_are_fine_and_six_are_too_deep(self, client):
        token = _manager(client)
        section = _section(client, token)
        chain = [_dish(client, token, section, "N%d" % i) for i in range(MAX_DEPTH + 2)]
        # N0 > N1 > ... > N5: five levels.
        for upper, lower in zip(chain[:MAX_DEPTH], chain[1 : MAX_DEPTH + 1]):
            _recipe(client, token, upper, components=[(lower, 1)])
        # One more below the bottom...
        res = _put(client, token, chain[MAX_DEPTH]["id"], components=[(chain[-1], 1)])
        assert (res.status_code, _code(res)) == (422, "recipe_too_deep")
        assert res.json()["detail"]["params"]["limit"] == MAX_DEPTH
        # ...or one more above the top.
        top = _dish(client, token, section, "Encima")
        res = _put(client, token, top["id"], components=[(chain[0], 1)])
        assert (res.status_code, _code(res)) == (422, "recipe_too_deep")

    def test_too_many_ingredients_or_components(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Todo")
        products = [_product(client, token, "P%d" % i) for i in range(recipes.ITEMS_PER_DISH + 1)]
        res = _put(client, token, dish["id"], items=[(p, 1) for p in products])
        assert (res.status_code, _code(res)) == (422, "recipe_too_many")
        assert res.json()["detail"]["params"] == {"what": "items", "limit": 30}
        assert _put(client, token, dish["id"], items=[(p, 1) for p in products[:-1]]).status_code == 200

        others = [_dish(client, token, section, "D%d" % i) for i in range(recipes.COMPONENTS_PER_DISH + 1)]
        res = _put(client, token, dish["id"], components=[(d, 1) for d in others])
        assert (res.status_code, _code(res)) == (422, "recipe_too_many")
        assert res.json()["detail"]["params"] == {"what": "components", "limit": 20}
        assert _put(client, token, dish["id"], components=[(d, 1) for d in others[:-1]]).status_code == 200

    def test_the_same_product_or_dish_twice(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Plato")
        other = _dish(client, token, section, "Otro")
        pollo = _product(client, token, "Pollo")
        res = _put(client, token, dish["id"], items=[(pollo, 1), (pollo, 2)])
        assert (res.status_code, _code(res)) == (422, "recipe_duplicate")
        res = _put(client, token, dish["id"], components=[(other, 1), (other, 1)])
        assert (res.status_code, _code(res)) == (422, "recipe_duplicate")

    @pytest.mark.parametrize("quantity", [0, -1, 0.0004, ITEM_QUANTITY_CEILING])
    def test_a_quantity_past_a_wall(self, client, quantity):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Plato")
        pollo = _product(client, token, "Pollo")
        assert _put(client, token, dish["id"], items=[(pollo, quantity)]).status_code == 422

    def test_unknown_dish_product_or_component(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Plato")
        ghost = {"id": str(uuid.uuid4())}
        res = _put(client, token, ghost["id"])
        assert (res.status_code, _code(res)) == (404, "menu_dish_not_found")
        res = _put(client, token, dish["id"], items=[(ghost, 1)])
        assert (res.status_code, _code(res)) == (404, "inventory_item_not_found")
        res = _put(client, token, dish["id"], components=[(ghost, 1)])
        assert (res.status_code, _code(res)) == (404, "menu_dish_not_found")

    def test_a_sale_that_would_take_past_what_a_stock_column_holds(self, client):
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Palé")
        agua = _product(client, token, "Agua", "ml")
        _recipe(client, token, dish, items=[(agua, 99_999)])
        res = _post_sale(client, token, [_line(dish, 999_999)])
        assert (res.status_code, _code(res)) == (422, "store_sale_consumption_too_large")
        assert res.json()["detail"]["params"]["item"] == "Agua"
        assert client.get(API + "/store/sales", headers=_auth(token)).json() == []


@skip_no_db
class TestWhatASaleTakes:
    def test_a_snapshot_of_the_recipe_of_the_moment(self, client):
        """Before the recipe: nothing. Changing it: the next sale, not the
        last one."""
        token = _manager(client)
        section = _section(client, token)
        dish = _dish(client, token, section, "Crispy")
        pollo = _product(client, token, "Pollo")

        before = _sale(client, token, [_line(dish)], sold_on="2026-09-01")
        assert _taken(before["id"]) == {}
        _recipe(client, token, dish, items=[(pollo, 0.75)])
        first = _sale(client, token, [_line(dish)], sold_on="2026-09-02")
        _recipe(client, token, dish, items=[(pollo, 1)])
        second = _sale(client, token, [_line(dish)], sold_on="2026-09-03")
        _recipe(client, token, dish)

        assert _taken(before["id"]) == {}
        assert _taken(first["id"]) == {pollo["id"]: D("0.750")}
        assert _taken(second["id"]) == {pollo["id"]: D("1.000")}
        assert _stock(client, token)["Pollo"]["sold_since_count"] == 1.75

    def test_free_lines_and_dishes_without_a_recipe_take_nothing(self, client):
        token = _manager(client)
        m = _crispy_menu(client, token)
        section = _section(client, token, "Bebidas")
        agua = _dish(client, token, section, "Agua", 1)
        sale = _sale(
            client,
            token,
            [
                {"dish_id": None, "name": "Caja del día", "unit_price": 850, "quantity": 1},
                _line(agua, 4),
                _line(m["crispy"], 1),
            ],
        )
        assert _taken(sale["id"]) == {m["pollo"]["id"]: D("0.750"), m["cebolla"]["id"]: D("0.100")}

    def test_voiding_the_sale_puts_the_stock_back(self, client):
        """The sale stays and so does what it took, written down as it was;
        the stock stops counting it. Once: a second void is a 409 and gives
        nothing back twice."""
        token = _manager(client)
        m = _crispy_menu(client, token)
        keep = _sale(client, token, [_line(m["crispy"])])
        drop = _sale(client, token, [_line(m["combo"], 2)])
        taken = _taken(drop["id"])
        assert _stock(client, token)["Pollo"]["sold_since_count"] == 2.25
        res = client.post(
            API + "/store/sales/%s/void" % drop["id"], json={}, headers=_auth(token)
        )
        assert res.status_code == 200
        assert _taken(drop["id"]) == taken
        assert _taken(keep["id"]) == {m["pollo"]["id"]: D("0.750"), m["cebolla"]["id"]: D("0.100")}
        stock = _stock(client, token)
        assert stock["Pollo"]["sold_since_count"] == 0.75
        assert stock["Patata"]["sold_since_count"] == 0

        again = client.post(
            API + "/store/sales/%s/void" % drop["id"], json={}, headers=_auth(token)
        )
        assert (again.status_code, _code(again)) == (409, "store_sale_already_voided")
        assert _stock(client, token) == stock

    def test_a_voided_sale_is_left_out_between_two_counts_too(self, client):
        """What went between two counts, and how much of it the sales
        explain: a voided sale in between explains none of it."""
        token = _manager(client)
        m = _crispy_menu(client, token)
        # 22:00 in Madrid, both after closing: the 2nd's sales are between them.
        _count(client, token, [(m["pollo"], 10)], "2026-09-01T20:00:00Z", after_close=True)
        keep = _sale(client, token, [_line(m["crispy"])], sold_on="2026-09-02")
        drop = _sale(client, token, [_line(m["crispy"], 4)], sold_on="2026-09-02")
        _count(client, token, [(m["pollo"], 9)], "2026-09-02T20:00:00Z", after_close=True)
        assert _stock(client, token)["Pollo"]["sold_between_counts"] == 3.75
        res = client.post(
            API + "/store/sales/%s/void" % drop["id"], json={}, headers=_auth(token)
        )
        assert res.status_code == 200
        assert _taken(keep["id"])[m["pollo"]["id"]] == D("0.750")
        assert _stock(client, token)["Pollo"]["sold_between_counts"] == 0.75

    def test_the_same_save_sent_again_takes_nothing_twice(self, client):
        token = _manager(client)
        m = _crispy_menu(client, token)
        ref = str(uuid.uuid4())
        first = _sale(client, token, [_line(m["combo"])], client_ref=ref)
        again = _post_sale(client, token, [_line(m["combo"], 5)], client_ref=ref)
        assert again.status_code == 200
        assert again.json() == first
        assert _taken(first["id"]) == {
            m["pollo"]["id"]: D("0.750"),
            m["cebolla"]["id"]: D("0.100"),
            m["patata"]["id"]: D("0.200"),
        }
        assert _stock(client, token)["Pollo"]["sold_since_count"] == 0.75

    def test_two_saves_at_once_with_one_ref_take_it_once(self, client, monkeypatch):
        """Both miss the lookup; the second meets the UNIQUE at the INSERT of
        the sale, answers with the first one's, and writes nothing of its own."""
        from app.routers import store as store_router

        token = _manager(client)
        m = _crispy_menu(client, token)
        ref = str(uuid.uuid4())
        first = _sale(client, token, [_line(m["crispy"])], client_ref=ref)
        real, calls = store_router._sale_by_ref, []

        def blind_first(*args, **kwargs):
            calls.append(1)
            return None if len(calls) == 1 else real(*args, **kwargs)

        monkeypatch.setattr(store_router, "_sale_by_ref", blind_first)
        res = _post_sale(client, token, [_line(m["crispy"], 3)], client_ref=ref)
        assert (res.status_code, res.json()) == (200, first)
        assert _stock(client, token)["Pollo"]["sold_since_count"] == 0.75


@skip_no_db
class TestStockWithSales:
    """A count reflects the sales up to a day: the day itself if it was taken
    after closing, the day before if before opening. The sales of the day
    counted are on one side of it or the other depending on which."""

    def _crispy(self, client, token):
        section = _section(client, token)
        pollo = _product(client, token, "Pollo")
        crispy = _dish(client, token, section, "Crispy Grande", 10)
        _recipe(client, token, crispy, items=[(pollo, 0.75)])
        return pollo, crispy

    def test_counted_before_opening_the_days_sales_are_after_it(self, client):
        token = _manager(client)
        pollo, crispy = self._crispy(client, token)
        _receive(client, token, [(pollo, 10)], "2026-09-10T06:00:00Z")
        # 09:00 in Madrid: before opening, by the hour.
        count = _count(client, token, [(pollo, 10)], "2026-09-10T07:00:00Z")
        assert (count["after_close"], count["sales_through"]) == (False, "2026-09-09")
        _sale(client, token, [_line(crispy)], sold_on="2026-09-09")
        _sale(client, token, [_line(crispy, 2)], sold_on="2026-09-10")

        listed = _stock(client, token)["Pollo"]
        assert listed["last_quantity"] == 10
        assert listed["received_since_count"] == 0
        # The 10th's two, not the 9th's one: that one was already gone.
        assert listed["sold_since_count"] == 1.5

    def test_counted_after_closing_the_days_sales_are_in_it(self, client):
        token = _manager(client)
        pollo, crispy = self._crispy(client, token)
        # 23:00 in Madrid: after closing, by the hour.
        count = _count(client, token, [(pollo, 8.5)], "2026-09-10T21:00:00Z")
        assert (count["after_close"], count["sales_through"]) == (True, "2026-09-10")
        _sale(client, token, [_line(crispy, 2)], sold_on="2026-09-10")
        _sale(client, token, [_line(crispy)], sold_on="2026-09-11")
        assert _stock(client, token)["Pollo"]["sold_since_count"] == 0.75

    def test_the_manager_says_which_it_was(self, client):
        token = _manager(client)
        pollo, crispy = self._crispy(client, token)
        _sale(client, token, [_line(crispy, 2)], sold_on="2026-09-10")

        # Late in the evening, but before opening that day's sales were typed
        # in: said so, it is.
        late = _count(client, token, [(pollo, 10)], "2026-09-10T21:00:00Z", after_close=False)
        assert (late["after_close"], late["sales_through"]) == (False, "2026-09-09")
        assert _stock(client, token)["Pollo"]["sold_since_count"] == 1.5

        early = _count(client, token, [(pollo, 10)], "2026-09-11T07:00:00Z", after_close=True)
        assert (early["after_close"], early["sales_through"]) == (True, "2026-09-11")
        assert _stock(client, token)["Pollo"]["sold_since_count"] == 0

        listed = client.get(API + "/inventory/counts", headers=_auth(token)).json()
        assert [(c["after_close"], c["sales_through"]) for c in listed] == [
            (True, "2026-09-11"),
            (False, "2026-09-09"),
        ]
        detail = client.get(API + "/inventory/counts/%s" % late["id"], headers=_auth(token)).json()
        assert (detail["after_close"], detail["sales_through"]) == (False, "2026-09-09")

    def test_the_day_of_the_count_is_madrids(self, client):
        """00:30 in Madrid on the 11th is 22:30Z on the 10th: the close of the
        10th's night, so it reflects the 10th's sales and not the 11th's."""
        token = _manager(client)
        pollo, crispy = self._crispy(client, token)
        count = _count(client, token, [(pollo, 5)], "2026-09-10T22:30:00Z")
        assert (count["after_close"], count["sales_through"]) == (True, "2026-09-10")
        _sale(client, token, [_line(crispy)], sold_on="2026-09-10")
        _sale(client, token, [_line(crispy, 2)], sold_on="2026-09-11")
        assert _stock(client, token)["Pollo"]["sold_since_count"] == 1.5

    def test_sold_between_the_two_counts(self, client):
        token = _manager(client)
        pollo, crispy = self._crispy(client, token)
        _count(client, token, [(pollo, 20)], "2026-09-05T21:00:00Z")  # after closing the 5th
        _sale(client, token, [_line(crispy)], sold_on="2026-09-05")  # in the first count
        [one] = _stock(client, token).values()
        assert one["sold_between_counts"] is None  # one count: no "between"

        _sale(client, token, [_line(crispy, 2)], sold_on="2026-09-06")
        _sale(client, token, [_line(crispy)], sold_on="2026-09-08")
        _count(client, token, [(pollo, 16)], "2026-09-09T07:00:00Z")  # before opening the 9th
        _sale(client, token, [_line(crispy, 4)], sold_on="2026-09-09")

        listed = _stock(client, token)["Pollo"]
        assert listed["previous_quantity"] == 20
        assert listed["last_quantity"] == 16
        assert listed["sold_between_counts"] == 2.25
        assert listed["sold_since_count"] == 3.0
        # Consumption between the counts is 20 - 16 = 4; the sales explain
        # 2.25 of it, and 1.75 is unexplained. The browser works that out.

    def test_two_counts_and_no_sales_between_is_zero_not_null(self, client):
        token = _manager(client)
        pollo, crispy = self._crispy(client, token)
        _count(client, token, [(pollo, 20)], "2026-09-05T21:00:00Z")
        _count(client, token, [(pollo, 20)], "2026-09-06T21:00:00Z")
        _sale(client, token, [_line(crispy)], sold_on="2026-09-07")
        listed = _stock(client, token)["Pollo"]
        assert listed["sold_between_counts"] == 0
        assert listed["sold_since_count"] == 0.75

    def test_a_product_never_sold(self, client):
        token = _manager(client)
        _product(client, token, "Sal")
        listed = _stock(client, token)["Sal"]
        assert listed["sold_since_count"] == 0
        assert listed["sold_between_counts"] is None

    def test_the_list_costs_the_same_for_one_product_as_for_six(self, client):
        """No query per product: the sales are summed in the same read as the
        deliveries."""
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

        def furnish(token, n):
            section = _section(client, token)
            products = [_product(client, token, "P%d" % i) for i in range(n)]
            dishes = []
            for i, p in enumerate(products):
                dish = _dish(client, token, section, "D%d" % i)
                _recipe(client, token, dish, items=[(p, 1)])
                dishes.append(dish)
            _count(client, token, [(p, 5) for p in products], "2026-09-01T21:00:00Z")
            _sale(client, token, [_line(d) for d in dishes], sold_on="2026-09-02")
            _count(client, token, [(p, 4) for p in products], "2026-09-02T21:00:00Z")
            _sale(client, token, [_line(d) for d in dishes], sold_on="2026-09-03")

        one, six = _manager(client), _manager(client)
        furnish(one, 1)
        furnish(six, 6)
        assert statements_for(one) == statements_for(six)


@skip_no_db
class TestTheCountsAlreadyTaken:
    def test_the_migration_fills_them_in_as_the_form_guesses(self, client):
        """0041 fills in `sales_through` for the counts taken before it, from
        their own moment: the same rule a count taken today gets when the
        manager does not say. Re-run here on counts the API just made, inside
        a transaction that is rolled back."""
        from app.db import admin_engine

        spec = importlib.util.spec_from_file_location(
            "migration_0041", VERSIONS / "0041_store_recipes.py"
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        token = _manager(client)
        pollo = _product(client, token, "Pollo")
        moments = [
            "2026-09-10T09:59:00Z",
            "2026-09-10T10:00:00Z",
            "2026-09-10T22:30:00Z",
            # 02:30 and 06:00 in Madrid: a late close, and the first morning hour.
            "2026-09-11T00:30:00Z",
            "2026-09-11T04:00:00Z",
            "2026-01-15T10:59:00Z",
            "2026-01-15T11:00:00Z",
        ]
        made = {_count(client, token, [(pollo, 1)], m)["id"]: m for m in moments}
        ids = {"ids": list(made)}
        read = text(
            "SELECT id::text, after_close, sales_through FROM inventory_count "
            "WHERE id::text = ANY(:ids)"
        )
        with admin_engine.connect() as conn:
            tx = conn.begin()
            try:
                stored = {i: (a, d) for i, a, d in conn.execute(read, ids).all()}
                for column in ("sales_through", "after_close"):
                    conn.execute(
                        text("ALTER TABLE inventory_count ALTER COLUMN %s DROP NOT NULL" % column)
                    )
                conn.execute(
                    text(
                        "UPDATE inventory_count SET sales_through = NULL, after_close = NULL "
                        "WHERE id::text = ANY(:ids)"
                    ),
                    ids,
                )
                conn.execute(text(module.BACKFILL))
                filled = {i: (a, d) for i, a, d in conn.execute(read, ids).all()}
            finally:
                tx.rollback()
        assert set(filled) == set(made)
        assert filled == stored
        assert sorted((d.isoformat(), a) for a, d in filled.values()) == [
            ("2026-01-14", False),
            ("2026-01-15", True),
            ("2026-09-09", False),
            ("2026-09-10", False),
            ("2026-09-10", True),
            ("2026-09-10", True),
            ("2026-09-10", True),
        ]


# --- Who may, and which business -------------------------------------------------------


def _file_under(org_id: str, client_key) -> None:
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE organization SET client_key = :key WHERE id = :org"),
            {"key": client_key, "org": org_id},
        )


@skip_no_db
class TestDoors:
    def test_another_business_can_neither_see_nor_use_what_is_yours(self, client):
        mine = _manager(client)
        theirs = _manager(client)
        m = _crispy_menu(client, theirs)
        section = _section(client, mine)
        dish = _dish(client, mine, section, "Mío")

        listed = client.get(API + "/store/recipes", headers=_auth(mine))
        assert listed.status_code == 200
        assert "Crispy" not in listed.text and m["pollo"]["id"] not in listed.text

        res = _put(client, mine, m["crispy"]["id"])
        assert (res.status_code, _code(res)) == (404, "menu_dish_not_found")
        res = _put(client, mine, dish["id"], items=[(m["pollo"], 1)])
        assert (res.status_code, _code(res)) == (404, "inventory_item_not_found")
        res = _put(client, mine, dish["id"], components=[(m["combo"], 1)])
        assert (res.status_code, _code(res)) == (404, "menu_dish_not_found")

        # Theirs is as they left it, and a sale of theirs is not in my stock.
        assert _recipes(client, theirs)["Crispy Grande"]["has_recipe"] is True
        _sale(client, theirs, [_line(m["crispy"])])
        mine_pollo = _product(client, mine, "Pollo")
        assert _stock(client, mine)["Pollo"]["id"] == mine_pollo["id"]
        assert _stock(client, mine)["Pollo"]["sold_since_count"] == 0

    def test_an_employee_reads_them_and_changes_none(self, client):
        """Reading is the team's since 28-sep-2026 (app/access.py); changing
        a recipe is still the manager's."""
        manager = _manager(client)
        section = _section(client, manager)
        dish = _dish(client, manager, section, "Crispy")
        staff = _employee_token(client, manager, _add(client, manager, "Ana")["id"])
        res = client.get(API + "/store/recipes", headers=_auth(staff))
        assert res.status_code == 200, res.text
        assert res.json() == client.get(API + "/store/recipes", headers=_auth(manager)).json()
        res = _put(client, staff, dish["id"])
        assert (res.status_code, _code(res)) == (403, "manager_role_required")

    def test_every_recipe_route_declares_its_permission(self):
        from app.access import Perm
        from app.routers import recipes as router_module

        for route in router_module.router.routes:
            perms = [
                d.call.permission
                for d in route.dependant.dependencies
                if hasattr(d.call, "permission")
            ]
            expected = (
                Perm.STORE_RECIPES_VIEW if route.methods == {"GET"} else Perm.STORE_RECIPES_EDIT
            )
            assert perms == [expected], (route.path, route.methods)

    def test_a_business_without_the_shop_is_refused_at_its_door(self, client):
        token, org_id = _signup(client, "Sin tienda")
        _file_under(org_id, None)  # the template: Turnos and Inventario
        for res in (
            client.get(API + "/store/recipes", headers=_auth(token)),
            client.put(
                API + "/store/recipes/%s" % uuid.uuid4(),
                json={"items": [], "components": []},
                headers=_auth(token),
            ),
        ):
            assert res.status_code == 403
            assert res.json()["detail"]["code"] == "app_not_enabled"
            assert res.json()["detail"]["params"] == {"app": "store"}

    def test_a_shop_without_the_inventory_is_refused_too(self, client, monkeypatch):
        key = "pytest-shop-%s" % uuid.uuid4().hex[:8]
        filed = clients.profiles()
        shop_only = ClientProfile(name="Solo tienda", apps=["shifts", "store"])
        monkeypatch.setattr(clients, "profiles", lambda: {**filed, key: shop_only})
        token, org_id = _signup(client, "Solo tienda")
        _file_under(org_id, key)
        # The shop itself answers...
        assert client.get(API + "/store/sales", headers=_auth(token)).status_code == 200
        # ...its recipes do not: there is nothing to make them of.
        for res in (
            client.get(API + "/store/recipes", headers=_auth(token)),
            client.put(
                API + "/store/recipes/%s" % uuid.uuid4(),
                json={"items": [], "components": []},
                headers=_auth(token),
            ),
        ):
            assert res.status_code == 403
            assert res.json()["detail"]["code"] == "app_not_enabled"
            assert res.json()["detail"]["params"] == {"app": "inventory"}


@skip_no_db
class TestTheTables:
    def test_the_new_tables_are_behind_row_level_security(self):
        from app.db import admin_engine

        with admin_engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname IN ('menu_recipe_item', 'menu_recipe_component', "
                    "'store_sale_consumption')"
                )
            ).all()
        assert sorted(rows) == [
            ("menu_recipe_component", True, True),
            ("menu_recipe_item", True, True),
            ("store_sale_consumption", True, True),
        ]

    def test_the_runtime_role_sees_only_its_own_rows(self, client):
        from app.db import app_engine

        _mine, mine_org = _signup(client, "Mío")
        theirs = _manager(client)
        m = _crispy_menu(client, theirs)
        sale = _sale(client, theirs, [_line(m["combo"])])
        with app_engine.connect() as conn:
            with conn.begin():
                conn.execute(
                    text("SELECT set_config('app.current_org_id', :org, true)"), {"org": mine_org}
                )
                for table, column, value in (
                    ("menu_recipe_item", "dish_id", m["crispy"]["id"]),
                    ("menu_recipe_component", "dish_id", m["combo"]["id"]),
                    ("store_sale_consumption", "sale_id", sale["id"]),
                ):
                    seen = conn.execute(
                        text("SELECT count(*) FROM %s WHERE %s = :v" % (table, column)),
                        {"v": value},
                    ).scalar()
                    assert seen == 0, table
        assert len(_taken(sale["id"])) == 3

    def test_the_database_refuses_a_neighbours_product_in_a_recipe(self, client):
        """The key is on (item_id, org_id): even past the API, a recipe cannot
        name another business's product."""
        from sqlalchemy.exc import IntegrityError

        from app.db import app_engine

        mine, mine_org = _signup(client, "Mío")
        theirs = _manager(client)
        section = _section(client, mine)
        dish = _dish(client, mine, section, "Mío")
        their_pollo = _product(client, theirs, "Pollo")
        with pytest.raises(IntegrityError, match="menu_recipe_item_item_id_org_id_fkey"):
            with app_engine.connect() as conn:
                with conn.begin():
                    conn.execute(
                        text("SELECT set_config('app.current_org_id', :org, true)"),
                        {"org": mine_org},
                    )
                    conn.execute(
                        text(
                            "INSERT INTO menu_recipe_item (org_id, dish_id, item_id, quantity) "
                            "VALUES (:org, :dish, :item, 1)"
                        ),
                        {"org": mine_org, "dish": dish["id"], "item": their_pollo["id"]},
                    )
