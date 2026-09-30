from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class HandEditObservation(Base):
    """One pattern seen in how a manager retouched a calendar we proposed.

    The sibling of ``RefineObservation`` for the corrections made with the
    mouse instead of in a sentence. Written by ``services/hand_edits.py`` after
    a publish, never by a request the manager is waiting on.

    ONE ROW PER (key, job, period), whatever happens afterwards. Republishing
    the same retouched month the next morning is the same evidence, not new
    evidence, and the unique constraint is what makes that true rather than a
    convention. Belief is measured in DISTINCT ``observed_on`` days over these
    rows, exactly as ``LearnedHint.evidence_days`` is measured in days and not
    in clicks.

    No names, no pay, no absences. The key of the one person-shaped pattern
    carries a salted hash of the employee id; see the migration.
    """

    __tablename__ = "hand_edit_observation"
    __table_args__ = (
        UniqueConstraint(
            "org_id", "key", "job_id", "period_start",
            name="uq_hand_edit_observation_once",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String, nullable=False)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    observed_on: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = created_at_col()
