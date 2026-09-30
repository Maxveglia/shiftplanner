from __future__ import annotations

"""What a stranger with curl may post, and what happens when they post more.

Everything a client sends used to be unbounded: `str` with no length in the
schemas, `String` with no length in the columns (which is TEXT in Postgres),
`List[...]` with no ceiling, and no limit at all on the body itself. Three
different bills followed from that -- tokens for the text that goes to
Anthropic, rows for the lists that become inserts, and memory for the request
FastAPI reads whole before a validator has run.

The limits are in ``app/schemas/limits.py`` and ``app/body_limit.py``; this
file is here so that removing one of them turns something red. Each test names
the bill it is about, because a number with no reason attached is the first
thing a later refactor rounds off.

The middleware half needs no database: it is wrapped around an application of
two routes and exercised directly, which is also the only way to send a
chunked body that no dependency has to authorise first.
"""

import json
import uuid

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.body_limit import (
    MAX_BODY_BYTES,
    MAX_SHIFT_BODY_BYTES,
    BodySizeLimitMiddleware,
    SHIFT_PATHS,
)

pytestmark = pytest.mark.filterwarnings("ignore")


# --------------------------------------------------------------------------
# The envelope: a body too big is refused before it is understood.
# --------------------------------------------------------------------------


def _echo_app() -> TestClient:
    """An application that does nothing but read its body.

    Reading is the point: the chunked path counts bytes as the application
    takes them, so an endpoint that never asks for its body would never trip
    the counter no matter how much arrived.
    """
    app = FastAPI()

    @app.post("/api/v1/anything")
    async def anything(request: Request) -> dict:
        return {"read": len(await request.body())}

    @app.post(SHIFT_PATHS[0])
    async def publish(request: Request) -> dict:
        return {"read": len(await request.body())}

    app.add_middleware(BodySizeLimitMiddleware)
    return TestClient(app)


def test_a_body_that_declares_itself_too_big_is_refused_unread():
    """The cheap half: Content-Length is believed, and nothing is allocated."""
    client = _echo_app()
    resp = client.post("/api/v1/anything", content=b"x" * (MAX_BODY_BYTES + 1))
    assert resp.status_code == 413


def test_the_refusal_carries_a_code_the_browser_can_translate():
    """413 is a wall a manager can walk into, so it has to say so in Spanish.

    Which in this product means a code, not a sentence -- see app/errors.py.
    """
    resp = _echo_app().post("/api/v1/anything", content=b"x" * (MAX_BODY_BYTES + 1))
    assert resp.json()["detail"]["code"] == "request_too_large"
    assert resp.json()["detail"]["params"]["limit"] == MAX_BODY_BYTES


def test_a_chunked_body_is_counted_as_it_arrives():
    """Transfer-Encoding: chunked announces no size at all.

    Trusting Content-Length alone would leave a hole the shape of one curl
    flag, so the bytes are counted on the way in and the request is cut off
    the moment the count goes past.
    """

    def chunks():
        sent = 0
        while sent <= MAX_BODY_BYTES:
            block = b"x" * 64_000
            sent += len(block)
            yield block

    resp = _echo_app().post("/api/v1/anything", content=chunks())
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "request_too_large"


def test_an_ordinary_body_passes_through_untouched():
    """A guard on the guard: a middleware that refused everything would pass
    every test above."""
    client = _echo_app()
    resp = client.post("/api/v1/anything", content=b"x" * 10_000)
    assert resp.status_code == 200
    assert resp.json()["read"] == 10_000


def test_publishing_a_month_of_shifts_gets_the_bigger_envelope():
    """A month of a 50-person roster does not fit in a megabyte.

    One shift is about 290 bytes of JSON and ``PublishIn.shifts`` allows 5,000
    of them (50 x 31 x 3), which is 1.4 MB. If publish shared the default
    ceiling, the list cap would be a number nobody could reach and a real site
    running split shifts -- some 3,100 shifts in a month -- would be refused.
    """
    assert MAX_SHIFT_BODY_BYTES > 5_000 * 290
    client = _echo_app()
    resp = client.post(SHIFT_PATHS[0], content=b"x" * (MAX_BODY_BYTES + 1))
    assert resp.status_code == 200


# --------------------------------------------------------------------------
# The schemas: a field too long, a list too long.
# --------------------------------------------------------------------------


def _db_available() -> bool:
    try:
        from sqlalchemy import text

        from app.db import app_engine

        with app_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


DB_AVAILABLE = _db_available()

skip_no_db = pytest.mark.skipif(
    not DB_AVAILABLE,
    reason=(
        "No Postgres reachable. Start Postgres, run `alembic upgrade head`, "
        "then re-run. See tests/test_tenant_isolation.py."
    ),
)


@pytest.fixture(scope="module")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


def _signup(client) -> str:
    email = "owner+%s@example.com" % uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Limits Ltd",
            "email": email,
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


@skip_no_db
def test_a_brief_longer_than_the_cap_is_refused(client):
    """The bill here is tokens: this text is forwarded to Anthropic verbatim
    and nothing truncates it on the way."""
    token = _signup(client)
    resp = client.post(
        "/api/v1/schedule/interpret",
        headers=_auth(token),
        json={"text": "a" * 8_001},
    )
    assert resp.status_code == 422


@skip_no_db
def test_a_brief_at_the_cap_is_not(client):
    """The cap is a wall, not a fence one character inside where it is drawn.

    Anything but 422 will do: with no API key configured this gets a 503, and
    what matters is that the SCHEMA let it through.
    """
    token = _signup(client)
    resp = client.post(
        "/api/v1/schedule/interpret",
        headers=_auth(token),
        json={"text": "a" * 8_000},
    )
    assert resp.status_code != 422


@skip_no_db
def test_more_shifts_than_a_month_can_hold_are_refused(client):
    """The bill here is rows: one element of this list is one INSERT, so a
    list with no ceiling is a table filled by a single request."""
    token = _signup(client)
    shift = {
        "employee_id": str(uuid.uuid4()),
        "start_at": "2026-10-01T07:00:00+00:00",
        "end_at": "2026-10-01T15:00:00+00:00",
    }
    resp = client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": "2026-10-01T00:00:00+00:00",
            "period_end": "2026-11-01T00:00:00+00:00",
            "shifts": [shift] * 5_001,
        },
    )
    assert resp.status_code == 422


@skip_no_db
def test_more_observations_than_a_manager_makes_are_refused(client):
    """Same bill, smaller list: each of these is an observation written down."""
    token = _signup(client)
    resp = client.post(
        "/api/v1/profile/observations",
        headers=_auth(token),
        json={"ops": [{"kind": "noop"}] * 501},
    )
    assert resp.status_code == 422


@skip_no_db
def test_a_signup_password_under_eight_characters_is_refused(client):
    """This is the account that can delete the organization and everything in
    it, and it was the one account with no rule about its password at all --
    while the login a manager hands to a waiter has demanded eight since it was
    written (schemas/account.py)."""
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Short Ltd",
            "email": "short+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "1234567",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 422


@skip_no_db
def test_a_body_over_the_limit_is_refused_by_the_real_application(client):
    """The middleware is mounted, and it answers before anything else does.

    No token on purpose: FastAPI reads the body before it solves a single
    dependency, so an unauthenticated flood would otherwise be allocated in
    full and only then told to go away.
    """
    payload = json.dumps({"text": "a" * (MAX_BODY_BYTES + 1000)})
    resp = client.post(
        "/api/v1/schedule/interpret",
        headers={"Content-Type": "application/json"},
        content=payload,
    )
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "request_too_large"


# --------------------------------------------------------------------------
# What a replan may ask for. These two are the ones a ceiling gets wrong in
# opposite directions: one refused a real customer, the other refused nobody.
# --------------------------------------------------------------------------


def test_a_fifty_person_replan_still_fits_in_the_context():
    """Measured, not guessed: buildPlanContext gives 41.6k for 50 people.

    The first ceiling written here was 40.000, which would have refused the
    replan for every customer above roughly fifteen people -- in pydantic's
    English, which the browser cannot translate. A limit that bites the
    product it protects is worse than no limit.
    """
    from app.routers.schedule import GenerateIn

    plan = GenerateIn(context="x" * 45_000, months=["2026-10"])

    assert len(plan.context) == 45_000


def test_a_month_that_is_not_a_month_is_refused_before_it_is_paid_for():
    """Each element becomes its own call to the model, prompt and all.

    The list is capped at twelve in the route, but the ELEMENTS used to be
    unbounded strings interpolated into the prompt -- so twelve of them could
    carry the best part of a megabyte of arbitrary text straight past the
    ceiling on `context` and buy twelve expensive calls with it. Anything that
    is not "YYYY-MM" was never a request this client makes: the browser sends
    `date.slice(0, 7)`.
    """
    from pydantic import ValidationError

    from app.routers.schedule import GenerateIn

    for not_a_month in ["2026-13", "26-10", "2026-10-01", "x" * 50_000, ""]:
        with pytest.raises(ValidationError):
            GenerateIn(context="brief", months=[not_a_month])

    assert GenerateIn(context="brief", months=["2026-01", "2026-12"]).months == [
        "2026-01",
        "2026-12",
    ]
