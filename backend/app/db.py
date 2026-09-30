from __future__ import annotations

from typing import Iterator, Optional
from uuid import UUID

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

# --- Engines -----------------------------------------------------------------
# Both connect with `timezone=utc`. Postgres returns timestamptz in the session
# timezone, so without this the SAME instant serialises as "...Z" when it was
# just built in Python and as "...-07:00" once it has been round-tripped through
# the database. Same moment, two spellings -- which is exactly the kind of thing
# a client compares as strings and gets wrong. One timezone in, one out.
# app_engine: runtime engine, connects as the RESTRICTED app_user role. RLS is
# enforced for this role (NOSUPERUSER + FORCE ROW LEVEL SECURITY).
app_engine: Engine = create_engine(
    settings.app_database_url,
    pool_pre_ping=True,
    future=True,
    connect_args={"options": "-c timezone=utc"},
)

# admin_engine: superuser engine. Used by Alembic for DDL and by the auth layer
# for the *pre-tenant* lookups (login by global-unique email, signup) that must
# read/write before an org context exists. It is never used for tenant domain
# queries at request time.
admin_engine: Engine = create_engine(
    settings.admin_database_url,
    pool_pre_ping=True,
    future=True,
    connect_args={"options": "-c timezone=utc"},
)

AppSessionLocal = sessionmaker(
    bind=app_engine, autoflush=False, autocommit=False, future=True
)
AdminSessionLocal = sessionmaker(
    bind=admin_engine, autoflush=False, autocommit=False, future=True
)


def set_current_org(db: Session, org_id: UUID) -> None:
    """Set the Postgres session variable that the RLS policies read.

    Uses ``set_config(name, value, is_local=true)`` -- the function form of
    ``SET LOCAL`` -- because Postgres' plain ``SET`` command does NOT accept
    bind parameters (``SET x = $1`` is a syntax error), whereas ``set_config``
    does. ``is_local=true`` scopes the value to the current transaction, so it
    is reset automatically on commit/rollback. This is the *real* tenant barrier.
    """
    db.execute(
        text("SELECT set_config('app.current_org_id', :org, true)"),
        {"org": str(org_id)},
    )


def get_db() -> Iterator[Session]:
    """FastAPI dependency: runtime (app_user) session with a per-request tx.

    The org context is applied later by ``get_current_user`` via
    ``set_current_org`` once the Bearer token has been decoded.
    """
    db = AppSessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_admin_db() -> Iterator[Session]:
    """FastAPI dependency: superuser session used only by the auth layer."""
    db = AdminSessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
