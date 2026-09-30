from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class StoreSale(Base):
    """One sale, filed under the day it was made. Its total is its lines'.

    Never deleted nor edited once saved: a mistake is voided (see 0043), and
    the database holds every role to it. Not mapped: `created_xact`, the
    transaction that saved it, which only the database writes and reads (a
    line or what the sale took is written in that transaction or never).
    """

    __tablename__ = "store_sale"
    __table_args__ = (
        # What the line's foreign key on (sale_id, org_id) points at.
        UniqueConstraint("id", "org_id"),
        # The same save sent twice finds the sale it already made (see 0035).
        UniqueConstraint("org_id", "client_ref"),
        # A period of one business's sales, which is every read (see 0035).
        Index("ix_store_sale_org_id", "org_id", "sold_on"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    # A day, not an instant: "what we sold on Saturday" has no time zone.
    sold_on: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # 'manual' -- typed in; 'till' -- charged from the bill in Tienda -> Menú
    # (see migration 0043).
    source: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'manual'")
    )
    # 'cash' or 'card', or NULL when nobody said: every sale typed in before
    # 0043, and one typed in from paper that does not say.
    payment_method: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    client_ref: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Who saved it, as their account was named then: written when the sale is
    # saved (routers/store.py), never changed, and kept when the account goes
    # (migration 0046). NULL on a sale whose account was gone before 0046.
    created_by_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    # A sale is voided, never deleted nor edited: the row and its lines stay
    # as they were and the statistics leave it out (see migration 0043).
    voided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    voided_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Who voided it, as their account was named then: written by the database
    # when the sale is voided, and kept when the account goes.
    voided_by_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    void_reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)


class StoreSaleLine(Base):
    """What one line of a sale was: a dish of the menu, or a free line.

    Name and price are copied from the menu when the line is written and never
    follow it after: a sale is a record of what happened.
    """

    __tablename__ = "store_sale_line"
    __table_args__ = (
        UniqueConstraint("sale_id", "position"),
        # On (sale_id, org_id), not on sale_id alone: the sale has to be this
        # business's own. A plain foreign key is checked past row-level
        # security and would accept a neighbour's (see migrations 0033, 0035).
        ForeignKeyConstraint(
            ["sale_id", "org_id"],
            ["store_sale.id", "store_sale.org_id"],
            ondelete="CASCADE",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    sale_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # Which dish of the menu this was, or NULL for a free line. Not a foreign
    # key, on purpose: it outlives the dish (see migration 0035).
    dish_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    # The order the lines were entered in.
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class StoreSaleConsumption(Base):
    """What one sale took off the shelf of one product, written when the sale
    was saved (see 0041).

    A snapshot of the recipes of that moment: a recipe changed later does not
    change it. Part of the sale's record, like its lines: a sale is never
    deleted, it is voided (0043), and a voided sale's rows stay here and stop
    counting in the stock (routers/inventory.py), which is what puts it back.
    """

    __tablename__ = "store_sale_consumption"
    __table_args__ = (
        UniqueConstraint("sale_id", "item_id"),
        # Both on (x_id, org_id): the sale and the product have to be this
        # business's own (see 0033, 0041).
        ForeignKeyConstraint(
            ["sale_id", "org_id"],
            ["store_sale.id", "store_sale.org_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["item_id", "org_id"],
            ["inventory_item.id", "inventory_item.org_id"],
            ondelete="CASCADE",
        ),
        Index("ix_store_sale_consumption_org_id", "org_id", "item_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    sale_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    # In the product's own unit, to the thousandth, above zero.
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
