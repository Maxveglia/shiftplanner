from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Numeric, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class Organization(Base):
    __tablename__ = "organization"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String, nullable=False)
    jurisdiction_code: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'ES-CT-HOSTELERIA'")
    )
    # Pay policy: how this org prices unsociable hours. Stored, not held in
    # a browser, because the manager's payroll view and the employee's pay
    # estimate must be arithmetic on the same numbers.
    night_differential_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default=text("15")
    )
    weekend_premium_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default=text("10")
    )
    overtime_multiplier: Mapped[Decimal] = mapped_column(
        Numeric(4, 2), nullable=False, server_default=text("1.5")
    )
    # Which folder of app/clients/ this business is served from: its apps and,
    # in time, how each is set up. NULL is a business nobody has set up yet,
    # and gets the template -- Turnos, being prepared. See
    # app/clients/__init__.py and 0034.
    client_key: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_col()
