from __future__ import annotations

"""The meter on the paid model: every call is counted, per organization.

What these tests guard is not the arithmetic -- it is the three ways a call
could be spent and never counted:

* a service submits work to a thread without copying the context, so the
  ledger the router opened is invisible from the worker;
* a request fails halfway and the router's rollback takes the meter with it;
* one organization's rows show up under another.

The pure tests need no database and no API: ``anthropic.Anthropic`` is
replaced with a stand-in whose ``messages.parse`` returns an empty but valid
structured object and a fixed usage. The endpoint tests need Postgres and
skip themselves otherwise, same convention as the rest of the suite.
"""

import uuid
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from types import SimpleNamespace

import pytest

from app.services import api_usage


# --- The ledger itself ------------------------------------------------------


def test_note_outside_a_ledger_is_a_no_op():
    """Scripts and the contract test call the services with no router around
    them; that must not fail and must not write anywhere."""
    api_usage.note("plan.month", "claude-opus-5", SimpleNamespace(input_tokens=1))


def test_a_worker_thread_only_sees_the_ledger_through_a_copied_context():
    usage = SimpleNamespace(input_tokens=10, output_tokens=20)

    def work():
        api_usage.note("x", "claude-opus-5", usage)

    with api_usage.collect() as ledger:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(work).result()  # the trap: a bare submit
            pool.submit(copy_context().run, work).result()  # the fix

    assert len(ledger.entries) == 1, "a bare submit was counted, or the copy was not"
    assert ledger.entries[0].input_tokens == 10


def test_missing_cache_fields_are_zero_not_an_error():
    with api_usage.collect() as ledger:
        api_usage.note("x", "claude-opus-5", SimpleNamespace(input_tokens=5, output_tokens=7))
    e = ledger.entries[0]
    assert (e.cache_creation_input_tokens, e.cache_read_input_tokens) == (0, 0)


# --- Pricing ----------------------------------------------------------------


def test_opus_5_is_priced_from_the_table():
    # 1M input at $5 + 1M output at $25.
    assert api_usage.cost_usd("claude-opus-5", 1_000_000, 1_000_000) == 30.0
    # Cache: writes at 1.25x input, reads at 0.1x input.
    assert api_usage.cost_usd("claude-opus-5", 0, 0, 1_000_000, 1_000_000) == pytest.approx(6.75)


def test_an_unpriced_model_costs_zero_rather_than_a_guess():
    assert api_usage.cost_usd("claude-nonexistent", 1_000_000, 1_000_000) == 0.0


# --- The three services note what they spend --------------------------------

USAGE = SimpleNamespace(
    input_tokens=1000, output_tokens=200, cache_creation_input_tokens=0,
    cache_read_input_tokens=0,
)


class _FakeStream:
    """What ``messages.stream`` hands back: a context manager holding one
    already-finished reply. The planner streams rather than calling ``parse``
    -- a month takes minutes to write and does not fit in one response
    deadline -- and ``get_final_message`` returns the same parsed object, so
    the meter is fed from the same place either way."""

    def __init__(self, message):
        self._message = message

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        # The planner iterates the events to keep its own clock on them. A
        # scripted reply has none; what matters is that the loop ends.
        return iter(())

    def get_final_message(self):
        return self._message


class _FakeAPIResponse:
    """What the SDK hands its middleware chain: a wrapper over the HTTP
    response, with the parsed body behind it."""

    def __init__(self, message, status_code: int = 200):
        self.http_response = SimpleNamespace(
            status_code=status_code, is_success=status_code < 400
        )
        self.message = message


class _FakeAnthropic:
    """Stands in for ``anthropic.Anthropic``. ``fail_for`` names schemas whose
    call raises, to reproduce a request that dies halfway.

    ``lose_attempts`` is the other failure, and the harder one to see: it names
    schemas whose first N HTTP ATTEMPTS time out before the reply arrives. The
    real SDK retries those inside ``messages.parse``, which is why they were
    invisible to the meter until the middleware existed, so the stand-in has to
    retry inside ``parse`` too -- running the middleware chain once per
    attempt, exactly where ``_base_client.py`` runs it.
    """

    fail_for: set = set()
    lose_attempts: dict = {}

    def __init__(self, *args, **kwargs):
        self.messages = self
        self._middleware: list = []

    def with_middleware(self, *middleware):
        """The real client returns a cheap copy sharing the connection pool."""
        clone = _FakeAnthropic()
        clone._middleware = [*self._middleware, *middleware]
        return clone

    def _reply(self, kw):
        schema = kw["output_format"]
        if schema.__name__ in self.fail_for:
            raise RuntimeError("simulated API failure on %s" % schema.__name__)
        return SimpleNamespace(parsed_output=schema(), usage=USAGE)

    def _through_middleware(self, terminal):
        handler = terminal
        for mw in reversed(self._middleware):
            handler = (lambda outer, nxt: lambda req: outer(req, nxt))(mw, handler)
        return handler

    def parse(self, **kw):
        schema = kw["output_format"]
        # Raised before any attempt: `fail_for` is a call that dies, not an
        # HTTP attempt that failed and was retried. Keeping the two apart is
        # what stops this knob from writing `.lost` rows the older tests --
        # the ones guarding the rollback trap -- do not expect.
        if schema.__name__ in self.fail_for:
            raise RuntimeError("simulated API failure on %s" % schema.__name__)
        to_lose = self.lose_attempts.get(schema.__name__, 0)
        request = SimpleNamespace(retries_taken=0, json=kw)
        for attempt in range(to_lose + 1):
            lost = attempt < to_lose

            def call_next(_req, lost=lost):
                if lost:
                    raise TimeoutError("the attempt timed out mid-reply")
                return _FakeAPIResponse(self._reply(kw))

            try:
                return self._through_middleware(call_next)(request).message
            except TimeoutError:
                if not lost:
                    raise
        raise AssertionError("unreachable")

    def stream(self, **kw):
        # Raises HERE, not on __enter__, so `fail_for` reproduces a call that
        # dies before any of the reply arrives -- which is what a request that
        # fails halfway does to the meter.
        return _FakeStream(self._reply(kw))


@pytest.fixture
def fake_anthropic(monkeypatch):
    import anthropic

    _FakeAnthropic.fail_for = set()
    _FakeAnthropic.lose_attempts = {}
    monkeypatch.setattr(anthropic, "Anthropic", _FakeAnthropic)
    return _FakeAnthropic


def test_the_brief_is_three_metered_calls(fake_anthropic):
    from app.services.intake import interpret_brief

    with api_usage.collect() as ledger:
        interpret_brief("a bar, open noon to midnight", "key", "2026-09-10")
    assert sorted(e.purpose for e in ledger.entries) == [
        "intake.emphasis", "intake.schedule", "intake.team",
    ]
    assert all(e.model == "claude-opus-5" for e in ledger.entries)


def test_an_adjustment_is_three_metered_calls(fake_anthropic):
    from app.services.refine_intake import plan_edits

    with api_usage.collect() as ledger:
        plan_edits("one more on Fridays", "context", "key")
    # Calendar, roster, and since per-person premiums the pay half.
    assert sorted(e.purpose for e in ledger.entries) == [
        "refine.calendar",
        "refine.pay",
        "refine.roster",
    ]


def test_a_plan_is_one_metered_call_per_month(fake_anthropic):
    from app.services.calendar_plan import plan_calendar

    with api_usage.collect() as ledger:
        plan_calendar("context", ["2026-10", "2026-11", "2026-12"], "key")
    assert [e.purpose for e in ledger.entries] == ["plan.month"] * 3


def test_a_brief_that_fails_halfway_still_counts_what_it_spent(fake_anthropic):
    from app.services.intake import interpret_brief

    fake_anthropic.fail_for = {"TeamFields"}
    with api_usage.collect() as ledger:
        with pytest.raises(RuntimeError):
            interpret_brief("a bar", "key", "2026-09-10")
    assert sorted(e.purpose for e in ledger.entries) == ["intake.emphasis", "intake.schedule"]


# --- How long it took, and the attempts nobody saw ---------------------------


def test_a_call_that_nobody_timed_writes_no_duration():
    """``note`` grew a fourth parameter and three services call it. A caller
    that has not been taught to time itself must keep working, and must not
    claim the call took zero milliseconds."""
    with api_usage.collect() as ledger:
        api_usage.note("plan.month", "claude-opus-5", USAGE)
    assert ledger.entries[0].duration_ms is None


def test_the_brief_records_how_long_each_call_took(fake_anthropic):
    from app.services.intake import interpret_brief

    with api_usage.collect() as ledger:
        interpret_brief("a bar, open noon to midnight", "key", "2026-09-10")
    assert all(e.duration_ms is not None for e in ledger.entries), (
        "a service stopped timing its call"
    )
    assert all(e.duration_ms >= 0 for e in ledger.entries)


def test_an_adjustment_records_how_long_each_call_took(fake_anthropic):
    from app.services.refine_intake import plan_edits

    with api_usage.collect() as ledger:
        plan_edits("one more on Fridays", "context", "key")
    assert all(e.duration_ms is not None for e in ledger.entries)


def test_an_attempt_the_sdk_retried_away_is_still_counted(fake_anthropic):
    """The hole this closes: the SDK's retries happen INSIDE
    ``messages.parse``, so an attempt that generated tokens and then timed out
    was billed to us and noted nowhere. Two lost attempts here, one reply."""
    from app.services.intake import interpret_brief

    fake_anthropic.lose_attempts = {"ScheduleFields": 2}
    with api_usage.collect() as ledger:
        interpret_brief("a bar", "key", "2026-09-10")

    lost = [e for e in ledger.entries if e.purpose.endswith(api_usage.LOST_SUFFIX)]
    assert [e.purpose for e in lost] == ["intake.schedule.lost"] * 2
    # Zero tokens, and deliberately so: the reply never arrived, so the counts
    # are unknowable here. What IS known is that the attempt happened and how
    # long it burned.
    assert all(e.input_tokens == 0 and e.output_tokens == 0 for e in lost)
    assert all(e.duration_ms is not None for e in lost)
    # And the reply that did arrive is counted exactly once, as it always was.
    assert sorted(
        e.purpose for e in ledger.entries if not e.purpose.endswith(api_usage.LOST_SUFFIX)
    ) == ["intake.emphasis", "intake.schedule", "intake.team"]


def test_a_call_that_never_retried_writes_no_lost_row(fake_anthropic):
    """The middleware must not double-count: a 2xx is never retried, so the
    successful attempt belongs to the service's own ``note`` and to nobody
    else."""
    from app.services.refine_intake import plan_edits

    with api_usage.collect() as ledger:
        plan_edits("one more on Fridays", "context", "key")
    assert not any(e.purpose.endswith(api_usage.LOST_SUFFIX) for e in ledger.entries)
    assert len(ledger.entries) == 3


# --- Through the router, into the table, out through the back office ---------


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

ADMIN_PASSWORD = "back-office-test-password"


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


def _signup(client) -> tuple[str, uuid.UUID]:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Metered Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], uuid.UUID(body["user"]["org_id"])


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _rows_for(org_id: uuid.UUID):
    from sqlalchemy import select

    from app.db import AppSessionLocal, set_current_org
    from app.models.api_usage import ApiUsage

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        return list(db.execute(select(ApiUsage)).scalars().all())
    finally:
        db.close()


def _admin_token(client) -> str:
    from app.db import AdminSessionLocal
    from app.seeds.platform_admin import ensure_platform_admin

    email = "operator+%s@example.com" % uuid.uuid4().hex[:8]
    db = AdminSessionLocal()
    try:
        ensure_platform_admin(db, email=email, password=ADMIN_PASSWORD, full_name="Op")
        db.commit()
    finally:
        db.close()
    resp = client.post("/api/v1/backoffice/login", json={"email": email, "password": ADMIN_PASSWORD})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@skip_no_db
def test_a_generated_calendar_is_metered_to_its_organization(client, fake_anthropic, with_api_key):
    token, org_id = _signup(client)
    other_token, other_org = _signup(client)

    resp = client.post(
        "/api/v1/schedule/generate",
        json={"context": "the whole snapshot", "months": ["2026-10", "2026-11"]},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text

    rows = _rows_for(org_id)
    assert [r.purpose for r in rows] == ["plan.month", "plan.month"]
    assert {r.request_id for r in rows} == {rows[0].request_id}, "one request, one id"
    assert rows[0].input_tokens == 1000 and rows[0].output_tokens == 200
    # The other tenant's session sees none of it.
    assert _rows_for(other_org) == []

    # And the back office prices it.
    detail = client.get(
        "/api/v1/backoffice/customers/%s" % org_id, headers=_auth(_admin_token(client))
    )
    assert detail.status_code == 200, detail.text
    cost = detail.json()["api_cost"]
    assert cost["calls_30d"] == 2
    # 2 x (1000 in at $5/M + 200 out at $25/M) = 2 x $0.01
    assert cost["usd_30d"] == pytest.approx(0.02)
    assert cost["usd_total"] == pytest.approx(0.02)
    assert cost["by_purpose_30d"] == {"plan.month": pytest.approx(0.02)}


@skip_no_db
def test_the_duration_reaches_the_table_and_the_back_office(client, fake_anthropic, with_api_key):
    """The column is only worth having if it survives the round trip: the
    service times the call, ``record`` writes it, and the back office averages
    it per purpose."""
    token, org_id = _signup(client)

    resp = client.post(
        "/api/v1/schedule/interpret", json={"text": "a bar, noon to midnight"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text

    rows = _rows_for(org_id)
    assert rows and all(r.duration_ms is not None for r in rows), (
        "a timed call arrived with no duration"
    )

    cost = client.get(
        "/api/v1/backoffice/customers/%s" % org_id, headers=_auth(_admin_token(client))
    ).json()["api_cost"]
    assert sorted(cost["avg_ms_30d"]) == ["intake.emphasis", "intake.schedule", "intake.team"]
    assert all(v >= 0 for v in cost["avg_ms_30d"].values())


@skip_no_db
def test_a_failed_brief_is_still_metered(client, fake_anthropic, with_api_key):
    """The 502 rolls the request back; the meter is written anyway."""
    token, org_id = _signup(client)
    fake_anthropic.fail_for = {"TeamFields"}

    resp = client.post(
        "/api/v1/schedule/interpret", json={"text": "a bar"}, headers=_auth(token)
    )
    assert resp.status_code == 502, resp.text
    assert sorted(r.purpose for r in _rows_for(org_id)) == ["intake.emphasis", "intake.schedule"]


@skip_no_db
def test_the_platform_bill_is_the_sum_of_its_customers(client, fake_anthropic, with_api_key):
    """The overview answers "what are we spending" without opening every customer.

    Deltas rather than absolutes: the suite shares a database and other tests
    meter calls of their own, so what this pins down is that the platform
    figure moves by exactly what two customers just spent -- and that it lands
    in the calendar month the provider's cap is counted in.
    """
    from datetime import datetime, timezone

    admin = _auth(_admin_token(client))
    before = client.get("/api/v1/backoffice/metrics", headers=admin).json()["api_spend"]

    for _ in range(2):
        token, _org = _signup(client)
        resp = client.post(
            "/api/v1/schedule/generate",
            json={"context": "the whole snapshot", "months": ["2026-10", "2026-11"]},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text

    after = client.get("/api/v1/backoffice/metrics", headers=admin).json()["api_spend"]

    # 2 customers x 2 months x (1000 in at $5/M + 200 out at $25/M) = 4 x $0.01
    assert after["calls_30d"] - before["calls_30d"] == 4
    assert after["usd_30d"] - before["usd_30d"] == pytest.approx(0.04)
    assert after["usd_total"] - before["usd_total"] == pytest.approx(0.04)
    spent_on_plans = after["by_purpose_30d"]["plan.month"] - before[
        "by_purpose_30d"
    ].get("plan.month", 0.0)
    assert spent_on_plans == pytest.approx(0.04)

    this_month = datetime.now(timezone.utc).strftime("%Y-%m")
    months = {row["month"]: row["usd"] for row in after["monthly"]}
    earlier = {row["month"]: row["usd"] for row in before["monthly"]}
    assert len(after["monthly"]) == 12, "twelve calendar months, oldest first"
    assert months[this_month] - earlier[this_month] == pytest.approx(0.04)
