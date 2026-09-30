from __future__ import annotations

"""How many times a password may be guessed.

Both logins used to answer as fast as they were asked, forever. What these pin
is the five things that stop being true once a counter exists, and one of them
is not about counting at all:

1. Five wrong passwords and the sixth attempt is refused EVEN IF IT IS RIGHT.
   That last clause is the whole test -- a limiter that lets the correct
   password through is a limiter an attacker walks past on the guess that
   matters.
2. The window passes and the door opens again. A lockout with no way out is an
   outage waiting for a support ticket nobody can answer.
3. A password that works wipes the slate, so a forgetful morning does not cost
   somebody their afternoon.
4. The back office behaves exactly like the tenant login, and on its own
   counter. It is the door with every customer behind it.
5. An email nobody has ever registered is refused in exactly the same words at
   exactly the same point. A 429 that only ever happened to real addresses
   would be an oracle for which addresses are real. HOW LONG that refusal
   takes is the other half of the same question, and it is pinned next door in
   `test_login_timing.py`.

TIME, AND HOW IT IS MOVED. `login_guard._now` is the one clock the whole
feature reads -- the database rows are stamped from it, the window is measured
from it and the cached deadlines are compared against it -- so monkeypatching
it is the same thing to every layer as fifteen minutes passing, and nothing
here sleeps.

ADDRESSES. Each test knocks from its own `X-Forwarded-For`, because the IP is a
second counter with a threshold of its own and tests that shared one would
start failing each other once they had sprayed thirty names between them. The
guard reads that header exactly as uvicorn does in production (see
`docker-entrypoint.sh`), which is what makes it settable here at all.

Skips itself without Postgres, like the other DB-backed modules.
"""

import itertools
from concurrent.futures import ThreadPoolExecutor
import uuid
from datetime import timedelta

import pytest

from app.services import login_guard

pytestmark = pytest.mark.filterwarnings("ignore")

PASSWORD = "s3cret-pass-long-enough"
WRONG = "not-the-password"
ADMIN_PASSWORD = "back-office-test-password"

TENANT_LOGIN = "/api/v1/auth/login"
PLATFORM_LOGIN = "/api/v1/backoffice/login"


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
    """Start every test with the process cache empty.

    Not to make anything pass -- the keys are unique per test -- but because a
    test that only passes with a warm cache and a test that only passes with a
    cold one are both telling us something, and they should not be able to hide
    behind whatever the previous test left behind.
    """
    login_guard.drop_cache()
    yield
    login_guard.drop_cache()


_addresses = itertools.count(1)


def _ip() -> str:
    """A caller's own address, out of the documentation range (RFC 5737)."""
    n = next(_addresses)
    return "198.51.100.%d" % (n % 250 + 1)


def _knock(client, path: str, email: str, password: str, ip: str):
    return client.post(
        path,
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )


def _manager(client) -> str:
    """A real account to knock on, and its email."""
    email = "owner+%s@example.com" % uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Rate Co %s" % uuid.uuid4().hex[:6],
            "email": email,
            "password": PASSWORD,
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    return email


def _operator() -> str:
    """A platform admin, made the only way one can be made: by the seed."""
    from app.db import AdminSessionLocal
    from app.seeds.platform_admin import ensure_platform_admin

    email = "operator+%s@example.com" % uuid.uuid4().hex[:8]
    db = AdminSessionLocal()
    try:
        ensure_platform_admin(
            db, email=email, password=ADMIN_PASSWORD, full_name="Test Operator"
        )
        db.commit()
    finally:
        db.close()
    return email


def _code(resp) -> str:
    return resp.json()["detail"]["code"]


def _at(monkeypatch, offset: timedelta):
    """Freeze the feature's clock `offset` from now."""
    from datetime import datetime, timezone

    frozen = datetime.now(timezone.utc) + offset
    monkeypatch.setattr(login_guard, "_now", lambda: frozen)
    return frozen


# --- The barrier ------------------------------------------------------------


@skip_no_db
def test_the_sixth_attempt_is_refused_even_with_the_right_password(client):
    """The one that matters. Anything less is a speed bump with a door in it."""
    email, ip = _manager(client), _ip()

    for _ in range(login_guard.MAX_FAILURES):
        refused = _knock(client, TENANT_LOGIN, email, WRONG, ip)
        assert refused.status_code == 401, refused.text
        assert _code(refused) == "invalid_credentials"

    shut = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert shut.status_code == 429, shut.text
    assert _code(shut) == "too_many_attempts"
    # The client is told when to come back, in the header everyone reads and in
    # the params the browser writes its sentence from.
    assert 1 <= int(shut.headers["Retry-After"]) <= 60
    assert shut.json()["detail"]["params"]["minutes"] == 1


@skip_no_db
def test_postgres_is_the_one_holding_the_door(client):
    """Drop the in-process cache -- a redeploy does exactly this -- and knock.

    This is the difference between the counter this feature has and the counter
    it would have had in a dictionary: `main` is the deploy here and it ships
    several times a day, so a limit that a restart forgets is a limit of five
    guesses per deploy.
    """
    email, ip = _manager(client), _ip()
    for _ in range(login_guard.MAX_FAILURES):
        assert _knock(client, TENANT_LOGIN, email, WRONG, ip).status_code == 401

    login_guard.drop_cache()

    shut = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert shut.status_code == 429, shut.text
    assert _code(shut) == "too_many_attempts"


@skip_no_db
def test_the_window_passes_and_the_door_opens(client, monkeypatch):
    email, ip = _manager(client), _ip()
    for _ in range(login_guard.MAX_FAILURES):
        assert _knock(client, TENANT_LOGIN, email, WRONG, ip).status_code == 401
    assert _knock(client, TENANT_LOGIN, email, PASSWORD, ip).status_code == 429

    _at(monkeypatch, login_guard.WINDOW + timedelta(minutes=1))

    opened = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert opened.status_code == 200, opened.text
    assert opened.json()["user"]["email"] == email


@skip_no_db
def test_each_further_failure_doubles_the_wait(client, monkeypatch):
    """A minute, then two. The doubling is what a list of passwords runs into.

    Note what has to happen for the sixth failure to be RECORDED: the lock has
    to have expired first, because a knock at a shut door is refused without
    being written down. So the escalation is one guess per lock, and the lock
    doubling under it.
    """
    email, ip = _manager(client), _ip()
    for _ in range(login_guard.MAX_FAILURES):
        assert _knock(client, TENANT_LOGIN, email, WRONG, ip).status_code == 401

    first = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert int(first.headers["Retry-After"]) <= 60

    # A minute later the door is open again -- for exactly one more guess.
    _at(monkeypatch, timedelta(seconds=61))
    assert _knock(client, TENANT_LOGIN, email, WRONG, ip).status_code == 401

    second = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert second.status_code == 429
    assert int(second.headers["Retry-After"]) == 120
    assert second.json()["detail"]["params"]["minutes"] == 2


@skip_no_db
def test_a_password_that_works_wipes_the_slate(client):
    """Four bad mornings must not add up to a locked afternoon."""
    email, ip = _manager(client), _ip()

    for _ in range(login_guard.MAX_FAILURES - 1):
        assert _knock(client, TENANT_LOGIN, email, WRONG, ip).status_code == 401
    assert _knock(client, TENANT_LOGIN, email, PASSWORD, ip).status_code == 200

    # Four more. Without the wipe this is eight failures and the door is shut.
    for _ in range(login_guard.MAX_FAILURES - 1):
        assert _knock(client, TENANT_LOGIN, email, WRONG, ip).status_code == 401
    assert _knock(client, TENANT_LOGIN, email, PASSWORD, ip).status_code == 200


# --- Telling nobody anything ------------------------------------------------


@skip_no_db
def test_an_email_nobody_has_is_refused_exactly_like_one_we_have(client):
    """The 429 must not be an oracle for which addresses have accounts."""
    known, unknown = _manager(client), "ghost+%s@example.com" % uuid.uuid4().hex[:8]

    def _sequence(email: str) -> list:
        ip = _ip()
        out = []
        for _ in range(login_guard.MAX_FAILURES + 1):
            resp = _knock(client, TENANT_LOGIN, email, WRONG, ip)
            out.append((resp.status_code, _code(resp)))
        return out

    # Each name is knocked on ONCE: a second pass would start where the first
    # left off and compare a locked door with a fresh one.
    real, invented = _sequence(known), _sequence(unknown)
    assert real == invented
    assert invented[-1] == (429, "too_many_attempts")


@skip_no_db
def test_the_case_of_the_address_is_not_a_way_round_it(client):
    """"ANA@x.com" and "ana@x.com" are one door, so they are one counter."""
    email, ip = _manager(client), _ip()
    for _ in range(login_guard.MAX_FAILURES):
        assert _knock(client, TENANT_LOGIN, email.upper(), WRONG, ip).status_code == 401

    shut = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert shut.status_code == 429, shut.text


# --- The other door ---------------------------------------------------------


@skip_no_db
def test_the_back_office_shuts_the_same_way(client):
    """The account that reads and deletes every customer on the platform."""
    email, ip = _operator(), _ip()

    for _ in range(login_guard.MAX_FAILURES):
        refused = _knock(client, PLATFORM_LOGIN, email, WRONG, ip)
        assert refused.status_code == 401, refused.text

    shut = _knock(client, PLATFORM_LOGIN, email, ADMIN_PASSWORD, ip)
    assert shut.status_code == 429, shut.text
    assert _code(shut) == "too_many_attempts"


@skip_no_db
def test_the_back_office_reopens_and_a_good_password_wipes_its_slate(
    client, monkeypatch
):
    email, ip = _operator(), _ip()
    for _ in range(login_guard.MAX_FAILURES):
        assert _knock(client, PLATFORM_LOGIN, email, WRONG, ip).status_code == 401
    assert _knock(client, PLATFORM_LOGIN, email, ADMIN_PASSWORD, ip).status_code == 429

    _at(monkeypatch, login_guard.WINDOW + timedelta(minutes=1))
    assert _knock(client, PLATFORM_LOGIN, email, ADMIN_PASSWORD, ip).status_code == 200

    # And the slate really was wiped, not merely aged out from under us: five
    # more failures are needed before it shuts again, not one.
    for _ in range(login_guard.MAX_FAILURES - 1):
        assert _knock(client, PLATFORM_LOGIN, email, WRONG, ip).status_code == 401
    assert _knock(client, PLATFORM_LOGIN, email, ADMIN_PASSWORD, ip).status_code == 200


@skip_no_db
def test_the_two_doors_do_not_share_a_counter(client):
    """An operator and a manager may use the same address. They are not one account."""
    email, ip = _operator(), _ip()
    for _ in range(login_guard.MAX_FAILURES):
        assert _knock(client, PLATFORM_LOGIN, email, WRONG, ip).status_code == 401
    assert _knock(client, PLATFORM_LOGIN, email, ADMIN_PASSWORD, ip).status_code == 429

    # The same name at the tenant door is still just a wrong password.
    other = _knock(client, TENANT_LOGIN, email, WRONG, ip)
    assert other.status_code == 401
    assert _code(other) == "invalid_credentials"


# --- The second signal ------------------------------------------------------


@skip_no_db
def test_a_chosen_address_cannot_lock_anybody_out(client):
    """The IP decides nothing, and this is the reason why.

    An earlier version counted it too, with a threshold six times looser, and
    said in its own docstring that it could never shut a door on its own. It
    could: thirty failures on invented names, all carrying the same chosen
    ``X-Forwarded-For``, and the real owner of that address was refused with
    the right password in hand. Since the header arrives from the internet and
    anybody may write anything in it, that is a denial of service you could aim
    at a restaurant's router from the other side of the world -- handed to the
    attacker by the defence. It also bought nothing, because the sprayer it was
    meant to slow down is precisely the one who rewrites the header.

    So: spray all you like from one address. The person behind it still works.
    """
    ip = _ip()

    def _a_name_nobody_has() -> str:
        return "spray+%s@example.com" % uuid.uuid4().hex[:8]

    for _ in range(login_guard.MAX_FAILURES * 6):
        resp = _knock(client, TENANT_LOGIN, _a_name_nobody_has(), WRONG, ip)
        assert resp.status_code == 401, resp.text

    email = _manager(client)
    opened = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert opened.status_code == 200, opened.text


@skip_no_db
def test_hammering_a_shut_door_does_not_lengthen_the_lock(client):
    """Whoever knows your address may shut you out for fifteen minutes, not forever.

    The wait is measured from the last attempt that counted, so an attempt that
    counted while the door was already shut would push the reopening further
    out every time -- and the cost of the policy, already said out loud in the
    module, would stop being bounded. A refusal therefore writes nothing.
    """
    email, ip = _manager(client), _ip()
    for _ in range(login_guard.MAX_FAILURES):
        assert _knock(client, TENANT_LOGIN, email, WRONG, ip).status_code == 401

    first = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert first.status_code == 429
    reopens_at = first.json()["detail"]["params"]["minutes"]

    login_guard.drop_cache()
    for _ in range(5):
        assert _knock(client, TENANT_LOGIN, email, WRONG, ip).status_code == 429
    login_guard.drop_cache()

    again = _knock(client, TENANT_LOGIN, email, PASSWORD, ip)
    assert again.status_code == 429
    assert again.json()["detail"]["params"]["minutes"] <= reopens_at


@skip_no_db
def test_a_different_address_knocking_on_the_same_name_is_still_stopped(client):
    """Rotating the header must not buy a fresh budget, or none of this matters.

    ``--forwarded-allow-ips='*'`` means this value arrives from the internet and
    anybody may write anything in it. That is precisely why the barrier counts
    the email, which an attacker after a particular account cannot vary.
    """
    email = _manager(client)
    for _ in range(login_guard.MAX_FAILURES):
        assert _knock(client, TENANT_LOGIN, email, WRONG, _ip()).status_code == 401

    shut = _knock(client, TENANT_LOGIN, email, PASSWORD, _ip())
    assert shut.status_code == 429, shut.text


# --- Who can read it --------------------------------------------------------


@skip_no_db
def test_the_runtime_role_cannot_read_who_has_been_knocking():
    """`app_user` has no privilege on this table at all, and that is checked.

    Not tidiness: a list of addresses somebody has been trying is a list of
    addresses worth trying, and this table is written from the superuser
    session before any tenant exists. It is also the reason the migration
    spells out a REVOKE instead of merely not writing a GRANT -- the default
    privileges in `infra/initdb/01-app-role.sql` hand every new table to
    `app_user` on the way in, so "we did not grant it" is not the same
    sentence in every environment. This assertion is what makes it one.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import ProgrammingError

    from app.db import app_engine

    with app_engine.connect() as conn:
        with pytest.raises(ProgrammingError, match="permission denied"):
            conn.execute(text("SELECT count(*) FROM login_attempt"))


# --- The policy itself, with no database in the way -------------------------


def test_the_wait_doubles_and_then_stops_doubling():
    """1, 2, 4, 8, 15, 15, 15 -- minutes, capped where the window is."""
    from datetime import datetime, timezone

    last = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
    waits = [
        login_guard._locked_until(n, last, login_guard.MAX_FAILURES)
        for n in range(login_guard.MAX_FAILURES, login_guard.MAX_FAILURES + 7)
    ]
    minutes = [int((w - last).total_seconds() // 60) for w in waits]
    assert minutes == [1, 2, 4, 8, 15, 15, 15]


def test_under_the_threshold_the_door_is_not_shut():
    from datetime import datetime, timezone

    last = datetime(2026, 9, 19, 12, 0, tzinfo=timezone.utc)
    for n in range(login_guard.MAX_FAILURES):
        assert login_guard._locked_until(n, last, login_guard.MAX_FAILURES) is None
    # And nothing to measure from is nothing to lock.
    assert login_guard._locked_until(99, None, login_guard.MAX_FAILURES) is None


@skip_no_db
def test_a_burst_sent_all_at_once_does_not_buy_extra_guesses(client):
    """The failure this whole design turns on: counting is not the same as holding.

    The first version read the counter, gave the route its turn to check a
    password, and wrote the failure down afterwards. Nothing held the place in
    between, so requests that arrive TOGETHER all read the same zero and all go
    through. Measured against that version with twenty-four concurrent knocks:
    fifteen passwords evaluated where the policy says five, and the multiplier
    is the server's own concurrency, so production would be worse. An attacker
    does not send one guess at a time -- they send fifty and wait out the lock.

    Five is the budget. Sending them at once must not raise it.
    """
    email, ip = _manager(client), _ip()
    attempts = 24

    with ThreadPoolExecutor(max_workers=attempts) as pool:
        codes = [
            future.result().status_code
            for future in [
                pool.submit(_knock, client, TENANT_LOGIN, email, WRONG, ip)
                for _ in range(attempts)
            ]
        ]

    evaluated = codes.count(401)
    assert evaluated <= login_guard.MAX_FAILURES, codes
    assert codes.count(429) == attempts - evaluated, codes
