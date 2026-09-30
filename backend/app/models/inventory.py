from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class InventorySupplier(Base):
    """Who a business buys its products from, and the phone its orders go to
    (see migration 0045).

    The phone is kept as the manager wrote it; the browser works out the
    digits WhatsApp needs when it builds the link. The name is unique per
    business whatever its case -- an index on (org_id, lower(name)) the
    migration makes and this model does not declare.
    """

    __tablename__ = "inventory_supplier"
    # What a product's key on (supplier_id, org_id) points at.
    __table_args__ = (UniqueConstraint("id", "org_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_col()


class InventoryItem(Base):
    """One thing on the shelf that the manager counts."""

    __tablename__ = "inventory_item"
    # What the keys on (item_id, org_id) of a recipe and of a sale's
    # consumption point at: the product has to be this business's own, and a
    # plain foreign key is checked past row-level security (see 0041).
    # Its supplier has to be this business's too, for the same reason (0045):
    # the key only refuses -- deleting a supplier nulls its products first,
    # in routers/inventory_suppliers.py.
    __table_args__ = (
        UniqueConstraint("id", "org_id"),
        ForeignKeyConstraint(
            ["supplier_id", "org_id"],
            ["inventory_supplier.id", "inventory_supplier.org_id"],
            name="inventory_item_supplier_fkey",
            deferrable=True,
            initially="DEFERRED",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Free text, as the manager says it: "botellas", "kg", "cajas de 24".
    unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Below this the product is flagged as low. NULL = no minimum.
    min_quantity: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 3), nullable=True)
    # Who it is bought from, or NULL (0045).
    supplier_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # How much of it is ordered at a time, in its own unit; NULL when nobody
    # said. What the order to the supplier offers first (0045).
    order_quantity: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 3), nullable=True
    )
    # Archived, not deleted: past counts still name the product.
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()


class InventoryItemPhoto(Base):
    """A product's one photo, the bytes themselves (see migration 0042).

    As a dish's (MenuDishPhoto, 0038): `id` is what its public URL carries
    (routers/inventory_photos.py), so it is random and never reused -- a new
    photo is a new row with a new id, which is what lets that URL be cached
    for a year.
    """

    __tablename__ = "inventory_item_photo"
    # The product has to be this business's own: a plain foreign key is
    # checked past row-level security (see 0041 and 0042).
    __table_args__ = (
        ForeignKeyConstraint(
            ["item_id", "org_id"],
            ["inventory_item.id", "inventory_item.org_id"],
            ondelete="CASCADE",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # One photo per product.
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True
    )
    # image/jpeg, image/png or image/webp, as its bytes proved
    # (app/services/photos.py).
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    # Deferred: loading the row never loads the picture. Only the route that
    # serves it asks for these, by name.
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    # As read from the file's header when it was uploaded. Never NULL: every
    # photo here comes through the API, which always reads them.
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class InventoryCount(Base):
    """One walk round the shop: what was there, at one moment."""

    __tablename__ = "inventory_count"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    counted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # The last day whose sales are already off the shelf this count saw: the
    # day of the count when it was taken after closing, the day before when it
    # was taken before opening. A sale is after the count when its `sold_on`
    # is later than this (see 0041).
    sales_through: Mapped[date] = mapped_column(Date, nullable=False)
    # Which of the two the manager said it was (or the hour guessed), kept as
    # said: between midnight and six both give the same `sales_through`, so it
    # cannot be read back off the day.
    after_close: Mapped[bool] = mapped_column(Boolean, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    counted_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = created_at_col()


class InventoryCountLine(Base):
    """How many of one product a count found."""

    __tablename__ = "inventory_count_line"
    __table_args__ = (UniqueConstraint("count_id", "item_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    count_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_count.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_item.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)


class InventoryBarcode(Base):
    """A code printed on a product, and how many of its units one scan is.

    `code` is what was read, for showing back; `code_key` is what is compared
    (see app/services/barcodes.py), and it is unique per business.
    """

    __tablename__ = "inventory_barcode"
    __table_args__ = (UniqueConstraint("org_id", "code_key"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_item.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    code: Mapped[str] = mapped_column(String, nullable=False)
    code_key: Mapped[str] = mapped_column(String, nullable=False)
    # The case of 24 has its own code, and one scan of it is 24 bottles.
    units_per_scan: Mapped[Decimal] = mapped_column(
        Numeric(12, 3), nullable=False, server_default=text("1")
    )
    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # clock_timestamp(), not now(): codes added together in one transaction
    # keep the order they were added in (see migration 0032).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("clock_timestamp()"),
        nullable=False,
    )


class InventoryReceipt(Base):
    """One delivery: what came in, at one moment, from whom."""

    __tablename__ = "inventory_receipt"
    __table_args__ = (UniqueConstraint("org_id", "client_ref"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    supplier: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    note: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    received_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Made up by the phone once per scanning session: the same save sent twice
    # (its answer was lost) finds the receipt it already made. See 0032.
    client_ref: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()


class InventoryReceiptLine(Base):
    """How much of one product a delivery brought, in the product's units."""

    __tablename__ = "inventory_receipt_line"
    __table_args__ = (UniqueConstraint("receipt_id", "item_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    receipt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_receipt.id", ondelete="CASCADE"),
        nullable=False,
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("inventory_item.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
