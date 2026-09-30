from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class Employee(Base):
    __tablename__ = "employee"
    __table_args__ = (
        UniqueConstraint("org_id", "external_id", name="uq_employee_org_external"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    external_id: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    employment_status: Mapped[str] = mapped_column(String, nullable=False)
    hire_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Whether this person wants their rota by email. See `0023_notify_by_email`
    # for why it defaults to true: these are the hours they are expected at,
    # not a newsletter, and the failure of defaulting it off lands on the
    # manager who believes the team was told.
    notify_by_email: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )

    created_at: Mapped[datetime] = created_at_col()

    # When a manager removed this person from the roster. NULL means they are
    # still on it, which is why NULL is the default and why nothing had to be
    # backfilled: an organization that never removes anybody has exactly the
    # rows, and exactly the behaviour, it had before this column existed.
    #
    # The row survives the removal because the identity is referenced by
    # contracts, absences, ledger movements and published shifts, all of which
    # used to be destroyed with it (ON DELETE CASCADE) with no way back. The
    # cost of keeping it is that EVERY read of this table now has to say so:
    # see `app.services.employees.LIVE`, the single predicate they all use.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
