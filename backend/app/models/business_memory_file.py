from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class BusinessMemoryFile(Base):
    """One file of the planner's notebook about one business.

    The storage behind the API's memory tool; see migration 0027 and
    ``services/planner_notes.py``. Written only by the background task that
    runs after a publish, and by the manager deleting a note. People appear in
    ``content`` as markers holding their employee id, never by name.
    """

    __tablename__ = "business_memory_file"
    __table_args__ = (
        UniqueConstraint("org_id", "path", name="uq_business_memory_file_path"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    path: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
