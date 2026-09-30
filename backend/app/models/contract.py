from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class Contract(Base):
    __tablename__ = "contract"
    __table_args__ = (
        # Only a single OPEN contract (valid_to IS NULL) per employee.
        Index(
            "uq_one_open_contract_per_employee",
            "employee_id",
            unique=True,
            postgresql_where=text("valid_to IS NULL"),
        ),
        CheckConstraint(
            "night_premium_basis IS NULL "
            "OR night_premium_basis = 'included_in_salary'",
            name="ck_contract_night_premium_basis",
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("employee.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    employment_type: Mapped[str] = mapped_column(String, nullable=False)
    base_annual_salary: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(12, 2), nullable=True
    )
    hourly_rate: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )
    min_hours_per_week: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    max_hours_per_week: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(6, 2), nullable=True
    )
    # The share of the contracted hours agreed IN WRITING as complementary
    # hours (art. 12.5 ET). Only meaningful on a part-time contract, where it
    # is the difference between hours that may be required and hours that may
    # not: NULL is no pact, and no pact means not one complementary hour is
    # owed. Versioned with the contract because it is agreed with it, and
    # because a pact signed in March does not reach back over February.
    complementary_pct: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 4), nullable=True
    )
    # This person's own premiums. NULL on each means "the same as the
    # business" (organization.night_differential_pct and friends); a value,
    # 0 included, overrides it for this person only. Versioned with the
    # contract because "a Juan no le pago la nocturnidad" is a term of Juan's
    # agreement, not a setting of the business.
    night_premium_pct: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )
    weekend_premium_pct: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )
    # Never below 1: an extra hour is not paid for less than an ordinary one
    # (art. 35.1 ET). The API enforces the range.
    overtime_multiplier: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(4, 2), nullable=True
    )
    # Why a night premium may be 0 or below the agreement: art. 36.2 ET allows
    # it only when the salary was set with night work priced in. The reason is
    # recorded because it is what makes the 0 lawful. NULL or
    # 'included_in_salary'.
    night_premium_basis: Mapped[Optional[str]] = mapped_column(
        String, nullable=True
    )
    # How often this person is paid. Part of the agreement, so it is
    # versioned with the contract rather than living on the employee.
    pay_period: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'monthly'")
    )
    valid_from: Mapped[date] = mapped_column(Date, nullable=False)
    valid_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = created_at_col()
