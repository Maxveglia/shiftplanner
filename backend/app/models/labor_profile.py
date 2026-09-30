from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import Date, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at_col, uuid_pk


class LaborProfile(Base):
    """Global reference data (no org_id, no RLS). Read-only at runtime."""

    __tablename__ = "labor_profile"

    id: Mapped[uuid.UUID] = uuid_pk()
    jurisdiction_code: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    parent_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = created_at_col()

    rules: Mapped[List["ComplianceRule"]] = relationship(
        "ComplianceRule",
        back_populates="profile",
        cascade="all, delete-orphan",
    )
