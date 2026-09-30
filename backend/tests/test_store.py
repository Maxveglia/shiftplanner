"""The shop's sales and their statistics: typed in by the manager or charged
at the till, read back as a list, a sale, and what a period adds up to --
voided, never deleted nor edited.

The schema half needs no database. The rest goes through the API as a manager,
as an employee and as another business, and the last part straight at the
database, as the runtime role.
"""

import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.schemas import limits
from app.schemas.store import StoreSaleCreate, StoreSaleLineIn, StoreSaleVoid
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    _employee_token,
    _signup,
    client,
    skip_no_db,
)

API = "/api/v1/store"
MENU = "/api/v1/menu"


# --- The schema: what is checked is what is stored ------------------------------


def _line_in(**fields) -> StoreSaleLineIn:
    body = {"name": "Croquetas", "unit_price": 9.5, "quantity": 1}
    body.update(fields)
    return StoreSaleLineIn(**body)


@pytest.mark.parametrize(
    "sent, stored",
    [(2.675, 2.68), (0.005, 0.01), (0.004, 0.0), (12, 12.0), (999999.99, 999999.99)],
)
def test_a_unit_price_is_kept_to_the_cent_half_up(sent, stored):
    """Half up from the decimal written, as a till rounds: Python's own
    round(2.675, 2) is 2.67, because the float nearest 2.675 is a hair under."""
    assert _line_in(unit_price=sent).unit_price == stored


@pytest.mark.parametrize("sent", [-0.01, 1_000_000, 999999.996, float("inf"), float("nan")])
def test_a_unit_price_the_column_cannot_hold_is_refused(sent):
    with pytest.raises(ValidationError):
        _line_in(unit_price=sent)


@pytest.mark.parametrize("sent, stored", [(0.3333, 0.333), (0.0005, 0.001), (2, 2.0)])
def test_a_quantity_is_kept_to_the_thousandth(sent, stored):
    assert _line_in(quantity=sent).quantity == stored


@pytest.mark.parametrize("sent", [0, -1, 0.0004, 1_000_000, 999999.9996])
def test_a_quantity_the_column_cannot_hold_is_refused(sent):
    """0.0004 passes `gt=0` and would be stored as 0.000, which the CHECK
    refuses: a 500. Refused here instead, as a 422."""
    with pytest.raises(ValidationError):
        _line_in(quantity=sent)


def test_a_name_is_trimmed_and_cleaned_before_it_is_measured():
    assert _line_in(name="  Caja del día \x00 ").name == "Caja del día"
    assert _line_in(name=" " + "x" * limits.NAME + " ").name == "x" * limits.NAME
    for bad in ("", "   ", "x" * (limits.NAME + 1)):
        with pytest.raises(ValidationError):
            _line_in(name=bad)


def test_a_sale_has_between_one_and_the_wall_of_lines():
    def sale(n):
        return StoreSaleCreate(
            sold_on="2026-09-01",
            client_ref=uuid.uuid4(),
            lines=[{"name": "L%d" % i, "unit_price": 1, "quantity": 1} for i in range(n)],
        )

    assert len(sale(limits.STORE_SALE_LINES).lines) == limits.STORE_SALE_LINES
    for n in (0, limits.STORE_SALE_LINES + 1):
        with pytest.raises(ValidationError):
            sale(n)


def test_a_blank_note_is_no_note():
    body = {
        "sold_on": "2026-09-01",
        "client_ref": uuid.uuid4(),
        "lines": [{"name": "Caja", "unit_price": 1, "quantity": 1}],
    }
    assert StoreSaleCreate(**body, note="   ").note is None
    assert StoreSaleCreate(**body, note=" Terraza ").note == "Terraza"
    with pytest.raises(ValidationError):
        StoreSaleCreate(**body, note="x" * (limits.NOTE + 1))


def test_the_client_ref_is_required():
    with pytest.raises(ValidationError):
        StoreSaleCreate(
            sold_on="2026-09-01", lines=[{"name": "Caja", "unit_price": 1, "quantity": 1}]
        )


def _sale_in(**fields) -> StoreSaleCreate:
    body = {
        "sold_on": "2026-09-01",
        "client_ref": uuid.uuid4(),
        "lines": [{"name": "Caja", "unit_price": 1, "quantity": 1}],
    }
    body.update(fields)
    return StoreSaleCreate(**body)


def test_a_sale_is_typed_in_and_says_nothing_of_how_it_was_paid_unless_told():
    sale = _sale_in()
    assert (sale.source, sale.payment_method) == ("manual", None)
    for method in ("cash", "card"):
        sale = _sale_in(source="till", payment_method=method)
        assert (sale.source, sale.payment_method) == ("till", method)


@pytest.mark.parametrize(
    "fields",
    [
        {"payment_method": "bizum"},
        {"payment_method": "Cash"},
        {"payment_method": ""},
        {"source": "sumup"},
        {"source": None},
    ],
)
def test_a_payment_method_or_a_source_that_does_not_exist_is_refused(fields):
    with pytest.raises(ValidationError):
        _sale_in(**fields)


def test_a_bill_charged_at_the_till_says_how_it_was_paid():
    """The till is where the money is taken: it always knows. A sale typed in
    by hand may not (0043's `store_sale_till_paid_check`)."""
    with pytest.raises(ValidationError) as refused:
        _sale_in(source="till")
    assert "says how it was paid" in str(refused.value)
    with pytest.raises(ValidationError):
        _sale_in(source="till", payment_method=None)
    assert _sale_in(source="manual", payment_method=None).payment_method is None


def test_a_void_reason_is_optional_and_trimmed_before_it_is_measured():
    assert StoreSaleVoid().reason is None
    assert StoreSaleVoid(reason="   ").reason is None
    assert StoreSaleVoid(reason=" Cobrada dos veces \x00").reason == "Cobrada dos veces"
    wall = "x" * limits.VOID_REASON
    assert StoreSaleVoid(reason=" %s " % wall).reason == wall
    with pytest.raises(ValidationError):
        StoreSaleVoid(reason=wall + "x")


# --- Through the API ------------------------------------------------------------


def _manager(client) -> str:
    token, _org = _signup(client, "Tienda Co")
    return token


def _dish(client, token, name="Croquetas", price=9.5) -> dict:
    section = client.post(MENU + "/sections", json={"name": "Carta"}, headers=_auth(token))
    assert section.status_code == 201, section.text
    dish = client.post(
        MENU + "/dishes",
        json={"section_id": section.json()["id"], "name": name, "price": price},
        headers=_auth(token),
    )
    assert dish.status_code == 201, dish.text
    return dish.json()


def _line(name="Caja del día", unit_price=850, quantity=1, dish_id=None) -> dict:
    return {"dish_id": dish_id, "name": name, "unit_price": unit_price, "quantity": quantity}


def _of(dish: dict, quantity=1, **fields) -> dict:
    """A line picked from the menu: the dish's name and price, as the browser
    copies them."""
    line = _line(dish["name"], dish["price"], quantity, dish["id"])
    line.update(fields)
    return line


def _post(client, token, lines, sold_on="2026-09-01", **fields):
    body = {"sold_on": sold_on, "client_ref": str(uuid.uuid4()), "lines": lines}
    body.update(fields)
    return client.post(API + "/sales", json=body, headers=_auth(token))


def _as_kept(answer: dict) -> dict:
    """The answer to saving a sale, as reading it back gives it: the sale,
    without what the save alone says about the stock (`stock_alerts`) --
    empty here, where no product has a minimum (tests/test_low_stock_orders.py
    is where it is not)."""
    kept = dict(answer)
    assert kept.pop("stock_alerts") == []
    return kept


def _sale(client, token, lines, sold_on="2026-09-01", **fields) -> dict:
    res = _post(client, token, lines, sold_on, **fields)
    assert res.status_code == 201, res.text
    return _as_kept(res.json())


def _sales(client, token, **params) -> list:
    query = {"from": params.pop("first", None), "to": params.pop("last", None)}
    res = client.get(
        API + "/sales",
        params={k: v for k, v in query.items() if v is not None},
        headers=_auth(token),
    )
    assert res.status_code == 200, res.text
    return res.json()


def _stats(client, token, first, last) -> dict:
    res = client.get(
        API + "/stats", params={"from": first, "to": last}, headers=_auth(token)
    )
    assert res.status_code == 200, res.text
    return res.json()


def _code(res) -> str:
    return res.json()["detail"]["code"]


def _me(client, token) -> dict:
    return client.get("/api/v1/auth/me", headers=_auth(token)).json()


def _void(client, token, sale_id, body=None):
    """Void a sale. `body=None` sends no body at all: the reason is optional,
    and so is the object that would carry it."""
    path = API + "/sales/%s/void" % sale_id
    if body is None:
        return client.post(path, headers=_auth(token))
    return client.post(path, json=body, headers=_auth(token))


def _instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _as_admin(sql: str, params: dict):
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        return conn.execute(text(sql), params).scalar()


@skip_no_db
class TestSales:
    def test_a_sale_is_recorded_and_read_back(self, client):
        token = _manager(client)
        croquetas = _dish(client, token)
        sale = _sale(
            client,
            token,
            [
                _of(croquetas, quantity=2),
                # Picked from the menu and changed before saving: half a ración
                # at half the price. The line keeps what was typed.
                _of(croquetas, quantity=1, name="Media de croquetas", unit_price=4.75),
                _line("Caja del día", 850, 1),
            ],
            note=" Terraza ",
        )
        assert sale["sold_on"] == "2026-09-01"
        assert sale["note"] == "Terraza"
        assert [
            (l["name"], l["dish_id"], l["unit_price"], l["quantity"], l["amount"])
            for l in sale["lines"]
        ] == [
            ("Croquetas", croquetas["id"], 9.5, 2.0, 19.0),
            ("Media de croquetas", croquetas["id"], 4.75, 1.0, 4.75),
            ("Caja del día", None, 850.0, 1.0, 850.0),
        ]
        assert sale["total"] == 873.75
        assert sale["created_at"]
        # Typed in, nobody said how it was paid, and not voided.
        assert (sale["source"], sale["payment_method"]) == ("manual", None)
        assert (sale["voided_at"], sale["voided_by_name"], sale["void_reason"]) == (
            None,
            None,
            None,
        )

        got = client.get(API + "/sales/%s" % sale["id"], headers=_auth(token))
        assert got.status_code == 200
        assert got.json() == sale

    def test_a_line_is_worth_its_price_times_its_quantity_to_the_cent(self, client):
        """Rounded per line, half up, and the total is the sum of the lines as
        rounded: what the lines say adds up to what the sale says."""
        token = _manager(client)
        sale = _sale(
            client,
            token,
            [_line("Pan", 2.5, 0.333), _line("Aceituna", 0.05, 0.5)],
        )
        assert [l["amount"] for l in sale["lines"]] == [0.83, 0.03]
        assert sale["total"] == 0.86
        [listed] = _sales(client, token)
        assert listed["total"] == 0.86

    def test_the_list_is_newest_day_first_with_totals(self, client):
        token = _manager(client)
        early = _sale(client, token, [_line(unit_price=10)], sold_on="2026-09-01")
        late = _sale(client, token, [_line(unit_price=30), _line(unit_price=5)], sold_on="2026-09-03")
        # Saved after `late` but a day before it: the day decides.
        middle = _sale(client, token, [_line(unit_price=20)], sold_on="2026-09-02")
        # And within one day, the one saved last first.
        late_again = _sale(client, token, [_line(unit_price=1)], sold_on="2026-09-03")
        listed = _sales(client, token)
        assert [s["id"] for s in listed] == [
            late_again["id"],
            late["id"],
            middle["id"],
            early["id"],
        ]
        by_id = {s["id"]: s for s in listed}
        assert (by_id[late["id"]]["total"], by_id[late["id"]]["line_count"]) == (35.0, 2)
        assert set(by_id[early["id"]]) == {
            "id",
            "sold_on",
            "note",
            "total",
            "line_count",
            "created_at",
            "payment_method",
            "source",
            "voided_at",
            "void_reason",
        }

    def test_the_list_is_cut_to_the_period_both_days_included(self, client):
        token = _manager(client)
        for day in ("2026-07-31", "2026-08-01", "2026-08-15", "2026-08-31", "2026-09-01"):
            _sale(client, token, [_line()], sold_on=day)
        august = _sales(client, token, first="2026-08-01", last="2026-08-31")
        assert [s["sold_on"] for s in august] == ["2026-08-31", "2026-08-15", "2026-08-01"]
        assert len(_sales(client, token, first="2026-08-15")) == 3
        assert len(_sales(client, token, last="2026-08-01")) == 2
        assert len(_sales(client, token, first="2026-08-15", last="2026-08-15")) == 1

    def test_the_list_has_a_wall(self, client, monkeypatch):
        from app.routers import store as router_module

        monkeypatch.setattr(router_module, "LIST_LIMIT", 2)
        token = _manager(client)
        for day in ("2026-09-01", "2026-09-02", "2026-09-03"):
            _sale(client, token, [_line()], sold_on=day)
        assert [s["sold_on"] for s in _sales(client, token)] == ["2026-09-03", "2026-09-02"]

    @pytest.mark.parametrize(
        "params, code",
        [
            ({"from": "2026-9-1"}, "bad_date"),
            ({"to": "20260901"}, "bad_date"),
            ({"from": "2026-02-30"}, "bad_date"),
            ({"from": "2026-09-02", "to": "2026-09-01"}, "window_end_before_start"),
        ],
    )
    def test_a_period_that_is_not_one_is_refused_in_words(self, client, params, code):
        token = _manager(client)
        res = client.get(API + "/sales", params=params, headers=_auth(token))
        assert res.status_code == 422
        assert _code(res) == code

    def test_a_sale_can_be_neither_deleted_nor_edited(self, client):
        """There is no DELETE any more, and there never was a PATCH or a PUT: a
        sale is voided (TestVoid). The path answers GET, so the other verbs
        are a 405 -- and the sale and its lines are where they were."""
        token = _manager(client)
        sale = _sale(client, token, [_line(), _line("Otra", 1, 1)])
        path = API + "/sales/%s" % sale["id"]
        for res in (
            client.delete(path, headers=_auth(token)),
            client.patch(path, json={"note": "Editada"}, headers=_auth(token)),
            client.put(path, json={"note": "Editada"}, headers=_auth(token)),
        ):
            assert res.status_code == 405, res.text
        assert client.get(path, headers=_auth(token)).json() == sale
        assert _as_admin(
            "SELECT count(*) FROM store_sale_line WHERE sale_id = :s", {"s": sale["id"]}
        ) == 2

    def test_an_unknown_sale_is_not_found(self, client):
        token = _manager(client)
        res = client.get(API + "/sales/%s" % uuid.uuid4(), headers=_auth(token))
        assert (res.status_code, _code(res)) == (404, "store_sale_not_found")

    def test_the_manager_sees_a_new_sale_at_once(self, client):
        """Committed before the answer: the list asked for the moment the save
        returns has it (see `_answer`)."""
        token = _manager(client)
        sale = _sale(client, token, [_line()])
        assert sale["id"] in [s["id"] for s in _sales(client, token)]


@skip_no_db
class TestTheMenuOnASale:
    def test_a_dish_of_another_business_is_refused_and_nothing_is_kept(self, client):
        mine, theirs = _manager(client), _manager(client)
        their_dish = _dish(client, theirs, "Plato de otro")
        res = _post(client, mine, [_line(), _of(their_dish)])
        assert res.status_code == 422
        assert _code(res) == "menu_dish_not_found"
        assert _sales(client, mine) == []

    def test_a_dish_that_does_not_exist_is_refused(self, client):
        token = _manager(client)
        res = _post(client, token, [_line(dish_id=str(uuid.uuid4()))])
        assert (res.status_code, _code(res)) == (422, "menu_dish_not_found")

    def test_one_dish_on_several_lines_is_fine(self, client):
        token = _manager(client)
        dish = _dish(client, token)
        sale = _sale(client, token, [_of(dish), _of(dish, unit_price=0)])
        assert [l["dish_id"] for l in sale["lines"]] == [dish["id"], dish["id"]]

    def test_a_sale_outlives_the_dish(self, client):
        """Taking a dish off the menu leaves its sales as they were -- name,
        price and dish -- and the statistics still count it as one dish."""
        token = _manager(client)
        dish = _dish(client, token, "Pulpo", 18)
        first = _sale(client, token, [_of(dish, quantity=2)], sold_on="2026-09-01")
        removed = client.delete(MENU + "/dishes/%s" % dish["id"], headers=_auth(token))
        assert removed.status_code == 204
        # And a whole section with the dish still in it, which is a cascade.
        other = _dish(client, token, "Tarta", 5)
        _sale(client, token, [_of(other)], sold_on="2026-09-02")
        section_id = other["section_id"]
        res = client.delete(MENU + "/sections/%s" % section_id, headers=_auth(token))
        assert res.status_code == 204

        again = client.get(API + "/sales/%s" % first["id"], headers=_auth(token)).json()
        assert again == first
        top = _stats(client, token, "2026-09-01", "2026-09-02")["top_dishes"]
        assert [(d["name"], d["dish_id"], d["quantity"], d["total"]) for d in top] == [
            ("Pulpo", dish["id"], 2.0, 36.0),
            ("Tarta", other["id"], 1.0, 5.0),
        ]
        # A new sale can no longer name it: it is not on the menu.
        res = _post(client, token, [_of(dish)])
        assert (res.status_code, _code(res)) == (422, "menu_dish_not_found")


@skip_no_db
class TestDays:
    def test_a_sale_is_filed_between_2000_and_two_days_ahead(self, client):
        """Two days past the server's UTC today: the browser offers its own
        tomorrow, which after midnight in Madrid is the server's day after."""
        token = _manager(client)
        ahead = datetime.now(timezone.utc).date() + timedelta(days=2)
        for day in ("2000-01-01", ahead.isoformat()):
            assert _post(client, token, [_line()], sold_on=day).status_code == 201
        for day in ("1999-12-31", (ahead + timedelta(days=1)).isoformat(), "2062-09-01"):
            res = _post(client, token, [_line()], sold_on=day)
            assert res.status_code == 422, day
            assert _code(res) == "store_date_out_of_range"

    def test_a_day_is_a_day_not_an_instant(self, client):
        token = _manager(client)
        res = _post(client, token, [_line()], sold_on="2026-09-01T23:30:00+02:00")
        assert res.status_code == 422


@skip_no_db
class TestTheSameSaveTwice:
    def test_a_repeat_is_answered_with_the_sale_already_kept(self, client):
        token = _manager(client)
        body = {"sold_on": "2026-09-01", "client_ref": str(uuid.uuid4()), "lines": [_line()]}
        first = client.post(API + "/sales", json=body, headers=_auth(token))
        assert first.status_code == 201
        again = client.post(API + "/sales", json=body, headers=_auth(token))
        assert again.status_code == 200
        assert again.json() == first.json()
        assert len(_sales(client, token)) == 1

    def test_a_repeat_is_answered_before_the_request_is_judged(self, client):
        """A retry is a question about the first request: a second copy that
        would be refused on its own is still answered with what was kept."""
        token = _manager(client)
        ref = str(uuid.uuid4())
        first = _sale(client, token, [_line(unit_price=10)], client_ref=ref)
        again = _post(
            client, token, [_line(dish_id=str(uuid.uuid4()))], sold_on="1990-01-01", client_ref=ref
        )
        assert again.status_code == 200
        assert _as_kept(again.json()) == first

    def test_a_ref_belongs_to_one_business(self, client):
        mine, theirs = _manager(client), _manager(client)
        ref = str(uuid.uuid4())
        kept = _sale(client, mine, [_line(unit_price=24)], client_ref=ref)
        res = _post(client, theirs, [_line(unit_price=6)], client_ref=ref)
        assert res.status_code == 201
        assert res.json()["id"] != kept["id"]
        assert res.json()["total"] == 6
        again = _post(client, mine, [_line(unit_price=24)], client_ref=ref)
        assert (again.status_code, _as_kept(again.json())) == (200, kept)

    def test_two_saves_at_once_with_one_ref_make_one_sale(self, client, monkeypatch):
        """Both miss the lookup; the second meets UNIQUE (org_id, client_ref)
        at the INSERT and answers with the first one's sale -- a 200, not a
        500 and not the takings counted twice. That is what the savepoint is
        for."""
        from app.routers import store as router_module

        token = _manager(client)
        ref = str(uuid.uuid4())
        first = _sale(client, token, [_line(unit_price=850)], client_ref=ref)

        real = router_module._sale_by_ref
        calls = []

        def blind_first(*args, **kwargs):
            calls.append(1)
            return None if len(calls) == 1 else real(*args, **kwargs)

        monkeypatch.setattr(router_module, "_sale_by_ref", blind_first)
        res = _post(client, token, [_line(unit_price=99)], client_ref=ref)
        assert res.status_code == 200
        assert _as_kept(res.json()) == first
        assert len(calls) == 2
        assert [s["total"] for s in _sales(client, token)] == [850]


@skip_no_db
class TestPayment:
    @pytest.mark.parametrize("method", ["cash", "card"])
    def test_a_bill_charged_at_the_till_says_how_it_was_paid(self, client, method):
        token = _manager(client)
        dish = _dish(client, token)
        sale = _sale(client, token, [_of(dish, quantity=2)], source="till", payment_method=method)
        assert (sale["source"], sale["payment_method"], sale["total"]) == ("till", method, 19.0)
        got = client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json()
        assert got == sale
        [listed] = _sales(client, token)
        assert (listed["source"], listed["payment_method"]) == ("till", method)

    def test_a_sale_typed_in_may_say_how_it_was_paid(self, client):
        token = _manager(client)
        sale = _sale(client, token, [_line()], payment_method="cash")
        assert (sale["source"], sale["payment_method"]) == ("manual", "cash")

    @pytest.mark.parametrize(
        "fields",
        [
            {"payment_method": "bizum"},
            {"payment_method": "CARD"},
            {"payment_method": ""},
            {"payment_method": 1},
            {"source": "sumup"},
            {"source": "Till"},
        ],
    )
    def test_a_method_or_a_source_that_does_not_exist_is_refused(self, client, fields):
        token = _manager(client)
        assert _post(client, token, [_line()], **fields).status_code == 422
        assert _sales(client, token) == []

    @pytest.mark.parametrize("fields", [{"source": "till"}, {"source": "till", "payment_method": None}])
    def test_a_bill_charged_at_the_till_without_a_method_is_refused(self, client, fields):
        token = _manager(client)
        assert _post(client, token, [_line()], **fields).status_code == 422
        assert _sales(client, token) == []

    def test_a_charge_sent_again_is_answered_with_how_the_first_was_paid(self, client):
        """A double tap on "Confirmar cobro", or a retry after the answer was
        lost: one sale, the first one, whatever the second says."""
        token = _manager(client)
        ref = str(uuid.uuid4())
        first = _sale(client, token, [_line(unit_price=23.3)], source="till", payment_method="cash", client_ref=ref)
        again = _post(client, token, [_line(unit_price=23.3)], source="till", payment_method="card", client_ref=ref)
        assert (again.status_code, _as_kept(again.json())) == (200, first)
        assert len(_sales(client, token)) == 1


@skip_no_db
class TestVoid:
    def test_a_voided_sale_stays_with_when_who_and_why(self, client):
        token = _manager(client)
        dish = _dish(client, token)
        sale = _sale(client, token, [_of(dish, quantity=2), _line("Caja", 1, 1)], source="till", payment_method="card")
        before = datetime.now(timezone.utc)
        res = _void(client, token, sale["id"], {"reason": "  Cobrada dos veces  "})
        after = datetime.now(timezone.utc)
        assert res.status_code == 200, res.text
        voided = res.json()

        assert before - timedelta(seconds=5) <= _instant(voided["voided_at"]) <= after + timedelta(seconds=5)
        assert voided["voided_by_name"] == _me(client, token)["full_name"]
        assert voided["void_reason"] == "Cobrada dos veces"
        # Everything else as it was: lines, total, how it was paid.
        unchanged = {k: v for k, v in voided.items() if k not in ("voided_at", "voided_by_name", "void_reason")}
        assert unchanged == {k: v for k, v in sale.items() if k not in ("voided_at", "voided_by_name", "void_reason")}
        # Read back, the same.
        assert client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json() == voided
        # Listed, marked, with the total it had.
        [listed] = _sales(client, token)
        assert (listed["id"], listed["total"], listed["line_count"]) == (sale["id"], 20.0, 2)
        assert (listed["voided_at"], listed["void_reason"]) == (voided["voided_at"], "Cobrada dos veces")
        # And its lines are still in the table.
        assert _as_admin(
            "SELECT count(*) FROM store_sale_line WHERE sale_id = :s", {"s": sale["id"]}
        ) == 2

    @pytest.mark.parametrize("body", [None, {}, {"reason": None}, {"reason": "   "}])
    def test_a_void_needs_no_reason(self, client, body):
        token = _manager(client)
        sale = _sale(client, token, [_line()])
        res = _void(client, token, sale["id"], body)
        assert res.status_code == 200, res.text
        assert res.json()["voided_at"] is not None
        assert res.json()["void_reason"] is None

    def test_a_reason_past_the_wall_is_refused_and_nothing_is_voided(self, client):
        token = _manager(client)
        sale = _sale(client, token, [_line()])
        res = _void(client, token, sale["id"], {"reason": "x" * (limits.VOID_REASON + 1)})
        assert res.status_code == 422
        [listed] = _sales(client, token)
        assert listed["voided_at"] is None

    def test_a_sale_is_voided_once(self, client):
        """The first void is the record: a second one, from another tab or a
        double tap, is a 409 and changes neither when nor why."""
        token = _manager(client)
        sale = _sale(client, token, [_line()])
        first = _void(client, token, sale["id"], {"reason": "Mal cobrada"}).json()
        again = _void(client, token, sale["id"], {"reason": "Otra razón"})
        assert (again.status_code, _code(again)) == (409, "store_sale_already_voided")
        assert client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json() == first

    def test_an_unknown_sale_cannot_be_voided(self, client):
        token = _manager(client)
        res = _void(client, token, uuid.uuid4(), {})
        assert (res.status_code, _code(res)) == (404, "store_sale_not_found")

    def test_a_save_sent_again_after_its_void_is_answered_with_the_voided_sale(self, client):
        """The retry is still a question about the first request: it does not
        bring the sale back to life, nor make a second one."""
        token = _manager(client)
        ref = str(uuid.uuid4())
        sale = _sale(client, token, [_line()], client_ref=ref)
        voided = _void(client, token, sale["id"], {}).json()
        again = _post(client, token, [_line()], client_ref=ref)
        assert (again.status_code, _as_kept(again.json())) == (200, voided)
        assert len(_sales(client, token)) == 1


@skip_no_db
class TestWalls:
    @pytest.mark.parametrize(
        "line",
        [
            _line(name=""),
            _line(name="x" * (limits.NAME + 1)),
            _line(unit_price=-1),
            _line(unit_price=1_000_000),
            _line(quantity=0),
            _line(quantity=1_000_000),
        ],
        ids=["blank-name", "long-name", "negative-price", "price-million", "no-quantity", "quantity-million"],
    )
    def test_a_line_past_a_wall_is_refused(self, client, line):
        token = _manager(client)
        assert _post(client, token, [line]).status_code == 422
        assert _sales(client, token) == []

    def test_a_sale_needs_a_line_and_has_a_ceiling(self, client):
        token = _manager(client)
        assert _post(client, token, []).status_code == 422
        too_many = [_line("L%d" % i, 1, 1) for i in range(limits.STORE_SALE_LINES + 1)]
        assert _post(client, token, too_many).status_code == 422
        most = _sale(client, token, too_many[:-1])
        assert len(most["lines"]) == limits.STORE_SALE_LINES
        # In the order they were typed.
        assert [l["name"] for l in most["lines"]] == [
            "L%d" % i for i in range(limits.STORE_SALE_LINES)
        ]

    def test_the_largest_line_the_columns_hold_fits(self, client):
        token = _manager(client)
        # (1e6 - 0.01) x (1e6 - 0.001) = 1e12 - 11000 + 0.00001.
        sale = _sale(client, token, [_line(unit_price=999999.99, quantity=999999.999)])
        assert sale["lines"][0]["amount"] == 999999989000.0
        assert sale["total"] == 999999989000.0


@skip_no_db
class TestStatistics:
    def test_a_week_of_sales_adds_up(self, client):
        token = _manager(client)
        croquetas = _dish(client, token, "Croquetas", 9.5)
        # Outside the week on both sides: not counted.
        _sale(client, token, [_line(unit_price=1000)], sold_on="2026-09-06")
        _sale(client, token, [_line(unit_price=1000)], sold_on="2026-09-14")
        # Monday: two sales. The dish sold under two spellings is one dish.
        _sale(
            client,
            token,
            [_of(croquetas, quantity=2), _line("Caja del día", 100, 1)],
            sold_on="2026-09-07",
        )
        _sale(
            client,
            token,
            [_of(croquetas, name="Croquetas caseras", unit_price=10)],
            sold_on="2026-09-07",
        )
        # Wednesday: a free line.
        _sale(client, token, [_line("CAJA DEL DÍA", 50, 1)], sold_on="2026-09-09")
        # Sunday: the most recent spelling of the dish is the one shown.
        _sale(
            client,
            token,
            [_of(croquetas, quantity=3, name="Croquetas de jamón"), _line("Tarta", 5, 0.5)],
            sold_on="2026-09-13",
        )

        stats = _stats(client, token, "2026-09-07", "2026-09-13")
        assert (stats["from"], stats["to"]) == ("2026-09-07", "2026-09-13")
        assert stats["total"] == 210.0
        assert stats["sales_count"] == 4
        assert stats["days_with_sales"] == 3
        # Over the three days that sold, not the seven of the week.
        assert stats["average_per_day"] == 70.0
        # Every day, the ones with no sales at 0.
        assert stats["days"] == [
            {"date": "2026-09-07", "total": 129.0},
            {"date": "2026-09-08", "total": 0.0},
            {"date": "2026-09-09", "total": 50.0},
            {"date": "2026-09-10", "total": 0.0},
            {"date": "2026-09-11", "total": 0.0},
            {"date": "2026-09-12", "total": 0.0},
            {"date": "2026-09-13", "total": 31.0},
        ]
        # Monday is 0.
        assert stats["by_weekday"] == [
            {"weekday": 0, "total": 129.0},
            {"weekday": 1, "total": 0.0},
            {"weekday": 2, "total": 50.0},
            {"weekday": 3, "total": 0.0},
            {"weekday": 4, "total": 0.0},
            {"weekday": 5, "total": 0.0},
            {"weekday": 6, "total": 31.0},
        ]
        # Dishes of the menu only: the free lines are in every total above,
        # and in no row of the top.
        assert stats["top_dishes"] == [
            {"name": "Croquetas de jamón", "dish_id": croquetas["id"], "quantity": 6.0, "total": 57.5},
        ]

    def test_a_weekday_adds_up_every_week_of_the_period(self, client):
        token = _manager(client)
        for monday in ("2026-08-31", "2026-09-07", "2026-09-14"):
            _sale(client, token, [_line(unit_price=10)], sold_on=monday)
        stats = _stats(client, token, "2026-08-31", "2026-09-20")
        assert len(stats["days"]) == 21
        assert stats["by_weekday"][0] == {"weekday": 0, "total": 30.0}
        assert sum(d["total"] for d in stats["by_weekday"]) == stats["total"] == 30.0
        assert (stats["days_with_sales"], stats["average_per_day"]) == (3, 10.0)

    def test_a_period_with_no_sales_is_zeros_not_an_error(self, client):
        token = _manager(client)
        stats = _stats(client, token, "2026-09-01", "2026-09-30")
        assert (stats["total"], stats["sales_count"], stats["days_with_sales"]) == (0.0, 0, 0)
        assert stats["average_per_day"] == 0.0
        assert len(stats["days"]) == 30
        assert all(d["total"] == 0 for d in stats["days"])
        assert [w["weekday"] for w in stats["by_weekday"]] == list(range(7))
        assert stats["top_dishes"] == []

    def test_one_day_is_a_period(self, client):
        token = _manager(client)
        _sale(client, token, [_line(unit_price=12.34)], sold_on="2026-09-01")
        stats = _stats(client, token, "2026-09-01", "2026-09-01")
        assert stats["days"] == [{"date": "2026-09-01", "total": 12.34}]
        assert stats["average_per_day"] == 12.34

    def test_the_average_is_to_the_cent(self, client):
        token = _manager(client)
        for day in ("2026-09-01", "2026-09-02", "2026-09-03"):
            _sale(client, token, [_line(unit_price=10)], sold_on=day)
        _sale(client, token, [_line(unit_price=0.01)], sold_on="2026-09-03")
        stats = _stats(client, token, "2026-09-01", "2026-09-30")
        # 30.01 over 3 days.
        assert stats["average_per_day"] == 10.0
        assert stats["total"] == 30.01

    def test_the_top_is_ten_dishes_most_first(self, client):
        token = _manager(client)
        dishes = [_dish(client, token, "Plato %02d" % i, i + 1) for i in range(12)]
        _sale(client, token, [_of(d) for d in dishes], sold_on="2026-09-01")
        top = _stats(client, token, "2026-09-01", "2026-09-01")["top_dishes"]
        assert [d["name"] for d in top] == ["Plato %02d" % i for i in range(11, 1, -1)]

    def test_a_tie_is_broken_by_units_then_by_name(self, client):
        token = _manager(client)
        b, a, c = (_dish(client, token, n, p) for n, p in (("B", 10), ("A", 10), ("C", 5)))
        _sale(client, token, [_of(b), _of(a), _of(c, quantity=2)], sold_on="2026-09-01")
        top = _stats(client, token, "2026-09-01", "2026-09-01")["top_dishes"]
        assert [d["name"] for d in top] == ["C", "A", "B"]

    def test_a_year_is_the_longest_period(self, client):
        token = _manager(client)
        # 2025-09-01 to 2026-09-01 is 366 days, both included.
        stats = _stats(client, token, "2025-09-01", "2026-09-01")
        assert len(stats["days"]) == 366
        res = client.get(
            API + "/stats",
            params={"from": "2025-08-31", "to": "2026-09-01"},
            headers=_auth(token),
        )
        assert (res.status_code, _code(res)) == (422, "store_range_too_long")
        assert res.json()["detail"]["params"] == {"limit": 366}

    @pytest.mark.parametrize(
        "params, code",
        [
            ({"from": "2026-09-01", "to": "2026-9-30"}, "bad_date"),
            ({"from": "2026-09-30", "to": "2026-09-01"}, "window_end_before_start"),
        ],
    )
    def test_a_period_that_is_not_one_is_refused_in_words(self, client, params, code):
        token = _manager(client)
        res = client.get(API + "/stats", params=params, headers=_auth(token))
        assert (res.status_code, _code(res)) == (422, code)

    def test_both_ends_are_required(self, client):
        """Which day is today is the browser's to say, not the server's."""
        token = _manager(client)
        for params in ({}, {"from": "2026-09-01"}, {"to": "2026-09-01"}):
            res = client.get(API + "/stats", params=params, headers=_auth(token))
            assert res.status_code == 422, params

    def test_the_last_day_there_is_does_not_overflow(self, client):
        token = _manager(client)
        stats = _stats(client, token, "9999-12-25", "9999-12-31")
        assert stats["days"][-1] == {"date": "9999-12-31", "total": 0.0}

    def test_a_voided_sale_is_listed_and_counted_nowhere(self, client):
        """Out of the total, the count, the days that sold, the average, every
        day, every weekday and the top -- and still in the list, marked."""
        token = _manager(client)
        croquetas = _dish(client, token, "Croquetas", 10)
        tarta = _dish(client, token, "Tarta", 5)
        # Monday: a sale that stands and one voided.
        kept = _sale(client, token, [_of(croquetas, quantity=2)], sold_on="2026-09-07", source="till", payment_method="cash")
        wrong = _sale(client, token, [_line("Caja del día", 100, 1)], sold_on="2026-09-07")
        # Wednesday: the only sale of the day, voided, and the only one of its dish.
        mistaken = _sale(client, token, [_of(tarta)], sold_on="2026-09-09", source="till", payment_method="card")
        for sale in (wrong, mistaken):
            assert _void(client, token, sale["id"], {"reason": "Error"}).status_code == 200

        stats = _stats(client, token, "2026-09-07", "2026-09-13")
        assert stats["total"] == 20.0
        assert (stats["sales_count"], stats["days_with_sales"]) == (1, 1)
        assert stats["average_per_day"] == 20.0
        assert [d["total"] for d in stats["days"]] == [20.0, 0, 0, 0, 0, 0, 0]
        assert [w["total"] for w in stats["by_weekday"]] == [20.0, 0, 0, 0, 0, 0, 0]
        assert stats["top_dishes"] == [
            {"name": "Croquetas", "dish_id": croquetas["id"], "quantity": 2.0, "total": 20.0},
        ]

        listed = {s["id"]: s for s in _sales(client, token, first="2026-09-07", last="2026-09-13")}
        assert set(listed) == {kept["id"], wrong["id"], mistaken["id"]}
        assert listed[kept["id"]]["voided_at"] is None
        assert [(listed[s["id"]]["total"], listed[s["id"]]["void_reason"]) for s in (wrong, mistaken)] == [
            (100.0, "Error"),
            (5.0, "Error"),
        ]
        assert all(listed[s["id"]]["voided_at"] for s in (wrong, mistaken))


@skip_no_db
class TestWhoMay:
    def test_an_employee_charges_at_the_till_but_types_nothing_in_by_hand(self, client):
        """Since 28-sep-2026 (app/access.py) the team charges at the till,
        reads the sales and the statistics as they are today, and voids a
        sale. A sale typed in by hand is still the manager's."""
        token = _manager(client)
        dish = _dish(client, token)
        sale = _sale(client, token, [_line()])
        employee = _add(client, token, "Ana")
        ana = _employee_token(client, token, employee["id"])
        staff = _auth(ana)

        assert client.get(MENU, headers=staff).status_code == 200
        for res in (
            client.get(API + "/sales", headers=staff),
            client.get(API + "/sales/%s" % sale["id"], headers=staff),
            client.get(API + "/stats", params={"from": "2026-09-01", "to": "2026-09-30"}, headers=staff),
        ):
            assert res.status_code == 200, res.text

        # By hand: refused -- the default source, and said out loud.
        for fields in ({}, {"source": "manual"}):
            res = _post(client, ana, [_line()], **fields)
            assert (res.status_code, _code(res)) == (403, "manager_role_required"), res.text

        # At the till: charged -- of today, in the business's calendar, as the
        # till charges it (routers/store.py) -- and voided.
        from app.services.business_time import business_day

        today = business_day(datetime.now(timezone.utc)).isoformat()
        charged = _post(
            client, ana, [_of(dish)], sold_on=today, source="till", payment_method="card"
        )
        assert charged.status_code == 201, charged.text
        assert charged.json()["source"] == "till"
        voided = client.post(API + "/sales/%s/void" % sale["id"], json={}, headers=staff)
        assert voided.status_code == 200, voided.text

        # Nothing typed by hand was kept: the manager's sale, voided, and the
        # till's.
        listed = {s["id"]: s for s in _sales(client, token)}
        assert set(listed) == {sale["id"], charged.json()["id"]}
        assert listed[sale["id"]]["voided_at"] is not None
        assert listed[charged.json()["id"]]["voided_at"] is None


@skip_no_db
class TestAnotherBusiness:
    def test_a_neighbours_sales_are_neither_read_nor_voided_nor_counted(self, client):
        mine, theirs = _manager(client), _manager(client)
        my_sale = _sale(client, mine, [_of(_dish(client, mine, "Mío", 10))])
        their_sale = _sale(client, theirs, [_line("Suyo", 999, 1)])

        assert [s["id"] for s in _sales(client, mine)] == [my_sale["id"]]
        for res in (
            client.get(API + "/sales/%s" % their_sale["id"], headers=_auth(mine)),
            client.post(
                API + "/sales/%s/void" % their_sale["id"],
                json={"reason": "Mía"},
                headers=_auth(mine),
            ),
        ):
            assert (res.status_code, _code(res)) == (404, "store_sale_not_found")
        stats = _stats(client, mine, "2026-09-01", "2026-09-01")
        assert stats["total"] == 10.0
        assert [d["name"] for d in stats["top_dishes"]] == ["Mío"]
        # Theirs is as they left it.
        still = client.get(API + "/sales/%s" % their_sale["id"], headers=_auth(theirs))
        assert (still.status_code, still.json()) == (200, their_sale)

    def test_the_database_refuses_a_line_under_a_neighbours_sale(self, client):
        """The second barrier: even written by hand, as the runtime role, a
        line cannot be filed under another business's sale. RLS stops the
        org_id; the key on (sale_id, org_id) stops the sale."""
        from sqlalchemy.exc import DBAPIError

        from app.db import app_engine

        mine, theirs = _manager(client), _manager(client)
        my_org = client.get("/api/v1/auth/me", headers=_auth(mine)).json()["org_id"]
        their_sale = _sale(client, theirs, [_line()])
        with pytest.raises(DBAPIError):
            with app_engine.begin() as conn:
                conn.execute(
                    text("SELECT set_config('app.current_org_id', :org, true)"),
                    {"org": my_org},
                )
                conn.execute(
                    text(
                        "INSERT INTO store_sale_line "
                        "(org_id, sale_id, name, unit_price, quantity, position) "
                        "VALUES (:org, :sale, 'Colado', 1, 1, 9)"
                    ),
                    {"org": my_org, "sale": their_sale["id"]},
                )
        assert _as_admin(
            "SELECT count(*) FROM store_sale_line WHERE sale_id = :s", {"s": their_sale["id"]}
        ) == 1


@contextmanager
def _runtime(org_id: str):
    """One transaction as app_user, the role every request runs as, inside
    the business: past row-level security, so what answers is the privilege
    -- or the trigger."""
    from app.db import app_engine

    with app_engine.begin() as conn:
        conn.execute(text("SELECT set_config('app.current_org_id', :org, true)"), {"org": org_id})
        yield conn


def _as_runtime(org_id: str, sql: str, params: dict):
    """One statement, in a transaction of its own, as app_user."""
    with _runtime(org_id) as conn:
        return conn.execute(text(sql), params).rowcount


def _product(client, token, name="Pollo") -> dict:
    res = client.post(
        "/api/v1/inventory/items", json={"name": name, "unit": "kg"}, headers=_auth(token)
    )
    assert res.status_code == 201, res.text
    return res.json()


def _second_manager(client, token, name="Marta") -> dict:
    """Another manager of the same business, with a login of their own: an
    employee's account, made a manager by hand (the API mints employees'
    logins only)."""
    employee = _add(client, token, name)
    their_token = _employee_token(client, token, employee["id"])
    me = _me(client, their_token)
    assert _as_admin(
        "UPDATE user_account SET role = 'manager' WHERE id = :a RETURNING id", {"a": me["id"]}
    ) is not None
    return {"token": their_token, "id": me["id"], "employee_id": employee["id"]}


def _refused(error) -> str:
    """What the database said, lower case: the privilege's "permission
    denied" or the trigger's own words."""
    return str(error.value).lower()


# A sale written by hand, past the API: what the INSERT CHECKs are left to.
_SAVED = (
    "INSERT INTO store_sale (org_id, sold_on, client_ref, source, payment_method) "
    "VALUES (:org, '2026-09-01', gen_random_uuid(), "
)
_A_LINE = (
    "INSERT INTO store_sale_line (org_id, sale_id, name, unit_price, quantity, position) "
    "VALUES (:org, :sale, 'Colada', 5, 1, 9)"
)
_WHAT_IT_TOOK = (
    "INSERT INTO store_sale_consumption (org_id, sale_id, item_id, quantity) "
    "VALUES (:org, :sale, :item, 1)"
)


@skip_no_db
class TestNeverDeleted:
    """What the database itself holds to, whatever a future route forgets
    (migration 0043): the privileges first, and the triggers for what a
    privilege cannot say."""

    @pytest.mark.parametrize(
        "sql",
        [
            "DELETE FROM store_sale WHERE id = :sale",
            "DELETE FROM store_sale_line WHERE sale_id = :sale",
            "UPDATE store_sale SET sold_on = sold_on - 1 WHERE id = :sale",
            "UPDATE store_sale SET payment_method = 'card' WHERE id = :sale",
            "UPDATE store_sale SET source = 'till' WHERE id = :sale",
            "UPDATE store_sale_line SET unit_price = 0 WHERE sale_id = :sale",
            # What it took off the stock is part of the record too (0041).
            "DELETE FROM store_sale_consumption WHERE sale_id = :sale",
            "UPDATE store_sale_consumption SET quantity = 1 WHERE sale_id = :sale",
            # The name of who voided is the database's to write.
            "UPDATE store_sale SET voided_by_name = 'Otra persona' WHERE id = :sale",
        ],
        ids=[
            "delete-sale",
            "delete-line",
            "edit-day",
            "edit-method",
            "edit-source",
            "edit-line",
            "delete-consumption",
            "edit-consumption",
            "edit-voider-name",
        ],
    )
    def test_the_runtime_role_can_neither_delete_nor_edit_a_sale(self, client, sql):
        from sqlalchemy.exc import ProgrammingError

        token = _manager(client)
        sale = _sale(client, token, [_line(), _line("Otra", 2, 1)], payment_method="cash")
        with pytest.raises(ProgrammingError) as refused:
            _as_runtime(_me(client, token)["org_id"], sql, {"sale": sale["id"]})
        assert "permission denied" in _refused(refused)
        assert client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json() == sale

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE store_sale SET voided_at = NULL, voided_by = NULL, void_reason = NULL "
            "WHERE id = :sale",
            "UPDATE store_sale SET void_reason = 'Otra razón' WHERE id = :sale",
            "UPDATE store_sale SET void_reason = NULL WHERE id = :sale",
            "UPDATE store_sale SET voided_at = voided_at - interval '1 day' WHERE id = :sale",
            "UPDATE store_sale SET voided_at = now() WHERE id = :sale",
            # Their account is still there: only its deletion clears it.
            "UPDATE store_sale SET voided_by = NULL WHERE id = :sale",
            "UPDATE store_sale SET voided_by = :other WHERE id = :sale",
        ],
        ids=[
            "un-void",
            "rewrite-reason",
            "drop-reason",
            "backdate",
            "void-again",
            "forget-voider",
            "another-voider",
        ],
    )
    def test_a_void_is_never_undone_nor_rewritten(self, client, sql):
        """The three columns app_user may write, and on a sale already voided
        none of them moves: the column grant says which columns, the trigger
        says from what to what."""
        from sqlalchemy.exc import ProgrammingError

        token = _manager(client)
        other = _second_manager(client, token)
        sale = _sale(client, token, [_line()], source="till", payment_method="cash")
        voided = _void(client, token, sale["id"], {"reason": "Mal cobrada"}).json()
        with pytest.raises(ProgrammingError) as refused:
            _as_runtime(
                _me(client, token)["org_id"], sql, {"sale": sale["id"], "other": other["id"]}
            )
        assert "a void is never undone nor rewritten" in _refused(refused)
        assert client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json() == voided

    def test_the_database_writes_when_and_who_of_a_void(self, client):
        """Voided by hand, past the API: the time is the database's clock, not
        the one sent, and the name is the voider's account's."""
        token = _manager(client)
        me = _me(client, token)
        sale = _sale(client, token, [_line()])
        before = datetime.now(timezone.utc)
        assert _as_runtime(
            me["org_id"],
            "UPDATE store_sale SET voided_at = '2000-01-01', voided_by = :me, "
            "void_reason = 'Cobrada dos veces' WHERE id = :sale",
            {"sale": sale["id"], "me": me["id"]},
        ) == 1
        after = datetime.now(timezone.utc)
        got = client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json()
        assert before - timedelta(seconds=5) <= _instant(got["voided_at"]) <= after + timedelta(seconds=5)
        assert (got["voided_by_name"], got["void_reason"]) == (me["full_name"], "Cobrada dos veces")

    @pytest.mark.parametrize(
        "sql, said",
        [
            ("UPDATE store_sale SET voided_at = now() WHERE id = :sale", "a void says who voided it"),
            (
                "UPDATE store_sale SET voided_at = now(), voided_by = :neighbour WHERE id = :sale",
                "not this business's",
            ),
            (
                "UPDATE store_sale SET voided_at = now(), voided_by = :me, "
                "voided_by_name = 'Otra persona' WHERE id = :sale",
                "permission denied",
            ),
            (
                "INSERT INTO store_sale (org_id, sold_on, client_ref, voided_at, voided_by, "
                "voided_by_name) VALUES (:org, '2026-09-01', gen_random_uuid(), now(), :me, "
                "'Otra persona')",
                "never saved voided",
            ),
        ],
        ids=["no-voider", "neighbours-voider", "forged-name", "saved-voided"],
    )
    def test_a_void_says_who_and_it_is_one_of_the_business(self, client, sql, said):
        from sqlalchemy.exc import ProgrammingError

        token = _manager(client)
        me = _me(client, token)
        neighbour = _me(client, _manager(client))
        sale = _sale(client, token, [_line()])
        with pytest.raises(ProgrammingError) as refused:
            _as_runtime(
                me["org_id"],
                sql,
                {"sale": sale["id"], "org": me["org_id"], "me": me["id"], "neighbour": neighbour["id"]},
            )
        assert said in _refused(refused)
        [listed] = _sales(client, token)
        assert (listed["id"], listed["voided_at"]) == (sale["id"], None)

    @pytest.mark.parametrize("what", [_A_LINE, _WHAT_IT_TOOK], ids=["line", "consumption"])
    @pytest.mark.parametrize(
        "first",
        [
            None,
            # Both write a new version of the sale's row in this transaction,
            # which is why "the same transaction" is not the row's `xmin`.
            "UPDATE store_sale SET voided_at = now(), voided_by = :me WHERE id = :sale",
            "UPDATE store_sale SET void_reason = NULL WHERE id = :sale",
        ],
        ids=["alone", "after-voiding-it", "after-touching-it"],
    )
    def test_nothing_is_added_to_a_sale_saved_before(self, client, what, first):
        """Its total is its lines', and what it took is the stock's: a line
        or a product added to last week's sale would rewrite both."""
        from sqlalchemy.exc import ProgrammingError

        token = _manager(client)
        me = _me(client, token)
        item = _product(client, token)
        sale = _sale(client, token, [_line("Caja", 20, 1)], source="till", payment_method="cash")
        params = {"sale": sale["id"], "org": me["org_id"], "me": me["id"], "item": item["id"]}
        with pytest.raises(ProgrammingError) as refused:
            with _runtime(me["org_id"]) as conn:
                if first is not None:
                    conn.execute(text(first), params)
                conn.execute(text(what), params)
        assert "never added afterwards" in _refused(refused)
        assert client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json() == sale
        assert _as_admin(
            "SELECT count(*) FROM store_sale_consumption WHERE sale_id = :s", {"s": sale["id"]}
        ) == 0

    def test_a_sale_and_what_it_holds_are_written_together_past_the_api_too(self, client):
        """The one way in, by hand as the route does it: the sale inside a
        savepoint, then its line and what it took, all in one transaction --
        whatever stamp the INSERT tried to bring. The next transaction adds
        nothing."""
        from sqlalchemy.exc import ProgrammingError

        token = _manager(client)
        me = _me(client, token)
        item = _product(client, token)
        with _runtime(me["org_id"]) as conn:
            with conn.begin_nested():
                sale_id = conn.execute(
                    text(
                        "INSERT INTO store_sale (org_id, sold_on, client_ref, source, "
                        "payment_method, created_xact) VALUES (:org, '2026-09-02', "
                        "gen_random_uuid(), 'till', 'card', '1') RETURNING id"
                    ),
                    {"org": me["org_id"]},
                ).scalar()
            params = {"sale": sale_id, "org": me["org_id"], "item": item["id"]}
            conn.execute(text(_A_LINE), params)
            conn.execute(text(_WHAT_IT_TOOK), params)
            assert conn.execute(
                text("SELECT created_xact = pg_current_xact_id() FROM store_sale WHERE id = :s"),
                {"s": sale_id},
            ).scalar() is True
        got = client.get(API + "/sales/%s" % sale_id, headers=_auth(token)).json()
        assert ([line["name"] for line in got["lines"]], got["total"]) == (["Colada"], 5.0)
        with pytest.raises(ProgrammingError) as refused:
            _as_runtime(me["org_id"], _A_LINE, {"sale": sale_id, "org": me["org_id"]})
        assert "never added afterwards" in _refused(refused)

    @pytest.mark.parametrize(
        "sql",
        [
            "UPDATE store_sale SET sold_on = sold_on - 1 WHERE id = :sale",
            "UPDATE store_sale SET voided_at = NULL, voided_by = NULL, voided_by_name = NULL, "
            "void_reason = NULL WHERE id = :sale",
            "UPDATE store_sale SET created_by = NULL WHERE id = :sale",
            _A_LINE,
        ],
        ids=["edit-day", "un-void", "forget-who-saved-it", "add-a-line"],
    )
    def test_the_owner_is_held_to_it_as_well(self, client, sql):
        """Past every privilege, the triggers still stand: whoever holds the
        owner's password has to drop them, on purpose, to change a sale."""
        from sqlalchemy.exc import ProgrammingError

        token = _manager(client)
        me = _me(client, token)
        sale = _sale(client, token, [_line()], source="till", payment_method="card")
        voided = _void(client, token, sale["id"], {"reason": "Error"}).json()
        with pytest.raises(ProgrammingError):
            _as_admin(sql, {"sale": sale["id"], "org": me["org_id"]})
        assert client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json() == voided

    def test_the_name_of_who_voided_outlives_their_account(self, client):
        """A manager who leaves takes their login, not the trail: the account
        goes, `voided_by` and `created_by` with it (their ON DELETE SET NULL,
        the one change the trigger lets through), and the sale still says who
        voided it."""
        token = _manager(client)
        marta = _second_manager(client, token, "Marta Soler")
        sale = _sale(client, marta["token"], [_line()], source="till", payment_method="cash")
        voided = _void(client, marta["token"], sale["id"], {"reason": "Cobrada dos veces"}).json()
        assert voided["voided_by_name"] == "Marta Soler"

        # Deleted by hand: "Quitar acceso" (DELETE /employees/{id}/account)
        # takes an employee's login, never a manager's (routers/accounts.py).
        res = client.delete(
            "/api/v1/employees/%s/account" % marta["employee_id"], headers=_auth(token)
        )
        assert res.status_code == 404, res.text
        assert _as_admin(
            "DELETE FROM user_account WHERE id = :a RETURNING id", {"a": marta["id"]}
        ) is not None
        assert _as_admin(
            "SELECT count(*) FROM user_account WHERE id = :a", {"a": marta["id"]}
        ) == 0
        # Who voided it is kept by name, and so is who charged it (0046).
        assert voided["created_by_name"] == "Marta Soler"
        assert client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json() == voided
        assert _as_admin(
            "SELECT voided_by IS NULL AND created_by IS NULL FROM store_sale WHERE id = :s",
            {"s": sale["id"]},
        ) is True

    @pytest.mark.parametrize(
        "sql",
        [
            # A reason, or a voider, on a sale that was never voided.
            "UPDATE store_sale SET void_reason = 'x' WHERE id = :sale",
            "UPDATE store_sale SET voided_by = created_by WHERE id = :sale",
            "UPDATE store_sale SET voided_at = now(), voided_by = created_by, "
            "void_reason = repeat('x', 201) WHERE id = :sale",
            # What a sale is saved with. As an UPDATE it would not reach the
            # CHECK: the trigger refuses first (above).
            _SAVED + "'manual', 'bizum')",
            _SAVED + "'import', NULL)",
            _SAVED + "'till', NULL)",
        ],
        ids=["reason-no-void", "voider-no-void", "long-reason", "bizum", "import", "till-unpaid"],
    )
    def test_the_columns_hold_only_what_can_be_true(self, client, sql):
        """As the owner, past every privilege: the CHECKs are what is left."""
        from sqlalchemy.exc import IntegrityError

        token = _manager(client)
        sale = _sale(client, token, [_line()])
        with pytest.raises(IntegrityError):
            _as_admin(sql, {"sale": sale["id"], "org": _me(client, token)["org_id"]})
        assert client.get(API + "/sales/%s" % sale["id"], headers=_auth(token)).json() == sale
        assert len(_sales(client, token)) == 1

    def test_ending_the_business_still_takes_its_sales(self, client):
        """The one delete that remains, and it is the business's own: the
        cascade from `organization` runs as the table's owner, so the REVOKE
        on app_user does not stand in its way -- voided sales included."""
        token = _manager(client)
        me = _me(client, token)
        sale = _sale(client, token, [_line(), _line("Otra", 2, 1)], source="till", payment_method="card")
        _sale(client, token, [_line()])
        assert _void(client, token, sale["id"], {"reason": "Error"}).status_code == 200
        res = client.request(
            "DELETE", "/api/v1/org", json={"confirm": me["org_name"]}, headers=_auth(token)
        )
        assert res.status_code == 204, res.text
        for table in ("store_sale", "store_sale_line"):
            assert _as_admin(
                "SELECT count(*) FROM %s WHERE org_id = :o" % table, {"o": me["org_id"]}
            ) == 0, table
