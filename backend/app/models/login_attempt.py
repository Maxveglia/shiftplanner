from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class LoginAttempt(Base):
    """One password that was refused, so the next one can be refused sooner.

    Until this table existed, a password was the only thing between a stranger
    and an account, and it could be guessed as fast as the network allowed --
    forever, with no counter anywhere. The back-office login was the same door
    with the whole customer base behind it.

    WHY A ROW PER FAILURE rather than a counter column on the account. A
    counter has to live somewhere, and the somewhere is the account -- which
    does not exist for an email nobody ever registered. Counting only the
    emails we recognise would mean a 429 says "this address is real", which is
    precisely the thing a login must never say. A separate table counts
    knocking, not accounts, so an invented address is rate-limited exactly like
    a genuine one and the answer is the same either way.

    NOT TENANT DATA. There is no ``org_id`` here and there is no row-level
    security on it, deliberately: a login happens BEFORE anyone knows which
    organization is being logged into -- both routes run on the superuser
    session for that reason (``get_admin_db``) -- so an org-scoped policy would
    have nothing to read and would match nothing at all. It is not granted to
    ``app_user`` either, for the same reason ``platform_admin`` is not: the
    runtime role has no business reading a list of who has been trying to get
    in, and the absence of a GRANT is the whole barrier against a bug in the
    tenant API that goes looking.

    ``identifier`` is the email, trimmed and lowercased, because "Ana@x.com"
    and "ana@x.com" are one door and counting them apart would be a bypass
    written in capital letters. ``ip`` is written down for a person to read
    and decides nothing at all -- see ``services/login_guard.py`` for why a
    value the sender chooses is not allowed to refuse anybody.

    Rows are deleted as they age past the window (every failure prunes), so
    this table is a sliding fifteen minutes of history and not a log. Nothing
    here is evidence and nothing here is kept: no password, no user agent, no
    account id -- just that somebody knocked on this name, from roughly there,
    at that moment.
    """

    __tablename__ = "login_attempt"

    id: Mapped[uuid.UUID] = uuid_pk()
    # Which front door: "tenant" (a manager or an employee) or "platform" (the
    # operator's back office). Kept apart so that hammering one never closes
    # the other -- they are different accounts that happen to share an address.
    scope: Mapped[str] = mapped_column(String, nullable=False)
    identifier: Mapped[str] = mapped_column(String, nullable=False)
    ip: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_col()
