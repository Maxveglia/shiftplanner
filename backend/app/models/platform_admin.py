from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class PlatformAdmin(Base):
    """Whoever runs the platform -- deliberately NOT a UserAccount.

    A UserAccount always belongs to an organization; its whole identity is
    "this person inside this tenant". A platform admin is the opposite: they
    belong to no tenant and read across all of them. Modelling them as a
    UserAccount with a magic role would mean one privilege-escalation bug in
    the tenant login path is enough to hand someone the whole customer base.

    Two consequences, both intentional:
      * this table is NOT granted to ``app_user`` in the migration, so the
        runtime role literally cannot read these password hashes;
      * their tokens carry ``scope="platform"`` and are rejected by
        ``get_current_user``, exactly as tenant tokens are rejected by
        ``get_current_platform_admin``.
    """

    __tablename__ = "platform_admin"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    hashed_password: Mapped[str] = mapped_column(String, nullable=False)
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
