from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class UserAccount(Base):
    __tablename__ = "user_account"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    employee_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("employee.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    # Coarse "is this account still alive?" signal, refreshed at most once every
    # LAST_SEEN_REFRESH_MINUTES (see app.deps). Deliberately coarse: the back
    # office needs to tell a live customer from a dormant one, which is a
    # question about days, not about clicks. It is never used for anything the
    # tenant sees, so throttling it costs nothing.
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
    # Which generation of this login's sessions is valid (migration 0046). A
    # token carries the number it was issued under ("sv"); raising it ends
    # every session issued before, which is how the till's tablet -- whose
    # token does not expire -- is signed out when its password changes.
    session_epoch: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
