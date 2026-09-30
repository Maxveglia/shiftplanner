from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, deferred, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


def _added_at() -> Mapped[datetime]:
    # clock_timestamp(), not now(): rows added in one transaction keep the
    # order they were added in, which breaks a tie in `position` (see 0033).
    return mapped_column(
        DateTime(timezone=True),
        server_default=text("clock_timestamp()"),
        nullable=False,
    )


class MenuSection(Base):
    """One part of the menu: "Entrantes", "Principales", "Bebidas"."""

    __tablename__ = "menu_section"
    # What the dish's foreign key on (section_id, org_id) points at.
    __table_args__ = (UniqueConstraint("id", "org_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # The manager's order, not the alphabet's: a menu reads starters first.
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = _added_at()


class MenuDish(Base):
    """One dish or drink, in one section of the same business's menu."""

    __tablename__ = "menu_dish"
    # On (section_id, org_id), not on section_id alone: the section has to be
    # this business's own. A plain foreign key is checked past row-level
    # security and would accept a neighbour's section (see migration 0033).
    # And UNIQUE (id, org_id), which is what the photo's key on
    # (dish_id, org_id) points at, for the same reason (0038).
    __table_args__ = (
        ForeignKeyConstraint(
            ["section_id", "org_id"],
            ["menu_section.id", "menu_section.org_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "org_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # NULL = no price on the menu: the fish at market price.
    price: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    # Codes of the fourteen EU allergens (app/schemas/menu.py::ALLERGENS),
    # stored once each and in that order.
    allergens: Mapped[List[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default=text("'{}'")
    )
    # False = sold out today; still on the menu, shown as such.
    available: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    created_at: Mapped[datetime] = _added_at()
    updated_at: Mapped[datetime] = created_at_col()


class MenuDishPhoto(Base):
    """A dish's one photo, the bytes themselves (see migration 0038).

    `id` is what its public URL carries (routers/menu_photos.py), so it is
    random and never reused: a new photo is a new row with a new id, which is
    what lets that URL be cached for a year.
    """

    __tablename__ = "menu_dish_photo"
    # The dish has to be this business's own: see MenuDish and 0038.
    __table_args__ = (
        ForeignKeyConstraint(
            ["dish_id", "org_id"],
            ["menu_dish.id", "menu_dish.org_id"],
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
    # One photo per dish.
    dish_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True
    )
    # image/jpeg, image/png or image/webp, as its bytes proved
    # (app/services/menu_photos.py).
    content_type: Mapped[str] = mapped_column(String, nullable=False)
    # Deferred: loading the row never loads the picture. Only the route that
    # serves it asks for these, by name.
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary, nullable=False))
    # As read from the file's header when it was uploaded; NULL for the ones
    # a migration loaded (0039), which did not read them.
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # The dish's name is printed on the picture already (0040): the tile then
    # does not print it over again. False for every upload.
    labelled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = created_at_col()


class MenuRecipeItem(Base):
    """One ingredient of a dish: a product of the inventory, and how much of
    it one unit sold takes, in that product's own unit (see 0041)."""

    __tablename__ = "menu_recipe_item"
    # Both keys on (x_id, org_id): the dish and the product have to be this
    # business's own. A plain foreign key is checked past row-level security.
    __table_args__ = (
        UniqueConstraint("dish_id", "item_id"),
        ForeignKeyConstraint(
            ["dish_id", "org_id"],
            ["menu_dish.id", "menu_dish.org_id"],
            ondelete="CASCADE",
        ),
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
    dish_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)


class MenuRecipeComponent(Base):
    """Another dish of the same menu inside this one, and how many: a combo
    is its components (see 0041). Never itself, directly or through others."""

    __tablename__ = "menu_recipe_component"
    __table_args__ = (
        UniqueConstraint("dish_id", "component_id"),
        CheckConstraint("dish_id <> component_id"),
        ForeignKeyConstraint(
            ["dish_id", "org_id"],
            ["menu_dish.id", "menu_dish.org_id"],
            ondelete="CASCADE",
        ),
        # No cascade: a dish inside a combo is not deleted from under it
        # (see 0041 and routers/menu.py::_combos_holding). Checked at commit.
        ForeignKeyConstraint(
            ["component_id", "org_id"],
            ["menu_dish.id", "menu_dish.org_id"],
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
    dish_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    component_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
