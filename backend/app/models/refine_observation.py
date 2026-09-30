from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class RefineObservation(Base):
    """One correction a manager made to a calendar we generated.

    The evidence trail. Hints are derived from these rows and can be recomputed
    from them, which is the difference between a system that can explain why it
    believes something and one that just believes it.

    Only the operations the client actually APPLIED are recorded -- an
    operation the client refused (it broke availability, or an onboarding
    limit) says nothing about the business, so counting it would teach us from
    something that never happened.

    What is deliberately NOT here: employee names, pay, absence reasons. The
    row keeps the shape of the correction ("one more person, Fridays,
    20:00-23:00"), never who it was about. A learned preference about a
    business must not become a record about a person.
    """

    __tablename__ = "refine_observation"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    op: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
