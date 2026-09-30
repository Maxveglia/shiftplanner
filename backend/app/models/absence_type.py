from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class AbsenceType(Base):
    __tablename__ = "absence_type"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, nullable=False)
    consumes_balance: Mapped[bool] = mapped_column(Boolean, nullable=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False)
    is_health_data: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Whether the hours excused by this kind of leave come back. Holiday does
    # not; a day swapped for a busy Saturday does, and the hours worked back
    # are ORDINARY hours rather than overtime (see services/workday.py).
    is_recoverable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    created_at: Mapped[datetime] = created_at_col()
