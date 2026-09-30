from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class ShiftTemplate(Base):
    __tablename__ = "shift_template"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    # Which of OUR default templates this row started life as -- 'morning',
    # 'evening', 'night' -- or NULL for one a manager created. The client turns
    # a seed key into a word in the language it is speaking; a customer's own
    # template has no key and is always shown exactly as it was written.
    seed_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    unpaid_break_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    color: Mapped[str] = mapped_column(String, nullable=False)
    is_night: Mapped[bool] = mapped_column(Boolean, nullable=False)
    is_weekend_premium: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
