from __future__ import annotations

"""Create the first back-office account.

Run once after migrating:

    PLATFORM_ADMIN_EMAIL=you@example.com \\
    PLATFORM_ADMIN_PASSWORD='a long one' \\
    make backend-bootstrap-admin

Why a script and not a signup page: the back office can see every customer on
the platform. A public route that mints such an account is a single missing
check away from handing the customer base to whoever finds it, so there isn't
one. Creating an operator requires shell access to the deployment, which is
the same bar as reading the database directly -- no new attack surface.

Re-running is safe: an existing account keeps its password and is only
reactivated if it had been disabled.

ROTATING ONE. That last sentence used to leave no way back in. The password is
hashed at creation and never touched again, so changing ``PLATFORM_ADMIN_PASSWORD``
did nothing -- the variable and the account disagreed silently, every login was
refused, and the only remedy was to open a shell and rewrite the hash by hand.
An account that cannot change its password is not a security property, it is a
missing feature that turns a forgotten password into an outage.

So rotation is possible, and it is opt-in::

    PLATFORM_ADMIN_ROTATE_PASSWORD=1   # env, applied on the next boot
    python -m app.seeds.platform_admin --rotate

Opt-in and never the default, because a boot that quietly rewrote the password
on every deploy would make the env var the account's real password forever --
including the day somebody pastes the wrong value into the dashboard. It costs
one deploy and stays visible in the logs, which is the right trade for
something this account can see.
"""

import os
import sys
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import AdminSessionLocal
from app.models.platform_admin import PlatformAdmin
from app.security import hash_password

MIN_PASSWORD_LENGTH = 12


def ensure_platform_admin(
    db: Session,
    *,
    email: str,
    password: str,
    full_name: Optional[str] = None,
    rotate: bool = False,
) -> tuple[PlatformAdmin, bool]:
    """Create the operator if missing. Returns ``(admin, created)``.

    With ``rotate`` the existing account's password is replaced by the one
    given. Without it the stored password is left exactly as it was, which is
    what makes running this on every boot harmless.
    """
    email = email.strip().lower()
    existing = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.email == email)
    ).scalar_one_or_none()
    if existing is not None:
        if not existing.is_active:
            existing.is_active = True
        if rotate:
            existing.hashed_password = hash_password(password)
        return existing, False

    admin = PlatformAdmin(
        email=email,
        hashed_password=hash_password(password),
        full_name=full_name or email,
        is_active=True,
    )
    db.add(admin)
    db.flush()
    return admin, True


def _wants_rotation(argv: Optional[list[str]] = None) -> bool:
    """Whether this run should replace an existing account's password.

    Two ways in, because the two callers are different: a person at a shell
    passes ``--rotate``, and a deployment that has no shell sets the variable
    and redeploys. Anything other than an explicit truthy value is a no.
    """
    args = sys.argv[1:] if argv is None else argv
    if "--rotate" in args or "--force" in args:
        return True
    return os.environ.get("PLATFORM_ADMIN_ROTATE_PASSWORD", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def main() -> None:
    email = settings.platform_admin_email.strip()
    password = settings.platform_admin_password
    full_name = os.environ.get("PLATFORM_ADMIN_NAME", "").strip() or None
    rotate = _wants_rotation()

    if not email or not password:
        sys.exit(
            "Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD "
            "(env or backend/.env) before running this."
        )
    if len(password) < MIN_PASSWORD_LENGTH:
        sys.exit(
            "PLATFORM_ADMIN_PASSWORD must be at least %d characters. This one "
            "account can read every customer on the platform." % MIN_PASSWORD_LENGTH
        )

    db = AdminSessionLocal()
    try:
        admin, created = ensure_platform_admin(
            db, email=email, password=password, full_name=full_name, rotate=rotate
        )
        db.commit()
        if created:
            outcome = "created"
        elif rotate:
            # Said loudly, and twice: this line is the only trace a password
            # change leaves, and leaving the variable set means every future
            # deploy silently re-pins the account to whatever it holds.
            outcome = (
                "password ROTATED -- now remove PLATFORM_ADMIN_ROTATE_PASSWORD "
                "so the next deploy leaves the account alone"
            )
        else:
            outcome = "already exists (unchanged)"
        print("platform admin %s: %s" % (admin.email, outcome))
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
