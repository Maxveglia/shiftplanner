"""The shop's sales, charged at the till or typed in by hand, and what they
add up to.

A sale comes from one of two places (`source`). The till: the bill of Tienda ->
Menú, charged in cash or by card -- card being the manager confirming the card
reader took the money, since there is no reader connected yet. Or by hand
("Nueva venta"): a table's bill, or the whole day as one line ("Caja del día",
850 €). A sale is filed under a DAY, has an optional note, a payment method
when somebody said, and one or more lines; a line is a dish of the menu or a
free line, with a unit price and a quantity, and the sale's total is the sum
of its lines. The name and price of a dish are copied onto the line when it is
picked (the browser does it): a sale is what happened, and the menu changing
next month must not rewrite it. See migrations 0035 and 0043.

A dish with a recipe (routers/recipes.py) takes what it is made of off the
stock: when a sale is saved, its lines are expanded through the recipes of
that moment and what they took is written down with it, in the same
transaction (`store_sale_consumption`, migration 0041). Written once and never
worked out again -- a recipe changed later changes the next sale, not this
one. A dish with no recipe called the same as one product of the inventory
takes one of it (services/recipes.py, "the automatic link"). The answer to
saving a sale does not show what it took; it says which of the products it
took from are now below their minimum (`stock_alerts`, and which of them this
sale made critical), so the till can offer the order to the supplier (Max,
27-sep-2026). Only that answer: reading a sale, the list and voiding one say
nothing of the stock.

A sale is never deleted nor edited once saved -- a till that records sales is
a billing system in the eyes of Spain's anti-fraud law, and its records have
to stay. A mistake is VOIDED: the sale stays, with its lines, its total and
what it took off the stock, marked with when, by whom and why; the list still
shows it, and the statistics leave it out. So does the stock: what a voided
sale took is still written down, and no longer counted (routers/inventory.py),
which puts it back. There is no DELETE and no PATCH, and the database refuses
both to the runtime role as well (0043): no un-voiding, no rewriting a void,
and no line added to a sale after the transaction that saved it.

The statistics are read off the same rows, the voided ones left out: the
total of a period, how many sales and on how many days, the average per day
that had sales, every day of the period with its total, the week by weekday,
and the dishes that took the most.

Who may do what is app/access.py's table: the whole team -- employees and the
till's tablet -- charges at the till, lists and reads the sales, voids one and
reads the statistics as they are today; a sale typed in by hand (`source`
"manual") is the manager's alone, checked inside `create_sale` since it is
the same route as the till's. And what the team charges is what the till
would: dishes of the menu at the menu's price, today, in whole units, under
the name the menu gives them (`_till_lines_are_dishes`, `_till_day`,
`_till_prices`, below) -- or "source": "till" would be a hand-typed sale by
another name.
Every query is scoped by `org_id` in the WHERE
and behind `org_isolation` as well, like every other tenant table. An id of
another business is a 404, never a 403.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, func, select, text, update
from sqlalchemy.dialects.postgresql import aggregate_order_by, array_agg
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import Perm, can, require_permission
from app.db import get_db
from app.errors import detail
from app.models.inventory import InventoryItem
from app.models.menu import MenuDish
from app.models.store import StoreSale, StoreSaleConsumption, StoreSaleLine
from app.models.user_account import UserAccount
from app.routers.inventory import stock_alerts
from app.schemas.auth import UserOut
from app.schemas.inventory import QUANTITY_CEILING as STOCK_CEILING
from app.schemas.store import (
    StoreSaleCreate,
    StoreSaleCreatedOut,
    StoreSaleLineOut,
    StoreSaleOut,
    StoreSaleSummary,
    StoreSaleVoid,
    StoreStatsDay,
    StoreStatsDish,
    StoreStatsOut,
    StoreStatsWeekday,
)
from app.services import recipes
from app.services.business_time import business_day

router = APIRouter(prefix="/store", tags=["store"])

# The list answers with the most recent sales of the period and no more. A
# busy bar typing a sale per table makes a few thousand a month; the screen
# asks for a week or a month at a time, and this is the wall behind it.
LIST_LIMIT = 500

# The longest period the statistics are worked out over: a year, leap day
# included. The screen offers 7, 30 and 90 days; this bounds what one request
# can make the database add up.
STATS_DAYS = 366

TOP_DISHES = 10

# A sale filed in 2062 because 2026 was mistyped is not a harmless typo: it
# sits in every statistics period that reaches it, for ever. Two days ahead of
# the server's UTC: the form offers up to the browser's tomorrow, and between
# midnight and 02:00 in Madrid the browser's tomorrow is already two days past
# the server's today -- a one-day margin refused a date the form had just
# offered. 2000 covers any takings worth typing in from paper.
_EARLIEST = date(2000, 1, 1)
_AHEAD = timedelta(days=2)

# A sale charged at the till by whoever may not type one in by hand is of
# today, in the business's calendar (Madrid, services/business_time.py) --
# one day either side, for a browser whose clock or zone is off, and a bill
# charged at 23:59 whose answer came back after midnight.
_TILL_SLACK = timedelta(days=1)

# How many of one dish a line of the till holds: whole units, a tap is one,
# and at most what the till's bill lets a line reach (frontend's
# lib/store/ticket.ts, MAX_TICKET_QUANTITY). 0,001 of a dish, or 166 666,665,
# is not something a till rings up -- it is an amount typed in by another name.
_TILL_MAX_QUANTITY = 999

_CENT = Decimal("0.01")
_ISO_DAY = re.compile(r"\d{4}-\d{2}-\d{2}", re.ASCII)

# What a line is worth: unit price times quantity, to the cent. Postgres'
# round() of a numeric rounds half away from zero, which on money that is
# never negative is half up -- how a till rounds. Worked out on every read
# rather than stored: neither side of it can change after the line is written,
# and a stored copy is a second number that could disagree with the first.
_AMOUNT = func.round(StoreSaleLine.unit_price * StoreSaleLine.quantity, 2)


def _money(value) -> float:
    return float(Decimal(value or 0).quantize(_CENT, rounding=ROUND_HALF_UP))


# --- Days ---------------------------------------------------------------------


def _sold_on(value: date) -> date:
    """The day a sale is filed under, if it is a plausible one."""
    today = datetime.now(timezone.utc).date()
    if not (_EARLIEST <= value <= today + _AHEAD):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "store_date_out_of_range",
                "The date must be between 2000 and tomorrow",
            ),
        )
    return value


def _day(value: str, name: str) -> date:
    """A day of a query string, YYYY-MM-DD and nothing else.

    Parsed here rather than typed as `date` in the signature so a bad one is
    refused with a code the browser can put into words (`bad_date`) rather
    than pydantic's English. The pattern first: Python's own parser also takes
    "20260901" and week dates, which are not what the contract says.
    """
    try:
        if not _ISO_DAY.fullmatch(value):
            raise ValueError(value)
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("bad_date", "'%s' must be a date as YYYY-MM-DD" % name),
        ) from None


def _in_order(first: Optional[date], last: Optional[date]) -> None:
    """Both ends are days of the period, so one day is `from` == `to`."""
    if first is not None and last is not None and last < first:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "window_end_before_start", "'to' must not be before 'from'"
            ),
        )


# --- Finding one, or saying it is not there -----------------------------------


def _get_sale(db: Session, org_id: UUID, sale_id: UUID) -> StoreSale:
    sale = db.execute(
        select(StoreSale).where(StoreSale.org_id == org_id).where(StoreSale.id == sale_id)
    ).scalar_one_or_none()
    if sale is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("store_sale_not_found", "Sale not found"),
        )
    return sale


def _sale_by_ref(db: Session, org_id: UUID, client_ref: UUID) -> Optional[StoreSale]:
    """The sale this business already saved under this ref, if any."""
    return db.execute(
        select(StoreSale)
        .where(StoreSale.org_id == org_id)
        .where(StoreSale.client_ref == client_ref)
    ).scalar_one_or_none()


def _known_dishes(db: Session, org_id: UUID, ids: Sequence[UUID]) -> None:
    """422 unless every one of these is a dish of this business's menu NOW.

    The line has no foreign key to the dish (see migration 0035), so this is
    the only thing that stops a line naming a neighbour's dish -- or one that
    left the menu while the form was open, which the manager is told in the
    menu's own words and can save as a free line. A 422 and not a 404: the
    sale is what was asked for, and it is the sale that cannot be kept as sent.
    """
    wanted = set(ids)
    if not wanted:
        return
    found = set(
        db.execute(
            select(MenuDish.id)
            .where(MenuDish.org_id == org_id)
            .where(MenuDish.id.in_(wanted))
        ).scalars()
    )
    if found != wanted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("menu_dish_not_found", "Dish not found"),
        )


def _consumption(
    db: Session, org_id: UUID, payload: StoreSaleCreate
) -> Dict[UUID, Decimal]:
    """What this sale takes off the stock, by product, from the recipes as
    they are NOW (services/recipes.py): exact, rounded once, nothing at zero.

    Worked out before anything is written, so a sale that cannot be written
    down whole is refused whole. The quantities are the ones the schema
    already rounded to the thousandth -- the ones the lines will store.
    """
    lines = [
        (line.dish_id, Decimal(str(line.quantity)))
        for line in payload.lines
        if line.dish_id is not None
    ]
    if not lines:
        return {}
    taken = recipes.expand(recipes.load(db, org_id), lines)
    # numeric(12, 3), like every stock quantity: nine digits before the point.
    # A sale past it is a quantity typed wrong, and a 422 in words rather
    # than the overflow the column would answer with (a 500).
    too_much = sorted(i for i, q in taken.items() if q >= STOCK_CEILING)
    if too_much:
        name = db.execute(
            select(InventoryItem.name)
            .where(InventoryItem.org_id == org_id)
            .where(InventoryItem.id == too_much[0])
        ).scalar_one_or_none()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "store_sale_consumption_too_large",
                "This sale would take more than %d of %s off the stock"
                % (STOCK_CEILING, name),
                item=name,
                limit=STOCK_CEILING,
            ),
        )
    return taken


def _answer(db: Session, out):
    """Commit, then answer with what was read BEFORE the commit.

    The screen refetches the list the moment it hears back, and `get_db`
    commits only when the request closes: without this it could read the list
    of before -- a sale just saved missing, and typed again. `out` is built
    first because the tenant the RLS policies see is SET LOCAL: after the
    commit, a read would be a read with no business at all. Same reason as
    routers/menu.py.
    """
    db.commit()
    return out


# --- Sales --------------------------------------------------------------------


def _created_by_name(db: Session, sale: StoreSale) -> Optional[str]:
    """Who charged or typed the sale in: the name written with it when it was
    saved (0046), which stays when their login goes. A sale saved before
    there was one has none: then their login as it is named now, while it
    exists -- the migration copied every name it could, so this is a sale
    whose login was already gone, or one saved past the API."""
    if sale.created_by_name is not None:
        return sale.created_by_name
    if sale.created_by is None:
        return None
    return db.execute(
        select(UserAccount.full_name)
        .where(UserAccount.org_id == sale.org_id)
        .where(UserAccount.id == sale.created_by)
    ).scalar_one_or_none()


def _sale_out(db: Session, sale: StoreSale) -> StoreSaleOut:
    rows = db.execute(
        select(StoreSaleLine, _AMOUNT)
        .where(StoreSaleLine.org_id == sale.org_id)
        .where(StoreSaleLine.sale_id == sale.id)
        .order_by(StoreSaleLine.position)
    ).all()
    return StoreSaleOut(
        id=sale.id,
        sold_on=sale.sold_on,
        note=sale.note,
        total=_money(sum((amount for _line, amount in rows), Decimal(0))),
        created_at=sale.created_at,
        payment_method=sale.payment_method,
        source=sale.source,
        created_by_name=_created_by_name(db, sale),
        voided_at=sale.voided_at,
        voided_by_name=sale.voided_by_name,
        void_reason=sale.void_reason,
        lines=[
            StoreSaleLineOut(
                id=line.id,
                dish_id=line.dish_id,
                name=line.name,
                unit_price=float(line.unit_price),
                quantity=float(line.quantity),
                amount=_money(amount),
            )
            for line, amount in rows
        ],
    )


@router.get("/sales", response_model=List[StoreSaleSummary])
def list_sales(
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.STORE_SALES_VIEW)),
) -> List[StoreSaleSummary]:
    """The sales of the period, the most recent day first and, within a day,
    the most recently saved first. Either end may be left out.

    The voided ones included, marked by `voided_at`, with the total they had:
    the list is the record of what was rung up. What they add up to is the
    statistics' to say, and those leave them out."""
    first = None if from_ is None else _day(from_, "from")
    last = None if to is None else _day(to, "to")
    _in_order(first, last)
    org_id = current_user.org_id
    query = (
        select(
            StoreSale,
            func.count(StoreSaleLine.id),
            func.coalesce(func.sum(_AMOUNT), 0),
        )
        .outerjoin(
            StoreSaleLine,
            and_(
                StoreSaleLine.sale_id == StoreSale.id,
                StoreSaleLine.org_id == StoreSale.org_id,
            ),
        )
        .where(StoreSale.org_id == org_id)
    )
    if first is not None:
        query = query.where(StoreSale.sold_on >= first)
    if last is not None:
        query = query.where(StoreSale.sold_on <= last)
    rows = db.execute(
        query.group_by(StoreSale.id)
        .order_by(
            StoreSale.sold_on.desc(), StoreSale.created_at.desc(), StoreSale.id.desc()
        )
        .limit(LIST_LIMIT)
    ).all()
    return [
        StoreSaleSummary(
            id=sale.id,
            sold_on=sale.sold_on,
            note=sale.note,
            total=_money(total),
            line_count=int(n),
            created_at=sale.created_at,
            payment_method=sale.payment_method,
            source=sale.source,
            voided_at=sale.voided_at,
            void_reason=sale.void_reason,
        )
        for sale, n, total in rows
    ]


@router.get("/sales/{sale_id}", response_model=StoreSaleOut)
def get_sale(
    sale_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.STORE_SALES_VIEW)),
) -> StoreSaleOut:
    return _sale_out(db, _get_sale(db, current_user.org_id, sale_id))


def _till_lines_are_dishes(payload: StoreSaleCreate) -> None:
    """422 unless every line is a dish of the menu, in whole units: the till
    rings up only what the menu shows, a tap at a time (frontend's
    lib/store/ticket.ts). A free line, or half a portion, is a sale typed in
    by hand, the manager's."""
    if any(line.dish_id is None for line in payload.lines):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "till_line_needs_dish",
                "Every line charged at the till is a dish of the menu",
            ),
        )
    # Already rounded to the thousandth by the schema: a whole number here is
    # one the line will store as it is.
    if any(
        not (1 <= line.quantity <= _TILL_MAX_QUANTITY and line.quantity == int(line.quantity))
        for line in payload.lines
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "till_quantity_invalid",
                "A line charged at the till is a whole number from 1 to %d"
                % _TILL_MAX_QUANTITY,
                limit=_TILL_MAX_QUANTITY,
            ),
        )


def _till_day(value: date) -> None:
    """422 unless the sale is of today in Madrid, give or take a day."""
    today = business_day(datetime.now(timezone.utc))
    if not (today - _TILL_SLACK <= value <= today + _TILL_SLACK):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "till_sale_not_today",
                "A sale charged at the till is of today",
            ),
        )


def _till_prices(db: Session, org_id: UUID, payload: StoreSaleCreate) -> Dict[UUID, str]:
    """409 unless every line is at its dish's price on the menu NOW; the
    menu's name of each dish, to write on its line.

    The till copies the price when the dish is tapped; a price changed on the
    menu while the bill was open is the one case a legitimate till sends
    another, and the answer tells it to fetch the menu again. A dish with no
    price on the menu (market price, `price` NULL) is not the till's to
    charge: it never lets one on the bill (lib/store/ticket.ts, whyNotAddable),
    so one sent is a price that left the menu while the bill was open -- or a
    figure made up, which is what a hand-typed sale is for.

    The name is the menu's too, not the one sent: it is what the statistics
    add the line up under (`_top_dishes`), and a name made up would be a dish
    the menu never had. After `_known_dishes`, under the menu's lock, so every
    dish is there and its price and name are the ones the sale is checked
    against and written with until it commits.
    """
    menu = {
        dish_id: (price, name)
        for dish_id, price, name in db.execute(
            select(MenuDish.id, MenuDish.price, MenuDish.name)
            .where(MenuDish.org_id == org_id)
            .where(MenuDish.id.in_({line.dish_id for line in payload.lines}))
        ).all()
    }
    for line in payload.lines:
        price, _name = menu[line.dish_id]
        # Already rounded to the cent by the schema: this Decimal is that cent.
        sent = Decimal(str(line.unit_price))
        if price is not None and sent == price:
            continue
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail(
                "menu_price_changed",
                "The price of a dish on the menu has changed",
                dish_id=str(line.dish_id),
            ),
        )
    return {dish_id: name for dish_id, (_price, name) in menu.items()}


def _one_alert_reader(db: Session, org_id: UUID) -> None:
    """One sale of a business reads the stock for its alerts at a time, until
    it commits.

    Without it, two sales saved together each read the stock with their own
    rows and not the other's (neither has committed): water at 7 with a
    minimum of 10, two sales of one, and both answer "6, not critical" while
    the shelf ends at 5, critical -- and from then on every sale finds it
    already critical, so the till never says it became so. Behind this lock
    the second waits for the first to commit (the lock goes with it), and its
    read, a new statement, sees the first's rows. Taken after the sale is
    written and just before the read, so sales still save side by side.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": "stock-alerts:%s" % org_id},
    )


def _created(
    db: Session,
    current_user: UserOut,
    sale: StoreSale,
    taken: Optional[Sequence[UUID]] = None,
) -> StoreSaleCreatedOut:
    """The sale, and the products it took from that are now below their
    minimum. `taken`: what it took, when the caller has it; read back from
    what was written otherwise (a save sent again).

    No alerts for a business without Inventario -- the stock is not its to
    see -- nor for a sale already voided, which takes nothing any more.
    """
    alerts = []
    if "inventory" in current_user.apps and sale.voided_at is None:
        if taken is None:
            taken = db.execute(
                select(StoreSaleConsumption.item_id)
                .where(StoreSaleConsumption.org_id == sale.org_id)
                .where(StoreSaleConsumption.sale_id == sale.id)
            ).scalars().all()
        _one_alert_reader(db, sale.org_id)
        alerts = stock_alerts(db, sale.org_id, taken, sale.id)
    return StoreSaleCreatedOut(
        **_sale_out(db, sale).model_dump(), stock_alerts=alerts
    )


@router.post(
    "/sales", response_model=StoreSaleCreatedOut, status_code=status.HTTP_201_CREATED
)
def create_sale(
    payload: StoreSaleCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.STORE_CHARGE)),
) -> StoreSaleCreatedOut:
    # The till is the team's; typing a sale in by hand is the manager's. The
    # same route, so the second question is asked here, first of all -- a
    # retry of a manual sale is answered no differently.
    by_hand = can(current_user, Perm.STORE_SALES_MANUAL)
    if payload.source == "manual" and not by_hand:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail("manager_role_required", "Manager role required"),
        )
    # And whoever may not type a sale in may not do it through the till's
    # door either: what they charge is what the till would -- dishes of the
    # menu, at its prices, today. The manager is not held to it (a sale of
    # theirs is what they say it is, by hand or at the till).
    held_to_the_till = not by_hand
    org_id = current_user.org_id
    # The same save sent again. Answered with the sale as it was KEPT -- its
    # lines, not the ones in this request -- and before anything in this
    # request is looked at: a retry is a question about the first request.
    kept = _sale_by_ref(db, org_id, payload.client_ref)
    if kept is not None:
        response.status_code = status.HTTP_200_OK
        return _answer(db, _created(db, current_user, kept))

    sold_on = _sold_on(payload.sold_on)
    if held_to_the_till:
        _till_lines_are_dishes(payload)
        _till_day(sold_on)
    # The menu's lock, shared: sales do not wait for each other, but a dish
    # deleted or a recipe changed while this one is being saved waits for it
    # (and it for them), so the dishes checked below and the recipes read are
    # the same menu -- never a line kept for a dish whose recipe went between
    # the two reads. The key is routers/menu.py::_one_writer's.
    db.execute(
        text("SELECT pg_advisory_xact_lock_shared(hashtextextended(:key, 0))"),
        {"key": "menu:%s" % org_id},
    )
    _known_dishes(
        db, org_id, [line.dish_id for line in payload.lines if line.dish_id is not None]
    )
    # The name each line is written under: the menu's, for whoever is held
    # to the till; what was sent, for the manager.
    menu_names: Dict[UUID, str] = {}
    if held_to_the_till:
        menu_names = _till_prices(db, org_id, payload)
    taken = _consumption(db, org_id, payload)

    sale = StoreSale(
        org_id=org_id,
        sold_on=sold_on,
        note=payload.note,
        source=payload.source,
        payment_method=payload.payment_method,
        client_ref=payload.client_ref,
        created_by=current_user.id,
        # Who charged it, by name, as the sale is saved: it stays when their
        # login goes (a person taken off the team, a tablet deleted), and the
        # database refuses to change it afterwards (0043's trigger; 0046).
        created_by_name=current_user.full_name,
    )
    try:
        # In a savepoint: two saves with one ref at once both miss the lookup
        # above, and the second meets the UNIQUE (org_id, client_ref) here. The
        # transaction has to survive that to read the first one's sale.
        with db.begin_nested():
            db.add(sale)
            db.flush()
    except IntegrityError:
        kept = _sale_by_ref(db, org_id, payload.client_ref)
        if kept is None:
            raise
        response.status_code = status.HTTP_200_OK
        return _answer(db, _created(db, current_user, kept))
    db.add_all(
        StoreSaleLine(
            org_id=org_id,
            sale_id=sale.id,
            dish_id=line.dish_id,
            name=menu_names.get(line.dish_id, line.name),
            # Already rounded by the schema; a Decimal of its shortest spelling
            # is exactly that cent (or thousandth), and the column is given
            # nothing to round.
            unit_price=Decimal(str(line.unit_price)),
            quantity=Decimal(str(line.quantity)),
            position=position,
        )
        for position, line in enumerate(payload.lines)
    )
    # What it took off the shelf, with it: the same transaction, so a sale is
    # never kept without it nor it without the sale. After the savepoint, so
    # a repeat answered above never writes it twice.
    db.add_all(
        StoreSaleConsumption(
            org_id=org_id, sale_id=sale.id, item_id=item_id, quantity=quantity
        )
        for item_id, quantity in taken.items()
    )
    db.flush()
    db.refresh(sale)
    return _answer(db, _created(db, current_user, sale, list(taken)))


@router.post("/sales/{sale_id}/void", response_model=StoreSaleOut)
def void_sale(
    sale_id: UUID,
    payload: Optional[StoreSaleVoid] = None,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.STORE_SALES_VOID)),
) -> StoreSaleOut:
    """Void a sale: it stays, lines and total as they were, marked with when,
    by whom and why, and the statistics stop counting it. Once: a second void
    is a 409 and changes nothing -- the first one's when, who and why are the
    record. There is no way back, nor a DELETE or a PATCH (see migration 0043).

    One conditional UPDATE, not a read and then a write: two voids at once
    (two tabs, a double tap) both pass a check made beforehand, and the second
    would overwrite the first one's reason. With `voided_at IS NULL` in the
    WHERE, the second finds nothing to update. The database has the last
    word on the rest (0043's `store_sale_written_once`): it writes the time
    and the voider's name itself, and refuses any other change.
    """
    org_id = current_user.org_id
    reason = payload.reason if payload is not None else None
    voided = db.execute(
        update(StoreSale)
        .where(StoreSale.org_id == org_id)
        .where(StoreSale.id == sale_id)
        .where(StoreSale.voided_at.is_(None))
        .values(voided_at=func.now(), voided_by=current_user.id, void_reason=reason)
        .execution_options(synchronize_session=False)
    ).rowcount
    # Read after the UPDATE, so it is the row as it is now. A sale that is not
    # this business's is a 404 here, before it could be a 409.
    sale = _get_sale(db, org_id, sale_id)
    if not voided:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail("store_sale_already_voided", "This sale was already voided"),
        )
    return _answer(db, _sale_out(db, sale))


# --- Statistics ---------------------------------------------------------------


def _top_dishes(
    db: Session, org_id: UUID, first: date, last: date
) -> List[StoreStatsDish]:
    """The dishes that took the most in the period, most first.

    Dishes of the menu only, and of sales not voided. A free line is money
    the business took -- it is in every total above -- but not a dish: "Caja
    del día" typed every night would otherwise head a list the manager reads
    as what the kitchen sells.

    A line of the menu is added up with the other lines of the same dish,
    whatever it was called on each -- a dish renamed halfway through the
    period is one dish. The name shown is the one the most recent line used.
    """
    latest_name = array_agg(
        aggregate_order_by(
            StoreSaleLine.name,
            StoreSale.sold_on.desc(),
            StoreSale.created_at.desc(),
            StoreSaleLine.position.desc(),
        )
    )[1]
    total = func.sum(_AMOUNT)
    quantity = func.sum(StoreSaleLine.quantity)
    rows = db.execute(
        select(StoreSaleLine.dish_id, latest_name, quantity, total)
        .join(
            StoreSale,
            and_(
                StoreSale.id == StoreSaleLine.sale_id,
                StoreSale.org_id == StoreSaleLine.org_id,
            ),
        )
        .where(StoreSale.org_id == org_id)
        .where(StoreSale.sold_on >= first)
        .where(StoreSale.sold_on <= last)
        .where(StoreSale.voided_at.is_(None))
        .where(StoreSaleLine.dish_id.is_not(None))
        .group_by(StoreSaleLine.dish_id)
        # Ties by units, then by name, so the same period always lists the
        # same ten in the same order.
        .order_by(total.desc(), quantity.desc(), latest_name.asc())
        .limit(TOP_DISHES)
    ).all()
    return [
        StoreStatsDish(
            name=name, dish_id=dish_id, quantity=float(qty), total=_money(amount)
        )
        for dish_id, name, qty, amount in rows
    ]


@router.get("/stats", response_model=StoreStatsOut)
def stats(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.STORE_STATS)),
) -> StoreStatsOut:
    """What the sales from `from` to `to`, both days included, add up to.

    Both ends are required: which day is "today" is the browser's to say (the
    business's calendar, not the server's), so the period is always the one
    the screen is showing.
    """
    first, last = _day(from_, "from"), _day(to, "to")
    _in_order(first, last)
    length = (last - first).days + 1
    if length > STATS_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "store_range_too_long",
                "Statistics cover at most %d days" % STATS_DAYS,
                limit=STATS_DAYS,
            ),
        )
    org_id = current_user.org_id
    # A voided sale is in the list and in none of these figures: what it rang
    # up was never taken.
    in_period = (
        StoreSale.org_id == org_id,
        StoreSale.sold_on >= first,
        StoreSale.sold_on <= last,
        StoreSale.voided_at.is_(None),
    )

    # Counted on the sales alone: a sale is a sale however much it came to.
    sales_count, days_with_sales = db.execute(
        select(func.count(StoreSale.id), func.count(func.distinct(StoreSale.sold_on)))
        .where(*in_period)
    ).one()

    per_day: Dict[date, Decimal] = {
        day: amount
        for day, amount in db.execute(
            select(StoreSale.sold_on, func.sum(_AMOUNT))
            .join(
                StoreSaleLine,
                and_(
                    StoreSaleLine.sale_id == StoreSale.id,
                    StoreSaleLine.org_id == StoreSale.org_id,
                ),
            )
            .where(*in_period)
            .group_by(StoreSale.sold_on)
        ).all()
    }

    # Every day of the period, none left out; walked by adding to `first`, so
    # the last one is `last` itself and nothing is ever asked of the day after
    # 9999-12-31.
    days: List[Tuple[date, Decimal]] = [
        (day, per_day.get(day, Decimal(0)))
        for day in (first + timedelta(days=n) for n in range(length))
    ]
    weekdays: Dict[int, Decimal] = defaultdict(Decimal)
    for day, amount in days:
        weekdays[day.weekday()] += amount
    total = sum((amount for _on, amount in days), Decimal(0))

    return StoreStatsOut(
        from_=first,
        to=last,
        total=_money(total),
        sales_count=int(sales_count),
        days_with_sales=int(days_with_sales),
        average_per_day=_money(total / days_with_sales) if days_with_sales else 0.0,
        days=[StoreStatsDay(date=day, total=_money(amount)) for day, amount in days],
        by_weekday=[
            StoreStatsWeekday(weekday=wd, total=_money(weekdays[wd])) for wd in range(7)
        ],
        top_dishes=_top_dishes(db, org_id, first, last),
    )
