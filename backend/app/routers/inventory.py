"""The stock: a list of products, the counts taken of them, and what came in.

A count is a snapshot -- what was on the shelf when the manager looked. A
receipt is a delivery: how much of each product arrived, and when -- and also
what a product already had on the shelf when it was added
(`initial_quantity`, a receipt made with the product), so that no product
needs a count just because it is new. And, since
the Tienda's recipes (migration 0041), a sale of the shop takes what its
dishes are made of off the shelf: what each sale took is written down when it
is saved (`store_sale_consumption`), and a sale voided (migration 0043) stops
taking it. What is on the shelf now is the last count, plus whatever was
received after it, minus whatever was sold after it; what went between two
counts is the first count, plus what came in between them, minus the second
-- and of that, what the sales explain. All of it is worked out in the
browser from the numbers this module sends with every product (see
`InventoryItemOut`); the sums behind them are done here, in SQL, in one query
for the whole list.

A delivery received at the very instant of a count is taken to be IN that
count -- it was on the shelf when it was counted. So "since the last count" is
strictly after it, and "between the counts" is (previous, last].

A sale is a DAY, not an instant, so a count says which day's sales it already
reflects (`sales_through`): the day it was taken if it was after closing, the
day before if it was before opening. A sale is after a count when its day is
later than that; "between the counts" is (previous, last] in days.

Products carry barcodes, so a delivery can be taken in with a scanner or the
phone's camera. A code is compared by its normalised key (see
`app/services/barcodes.py`), and one key belongs to one product per business.

A product can have a photo (migration 0042), so it is found by its face as
well as its name: put and taken away here, by the manager, and served from
`routers/inventory_photos.py` -- the one route of the inventory without a
token, since an <img> cannot send one. Every answer that shows a product (the
list, a count's lines, a delivery's lines) carries the photo's address,
`photo_url`, read in the same query as the product; never its bytes.

A product can say who it is bought from and how much of it is ordered at a
time (migration 0045; the suppliers themselves are routers/
inventory_suppliers.py), and every sale says which of the products it took
from are now below their minimum (`stock_alerts`, below, for
routers/store.py): what the till needs to offer the order to the supplier.

Who may do what is app/access.py's table, route by route: the whole team --
employees and the till's tablet -- sees the stock, counts it and takes a
delivery in; only the manager creates or changes a product (its barcodes and
photo included) and deletes a count or a delivery. Every query is scoped by
`org_id` in the WHERE and behind `org_isolation` as well, like every other
tenant table.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import (
    Date,
    DateTime,
    Numeric,
    and_,
    case,
    cast,
    func,
    null,
    or_,
    delete,
    select,
    text,
    union_all,
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.access import Perm, require_permission
from app.db import get_db
from app.errors import detail
from app.models.inventory import (
    InventoryBarcode,
    InventoryCount,
    InventoryCountLine,
    InventoryItem,
    InventoryItemPhoto,
    InventoryReceipt,
    InventoryReceiptLine,
    InventorySupplier,
)
from app.models.store import StoreSale, StoreSaleConsumption
from app.photo_http import PHOTO_BODY, Upload, checked, read_upload
from app.routers.inventory_photos import photo_url_or_none
from app.schemas.auth import UserOut
from app.schemas.inventory import (
    InventoryBarcodeIn,
    InventoryBarcodeOut,
    InventoryCountCreate,
    InventoryCountLineOut,
    InventoryCountOut,
    InventoryCountSummary,
    InventoryItemCreate,
    InventoryItemOut,
    InventoryItemUpdate,
    InventoryReceiptCreate,
    InventoryReceiptLineOut,
    InventoryReceiptOut,
    InventoryReceiptSummary,
    InventorySupplierRef,
    StockAlertOut,
)
from app.services.barcodes import barcode_key
from app.services.business_time import to_business_time

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _num(value) -> Optional[float]:
    return None if value is None else float(value)


@dataclass
class _Stock:
    """What the list says about one product beyond its own row."""

    # The last two counts that included it, newest first: (quantity, when).
    counts: List[Tuple[float, datetime]] = field(default_factory=list)
    received_since: float = 0.0
    received_between: Optional[float] = None
    last_received_at: Optional[datetime] = None
    sold_since: float = 0.0
    sold_between: Optional[float] = None
    barcodes: List[InventoryBarcode] = field(default_factory=list)
    # `sold_since` as it was without one sale, when `_stock` was asked for it
    # (`without_sale`); None otherwise.
    sold_since_without_sale: Optional[float] = None


def _on_hand(s: _Stock, sold_since: float) -> Optional[float]:
    """What is on the shelf: the last count, plus what came in since, minus
    what the sales took since -- and None when nothing at all is known (never
    counted, nothing received, nothing sold). The browser's `onHand`
    (frontend/src/api/inventory.ts), to the thousandth like it."""
    last = s.counts[0][0] if s.counts else None
    if last is None and not s.received_since and not sold_since:
        return None
    return round((last or 0.0) + s.received_since - sold_since, 3)


def is_critical(on_hand: Optional[float], minimum: Optional[float]) -> bool:
    """Max's "very critical", 27-sep-2026: nothing left, or half the minimum
    or less. Only a product with a minimum and a known stock can be."""
    if on_hand is None or minimum is None:
        return False
    return on_hand <= 0 or on_hand <= minimum / 2


def _barcode_out(barcode: InventoryBarcode) -> InventoryBarcodeOut:
    return InventoryBarcodeOut(
        id=barcode.id,
        code=barcode.code,
        key=barcode.code_key,
        units_per_scan=float(barcode.units_per_scan),
        label=barcode.label,
    )


# How a product finds its photo, in the query that reads the product: an outer
# join on both keys, and only the photo's id is selected -- never its bytes.
_PHOTO_OF_ITEM = and_(
    InventoryItemPhoto.item_id == InventoryItem.id,
    InventoryItemPhoto.org_id == InventoryItem.org_id,
)

# And its supplier, the same way: an outer join on both keys, in the same read.
_SUPPLIER_OF_ITEM = and_(
    InventorySupplier.id == InventoryItem.supplier_id,
    InventorySupplier.org_id == InventoryItem.org_id,
)


def supplier_ref(supplier: Optional[InventorySupplier]) -> Optional[InventorySupplierRef]:
    if supplier is None:
        return None
    return InventorySupplierRef(id=supplier.id, name=supplier.name, phone=supplier.phone)


def _item_out(
    item: InventoryItem,
    stock: Dict[UUID, _Stock],
    photo_id: Optional[UUID] = None,
    supplier: Optional[InventorySupplier] = None,
) -> InventoryItemOut:
    s = stock.get(item.id) or _Stock()
    seen = s.counts
    return InventoryItemOut(
        id=item.id,
        name=item.name,
        unit=item.unit,
        category=item.category,
        min_quantity=_num(item.min_quantity),
        supplier=supplier_ref(supplier),
        order_quantity=_num(item.order_quantity),
        archived_at=item.archived_at,
        last_quantity=seen[0][0] if seen else None,
        last_counted_at=seen[0][1] if seen else None,
        previous_quantity=seen[1][0] if len(seen) > 1 else None,
        previous_counted_at=seen[1][1] if len(seen) > 1 else None,
        received_since_count=s.received_since,
        # Zero, not null, once there are two counts and nothing came between
        # them: "nothing arrived" is an answer, "no two counts" is not.
        received_between_counts=(
            (s.received_between or 0.0) if len(seen) > 1 else None
        ),
        last_received_at=s.last_received_at,
        sold_since_count=s.sold_since,
        # As `received_between_counts`: zero once there are two counts.
        sold_between_counts=(s.sold_between or 0.0) if len(seen) > 1 else None,
        barcodes=[_barcode_out(b) for b in s.barcodes],
        photo_url=photo_url_or_none(photo_id),
    )


def _photo_id(db: Session, org_id: UUID, item_id: UUID) -> Optional[UUID]:
    """The id of this product's photo, or None: one read, for one product."""
    return db.execute(
        select(InventoryItemPhoto.id)
        .where(InventoryItemPhoto.org_id == org_id)
        .where(InventoryItemPhoto.item_id == item_id)
    ).scalar_one_or_none()


def _supplier_of(db: Session, item: InventoryItem) -> Optional[InventorySupplier]:
    """This product's supplier, or None: one read, for one product."""
    if item.supplier_id is None:
        return None
    return db.execute(
        select(InventorySupplier)
        .where(InventorySupplier.org_id == item.org_id)
        .where(InventorySupplier.id == item.supplier_id)
    ).scalar_one_or_none()


def _known_supplier(db: Session, org_id: UUID, supplier_id: Optional[UUID]) -> None:
    """404 unless it is a supplier of this business. Another business's is
    "not found", like one that never existed -- and the key on
    (supplier_id, org_id) would refuse it anyway, at the commit.

    FOR KEY SHARE, as the key's own check would lock it: the supplier cannot
    be deleted between this read and the commit (its delete waits, and then
    finds this product to leave without a supplier), and one deleted just
    before is not found here -- a 404, never a key error at the commit."""
    if supplier_id is None:
        return
    found = db.execute(
        select(InventorySupplier.id)
        .where(InventorySupplier.org_id == org_id)
        .where(InventorySupplier.id == supplier_id)
        .with_for_update(key_share=True)
    ).scalar_one_or_none()
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("inventory_supplier_not_found", "Supplier not found"),
        )


def _ranked_counts(org_id: UUID, item_ids: Optional[Sequence[UUID]]):
    """Every count line of these products, ranked newest first per product.

    One ranking for both uses below, so "the last count" is the same count
    when its quantity is read and when the deliveries are measured against it.
    Ordered by when it was COUNTED, and by when it was saved only to break a
    tie -- a count typed in late must not pass for the latest.
    """
    rank = (
        func.row_number()
        .over(
            partition_by=InventoryCountLine.item_id,
            order_by=(InventoryCount.counted_at.desc(), InventoryCount.created_at.desc()),
        )
        .label("rank")
    )
    ranked = (
        select(
            InventoryCountLine.item_id,
            InventoryCountLine.quantity,
            InventoryCount.counted_at,
            InventoryCount.sales_through,
            rank,
        )
        .join(InventoryCount, InventoryCount.id == InventoryCountLine.count_id)
        .where(InventoryCountLine.org_id == org_id)
    )
    if item_ids is not None:
        ranked = ranked.where(InventoryCountLine.item_id.in_(item_ids))
    return ranked.subquery()


def _stock(
    db: Session,
    org_id: UUID,
    item_ids: Optional[Sequence[UUID]] = None,
    without_sale: Optional[UUID] = None,
) -> Dict[UUID, _Stock]:
    """Counts, deliveries, sales and codes of every product (or of these), in
    three reads.

    Three queries whatever the number of products -- never one per product.
    The deliveries and the sales are summed in the same one.

    `without_sale`: also sum what the sales took since the last count leaving
    that one sale out (`sold_since_without_sale`) -- the stock as it was just
    before it, in the same read and by the same rule as the stock now, so the
    two can only differ by what that sale took.
    """
    out: Dict[UUID, _Stock] = {}

    ranked = _ranked_counts(org_id, item_ids)
    for item_id, quantity, counted_at in db.execute(
        select(ranked.c.item_id, ranked.c.quantity, ranked.c.counted_at)
        .where(ranked.c.rank <= 2)
        .order_by(ranked.c.item_id, ranked.c.rank)
    ).all():
        out.setdefault(item_id, _Stock()).counts.append((float(quantity), counted_at))

    # The two counts per product -- when, and the last day of sales each
    # already reflects -- as a relation the movements can be joined to, so the
    # windows are applied by Postgres in the same pass that sums them.
    ranked = _ranked_counts(org_id, item_ids)
    bounds = (
        select(
            ranked.c.item_id,
            func.max(case((ranked.c.rank == 1, ranked.c.counted_at))).label("last_at"),
            func.max(case((ranked.c.rank == 2, ranked.c.counted_at))).label("previous_at"),
            func.max(case((ranked.c.rank == 1, ranked.c.sales_through))).label(
                "last_through"
            ),
            func.max(case((ranked.c.rank == 2, ranked.c.sales_through))).label(
                "previous_through"
            ),
        )
        .where(ranked.c.rank <= 2)
        .group_by(ranked.c.item_id)
        .subquery()
    )

    # Every movement of stock, one row each: a delivery's line (an instant and
    # what came in) or what a sale took (a day and how much). One relation, so
    # both are summed in one read.
    deliveries = (
        select(
            InventoryReceiptLine.item_id.label("item_id"),
            InventoryReceipt.received_at.label("received_at"),
            InventoryReceiptLine.quantity.label("received"),
            cast(null(), Date).label("sold_on"),
            cast(null(), Numeric(12, 3)).label("sold"),
            cast(null(), PG_UUID(as_uuid=True)).label("sale_id"),
        )
        .join(
            InventoryReceipt,
            and_(
                InventoryReceipt.id == InventoryReceiptLine.receipt_id,
                InventoryReceipt.org_id == InventoryReceiptLine.org_id,
            ),
        )
        .where(InventoryReceiptLine.org_id == org_id)
        .where(InventoryReceipt.org_id == org_id)
    )
    sales = (
        select(
            StoreSaleConsumption.item_id,
            cast(null(), DateTime(timezone=True)),
            cast(null(), Numeric(12, 3)),
            StoreSale.sold_on,
            StoreSaleConsumption.quantity,
            StoreSaleConsumption.sale_id,
        )
        .join(
            StoreSale,
            and_(
                StoreSale.id == StoreSaleConsumption.sale_id,
                StoreSale.org_id == StoreSaleConsumption.org_id,
            ),
        )
        .where(StoreSaleConsumption.org_id == org_id)
        .where(StoreSale.org_id == org_id)
        # A voided sale keeps what it took written down, and no longer takes
        # it: voiding one puts its ingredients back on the shelf.
        .where(StoreSale.voided_at.is_(None))
    )
    if item_ids is not None:
        deliveries = deliveries.where(InventoryReceiptLine.item_id.in_(item_ids))
        sales = sales.where(StoreSaleConsumption.item_id.in_(item_ids))
    moves = union_all(deliveries, sales).subquery()

    received_at, received = moves.c.received_at, moves.c.received
    sold_on, sold = moves.c.sold_on, moves.c.sold
    # A day later than the last one the last count reflects; every sale, if
    # it was never counted.
    after_last_count = (
        sold_on.is_not(None),
        or_(bounds.c.last_through.is_(None), sold_on > bounds.c.last_through),
    )
    totals = (
        select(
            moves.c.item_id,
            # Strictly after the last count; everything, if it was never counted.
            func.sum(received).filter(
                received_at.is_not(None),
                or_(bounds.c.last_at.is_(None), received_at > bounds.c.last_at),
            ),
            # After the previous count and up to (and at) the last one.
            func.sum(received).filter(
                bounds.c.previous_at.is_not(None),
                received_at > bounds.c.previous_at,
                received_at <= bounds.c.last_at,
            ),
            func.max(received_at),
            func.sum(sold).filter(*after_last_count),
            # Later than what the previous count reflects, and no later than
            # what the last one does.
            func.sum(sold).filter(
                bounds.c.previous_through.is_not(None),
                sold_on > bounds.c.previous_through,
                sold_on <= bounds.c.last_through,
            ),
            # The same as `sold_since`, that one sale left out.
            (
                null()
                if without_sale is None
                else func.sum(sold).filter(
                    *after_last_count, moves.c.sale_id != without_sale
                )
            ),
        )
        .outerjoin(bounds, bounds.c.item_id == moves.c.item_id)
        .group_by(moves.c.item_id)
    )
    for item_id, since, between, last_at, sold_since, sold_between, without in db.execute(
        totals
    ).all():
        s = out.setdefault(item_id, _Stock())
        s.received_since = _num(since) or 0.0
        s.received_between = _num(between)
        s.last_received_at = last_at
        s.sold_since = _num(sold_since) or 0.0
        s.sold_between = _num(sold_between)
        if without_sale is not None:
            s.sold_since_without_sale = _num(without) or 0.0

    codes = select(InventoryBarcode).where(InventoryBarcode.org_id == org_id)
    if item_ids is not None:
        codes = codes.where(InventoryBarcode.item_id.in_(item_ids))
    for barcode in db.execute(
        codes.order_by(InventoryBarcode.created_at, InventoryBarcode.id)
    ).scalars():
        out.setdefault(barcode.item_id, _Stock()).barcodes.append(barcode)
    return out


def stock_alerts(
    db: Session, org_id: UUID, item_ids: Iterable[UUID], sale_id: UUID
) -> List[StockAlertOut]:
    """The products a sale took from that are now below their minimum, for
    the answer to saving it (routers/store.py). Max, 27-sep-2026: when one
    runs low, offer the order to its supplier.

    Only products with a minimum, and not archived: a product with no
    minimum never runs "low", and an archived one is off the list the
    manager orders from. Below the minimum is what the Inventario flags
    (`isBelowMinimum` in the browser: the stock under the minimum, and a
    stock known at all).

    `became_critical` is what the till opens the order for: critical now
    (`is_critical`) and not before THIS sale. "Before" is the same read with
    the sale left out (`_stock`'s `without_sale`), not a second read taken
    earlier: one snapshot, so a sale saved at the same moment by another till
    cannot be counted on one side and not the other, and a save sent again
    (its answer lost) is answered with the same alerts as the first time.
    A sale filed under a day a count already reflects takes nothing off the
    stock now -- its product is where it was, and nothing "becomes" anything.
    A stock that was not known before (never counted, received or sold) was
    not critical: the first sale of it can make it so.

    Four reads at most, whatever the number of products: the products with
    their photo and supplier, and `_stock` for those. None when the sale
    took nothing from a product with a minimum.
    """
    ids = list(set(item_ids))
    if not ids:
        return []
    rows = db.execute(
        select(InventoryItem, InventoryItemPhoto.id, InventorySupplier)
        .outerjoin(InventoryItemPhoto, _PHOTO_OF_ITEM)
        .outerjoin(InventorySupplier, _SUPPLIER_OF_ITEM)
        .where(InventoryItem.org_id == org_id)
        .where(InventoryItem.id.in_(ids))
        .where(InventoryItem.min_quantity.is_not(None))
        .where(InventoryItem.archived_at.is_(None))
    ).all()
    if not rows:
        return []
    stock = _stock(db, org_id, [item.id for item, _p, _s in rows], without_sale=sale_id)
    alerts: List[StockAlertOut] = []
    for item, photo_id, supplier in rows:
        s = stock.get(item.id) or _Stock()
        minimum = float(item.min_quantity)
        now = _on_hand(s, s.sold_since)
        if now is None or now >= minimum:
            continue
        before_sold = s.sold_since_without_sale
        before = _on_hand(s, s.sold_since if before_sold is None else before_sold)
        critical = is_critical(now, minimum)
        alerts.append(
            StockAlertOut(
                item_id=item.id,
                name=item.name,
                unit=item.unit,
                on_hand=now,
                min_quantity=minimum,
                critical=critical,
                became_critical=critical and not is_critical(before, minimum),
                supplier=supplier_ref(supplier),
                order_quantity=_num(item.order_quantity),
                photo_url=photo_url_or_none(photo_id),
            )
        )
    alerts.sort(key=lambda a: (a.name.lower(), str(a.item_id)))
    return alerts


# How far from today a count or a delivery may be dated. A count is "the last"
# because of its date, and a delivery is added to the stock for as long as it
# is after the last count -- so 2062 typed for 2026 is not a typo that sits
# harmlessly in a list: it is on top of the stock for ever, through every real
# count after it. A day ahead covers a clock or a time zone that is off; 2000
# covers any paper count worth typing in, and stays inside what the driver
# can read back (year 1 with an offset is out of its range: a 500, not a 422).
_EARLIEST = datetime(2000, 1, 1, tzinfo=timezone.utc)
_AHEAD = timedelta(days=1)


def _when(value: Optional[datetime]) -> datetime:
    """The date a count or a delivery is filed under: now, or the one sent if
    it is a plausible one."""
    now = datetime.now(timezone.utc)
    if value is None:
        return now
    aware = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    if not (_EARLIEST <= aware <= now + _AHEAD):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "inventory_date_out_of_range",
                "The date must be between 2000 and tomorrow",
            ),
        )
    return value


def _aware(value: datetime) -> datetime:
    """A moment with no zone is read as UTC, as Postgres stores it."""
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


#: A count "after closing" taken before this hour closes the day before: a bar
#: that shuts at 02:00 and counts at 02:30 on Sunday has counted Saturday's
#: night, and Saturday's sales are what it saw.
LATE_CLOSE_HOUR = 6
CLOSING_ROLLOVER = timedelta(hours=LATE_CLOSE_HOUR)


def _count_moment(counted_at: datetime, after_close: Optional[bool]) -> Tuple[bool, date]:
    """Whether a count was after closing, and the last day whose sales it
    already reflects.

    After closing, that day's sales are off the shelf it saw: the day itself --
    the day the night began, for a count in the small hours. Before opening,
    they are still to come: the day before. Which one it was is the manager's
    to say; left unsaid, the hour guesses: from noon, and in the small hours
    after a late close, after closing; in the morning, before opening. Between
    midnight and six the two answers give the same day, so the guess there
    only chooses the label. The DAY is the business's too, not the server's
    UTC: a count at 00:30 in Madrid is on the day that has just begun there.
    """
    local = to_business_time(_aware(counted_at))
    if after_close is None:
        after_close = local.hour >= 12 or local.hour < LATE_CLOSE_HOUR
    if after_close:
        return True, (local - CLOSING_ROLLOVER).date()
    return False, local.date() - timedelta(days=1)


def _sales_through(counted_at: datetime, after_close: Optional[bool]) -> date:
    """The last day whose sales a count taken at this moment already reflects
    (see `_count_moment`)."""
    return _count_moment(counted_at, after_close)[1]


def _after_close(count: InventoryCount) -> bool:
    """Whether a count was taken after closing, as it was said when saved."""
    return count.after_close


def _get_item(db: Session, org_id: UUID, item_id: UUID) -> InventoryItem:
    item = db.execute(
        select(InventoryItem)
        .where(InventoryItem.org_id == org_id)
        .where(InventoryItem.id == item_id)
    ).scalar_one_or_none()
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("inventory_item_not_found", "Product not found"),
        )
    return item


def _get_count(db: Session, org_id: UUID, count_id: UUID) -> InventoryCount:
    count = db.execute(
        select(InventoryCount)
        .where(InventoryCount.org_id == org_id)
        .where(InventoryCount.id == count_id)
    ).scalar_one_or_none()
    if count is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("inventory_count_not_found", "Count not found"),
        )
    return count


def _get_receipt(db: Session, org_id: UUID, receipt_id: UUID) -> InventoryReceipt:
    receipt = db.execute(
        select(InventoryReceipt)
        .where(InventoryReceipt.org_id == org_id)
        .where(InventoryReceipt.id == receipt_id)
    ).scalar_one_or_none()
    if receipt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("inventory_receipt_not_found", "Receipt not found"),
        )
    return receipt


def _known_items(db: Session, org_id: UUID, ids: List[UUID]) -> None:
    """404 unless every one of these is a product of this business.

    Archived products count: one can be received or counted like any other,
    and the client offers to bring it back first.
    """
    known = set(
        db.execute(
            select(InventoryItem.id)
            .where(InventoryItem.org_id == org_id)
            .where(InventoryItem.id.in_(ids))
        ).scalars()
    )
    if len(known) != len(set(ids)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("inventory_item_not_found", "Product not found"),
        )


# --- Giving a product its codes -----------------------------------------


def _taken(product: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=detail(
            "inventory_barcode_taken",
            "That barcode already belongs to %s" % product,
            product=product,
        ),
    )


def _owner_of(db: Session, org_id: UUID, keys: Iterable[str]) -> Optional[str]:
    """The name of the product of this business that already has one of these."""
    return db.execute(
        select(InventoryItem.name)
        .join(InventoryBarcode, InventoryBarcode.item_id == InventoryItem.id)
        .where(InventoryBarcode.org_id == org_id)
        .where(InventoryBarcode.code_key.in_(list(keys)))
        .order_by(InventoryItem.name)
        .limit(1)
    ).scalar_one_or_none()


def _code_on(
    db: Session, org_id: UUID, item_id: UUID, key: str
) -> Optional[InventoryBarcode]:
    """This product's code with this key, if it has it."""
    return db.execute(
        select(InventoryBarcode)
        .where(InventoryBarcode.org_id == org_id)
        .where(InventoryBarcode.item_id == item_id)
        .where(InventoryBarcode.code_key == key)
    ).scalar_one_or_none()


def _add_barcodes(
    db: Session, org_id: UUID, item: InventoryItem, wanted: Sequence[InventoryBarcodeIn]
) -> List[InventoryBarcode]:
    """Give a product these codes, or refuse the lot.

    Refused with the NAME of the product that already has one, because that is
    what the manager needs to decide: it is the same product under another
    name, or the code was typed wrong. Two codes of the same request that are
    one code once normalised (the UPC-A and the EAN-13 of one box) are refused
    the same way, naming the product being given them.

    Checked first so the answer has the name in it, and caught at the UNIQUE
    constraint as well, for the request that slips in between: inside a
    savepoint, so the transaction is still usable to look the name up.
    """
    keyed: List[Tuple[str, InventoryBarcodeIn]] = []
    for wish in wanted:
        try:
            keyed.append((barcode_key(wish.code), wish))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail(
                    "inventory_barcode_invalid", "A barcode must not be blank"
                ),
            ) from None
    if not keyed:
        return []
    keys = [key for key, _ in keyed]
    if len(set(keys)) != len(keys):
        raise _taken(item.name)
    owner = _owner_of(db, org_id, keys)
    if owner is not None:
        raise _taken(owner)

    made: List[InventoryBarcode] = []
    try:
        with db.begin_nested():
            for key, wish in keyed:
                barcode = InventoryBarcode(
                    org_id=org_id,
                    item_id=item.id,
                    code=wish.code,
                    code_key=key,
                    units_per_scan=wish.units_per_scan,
                    label=wish.label,
                )
                db.add(barcode)
                # One INSERT per code rather than one for all: created_at is
                # clock_timestamp(), and separate statements are what keep the
                # codes in the order they were given.
                db.flush()
                made.append(barcode)
    except IntegrityError as exc:
        raise _taken(_owner_of(db, org_id, keys) or item.name) from exc
    return made


# --- Products -----------------------------------------------------------


@router.get("/items", response_model=List[InventoryItemOut])
def list_items(
    include_archived: bool = False,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_VIEW)),
) -> List[InventoryItemOut]:
    query = (
        select(InventoryItem, InventoryItemPhoto.id, InventorySupplier)
        .outerjoin(InventoryItemPhoto, _PHOTO_OF_ITEM)
        .outerjoin(InventorySupplier, _SUPPLIER_OF_ITEM)
        .where(InventoryItem.org_id == current_user.org_id)
    )
    if not include_archived:
        query = query.where(InventoryItem.archived_at.is_(None))
    rows = db.execute(
        query.order_by(
            func.coalesce(InventoryItem.category, "").asc(),
            func.lower(InventoryItem.name).asc(),
        )
    ).all()
    stock = _stock(db, current_user.org_id)
    return [
        _item_out(item, stock, photo_id, supplier) for item, photo_id, supplier in rows
    ]


@router.post("/items", response_model=InventoryItemOut, status_code=status.HTTP_201_CREATED)
def create_item(
    payload: InventoryItemCreate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_PRODUCTS)),
) -> InventoryItemOut:
    """Add a product, with its codes and, if it is said, what is already on
    the shelf (`initial_quantity`): kept as a receipt of that much, now, with
    `initial_note` as its note -- an entry, not a count. All of it or none of
    it: one transaction, committed before the answer, which already shows
    that entry in `received_since_count`."""
    _known_supplier(db, current_user.org_id, payload.supplier_id)
    item = InventoryItem(
        org_id=current_user.org_id,
        name=payload.name,
        unit=payload.unit,
        category=payload.category,
        min_quantity=payload.min_quantity,
        supplier_id=payload.supplier_id,
        order_quantity=payload.order_quantity,
    )
    db.add(item)
    db.flush()
    # In the same transaction as the product: a code that is already another
    # product's refuses the request, and the product goes with it.
    _add_barcodes(db, current_user.org_id, item, payload.barcodes)
    if payload.initial_quantity is not None:
        # What was already on the shelf when it was added, as an entry rather
        # than a count, so nobody has to count a product just added. After
        # the codes and in the same transaction: a code refused above means
        # no entry at all, and an entry that fails takes the product with it.
        receipt = InventoryReceipt(
            org_id=current_user.org_id,
            received_at=_when(None),
            supplier=None,
            note=payload.initial_note,
            received_by=current_user.id,
            client_ref=None,
        )
        db.add(receipt)
        db.flush()
        db.add(
            InventoryReceiptLine(
                org_id=current_user.org_id,
                receipt_id=receipt.id,
                item_id=item.id,
                quantity=payload.initial_quantity,
            )
        )
        db.flush()
    db.refresh(item)
    # Committed before the answer (see `_answer`): the form sends the photo
    # of a new product the moment it hears 201, and a PUT that arrived before
    # this commit would find no product -- "that product is no longer in your
    # inventory" about the one just made.
    return _answer(
        db,
        _item_out(
            item,
            _stock(db, current_user.org_id, [item.id]),
            supplier=_supplier_of(db, item),
        ),
    )


@router.patch("/items/{item_id}", response_model=InventoryItemOut)
def update_item(
    item_id: UUID,
    payload: InventoryItemUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_PRODUCTS)),
) -> InventoryItemOut:
    item = _get_item(db, current_user.org_id, item_id)
    sent = payload.model_fields_set
    if "name" in sent and payload.name is not None:
        item.name = payload.name
    if "unit" in sent:
        item.unit = payload.unit
    if "category" in sent:
        item.category = payload.category
    if "min_quantity" in sent:
        item.min_quantity = payload.min_quantity
    if "supplier_id" in sent:
        _known_supplier(db, current_user.org_id, payload.supplier_id)
        item.supplier_id = payload.supplier_id
    if "order_quantity" in sent:
        item.order_quantity = payload.order_quantity
    if "archived" in sent and payload.archived is not None:
        if payload.archived and item.archived_at is None:
            item.archived_at = datetime.now(timezone.utc)
        elif not payload.archived:
            item.archived_at = None
    db.flush()
    db.refresh(item)
    # Committed before the answer, like creating one: the photo that follows
    # an edit must see the edit.
    return _answer(
        db,
        _item_out(
            item,
            _stock(db, current_user.org_id, [item.id]),
            _photo_id(db, current_user.org_id, item.id),
            _supplier_of(db, item),
        ),
    )


# --- Barcodes -----------------------------------------------------------


@router.post(
    "/items/{item_id}/barcodes",
    response_model=InventoryBarcodeOut,
    status_code=status.HTTP_201_CREATED,
)
def add_barcode(
    item_id: UUID,
    payload: InventoryBarcodeIn,
    response: Response,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_PRODUCTS)),
) -> InventoryBarcodeOut:
    item = _get_item(db, current_user.org_id, item_id)
    try:
        [barcode] = _add_barcodes(db, current_user.org_id, item, [payload])
    except HTTPException as refused:
        # Already THIS product's: the same code given to it again -- a save
        # retried because its answer was lost, or two at once. What was asked
        # for is true, so it is answered with the code as it is (200, and its
        # units and label left alone) rather than as a conflict. Checked after
        # the refusal, not before, so the one answer covers both the plain
        # repeat and the one that only met the UNIQUE constraint.
        if refused.status_code == status.HTTP_409_CONFLICT:
            already = _code_on(
                db, current_user.org_id, item.id, barcode_key(payload.code)
            )
            if already is not None:
                response.status_code = status.HTTP_200_OK
                return _barcode_out(already)
        raise
    return _barcode_out(barcode)


@router.delete(
    "/items/{item_id}/barcodes/{barcode_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_barcode(
    item_id: UUID,
    barcode_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_PRODUCTS)),
) -> Response:
    item = _get_item(db, current_user.org_id, item_id)
    barcode = db.execute(
        select(InventoryBarcode)
        .where(InventoryBarcode.org_id == current_user.org_id)
        .where(InventoryBarcode.item_id == item.id)
        .where(InventoryBarcode.id == barcode_id)
    ).scalar_one_or_none()
    if barcode is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("inventory_barcode_not_found", "Barcode not found"),
        )
    db.delete(barcode)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- A product's photo ----------------------------------------------------
#
# The body is read, checked and refused by app/photo_http.py, shared with the
# menu's dishes: the same wall (JPEG, PNG or WebP, 512 KB, 4096 px a side) and
# the same codes (413 `menu_photo_too_large`, 415 `menu_photo_bad_type`).


def _one_photo_writer(db: Session, item_id: UUID) -> None:
    """One change to a product's photo at a time, until this one commits.

    Without it, two uploads at once both find no photo to take off and both
    insert one: the second meets the UNIQUE on item_id -- a 500. Behind the
    lock the second one takes off what the first one put. Namespaced so it is
    nobody else's lock.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": "inventory_photo:%s" % item_id},
    )


def _drop_photo(db: Session, org_id: UUID, item_id: UUID) -> None:
    db.execute(
        delete(InventoryItemPhoto)
        .where(InventoryItemPhoto.org_id == org_id)
        .where(InventoryItemPhoto.item_id == item_id)
    )


def _answer(db: Session, out):
    """Commit, then answer with what was read BEFORE the commit.

    `get_db` commits when the request closes, which FastAPI does after the
    body has gone -- and the screen acts on the answer the moment it hears it:
    the <img> asks for a new `photo_url`, and the form sends the photo of a
    product it has just created, each on another session and before the row
    is there, and each gets a 404. Same reason as routers/menu.py's `_answer`.

    `out` is read first because the tenant the RLS policies see is SET LOCAL:
    after the commit, a read would be a read with no business at all. The
    commit also releases `_one_photo_writer`'s lock.
    """
    db.commit()
    return out


@router.put(
    "/items/{item_id}/photo", response_model=InventoryItemOut, openapi_extra=PHOTO_BODY
)
def put_item_photo(
    item_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_PRODUCTS)),
    # AFTER the permission: whoever may not is turned away before a byte is read.
    upload: Upload = Depends(read_upload),
) -> InventoryItemOut:
    """Put a photo on a product, or change the one it has; answered with the
    product, as the list has it.

    The body is the image, sent with its own Content-Type (image/jpeg, png or
    webp). A product that had a photo gets a NEW one, with a new id -- so a
    new `photo_url`, and no phone keeps showing the old one from its cache.
    Archived products too: one can come back.
    """
    photo = checked(upload, "product")
    org_id = current_user.org_id
    _one_photo_writer(db, item_id)
    item = _get_item(db, org_id, item_id)
    # Out with the old row first, in its own statement: item_id is UNIQUE,
    # and the new row is a new id rather than the old one overwritten.
    _drop_photo(db, org_id, item.id)
    new = InventoryItemPhoto(
        org_id=org_id,
        item_id=item.id,
        content_type=photo.content_type,
        data=upload.data,
        width=photo.width,
        height=photo.height,
    )
    db.add(new)
    db.flush()
    return _answer(
        db, _item_out(item, _stock(db, org_id, [item.id]), new.id, _supplier_of(db, item))
    )


@router.delete("/items/{item_id}/photo", status_code=status.HTTP_204_NO_CONTENT)
def delete_item_photo(
    item_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_PRODUCTS)),
) -> Response:
    """Take the photo off a product. A product with none is already as asked:
    204. Its address is a 404 from now on."""
    org_id = current_user.org_id
    _one_photo_writer(db, item_id)
    item = _get_item(db, org_id, item_id)
    _drop_photo(db, org_id, item.id)
    return _answer(db, Response(status_code=status.HTTP_204_NO_CONTENT))


# --- Counts -------------------------------------------------------------


@router.get("/counts", response_model=List[InventoryCountSummary])
def list_counts(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_VIEW)),
) -> List[InventoryCountSummary]:
    lines = (
        select(InventoryCountLine.count_id, func.count().label("n"))
        .where(InventoryCountLine.org_id == current_user.org_id)
        .group_by(InventoryCountLine.count_id)
        .subquery()
    )
    rows = db.execute(
        select(InventoryCount, func.coalesce(lines.c.n, 0))
        .outerjoin(lines, lines.c.count_id == InventoryCount.id)
        .where(InventoryCount.org_id == current_user.org_id)
        .order_by(InventoryCount.counted_at.desc(), InventoryCount.created_at.desc())
        .limit(500)
    ).all()
    return [
        InventoryCountSummary(
            id=c.id,
            counted_at=c.counted_at,
            after_close=_after_close(c),
            sales_through=c.sales_through,
            note=c.note,
            line_count=int(n),
        )
        for c, n in rows
    ]


def _count_out(db: Session, count: InventoryCount) -> InventoryCountOut:
    rows = db.execute(
        select(InventoryCountLine, InventoryItem, InventoryItemPhoto.id)
        .join(InventoryItem, InventoryItem.id == InventoryCountLine.item_id)
        .outerjoin(InventoryItemPhoto, _PHOTO_OF_ITEM)
        .where(InventoryCountLine.count_id == count.id)
        .where(InventoryCountLine.org_id == count.org_id)
        .order_by(
            func.coalesce(InventoryItem.category, "").asc(),
            func.lower(InventoryItem.name).asc(),
        )
    ).all()
    return InventoryCountOut(
        id=count.id,
        counted_at=count.counted_at,
        after_close=_after_close(count),
        sales_through=count.sales_through,
        note=count.note,
        lines=[
            InventoryCountLineOut(
                item_id=item.id,
                item_name=item.name,
                unit=item.unit,
                category=item.category,
                quantity=float(line.quantity),
                photo_url=photo_url_or_none(photo_id),
            )
            for line, item, photo_id in rows
        ],
    )


@router.get("/counts/{count_id}", response_model=InventoryCountOut)
def get_count(
    count_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_VIEW)),
) -> InventoryCountOut:
    return _count_out(db, _get_count(db, current_user.org_id, count_id))


@router.post("/counts", response_model=InventoryCountOut, status_code=status.HTTP_201_CREATED)
def create_count(
    payload: InventoryCountCreate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_COUNT)),
) -> InventoryCountOut:
    ids = [line.item_id for line in payload.lines]
    if len(set(ids)) != len(ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "inventory_count_duplicate_item",
                "A product appears more than once in the count",
            ),
        )
    _known_items(db, current_user.org_id, ids)

    # Aware before it is stored: the day of its sales is worked out from this
    # moment, so the moment stored has to be the same one whatever zone the
    # database session is in.
    counted_at = _aware(_when(payload.counted_at))
    after_close, sales_through = _count_moment(counted_at, payload.after_close)
    count = InventoryCount(
        org_id=current_user.org_id,
        counted_at=counted_at,
        after_close=after_close,
        sales_through=sales_through,
        note=payload.note,
        counted_by=current_user.id,
    )
    db.add(count)
    db.flush()
    db.add_all(
        InventoryCountLine(
            org_id=current_user.org_id,
            count_id=count.id,
            item_id=line.item_id,
            quantity=line.quantity,
        )
        for line in payload.lines
    )
    db.flush()
    db.refresh(count)
    return _count_out(db, count)


@router.delete("/counts/{count_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_count(
    count_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_RECORDS_DELETE)),
) -> Response:
    db.delete(_get_count(db, current_user.org_id, count_id))
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Receipts -----------------------------------------------------------


@router.get("/receipts", response_model=List[InventoryReceiptSummary])
def list_receipts(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_VIEW)),
) -> List[InventoryReceiptSummary]:
    lines = (
        select(
            InventoryReceiptLine.receipt_id,
            func.count().label("n"),
            func.sum(InventoryReceiptLine.quantity).label("total"),
        )
        .where(InventoryReceiptLine.org_id == current_user.org_id)
        .group_by(InventoryReceiptLine.receipt_id)
        .subquery()
    )
    rows = db.execute(
        select(InventoryReceipt, func.coalesce(lines.c.n, 0), func.coalesce(lines.c.total, 0))
        .outerjoin(lines, lines.c.receipt_id == InventoryReceipt.id)
        .where(InventoryReceipt.org_id == current_user.org_id)
        .order_by(InventoryReceipt.received_at.desc(), InventoryReceipt.created_at.desc())
        .limit(500)
    ).all()
    return [
        InventoryReceiptSummary(
            id=r.id,
            received_at=r.received_at,
            supplier=r.supplier,
            note=r.note,
            line_count=int(n),
            total_quantity=float(total),
        )
        for r, n, total in rows
    ]


def _receipt_out(db: Session, receipt: InventoryReceipt) -> InventoryReceiptOut:
    rows = db.execute(
        select(InventoryReceiptLine, InventoryItem, InventoryItemPhoto.id)
        .join(InventoryItem, InventoryItem.id == InventoryReceiptLine.item_id)
        .outerjoin(InventoryItemPhoto, _PHOTO_OF_ITEM)
        .where(InventoryReceiptLine.receipt_id == receipt.id)
        .where(InventoryReceiptLine.org_id == receipt.org_id)
        .order_by(
            func.coalesce(InventoryItem.category, "").asc(),
            func.lower(InventoryItem.name).asc(),
        )
    ).all()
    return InventoryReceiptOut(
        id=receipt.id,
        received_at=receipt.received_at,
        supplier=receipt.supplier,
        note=receipt.note,
        lines=[
            InventoryReceiptLineOut(
                item_id=item.id,
                item_name=item.name,
                unit=item.unit,
                category=item.category,
                quantity=float(line.quantity),
                photo_url=photo_url_or_none(photo_id),
            )
            for line, item, photo_id in rows
        ],
    )


@router.get("/receipts/{receipt_id}", response_model=InventoryReceiptOut)
def get_receipt(
    receipt_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_VIEW)),
) -> InventoryReceiptOut:
    return _receipt_out(db, _get_receipt(db, current_user.org_id, receipt_id))


def _receipt_by_ref(
    db: Session, org_id: UUID, client_ref: Optional[UUID]
) -> Optional[InventoryReceipt]:
    """The receipt this business already saved under this ref, if any."""
    if client_ref is None:
        return None
    return db.execute(
        select(InventoryReceipt)
        .where(InventoryReceipt.org_id == org_id)
        .where(InventoryReceipt.client_ref == client_ref)
    ).scalar_one_or_none()


@router.post(
    "/receipts", response_model=InventoryReceiptOut, status_code=status.HTTP_201_CREATED
)
def create_receipt(
    payload: InventoryReceiptCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_RECEIVE)),
) -> InventoryReceiptOut:
    # The same save sent again. Answered with the receipt as it was KEPT --
    # its lines, not the ones in this request -- and before anything in this
    # request is looked at: a retry is a question about the first request,
    # and the phone works out what is still unsaved from what comes back.
    kept = _receipt_by_ref(db, current_user.org_id, payload.client_ref)
    if kept is not None:
        response.status_code = status.HTTP_200_OK
        return _receipt_out(db, kept)

    # One line per product. Scanning the same box twice is added up on the
    # client, before it gets here; two lines for one product reaching the
    # server is a client that forgot to, and which of the two was meant is
    # not something to guess.
    ids = [line.item_id for line in payload.lines]
    if len(set(ids)) != len(ids):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "inventory_receipt_duplicate_item",
                "A product appears more than once in the receipt",
            ),
        )
    _known_items(db, current_user.org_id, ids)

    receipt = InventoryReceipt(
        org_id=current_user.org_id,
        received_at=_when(payload.received_at),
        supplier=payload.supplier,
        note=payload.note,
        received_by=current_user.id,
        client_ref=payload.client_ref,
    )
    try:
        # In a savepoint: two saves with one ref at once both miss the lookup
        # above, and the second meets the UNIQUE (org_id, client_ref) here. The
        # transaction has to survive that to read the first one's receipt.
        with db.begin_nested():
            db.add(receipt)
            db.flush()
    except IntegrityError:
        kept = _receipt_by_ref(db, current_user.org_id, payload.client_ref)
        if kept is None:
            raise
        response.status_code = status.HTTP_200_OK
        return _receipt_out(db, kept)
    db.add_all(
        InventoryReceiptLine(
            org_id=current_user.org_id,
            receipt_id=receipt.id,
            item_id=line.item_id,
            quantity=line.quantity,
        )
        for line in payload.lines
    )
    db.flush()
    db.refresh(receipt)
    return _receipt_out(db, receipt)


@router.delete("/receipts/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt(
    receipt_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(require_permission(Perm.INVENTORY_RECORDS_DELETE)),
) -> Response:
    db.delete(_get_receipt(db, current_user.org_id, receipt_id))
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
