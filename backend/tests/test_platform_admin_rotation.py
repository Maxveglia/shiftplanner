from __future__ import annotations

"""Getting back into the back office.

The operator account is created once by a script and then never touched, which
is the right default: running the seed on every boot must not rewrite a
password somebody is using. The cost of that default, unnoticed until it bit,
was that there was NO way to change it. Editing ``PLATFORM_ADMIN_PASSWORD``
looked like it worked and did nothing -- the variable and the stored hash
disagreed, every login was refused with "Invalid credentials", and the account
that can see every customer on the platform was locked with no route back
except hand-editing the database.

So: the default still changes nothing, and rotation is a thing you ask for.
Both halves are pinned here, because either one silently flipping is a bad day.

Skips itself without Postgres, like the other DB-backed modules.
"""

import uuid

import pytest

pytestmark = pytest.mark.filterwarnings("ignore")

FIRST_PASSWORD = "first-password-long-enough"
SECOND_PASSWORD = "second-password-long-enough"


def _db_available() -> bool:
    try:
        from sqlalchemy import text

        from app.db import app_engine

        with app_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


skip_no_db = pytest.mark.skipif(
    not _db_available(),
    reason="No Postgres reachable. Start Postgres and run `alembic upgrade head`.",
)


@pytest.fixture()
def session():
    from app.db import AdminSessionLocal

    db = AdminSessionLocal()
    try:
        yield db
    finally:
        db.rollback()
        db.close()


def _email() -> str:
    return "operator-%s@example.com" % uuid.uuid4().hex[:12]


@skip_no_db
def test_seeding_twice_leaves_the_password_alone(session):
    """The property that makes it safe to run on every boot."""
    from app.security import verify_password
    from app.seeds.platform_admin import ensure_platform_admin

    email = _email()
    admin, created = ensure_platform_admin(
        session, email=email, password=FIRST_PASSWORD
    )
    session.flush()
    assert created is True

    again, created_again = ensure_platform_admin(
        session, email=email, password=SECOND_PASSWORD
    )
    session.flush()
    assert created_again is False
    assert again.id == admin.id
    # The second password was offered and refused: this is the whole reason a
    # redeploy cannot lock anybody out.
    assert verify_password(FIRST_PASSWORD, again.hashed_password) is True
    assert verify_password(SECOND_PASSWORD, again.hashed_password) is False


@skip_no_db
def test_rotation_replaces_the_password(session):
    """And the way back in, when the first one is lost."""
    from app.security import verify_password
    from app.seeds.platform_admin import ensure_platform_admin

    email = _email()
    ensure_platform_admin(session, email=email, password=FIRST_PASSWORD)
    session.flush()

    rotated, created = ensure_platform_admin(
        session, email=email, password=SECOND_PASSWORD, rotate=True
    )
    session.flush()
    assert created is False
    assert verify_password(SECOND_PASSWORD, rotated.hashed_password) is True
    assert verify_password(FIRST_PASSWORD, rotated.hashed_password) is False


@skip_no_db
def test_rotation_also_reopens_a_disabled_account(session):
    """A locked-out operator is often a disabled one as well.

    Rotating has to leave the account usable, or the password is fixed and the
    login still fails -- which is the same outage wearing a different hat.
    """
    from app.seeds.platform_admin import ensure_platform_admin

    email = _email()
    admin, _ = ensure_platform_admin(session, email=email, password=FIRST_PASSWORD)
    session.flush()
    admin.is_active = False
    session.flush()

    rotated, _ = ensure_platform_admin(
        session, email=email, password=SECOND_PASSWORD, rotate=True
    )
    session.flush()
    assert rotated.is_active is True


# --- Choosing to rotate -----------------------------------------------------
#
# No database needed: this is the switch, not the effect. It is separated out
# because the failure that started all this was silent, and a switch that reads
# as "on" when it is off would recreate it exactly.


def test_rotation_is_off_unless_it_is_asked_for(monkeypatch):
    from app.seeds.platform_admin import _wants_rotation

    monkeypatch.delenv("PLATFORM_ADMIN_ROTATE_PASSWORD", raising=False)
    assert _wants_rotation([]) is False
    assert _wants_rotation(["--other-flag"]) is False


def test_a_flag_turns_rotation_on(monkeypatch):
    from app.seeds.platform_admin import _wants_rotation

    monkeypatch.delenv("PLATFORM_ADMIN_ROTATE_PASSWORD", raising=False)
    assert _wants_rotation(["--rotate"]) is True
    assert _wants_rotation(["--force"]) is True


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_the_environment_turns_rotation_on(monkeypatch, value):
    from app.seeds.platform_admin import _wants_rotation

    monkeypatch.setenv("PLATFORM_ADMIN_ROTATE_PASSWORD", value)
    assert _wants_rotation([]) is True


@pytest.mark.parametrize("value", ["", "0", "false", "no", "off", "maybe"])
def test_anything_else_in_the_environment_is_a_no(monkeypatch, value):
    """Including the values a person might type meaning "not now"."""
    from app.seeds.platform_admin import _wants_rotation

    monkeypatch.setenv("PLATFORM_ADMIN_ROTATE_PASSWORD", value)
    assert _wants_rotation([]) is False
