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
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class DayNote(Base):
    """The manager's summary of one day. One per business per day."""

    __tablename__ = "day_note"
    __table_args__ = (UniqueConstraint("org_id", "note_date"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    note_date: Mapped[date] = mapped_column(Date, nullable=False)
    body: Mapped[str] = mapped_column(String, nullable=False)
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="SET NULL"),
        nullable=True,
    )
    # The last time this note was emailed to the readers. NULL = never.
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = created_at_col()


class DayNoteReader(Base):
    """An address the day notes are shared with.

    Both channels hang off this one list: every address on it is emailed when
    the manager sends a note, and an address that is also a login in this
    business reads the notes in the app.
    """

    __tablename__ = "day_note_reader"
    __table_args__ = (UniqueConstraint("org_id", "email"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Stored lowercased, so the login match is exact.
    email: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class DayNoteInsight(Base):
    """What a small model read in one note: facts about the business, no people.

    One per note, and it goes when the note goes (ON DELETE CASCADE). Written
    only by ``services/day_insights.refresh``, in the background, after the
    note is saved. ``source_hash`` is the hash of the body that was read, so a
    reading of an older version of the note is recognisable as one.

    Every stretch of the day is ``{"start": "HH:MM", "end": "HH:MM"}``, on the
    business's own clock; ``end <= start`` means it runs past midnight.
    """

    __tablename__ = "day_note_insight"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    note_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("day_note.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    note_date: Mapped[date] = mapped_column(Date, nullable=False)
    revenue: Mapped[Optional[Decimal]] = mapped_column(Numeric(12, 2), nullable=True)
    customers: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    closed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    busy: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    quiet: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    short_staffed: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    over_staffed: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    events: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    source_hash: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    extracted_at: Mapped[datetime] = created_at_col()
