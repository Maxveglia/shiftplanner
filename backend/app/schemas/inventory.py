from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas import limits
from app.services.barcodes import clean_code


def _clean(value: Optional[str]) -> Optional[str]:
    """Blank means "not said", so it is stored as NULL rather than as ''."""
    if value is None:
        return None
    value = _without_nul(value).strip()
    return value or None


def _without_nul(value: str) -> str:
    """A NUL cannot be stored in a Postgres text column: psycopg refuses it,
    which is a 500. It is never meant -- a pasted or scanned stray byte -- so
    it is dropped rather than refused."""
    return value.replace("\x00", "")


# The ceiling of every quantity stored in a numeric(12, 3) column. STRICTLY
# below 1e9: numeric(12, 3) holds nine digits before the point, so 1e9 itself
# is an overflow in Postgres -- a 500, not a 422 -- the moment it is written.
QUANTITY_CEILING = 1_000_000_000

# One product created with its codes in one request: the bottle, the case, the
# pack of six, and the codes a supplier changed over the years. Twenty is a
# wall, not a workload.
BARCODES_PER_ITEM = 20

# How many units one scan can be worth: a pallet, at most.
UNITS_PER_SCAN_CEILING = 100_000


def _positive_at_storage(v: float) -> float:
    """Above zero and under the ceiling AS STORED, not only as sent.

    The column keeps three decimals, so 0.0004 passes `gt=0` here, is rounded
    to 0.000 on the way in and then breaks the `> 0` CHECK -- an IntegrityError,
    which is a 500 -- and 999999999.9996 passes `lt` and rounds up into an
    overflow. Both are refused here instead, in the words of a 422.
    """
    stored = round(v, 3)
    if stored <= 0:
        raise ValueError("must be at least 0.001")
    return _under_ceiling(stored)


def _under_ceiling(v: float) -> float:
    """Zero or more, and under the ceiling as stored -- for a count and a
    minimum, where zero is an answer.

    Returns the ROUNDED value: Postgres rounds a float8 to fifteen significant
    digits before it rounds to three decimals, so 999999999.9994999 rounds
    down here and up to 1e9 there. What is checked has to be what is sent on.
    """
    stored = round(v, 3)
    if stored < 0:
        raise ValueError("must not be negative")
    if stored >= QUANTITY_CEILING:
        raise ValueError("must be below %d" % QUANTITY_CEILING)
    return stored


class InventoryBarcodeIn(BaseModel):
    # Cleaned BEFORE the length is checked: a scanner that sends the code with
    # a CR/LF after it has not sent a longer code. Blank is let through here on
    # purpose, so the router can refuse it with its own code
    # (`inventory_barcode_invalid`) rather than as pydantic's generic 422.
    code: str = Field(max_length=limits.CODE)
    units_per_scan: float = Field(default=1, gt=0, le=UNITS_PER_SCAN_CEILING)
    # "caja de 24", "pack de 6": which of the product's codes this one is.
    label: Optional[str] = Field(default=None, max_length=limits.CODE)

    @field_validator("code", mode="before")
    @classmethod
    def _code(cls, v):
        return clean_code(v) if isinstance(v, str) else v

    @field_validator("units_per_scan")
    @classmethod
    def _units(cls, v: float) -> float:
        return _positive_at_storage(v)

    @field_validator("label")
    @classmethod
    def _label(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)


class InventoryBarcodeOut(BaseModel):
    id: uuid.UUID
    # As it was read, for showing back.
    code: str
    # What it is compared as (app/services/barcodes.py). The client matches a
    # scan against this, after normalising the scan the same way.
    key: str
    units_per_scan: float
    label: Optional[str] = None


class InventoryItemFields(BaseModel):
    name: str = Field(min_length=1, max_length=limits.NAME)
    unit: Optional[str] = Field(default=None, max_length=limits.CODE)
    category: Optional[str] = Field(default=None, max_length=limits.NAME)
    min_quantity: Optional[float] = Field(default=None, ge=0, lt=QUANTITY_CEILING)
    # Who it is bought from: a supplier of this business (404
    # `inventory_supplier_not_found` otherwise), or null for none.
    supplier_id: Optional[uuid.UUID] = None
    # How much of it is ordered at a time, in its own unit: above zero, or
    # null when nobody said.
    order_quantity: Optional[float] = Field(default=None, gt=0, lt=QUANTITY_CEILING)

    @field_validator("min_quantity")
    @classmethod
    def _minimum(cls, v: Optional[float]) -> Optional[float]:
        return None if v is None else _under_ceiling(v)

    @field_validator("order_quantity")
    @classmethod
    def _order(cls, v: Optional[float]) -> Optional[float]:
        return None if v is None else _positive_at_storage(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = _without_nul(v).strip()
        if not v:
            raise ValueError("name must not be blank")
        return v

    @field_validator("unit", "category")
    @classmethod
    def _optional_text(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)


class InventoryItemCreate(InventoryItemFields):
    # Created with the product, in the same transaction: if one of them is
    # already another product's, neither the product nor any code is kept.
    barcodes: List[InventoryBarcodeIn] = Field(
        default_factory=list, max_length=BARCODES_PER_ITEM
    )
    # What is already on the shelf when the product is added (Max,
    # 28-sep-2026: a product just added must not need a count). Kept as an
    # ENTRY -- a receipt of this much, now, in the same transaction as the
    # product -- and not as a count: the stock is last count + received -
    # sold, so it starts here without anyone counting. Checked and rounded
    # exactly as a receipt line's quantity, since that is what it becomes.
    initial_quantity: Optional[float] = Field(default=None, gt=0, lt=QUANTITY_CEILING)
    # That receipt's note, as the browser words it in the manager's language
    # ("Existencias al darlo de alta"), so the history says why it is there.
    # Ignored without `initial_quantity`: no entry, nothing to note.
    initial_note: Optional[str] = Field(default=None, max_length=limits.NOTE)

    @field_validator("initial_quantity")
    @classmethod
    def _initial_quantity(cls, v: Optional[float]) -> Optional[float]:
        return None if v is None else _positive_at_storage(v)

    @field_validator("initial_note")
    @classmethod
    def _initial_note(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)


class InventoryItemUpdate(InventoryItemFields):
    """Every field optional: only what is sent is changed."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=limits.NAME)  # type: ignore[assignment]
    # False brings an archived product back onto the list.
    archived: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v: Optional[str]) -> Optional[str]:  # type: ignore[override]
        if v is None:
            return None
        v = _without_nul(v).strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class InventorySupplierRef(BaseModel):
    """A supplier as a product, or an alert, names it."""

    id: uuid.UUID
    name: str
    # As the manager wrote it ("+34 612 34 56 78"), or null.
    phone: Optional[str] = None


class InventoryItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    unit: Optional[str] = None
    category: Optional[str] = None
    min_quantity: Optional[float] = None
    # Who it is bought from, or null; and how much of it is ordered at a time,
    # in its own unit, or null (migration 0045).
    supplier: Optional[InventorySupplierRef] = None
    order_quantity: Optional[float] = None
    archived_at: Optional[datetime] = None
    # From the two most recent counts that included this product.
    last_quantity: Optional[float] = None
    last_counted_at: Optional[datetime] = None
    previous_quantity: Optional[float] = None
    previous_counted_at: Optional[datetime] = None
    # What came in, measured against those counts. A delivery at the very
    # instant of a count is taken to be IN that count (on the shelf when it
    # was counted), so the windows are (previous, last] and (last, now):
    #   received_since_count     after the last count. Everything ever
    #                            received when it has never been counted --
    #                            and 0, never null, when nothing came.
    #   received_between_counts  after the previous count and up to the last
    #                            one. Null with fewer than two counts: there is
    #                            no "between" to speak of.
    # What is on the shelf now is last_quantity + received_since_count; what
    # went between the two counts is previous + between - last.
    received_since_count: float = 0
    received_between_counts: Optional[float] = None
    last_received_at: Optional[datetime] = None
    # What the shop's sales took of it (their recipes, as they were when each
    # sale was saved), measured against the same two counts -- but by DAY: a
    # count says the last day whose sales it already reflects
    # (`sales_through`), and a sale is after it when `sold_on` is later.
    #   sold_since_count     sales after the last count; every sale when it
    #                        has never been counted -- 0, never null.
    #   sold_between_counts  sales after the previous count and up to the
    #                        last one. Null with fewer than two counts.
    # On the shelf now: last_quantity + received_since_count
    # - sold_since_count (it can go below zero: more was sold than was
    # received since the last count, so a delivery or a count is missing).
    sold_since_count: float = 0
    sold_between_counts: Optional[float] = None
    barcodes: List[InventoryBarcodeOut] = Field(default_factory=list)
    # Where its photo is, as a path on this server
    # ("/api/v1/inventory/photos/<id>", routers/inventory_photos.py), or null
    # for a product with none. The path changes whenever the photo does, so a
    # browser can keep it for a year.
    photo_url: Optional[str] = None


class InventoryCountLineIn(BaseModel):
    item_id: uuid.UUID
    quantity: float = Field(ge=0, lt=QUANTITY_CEILING)

    @field_validator("quantity")
    @classmethod
    def _quantity(cls, v: float) -> float:
        return _under_ceiling(v)


class InventoryCountCreate(BaseModel):
    # Defaults to now. Sent when a count done on paper is typed in later.
    counted_at: Optional[datetime] = None
    # Counted after closing (that day's sales are already off the shelf it
    # saw) or before opening (they are still to come). Left out, it is
    # guessed from the hour of `counted_at` on the business's clock: before
    # noon is before opening. See routers/inventory.py::_sales_through.
    after_close: Optional[bool] = None
    note: Optional[str] = Field(default=None, max_length=limits.NOTE)
    lines: List[InventoryCountLineIn] = Field(
        min_length=1, max_length=limits.INVENTORY_ITEMS
    )

    @field_validator("note")
    @classmethod
    def _note(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)


class InventoryCountLineOut(BaseModel):
    item_id: uuid.UUID
    item_name: str
    unit: Optional[str] = None
    category: Optional[str] = None
    quantity: float
    # The product's photo, as `InventoryItemOut.photo_url`: its face now, not
    # when it was counted.
    photo_url: Optional[str] = None


class InventoryCountSummary(BaseModel):
    id: uuid.UUID
    counted_at: datetime
    # Whether it was taken after closing, and so the last day whose sales it
    # already reflects: the day it was counted, or the day before.
    after_close: bool
    sales_through: date
    note: Optional[str] = None
    line_count: int


class InventoryCountOut(BaseModel):
    id: uuid.UUID
    counted_at: datetime
    after_close: bool
    sales_through: date
    note: Optional[str] = None
    lines: List[InventoryCountLineOut]


# --- Receipts: what came in ------------------------------------------------


class InventoryReceiptLineIn(BaseModel):
    item_id: uuid.UUID
    # In the product's own units. Nothing is received zero times: a line that
    # brought nothing is a line that should not be there.
    quantity: float = Field(gt=0, lt=QUANTITY_CEILING)

    @field_validator("quantity")
    @classmethod
    def _quantity(cls, v: float) -> float:
        return _positive_at_storage(v)


class InventoryReceiptCreate(BaseModel):
    # Defaults to now. Sent when a delivery note is typed in after the fact.
    received_at: Optional[datetime] = None
    # Made up by the phone once per scanning session. Sent again with a save
    # whose answer was lost, it is answered with the receipt already kept (200)
    # instead of receiving the same lorry twice.
    client_ref: Optional[uuid.UUID] = None
    supplier: Optional[str] = Field(default=None, max_length=limits.NAME)
    note: Optional[str] = Field(default=None, max_length=limits.NOTE)
    lines: List[InventoryReceiptLineIn] = Field(
        min_length=1, max_length=limits.INVENTORY_ITEMS
    )

    @field_validator("supplier", "note")
    @classmethod
    def _optional_text(cls, v: Optional[str]) -> Optional[str]:
        return _clean(v)


class InventoryReceiptSummary(BaseModel):
    id: uuid.UUID
    received_at: datetime
    supplier: Optional[str] = None
    note: Optional[str] = None
    line_count: int
    total_quantity: float


class InventoryReceiptLineOut(BaseModel):
    item_id: uuid.UUID
    item_name: str
    unit: Optional[str] = None
    category: Optional[str] = None
    quantity: float
    # The product's photo, as `InventoryItemOut.photo_url`: its face now, not
    # when it came in.
    photo_url: Optional[str] = None


class InventoryReceiptOut(BaseModel):
    id: uuid.UUID
    received_at: datetime
    supplier: Optional[str] = None
    note: Optional[str] = None
    lines: List[InventoryReceiptLineOut]


# --- Suppliers: who the products are bought from ---------------------------

# The CHECKs of migration 0045, said again here and in the routes so a value
# past them is a 422 in words rather than an IntegrityError, a 500.
SUPPLIER_NAME = 120
SUPPLIER_PHONE = 40


def _supplier_name(v):
    # NUL dropped and ends trimmed BEFORE the length is checked, like a sale
    # line's name: " Makro " has not been sent two characters too many.
    return _without_nul(v).strip() if isinstance(v, str) else v


class InventorySupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=SUPPLIER_NAME)
    # As the manager writes it. Whether it is a phone at all (digits, spaces,
    # hyphens, parentheses and one leading "+"; 7 to 15 digits; at most 40
    # characters) is the route's to say, with its own code
    # (`inventory_supplier_phone_invalid`) rather than as pydantic's generic
    # 422. This length is only the wall against a megabyte.
    phone: Optional[str] = Field(default=None, max_length=limits.CODE)

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, v):
        return _supplier_name(v)

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: Optional[str]) -> Optional[str]:
        # Blank is no phone.
        return _clean(v)


class InventorySupplierUpdate(InventorySupplierIn):
    """Only what is sent is changed; `phone: null` takes the phone off."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=SUPPLIER_NAME)  # type: ignore[assignment]


class InventorySupplierOut(InventorySupplierRef):
    # How many products on the list (not archived) say they are bought from
    # it: the ones left without a supplier if it is deleted.
    item_count: int = 0


# --- What a sale leaves low --------------------------------------------------


class StockAlertOut(BaseModel):
    """A product a sale has just taken from and that is now below its minimum
    (routers/inventory.py::stock_alerts).

    `on_hand` is the stock as the Inventario works it out (last count +
    received since - sold since; it can be below zero). `critical` is
    on_hand <= 0 or on_hand <= half the minimum; `became_critical` is that it
    is critical now and was not before THIS sale -- the one the till opens the
    order for, rather than on every sale while it stays low.
    """

    item_id: uuid.UUID
    name: str
    unit: Optional[str] = None
    on_hand: float
    min_quantity: float
    critical: bool
    became_critical: bool
    supplier: Optional[InventorySupplierRef] = None
    order_quantity: Optional[float] = None
    photo_url: Optional[str] = None
