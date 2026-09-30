from __future__ import annotations

import datetime as dt
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas import limits
from app.schemas.inventory import StockAlertOut, _clean, _without_nul

# The CHECKs of migration 0035, said again here so a number past them is a
# 422 in words rather than an IntegrityError, which is a 500. Strictly below:
# a unit price or a quantity of a million is not a sale, it is a typo.
UNIT_PRICE_CEILING = 1_000_000
QUANTITY_CEILING = 1_000_000

_CENT = Decimal("0.01")
_THOUSANDTH = Decimal("0.001")

# How a sale was paid, and where it came from: the CHECKs of migration 0043.
# 'card' is the manager confirming the card reader took the money -- there is
# no reader behind it yet (SumUp comes later).
PaymentMethod = Literal["cash", "card"]
Source = Literal["manual", "till"]


def _as_stored(v: float, step: Decimal, ceiling: int) -> Decimal:
    """`v` rounded as the column keeps it, half up, from the decimal the client
    wrote -- and refused if what would be WRITTEN is past the ceiling.

    Rounded before it is checked, for the reason `_to_the_cent` in
    `schemas/menu.py` gives: 999999.996 passes `lt=1000000`, rounds up to a
    million on the way in and breaks the CHECK. What is checked has to be what
    is written.
    """
    stored = Decimal(str(v)).quantize(step, rounding=ROUND_HALF_UP)
    if stored >= ceiling:
        raise ValueError("must be below %d" % ceiling)
    return stored


class StoreSaleLineIn(BaseModel):
    # The dish of this business's menu the line was picked from, or null for a
    # free line ("Caja del día"). Checked against the menu when the sale is
    # saved: a dish of another business, or one no longer on the menu, is 422.
    dish_id: Optional[uuid.UUID] = None
    # Copied from the menu by the browser, and editable before saving. Blank is
    # refused by `min_length`, after the trim.
    name: str = Field(min_length=1, max_length=limits.NAME)
    # Euros, as a number: "12,50" is the browser's to read, not the server's.
    unit_price: float = Field(ge=0, lt=UNIT_PRICE_CEILING)
    # Up to three decimals: 0.5 of a ración, 1.25 kg sold by weight.
    quantity: float = Field(gt=0, lt=QUANTITY_CEILING)

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, v):
        # NUL dropped and ends trimmed BEFORE the length is checked: a name
        # with a trailing space has not been sent a character too long.
        return _without_nul(v).strip() if isinstance(v, str) else v

    @field_validator("unit_price")
    @classmethod
    def _unit_price(cls, v: float) -> float:
        return float(_as_stored(v, _CENT, UNIT_PRICE_CEILING))

    @field_validator("quantity")
    @classmethod
    def _quantity(cls, v: float) -> float:
        stored = _as_stored(v, _THOUSANDTH, QUANTITY_CEILING)
        # 0.0004 passes `gt=0` and is stored as 0.000, which the CHECK refuses.
        if stored <= 0:
            raise ValueError("must be at least 0.001")
        return float(stored)


class StoreSaleCreate(BaseModel):
    # The day the sale was made, as the manager's calendar says it: a date,
    # not an instant, so there is no time zone to put it on the wrong day.
    # Between 2000 and tomorrow (routers/store.py).
    sold_on: dt.date
    note: Optional[str] = Field(default=None, max_length=limits.NOTE)
    # Made up by the browser once per sale. Sent again with a save whose answer
    # was lost, it is answered with the sale already kept (200) instead of
    # counting the takings twice.
    client_ref: uuid.UUID
    lines: List[StoreSaleLineIn] = Field(
        min_length=1, max_length=limits.STORE_SALE_LINES
    )
    # Null when nobody said how it was paid: a sale typed in from paper may
    # not know. The bill in Tienda -> Menú always says, and has to.
    payment_method: Optional[PaymentMethod] = None
    # 'manual' is "Nueva venta", typed in; 'till' is a bill charged in
    # Tienda -> Menú.
    source: Source = "manual"

    @field_validator("note")
    @classmethod
    def _note(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)

    @model_validator(mode="after")
    def _the_till_says_how_it_was_paid(self) -> "StoreSaleCreate":
        # The CHECK of migration 0043 (`store_sale_till_paid_check`), said
        # here so it is a 422 in words and not an IntegrityError, a 500. The
        # till is where the money is taken: it knows how.
        if self.source == "till" and self.payment_method is None:
            raise ValueError("a sale charged at the till says how it was paid")
        return self


class StoreSaleVoid(BaseModel):
    """Why a sale is voided, if the manager says. A sale is never deleted nor
    edited: a mistake is voided, and the right one saved (see migration 0043)."""

    reason: Optional[str] = Field(default=None, max_length=limits.VOID_REASON)

    @field_validator("reason", mode="before")
    @classmethod
    def _reason(cls, v):
        # Trimmed BEFORE the length is checked, like a line's name; blank is
        # no reason at all.
        return _clean(v) if isinstance(v, str) else v


# --- Out -------------------------------------------------------------------
# Money is a JSON number to the cent, as the menu's `price`; quantities to the
# thousandth.


class StoreSaleLineOut(BaseModel):
    id: uuid.UUID
    dish_id: Optional[uuid.UUID] = None
    name: str
    unit_price: float
    quantity: float
    # unit_price x quantity, to the cent, half up.
    amount: float


class StoreSaleSummary(BaseModel):
    id: uuid.UUID
    sold_on: dt.date
    note: Optional[str] = None
    # What the lines add up to, voided or not: a voided sale is listed as it
    # was, marked, and left out of the statistics.
    total: float
    line_count: int
    created_at: dt.datetime
    payment_method: Optional[str] = None
    source: str
    voided_at: Optional[dt.datetime] = None
    void_reason: Optional[str] = None


class StoreSaleOut(BaseModel):
    id: uuid.UUID
    sold_on: dt.date
    note: Optional[str] = None
    # The sum of the lines' amounts.
    total: float
    created_at: dt.datetime
    # 'cash', 'card', or null when nobody said.
    payment_method: Optional[str] = None
    # 'manual' or 'till'.
    source: str
    # Who saved it -- charged it at the till or typed it in -- as their login
    # was named then: written with the sale, and kept when that login is
    # deleted (a tablet deleted, a person taken off the team). Null only on a
    # sale whose login was gone before the name was kept (migration 0046).
    created_by_name: Optional[str] = None
    # Set once, when the sale is voided; never cleared.
    voided_at: Optional[dt.datetime] = None
    # Who voided it, as their account was named when they did: copied by the
    # database at the void, and kept when the account is deleted.
    voided_by_name: Optional[str] = None
    void_reason: Optional[str] = None
    # In the order they were entered.
    lines: List[StoreSaleLineOut]


class StoreSaleCreatedOut(StoreSaleOut):
    """The answer to saving a sale -- and only to that: the sale, and the
    products it took from that are now below their minimum (routers/
    inventory.py::stock_alerts), so the till can offer the order to the
    supplier. Empty when there are none, or the business has no Inventario.
    A save sent again is answered with the same alerts, worked out again."""

    stock_alerts: List[StockAlertOut] = Field(default_factory=list)


class StoreStatsDay(BaseModel):
    date: dt.date
    total: float


class StoreStatsWeekday(BaseModel):
    # 0 = Monday ... 6 = Sunday: a Spanish week, and Python's `weekday()`.
    weekday: int
    total: float


class StoreStatsDish(BaseModel):
    # As the most recent line of it spelt it.
    name: str
    # The dish of the menu these lines sold. Never null today -- free lines
    # are not dishes and stay out of the top -- but kept optional so the
    # shape does not change if a TPV import ever sends lines without one.
    dish_id: Optional[uuid.UUID] = None
    quantity: float
    total: float


class StoreStatsOut(BaseModel):
    """What the sales of a period add up to, the voided ones left out -- of
    every figure here, the top dishes included.

    `from` and `to` are both days of the period, and so is every entry of
    `days`: all of them, a day with no sales at 0, so a chart of it has no gaps
    to explain.
    """

    model_config = ConfigDict(populate_by_name=True)

    from_: dt.date = Field(alias="from")
    to: dt.date
    total: float
    sales_count: int
    days_with_sales: int
    # The total over the days that had a sale, not over every day of the
    # period: a bar shut on Mondays is not averaging less for being shut.
    average_per_day: float
    days: List[StoreStatsDay]
    # Seven, Monday first, whether or not each weekday had sales.
    by_weekday: List[StoreStatsWeekday]
    # The ten that took the most, most first.
    top_dishes: List[StoreStatsDish]
