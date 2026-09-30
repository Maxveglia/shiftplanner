from __future__ import annotations

"""The two things standing between a button and somebody's bill.

Planning is the expensive call in this product -- one per month of the
horizon, and the output of a month costs about forty times its input. Two
controls arrived with the medium default, and both are the kind that fail
silently: a cheaper effort that the client cannot escalate is a quality
regression nobody sees, and a budget that never refuses is a comment.
"""

import uuid

import pytest
from types import SimpleNamespace

from app.services import api_usage


USAGE = SimpleNamespace(
    input_tokens=1000,
    output_tokens=200,
    cache_creation_input_tokens=0,
    cache_read_input_tokens=0,
)


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
    reason="No Postgres reachable. Start it and run `alembic upgrade head`.",
)


class _Stream:
    def __init__(self, response):
        self._response = response

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter(())

    def get_final_message(self):
        return self._response


class _Model:
    """Records the effort it was asked for, and answers with one shift."""

    efforts: list = []

    def __init__(self, *args, **kwargs):
        self.messages = self

    def with_middleware(self, *_middleware):
        return self

    def stream(self, **kw):
        from app.services.calendar_plan import MonthPlan, ProposedShift

        _Model.efforts.append(kw["output_config"]["effort"])
        plan = MonthPlan(
            shifts=[
                ProposedShift(
                    employee_id="e1", date="2026-10-01", start="09:00", end="17:00"
                )
            ]
        )
        return _Stream(SimpleNamespace(parsed_output=plan, usage=USAGE))


@pytest.fixture
def fake_anthropic(monkeypatch):
    import anthropic

    _Model.efforts = []
    monkeypatch.setattr(anthropic, "Anthropic", _Model)
    return _Model


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def with_api_key(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer %s" % token}


def _signup(client) -> tuple[str, uuid.UUID]:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Budgeted Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], uuid.UUID(body["user"]["org_id"])


def _generate(client, token, **extra):
    payload = {"context": "the whole snapshot", "months": ["2026-10"]}
    payload.update(extra)
    return client.post(
        "/api/v1/schedule/generate", json=payload, headers=_auth(token)
    )


# --- effort ------------------------------------------------------------------


@skip_no_db
def test_a_plan_is_asked_for_cheaply_unless_told_otherwise(
    client, fake_anthropic, with_api_key
):
    token, _ = _signup(client)

    assert _generate(client, token).status_code == 200
    assert fake_anthropic.efforts == ["medium"]


@skip_no_db
def test_the_client_can_buy_the_deeper_answer_for_a_month_it_rejected(
    client, fake_anthropic, with_api_key
):
    """The saving is only honest while the escalation exists: medium everywhere
    with no way back is not a cheaper product, it is a worse one."""
    token, _ = _signup(client)

    assert _generate(client, token, effort="high").status_code == 200
    assert fake_anthropic.efforts == ["high"]


@skip_no_db
def test_an_effort_we_do_not_recognise_is_refused_rather_than_forwarded(
    client, fake_anthropic, with_api_key
):
    """This field decides what a request costs. Passing an unknown value
    through would let a client name a setting we never priced."""
    token, _ = _signup(client)

    resp = _generate(client, token, effort="max")

    assert resp.status_code == 422
    assert fake_anthropic.efforts == []


@skip_no_db
def test_the_retry_is_metered_apart_from_the_first_ask(
    client, fake_anthropic, with_api_key
):
    """Without the split, nothing can answer the question the cheap default
    raises: how often did we have to buy the month twice?"""
    from sqlalchemy import select

    from app.db import admin_engine
    from app.models.api_usage import ApiUsage
    from sqlalchemy.orm import Session

    token, org_id = _signup(client)
    _generate(client, token)
    _generate(client, token, effort="high")

    with Session(admin_engine) as db:
        purposes = [
            row.purpose
            for row in db.execute(
                select(ApiUsage).where(ApiUsage.org_id == org_id)
            ).scalars()
        ]

    assert sorted(purposes) == ["plan.month", "plan.month.retry"]


# --- budget ------------------------------------------------------------------


@skip_no_db
def test_a_warning_alone_never_refuses_a_calendar(
    client, fake_anthropic, with_api_key, monkeypatch
):
    """Enforcement is off by default on purpose. A ceiling that starts
    refusing the day it ships turns our estimate into somebody's outage."""
    from app.config import settings

    monkeypatch.setattr(api_usage, "spent_usd_this_month", lambda *a: 10_000.0)
    monkeypatch.setattr(settings, "api_budget_enforced", False)

    token, _ = _signup(client)
    assert _generate(client, token).status_code == 200


@skip_no_db
def test_an_account_over_its_budget_is_refused_once_enforcement_is_on(
    client, fake_anthropic, with_api_key, monkeypatch
):
    from app.config import settings

    monkeypatch.setattr(api_usage, "spent_usd_this_month", lambda *a: 10_000.0)
    monkeypatch.setattr(settings, "api_budget_enforced", True)

    token, _ = _signup(client)
    resp = _generate(client, token)

    assert resp.status_code == 429
    assert fake_anthropic.efforts == [], "refused before the money was spent"


@skip_no_db
def test_an_account_under_its_budget_is_served(
    client, fake_anthropic, with_api_key, monkeypatch
):
    from app.config import settings

    monkeypatch.setattr(api_usage, "spent_usd_this_month", lambda *a: 0.01)
    monkeypatch.setattr(settings, "api_budget_enforced", True)

    token, _ = _signup(client)
    assert _generate(client, token).status_code == 200


@skip_no_db
def test_spending_is_counted_per_organisation(client):
    """The budget is one customer's, and the ledger it reads is row-level
    isolated. A sum that leaked across orgs would refuse the wrong people."""
    from app.db import admin_engine
    from sqlalchemy.orm import Session

    _, org_id = _signup(client)

    with Session(admin_engine) as db:
        assert api_usage.spent_usd_this_month(db, org_id) == 0.0


# --- who gives up first ------------------------------------------------------


def test_the_server_gives_up_before_the_browser_does():
    """Both files say the server should be what surrenders, so that the
    manager gets a reason instead of a shrug. Neither said it in arithmetic,
    and the intake quietly stopped being true: a timeout is per ATTEMPT, so
    the real ceiling is timeout x attempts. These numbers live in two
    languages and nothing else compares them.
    """
    from app.services import calendar_plan, intake, refine_intake

    # frontend/src/api/schedule.ts
    interpret_allowed_by_browser = 300.0
    refine_allowed_by_browser = 120.0
    plan_allowed_by_browser = 600.0

    assert (
        intake.TIMEOUT_SECONDS * (intake.MAX_RETRIES + 1)
        < interpret_allowed_by_browser
    )
    assert (
        refine_intake.TIMEOUT_SECONDS * (refine_intake.MAX_RETRIES + 1)
        < refine_allowed_by_browser
    )
    # The planner is streamed, so its per-event timeout is not the ceiling --
    # WHOLE_ANSWER_SECONDS is, once per attempt.
    assert (
        calendar_plan.WHOLE_ANSWER_SECONDS * (calendar_plan.MAX_RETRIES + 1)
        < plan_allowed_by_browser
    )


# --- the connection, while the model writes ----------------------------------


@skip_no_db
def test_the_request_lets_go_of_the_database_while_the_model_writes(
    monkeypatch, client, fake_anthropic, with_api_key
):
    """A generation must not sit on a pooled connection for minutes.

    The pool is fifteen connections wide, a month takes minutes to write, and
    `get_current_user` opens the transaction before the endpoint is even
    entered -- so without an explicit commit a dozen managers generating at
    once is enough to make LOGIN wait and fail. This watches the pool from
    inside the model call, which is the only place the property is visible.
    """
    from app.db import app_engine

    token, _ = _signup(client)

    held = []
    original = _Model.stream

    def watching(self, **kw):
        held.append(app_engine.pool.checkedout())
        return original(self, **kw)

    monkeypatch.setattr(_Model, "stream", watching)

    # What the pool looks like with nobody generating. Measured rather than
    # assumed to be zero: a fixture elsewhere may legitimately hold one.
    idle = app_engine.pool.checkedout()

    resp = _generate(client, token)

    assert resp.status_code == 200, resp.text
    assert held, "the model was never asked, so nothing was measured"
    assert max(held) <= idle, (
        "the request was holding %d connection(s) while the model wrote; "
        "it should hold none" % (max(held) - idle)
    )
