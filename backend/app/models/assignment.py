from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, text
from sqlalchemy.dialects.postgresql import ExcludeConstraint, TSTZRANGE, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class Assignment(Base):
    """A shift, stored as an interval.

    ``status`` is the visibility boundary between the two people who use this
    product: ``draft`` is the manager's working copy, ``published`` is what the
    employee is allowed to see and be paid for.
    """

    __tablename__ = "assignment"
    __table_args__ = (
        # Two shifts of the same KIND may not overlap for one person. A draft
        # is allowed to sit on top of the published rota it is about to
        # replace -- that is what a draft is for -- so ``status`` is part of
        # the key. Mirrors migration 0016.
        ExcludeConstraint(
            ("employee_id", "="),
            ("status", "="),
            ("during", "&&"),
            using="gist",
            where=text("status <> 'archived'"),
            name="assignment_no_overlap",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("employee.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    shift_template_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("shift_template.id", ondelete="SET NULL"),
        nullable=True,
    )
    during: Mapped[Any] = mapped_column(TSTZRANGE, nullable=False)
    # Needed to reconstruct PAID hours from the interval; without it the
    # employee would be shown -- and paid for -- their break.
    unpaid_break_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    status: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'draft'")
    )
    source: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'manual'")
    )
    computed_cost: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    is_overtime: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    is_premium: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
