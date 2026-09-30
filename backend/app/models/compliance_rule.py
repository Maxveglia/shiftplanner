from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Optional

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, uuid_pk


class ComplianceRule(Base):
    """Global reference data (no org_id, no RLS). Read-only at runtime."""

    __tablename__ = "compliance_rule"

    id: Mapped[uuid.UUID] = uuid_pk()
    profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("labor_profile.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    rule_type: Mapped[str] = mapped_column(String, nullable=False)
    threshold: Mapped[Optional[Decimal]] = mapped_column(Numeric(8, 2), nullable=True)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    reference_window: Mapped[str] = mapped_column(String, nullable=False)
    computation_method: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    hardness: Mapped[str] = mapped_column(String, nullable=False)
    premium_multiplier: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(4, 2), nullable=True
    )
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    profile: Mapped["LaborProfile"] = relationship(
        "LaborProfile", back_populates="rules"
    )
