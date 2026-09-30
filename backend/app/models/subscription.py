from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class Subscription(Base):
    """The commercial state of one organization. Exactly one row per org.

    This is what turns "an org exists" into "an org is a paying customer", the
    single distinction the back office is built to count. It carries no price:
    the back office answers *how many*, not *how much*, so the amounts live in
    the payment provider and never need to be mirrored here.

    ``activated_at`` is stamped the first time the account becomes ``active``.
    Keeping it separate from ``created_at`` is what makes "signed up in March,
    converted in May" answerable at all -- deriving it later from a status
    column that has been overwritten is impossible.
    """

    __tablename__ = "subscription"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    plan: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'trial'")
    )
    status: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'trialing'")
    )
    # Contracted manager seats. Null = not yet agreed (trials).
    seats: Mapped[Optional[int]] = mapped_column(nullable=True)
    trial_ends_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    activated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    canceled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
