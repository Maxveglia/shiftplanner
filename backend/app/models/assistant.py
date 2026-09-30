from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class AssistantMemoryStore(Base):
    """Which Anthropic memory store is this organisation's. One or none.

    See migration 0028 and ``services/assistant.py``. The org is the primary
    key, so a second store for one business cannot be inserted -- the race
    between two first conversations is settled here, not by timing.
    """

    __tablename__ = "assistant_memory_store"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        primary_key=True,
    )
    store_id: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = created_at_col()


class AssistantSession(Base):
    """One conversation: an Anthropic session, bound to an org and a user.

    Holds no words. The transcript lives at Anthropic under
    ``anthropic_session_id`` and only ever contains pseudonyms.
    """

    __tablename__ = "assistant_session"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_account.id", ondelete="CASCADE"),
        nullable=False,
    )
    anthropic_session_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    model: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    busy_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    turns: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), default=0)
    input_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"), default=0)
    output_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("0"), default=0)
    cache_read_input_tokens: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    cache_creation_input_tokens: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
