from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class LearnedHint(Base):
    """One thing we believe about how this organization staffs itself.

    A hint is never written by the model and never written by a single event.
    It is *derived* from ``refine_observation`` -- the corrections a manager
    actually made to a calendar we generated -- and it only becomes usable once
    the same correction has been made on ``MIN_EVIDENCE`` different days.

    Three columns exist purely so this cannot turn into superstition:

    ``evidence_days`` counts DISTINCT days on which the correction was seen,
    not events. A manager fixing one Friday with five clicks is one day of
    evidence, not five -- otherwise a single frustrated afternoon becomes a
    standing rule about their business.

    ``contradictions`` counts the times the generated calendar already matched
    the hint and the manager corrected it back the other way. Past
    ``MAX_CONTRADICTIONS`` the hint deactivates itself: what we learned stopped
    being true, and a business that changed is the normal case, not an error.

    ``rejected`` is the manager saying no directly. It is permanent and it
    outranks any amount of evidence. Re-learning something a human explicitly
    switched off would make the feature untrustworthy in the only way that
    matters.

    A hint is a proposal, not a rule. It can only fill a field the brief left
    unstated, it is tagged as coming from here everywhere it surfaces, and the
    manager can see the evidence behind it.
    """

    __tablename__ = "learned_hint"
    __table_args__ = (UniqueConstraint("org_id", "key", name="uq_learned_hint_org_key"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Stable identity of what is being claimed, e.g. "closing_staff_delta" or
    # "busy_window:5:1200-1380". Two observations of the same claim share a key
    # and therefore a row; that is what makes evidence accumulate.
    key: Mapped[str] = mapped_column(String, nullable=False)
    # The claim itself, e.g. {"delta": 2} or {"staff": 4}. JSONB because the
    # shape differs per kind of hint and none of it is queried by field.
    value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    evidence_days: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    contradictions: Mapped[int] = mapped_column(nullable=False, server_default=text("0"))
    # Guards evidence_days against being incremented twice on the same day.
    last_evidence_on: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    rejected: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
