from __future__ import annotations

"""What the clock tells a stranger that the answer does not.

Both logins refuse an unknown address and a real address with the wrong
password in exactly the same words -- the same 401, the same
``invalid_credentials`` -- and since the rate limiter is counted before the
lookup, the 429 says nothing either (see ``test_login_rate_limit``). The
answers still arrived at different times. A real address cost a bcrypt
verification, a sixth of a second on this laptop; an invented one was refused
the moment a SELECT came back empty, in a couple of milliseconds. Two orders of
magnitude, visible over the network, and enough to sort a leaked address list
into "has an account here" and "does not" without guessing a single password.
For ``/backoffice/login`` the address sorted that way is the one account that
reads and deletes every customer on the platform.

WHAT IS MEASURED. Both doors, both arms INTERLEAVED: stranger, customer,
stranger, customer. The interleaving matters more than the number of
repetitions. A laptop that starts indexing halfway through a run slows down
whatever happens to be running at that moment, and a test that timed all the
strangers first and all the customers afterwards would read that drift as a
leak -- or hide a real one behind it.

THE BUDGET, and why it is written in bcrypt rather than in milliseconds. The
thing being hidden is one password verification, so that is the honest unit:
the test measures what one verification costs on the machine it is running on
right now and allows the two medians to differ by a quarter of it. A machine
four times faster or slower than this one moves both numbers together and the
test means the same thing. Before the fix the gap was one whole verification --
four times the budget -- so nothing about a loaded machine can make this pass
by accident, and nothing about a loaded machine can make it fail either: the
medians are taken over interleaved samples, so load has to prefer one arm over
the other, consistently, for half a run, to show up at all.

The budget has a floor of 15 ms for the case of a machine where bcrypt is
unusually cheap. Below that the noise of an HTTP round trip through TestClient
and two Postgres queries is bigger than a quarter of the thing being measured,
and a threshold under the noise floor is a test that fails for reasons that
have nothing to do with passwords. A timing test with false positives is worse
than no timing test: it gets marked flaky, then skipped, then deleted.

Skips itself without Postgres, like the other DB-backed modules.
"""

import itertools
import statistics
import time
import uuid

import pytest

from app.services import login_guard

pytestmark = pytest.mark.filterwarnings("ignore")

PASSWORD = "s3cret-pass-long-enough"
WRONG = "not-the-password"
ADMIN_PASSWORD = "back-office-test-password"

TENANT_LOGIN = "/api/v1/auth/login"
PLATFORM_LOGIN = "/api/v1/backoffice/login"

#: Timed knocks per arm. Odd, so the median is a number that was actually
#: measured and not the mean of the two in the middle.
ROUNDS = 15

#: Knocks thrown away before the clock is believed. The first request through
#: TestClient pays for lazy imports, the connection pool and Postgres planning
#: statements it will never plan again.
WARMUP = 2


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
    reason=(
        "No Postgres reachable. Start Postgres, run `alembic upgrade head`, "
        "then re-run. See module docstring."
    ),
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _fresh_cache():
    login_guard.drop_cache()
    yield
    login_guard.drop_cache()


_addresses = itertools.count(1)


def _ip() -> str:
    """A caller's own address, out of the documentation range (RFC 5737)."""
    n = next(_addresses)
    return "203.0.113.%d" % (n % 250 + 1)


def _knock(client, path: str, email: str, password: str, ip: str):
    return client.post(
        path,
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )


def _a_name_nobody_has() -> str:
    return "ghost+%s@example.com" % uuid.uuid4().hex[:8]


def _tenant_doors(client, n: int) -> list:
    """`n` manager accounts that exist, each with its own address.

    One address per measurement, never two knocks on the same one: five
    failures shut a door and a 429 is not what is being timed here.

    Only the first account goes through signup, which is the one path that
    builds an organization properly. The rest are copies of its row with a
    different address and the SAME hash, so each costs exactly one bcrypt
    verification and the fixture does not spend half a minute seeding orgs.
    """
    from sqlalchemy import select

    from app.db import AdminSessionLocal
    from app.models.user_account import UserAccount

    first = "timing+%s@example.com" % uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Timing Co %s" % uuid.uuid4().hex[:6],
            "email": first,
            "password": PASSWORD,
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text

    emails = [first]
    db = AdminSessionLocal()
    try:
        row = db.execute(
            select(UserAccount).where(UserAccount.email == first)
        ).scalar_one()
        for _ in range(n - 1):
            clone = "timing+%s@example.com" % uuid.uuid4().hex[:8]
            db.add(
                UserAccount(
                    org_id=row.org_id,
                    email=clone,
                    hashed_password=row.hashed_password,
                    full_name="Owner",
                    role="manager",
                    is_active=True,
                )
            )
            emails.append(clone)
        db.commit()
    finally:
        db.close()
    return emails


def _platform_doors(n: int) -> list:
    """`n` platform admins, the first made the only way one can be made."""
    from app.db import AdminSessionLocal
    from app.models.platform_admin import PlatformAdmin
    from app.seeds.platform_admin import ensure_platform_admin

    first = "operator+%s@example.com" % uuid.uuid4().hex[:8]
    emails = [first]
    db = AdminSessionLocal()
    try:
        admin, _ = ensure_platform_admin(
            db, email=first, password=ADMIN_PASSWORD, full_name="Test Operator"
        )
        db.flush()
        for _ in range(n - 1):
            clone = "operator+%s@example.com" % uuid.uuid4().hex[:8]
            db.add(
                PlatformAdmin(
                    email=clone,
                    hashed_password=admin.hashed_password,
                    full_name="Test Operator",
                    is_active=True,
                )
            )
            emails.append(clone)
        db.commit()
    finally:
        db.close()
    return emails


def _one_verification() -> float:
    """What a single bcrypt verification costs on this machine, right now."""
    from app.security import hash_password, verify_password

    hashed = hash_password(PASSWORD)
    samples = []
    for _ in range(5):
        started = time.perf_counter()
        verify_password(WRONG, hashed)
        samples.append(time.perf_counter() - started)
    return statistics.median(samples)


# --- The clock --------------------------------------------------------------


@skip_no_db
@pytest.mark.parametrize(
    "door", [TENANT_LOGIN, PLATFORM_LOGIN], ids=["tenant", "back-office"]
)
def test_a_name_nobody_has_is_refused_as_slowly_as_one_we_have(client, door):
    """How long the refusal takes must not say whether the account exists."""
    total = ROUNDS + WARMUP
    known = (
        _tenant_doors(client, total)
        if door == TENANT_LOGIN
        else _platform_doors(total)
    )
    unknown = [_a_name_nobody_has() for _ in range(total)]

    ip = _ip()
    strangers: list = []
    customers: list = []
    for i in range(total):
        for bucket, email in ((strangers, unknown[i]), (customers, known[i])):
            started = time.perf_counter()
            resp = _knock(client, door, email, WRONG, ip)
            elapsed = time.perf_counter() - started
            assert resp.status_code == 401, resp.text
            assert resp.json()["detail"]["code"] == "invalid_credentials"
            if i >= WARMUP:
                bucket.append(elapsed)

    stranger = statistics.median(strangers)
    customer = statistics.median(customers)
    verification = _one_verification()
    budget = max(0.25 * verification, 0.015)
    report = (
        "unknown email %.1f ms, known email %.1f ms, gap %.1f ms, "
        "budget %.1f ms, one bcrypt %.1f ms"
        % (
            stranger * 1000,
            customer * 1000,
            abs(stranger - customer) * 1000,
            budget * 1000,
            verification * 1000,
        )
    )

    # Neither arm may be cheap: a "fix" that stopped hashing, or dropped the
    # cost factor, would even the two times out by making both of them an
    # oracle for nothing and the password store weak for everybody.
    assert min(stranger, customer) > 0.5 * verification, report
    assert abs(stranger - customer) < budget, report
