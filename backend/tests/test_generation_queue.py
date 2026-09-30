from __future__ import annotations

"""A calendar the manager does not have to sit and watch.

Planning used to be one HTTP request that ran for minutes: the model wrote the
months, the provider billed them, and they lived only in that request. Closing
the tab threw away work already paid for, which is not hypothetical -- on
14-sep-2026 nine attempts were generated and discarded and the meter showed a
quiet afternoon.

These tests are about the properties that replace it: the ask returns at once,
a month is on disk the moment it exists, one bad month does not take the others
with it, a redeploy resumes instead of re-buying, and none of it is visible to
another customer.
"""

import re
import threading
import time
import uuid

import pytest
from types import SimpleNamespace

USAGE = SimpleNamespace(
    input_tokens=1000,
    output_tokens=200,
    cache_creation_input_tokens=0,
    cache_read_input_tokens=0,
)

MONTH_ASKED = re.compile(r"Plan the month of (\d{4}-\d{2})\.")

# The one person on the roster of these jobs. It matters that it is a real id:
# the server shortens the ids in the context before the model sees them and
# restores them on the way back (services/id_alias.py), so a month whose shifts
# name somebody it cannot place comes back as a FAILED month -- which is the
# right behaviour, and would quietly hollow out every assertion here.
EMPLOYEE_ID = "11111111-1111-4111-8111-111111111111"


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



def _text(content) -> str:
    """What the model reads, whether sent as a string or as text blocks.

    The planner sends blocks so the shared prefix can carry a cache marker;
    the words are what these tests are about, not the envelope.
    """
    if isinstance(content, str):
        return content
    return "\n\n".join(block["text"] for block in content)

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
    """A model that answers one shift per month, and can be made to misbehave.

    ``block`` holds the named month until the event is set, which is how a test
    can look at the database while one month is done and another is not --
    the whole property of the queue, and invisible without it.
    """

    asked: list = []
    fail: set = set()
    block: dict = {}

    def __init__(self, *args, **kwargs):
        self.messages = self

    def with_middleware(self, *_middleware):
        return self

    def stream(self, **kw):
        from app.services.calendar_plan import MonthPlan, ProposedShift

        found = MONTH_ASKED.search(_text(kw["messages"][0]["content"]))
        month = found.group(1) if found else "?"
        _Model.asked.append(month)

        gate = _Model.block.get(month)
        if gate is not None:
            assert gate.wait(timeout=30), "the test never released %s" % month

        if month in _Model.fail:
            raise RuntimeError("the model would not write %s" % month)

        plan = MonthPlan(
            shifts=[
                ProposedShift(
                    employee_id="e1",
                    date="%s-01" % month,
                    start="09:00",
                    end="17:00",
                )
            ]
        )
        return _Stream(SimpleNamespace(parsed_output=plan, usage=USAGE))


@pytest.fixture
def fake_anthropic(monkeypatch):
    import anthropic

    _Model.asked = []
    _Model.fail = set()
    _Model.block = {}
    monkeypatch.setattr(anthropic, "Anthropic", _Model)
    return _Model


@pytest.fixture(scope="module")
def client():
    """The app with its workers switched OFF.

    The lifespan starts background planners, and a planner racing the test for
    the same job is the difference between a suite that proves something and
    one that passes. These tests drive the worker by hand, one step at a time.
    """
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import app

    before = settings.generation_workers
    settings.generation_workers = 0
    try:
        with TestClient(app) as c:
            yield c
    finally:
        settings.generation_workers = before


@pytest.fixture(autouse=True)
def empty_queue():
    """Start every test with nothing in the queue.

    The queue is global by design -- a worker asks "is there a job for
    anybody?" -- and this database is not torn down between runs, so without
    this a test that drives the worker by hand picks up the leftovers of the
    test before it and proves something about the wrong job.
    """
    from sqlalchemy import text

    from app.db import AdminSessionLocal

    db = AdminSessionLocal()
    try:
        # generation_month goes with it: ON DELETE CASCADE.
        db.execute(text("DELETE FROM generation_job"))
        db.commit()
    finally:
        db.close()


@pytest.fixture
def with_api_key(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _signup(client) -> tuple:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Queued Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], uuid.UUID(body["user"]["org_id"])


def _enqueue(client, token, months=("2026-10",), **extra):
    payload = {
        "context": "the whole snapshot",
        "months": list(months),
        "employees": [EMPLOYEE_ID],
    }
    payload.update(extra)
    return client.post(
        "/api/v1/schedule/generate/jobs", json=payload, headers=_auth(token)
    )


def _read(client, token, job_id):
    return client.get(
        "/api/v1/schedule/generate/jobs/%s" % job_id, headers=_auth(token)
    )


def _sql(org_id, statement, params=None):
    """Run one statement as the tenant. Returns the rows."""
    from sqlalchemy import text

    from app.db import AppSessionLocal, set_current_org

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        result = db.execute(text(statement), params or {})
        rows = result.fetchall() if result.returns_rows else []
        db.commit()
        return rows
    finally:
        db.close()


def _months_on_disk(org_id, job_id):
    return {
        row[0]: row[1]
        for row in _sql(
            org_id,
            "SELECT month, status FROM generation_month WHERE job_id = :job",
            {"job": job_id},
        )
    }


def _wait_until(predicate, timeout=20.0):
    """Poll a condition. Returns True if it came true in time."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


# --- asking ------------------------------------------------------------------


@skip_no_db
def test_asking_for_a_calendar_returns_before_the_model_is_asked(
    client, fake_anthropic, with_api_key
):
    token, _ = _signup(client)

    resp = _enqueue(client, token, months=["2026-10", "2026-11"])

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued"
    assert body["months"] == ["2026-10", "2026-11"]
    assert body["done"] == [] and body["shifts"] == []
    assert uuid.UUID(body["job_id"])
    # The point of the whole change: the request did not wait for the model.
    assert _Model.asked == []


@skip_no_db
def test_without_a_key_nothing_is_queued(client, fake_anthropic, monkeypatch):
    """A job nobody can do is worse than the 503 the client already answers."""
    from app.config import settings

    monkeypatch.setattr(settings, "anthropic_api_key", "")
    token, _ = _signup(client)

    resp = _enqueue(client, token)

    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"]["code"] == "anthropic_key_missing"


@skip_no_db
def test_a_second_calendar_is_refused_while_one_is_running(
    client, fake_anthropic, with_api_key
):
    """One at a time per organisation.

    The browser used to refuse this with a React ref, which does not survive a
    reload and knows nothing about the other tab. What it costs to get wrong is
    a second bill for the same months.
    """
    token, _ = _signup(client)
    first = _enqueue(client, token)
    assert first.status_code == 202, first.text

    second = _enqueue(client, token)

    assert second.status_code == 409, second.text
    detail = second.json()["detail"]
    assert detail["code"] == "generation_already_running"
    assert detail["params"]["job_id"] == first.json()["job_id"]


@skip_no_db
def test_more_than_a_year_is_refused(client, fake_anthropic, with_api_key):
    token, _ = _signup(client)
    # Thirteen REAL months. It used to ask for "2026-13", which is not a month
    # at all, so the schema now refuses it before the route can count -- and
    # what this test is about is the counting, and the sentence it produces.
    thirteen = ["2026-%02d" % m for m in range(1, 13)] + ["2027-01"]
    resp = _enqueue(client, token, months=thirteen)
    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "too_many_months"


# --- working -----------------------------------------------------------------


@skip_no_db
def test_a_month_is_on_disk_the_moment_it_arrives(
    client, fake_anthropic, with_api_key
):
    """The property the queue exists for.

    October is held nowhere while November is still being written: it has been
    billed, so it is stored. This is checked the only way it can be -- from
    another thread, while the job is half done.
    """
    token, org_id = _signup(client)
    job_id = uuid.UUID(
        _enqueue(client, token, months=["2026-10", "2026-11"]).json()["job_id"]
    )

    release = threading.Event()
    _Model.block = {"2026-11": release}

    from app.services import generation_worker

    worker = threading.Thread(target=generation_worker.work_once)
    worker.start()
    try:
        assert _wait_until(
            lambda: "2026-10" in _months_on_disk(org_id, job_id)
        ), "October was not stored while November was still being written"

        # And the job says it is still going, rather than done or lost.
        body = _read(client, token, job_id).json()
        assert body["status"] == "running"
        assert body["done"] == ["2026-10"]
        assert len(body["shifts"]) == 1
    finally:
        release.set()
        worker.join(timeout=30)

    body = _read(client, token, job_id).json()
    assert body["status"] == "done"
    assert body["done"] == ["2026-10", "2026-11"]
    assert body["failed"] == []
    assert len(body["shifts"]) == 2
    assert {s["date"] for s in body["shifts"]} == {"2026-10-01", "2026-11-01"}
    assert {s["employeeId"] for s in body["shifts"]} == {EMPLOYEE_ID}


@skip_no_db
def test_one_month_the_model_will_not_write_does_not_take_the_others_down(
    client, fake_anthropic, with_api_key
):
    """A failed month is a note about quality, not an outage.

    The client covers that block with its own deterministic pass, which is what
    it did before any model was involved -- so the job is DONE, not failed.
    """
    token, _ = _signup(client)
    job_id = _enqueue(client, token, months=["2026-10", "2026-11"]).json()["job_id"]
    _Model.fail = {"2026-10"}

    from app.services import generation_worker

    generation_worker.work_once()

    body = _read(client, token, job_id).json()
    assert body["status"] == "done"
    assert body["failed"] == ["2026-10"]
    assert body["done"] == ["2026-11"]
    assert body["error_code"] is None


@skip_no_db
def test_the_job_carries_why_the_model_could_not_be_reached(
    client, fake_anthropic, with_api_key, monkeypatch
):
    """The cause, as a code the client translates -- never as prose.

    "The account is out of credit" and "something went wrong" need different
    people to do different things, which is why `errors.ai_failure` reads the
    vendor's own wording. A queued job has to carry that same distinction.
    """
    token, _ = _signup(client)
    job_id = _enqueue(client, token).json()["job_id"]

    def explode(*_args, **_kwargs):
        raise RuntimeError("Your credit balance is too low")

    from app.services import generation_worker

    monkeypatch.setattr(generation_worker, "plan_calendar", explode)
    generation_worker.work_once()

    body = _read(client, token, job_id).json()
    assert body["status"] == "failed"
    assert body["error_code"] == "ai_no_credit"


@skip_no_db
def test_an_empty_queue_is_not_work(client, fake_anthropic, with_api_key):
    from app.services import generation_worker

    assert generation_worker.work_once() is False


# --- surviving a redeploy ----------------------------------------------------


def _go_stale(org_id, job_id, *, attempts):
    """Make a job look like one whose container went away."""
    _sql(
        org_id,
        "UPDATE generation_job SET status = 'running', attempts = :attempts, "
        "heartbeat_at = now() - interval '1 hour' WHERE id = :id",
        {"id": job_id, "attempts": attempts},
    )


@skip_no_db
def test_a_job_whose_worker_died_is_resumed_and_buys_no_month_twice(
    client, fake_anthropic, with_api_key
):
    token, org_id = _signup(client)
    job_id = uuid.UUID(
        _enqueue(client, token, months=["2026-10", "2026-11"]).json()["job_id"]
    )

    # October got written, then the container went away mid-November.
    from app.services import generation_queue

    generation_queue.record_month(
        org_id,
        job_id,
        "2026-10",
        [{"employeeId": "e1", "date": "2026-10-01", "start": "09:00", "end": "17:00"}],
    )
    _go_stale(org_id, job_id, attempts=1)

    from app.services import generation_worker

    generation_worker.work_once()

    # Only the month that was missing was asked for.
    assert _Model.asked == ["2026-11"]
    body = _read(client, token, job_id).json()
    assert body["status"] == "done"
    assert body["done"] == ["2026-10", "2026-11"]


@skip_no_db
def test_a_silent_job_tells_the_panel_and_then_that_it_was_resumed(
    client, fake_anthropic, with_api_key
):
    """The twenty minutes of "Reorganizando" nobody could explain.

    A deploy killed the worker; the job waited out its five minutes and was
    taken up again, and the panel said nothing either time. The read now says
    both things the panel needs: nobody is on it, and later, that somebody is
    again.
    """
    token, org_id = _signup(client)
    job_id = uuid.UUID(_enqueue(client, token).json()["job_id"])

    fresh = _read(client, token, job_id).json()
    assert fresh["stalled"] is False
    assert fresh["attempts"] <= 1

    _go_stale(org_id, job_id, attempts=1)
    silent = _read(client, token, job_id).json()
    assert silent["status"] == "running"
    assert silent["stalled"] is True

    # Taken up again: the heartbeat is fresh and the attempt is the second.
    _sql(
        org_id,
        "UPDATE generation_job SET attempts = 2, heartbeat_at = now() WHERE id = :id",
        {"id": job_id},
    )
    resumed = _read(client, token, job_id).json()
    assert resumed["stalled"] is False
    assert resumed["attempts"] == 2


@skip_no_db
def test_a_job_that_keeps_killing_its_worker_is_abandoned(
    client, fake_anthropic, with_api_key
):
    """Otherwise it takes down every worker in turn, forever, and the only
    symptom is a queue that never moves."""
    token, org_id = _signup(client)
    job_id = uuid.UUID(_enqueue(client, token).json()["job_id"])
    _go_stale(org_id, job_id, attempts=2)

    from app.services import generation_worker

    assert generation_worker.work_once() is False

    body = _read(client, token, job_id).json()
    assert body["status"] == "failed"
    assert body["error_code"] == "generation_abandoned"
    # And the account is free to ask again.
    assert _enqueue(client, token).status_code == 202


# --- what the neighbours can see ---------------------------------------------


@skip_no_db
def test_another_organisation_cannot_read_the_job(
    client, fake_anthropic, with_api_key
):
    mine, _ = _signup(client)
    theirs, _ = _signup(client)
    job_id = _enqueue(client, mine).json()["job_id"]

    assert _read(client, mine, job_id).status_code == 200
    assert _read(client, theirs, job_id).status_code == 404


@skip_no_db
def test_the_months_of_a_job_are_invisible_to_another_tenant(
    client, fake_anthropic, with_api_key
):
    """Row-level security, not the WHERE clause above it.

    The endpoint filters by org as well, so this reads the table directly with
    the other tenant's context: the barrier has to be the database's.
    """
    token, org_id = _signup(client)
    _, other_org = _signup(client)
    job_id = uuid.UUID(_enqueue(client, token).json()["job_id"])

    from app.services import generation_worker

    generation_worker.work_once()

    assert _months_on_disk(org_id, job_id) == {"2026-10": "planned"}
    assert _months_on_disk(other_org, job_id) == {}


@skip_no_db
def test_a_reopened_tab_finds_the_calendar_it_walked_away_from(
    client, fake_anthropic, with_api_key
):
    token, _ = _signup(client)
    job_id = _enqueue(client, token, months=["2026-10", "2026-11"]).json()["job_id"]

    from app.services import generation_worker

    generation_worker.work_once()

    resp = client.get(
        "/api/v1/schedule/generate/jobs/latest", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["job_id"] == job_id
    assert body["status"] == "done"
    assert len(body["shifts"]) == 2


@skip_no_db
def test_an_account_that_never_asked_has_no_latest(
    client, fake_anthropic, with_api_key
):
    token, _ = _signup(client)
    resp = client.get(
        "/api/v1/schedule/generate/jobs/latest", headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() is None


@skip_no_db
def test_polling_can_ask_for_the_counts_without_the_calendar(
    client, fake_anthropic, with_api_key
):
    """A year is around 1.500 shifts and a poll happens every few seconds.

    Sending the whole calendar back each time would move megabytes to answer
    "how is it going?", so the progress read asks for the months alone.
    """
    token, _ = _signup(client)
    job_id = _enqueue(client, token, months=["2026-10", "2026-11"]).json()["job_id"]

    from app.services import generation_worker

    generation_worker.work_once()

    light = client.get(
        "/api/v1/schedule/generate/jobs/%s?shifts=false" % job_id,
        headers=_auth(token),
    ).json()
    full = _read(client, token, job_id).json()

    assert light["done"] == ["2026-10", "2026-11"]
    assert light["shifts"] == []
    assert len(full["shifts"]) == 2


# --- the lease: who owns the job right now ------------------------------------


@skip_no_db
def test_a_worker_that_lost_the_job_cannot_close_it(client, fake_anthropic, with_api_key):
    """The failure the lease exists for.

    A heartbeat that cannot reach the database -- a saturated pool is enough --
    gets the job declared stale and resumed by somebody else. If the first
    worker could still close it, it would mark `done` a calendar its replacement
    is halfway through writing, the browser would stop polling, and a
    half-planned year would be adopted as finished.
    """
    token, org_id = _signup(client)
    job_id = uuid.UUID(_enqueue(client, token, months=["2026-10"]).json()["job_id"])

    from app.services import generation_queue

    first = generation_queue.claim()
    assert first is not None and first.id == job_id
    stale_lease = first.lease

    # Somebody else takes it over: the row goes quiet and is claimed again.
    _go_stale(org_id, job_id, attempts=1)
    second = generation_queue.claim()
    assert second is not None and second.id == job_id
    assert second.lease != stale_lease

    # Now the first worker tries to finish, and to add a month.
    generation_queue.finish(org_id, job_id, lease=stale_lease)
    generation_queue.record_month(
        org_id,
        job_id,
        "2026-10",
        [{"employeeId": "e1", "date": "2026-10-01", "start": "09:00", "end": "17:00"}],
        stale_lease,
    )

    # Neither landed: the job is still running, for its new owner, with nothing
    # written under it.
    assert _read(client, token, str(job_id)).json()["status"] == "running"
    assert _months_on_disk(org_id, job_id) == {}

    # And the owner can still do both.
    generation_queue.record_month(
        org_id,
        job_id,
        "2026-10",
        [{"employeeId": "e1", "date": "2026-10-01", "start": "09:00", "end": "17:00"}],
        second.lease,
    )
    generation_queue.finish(org_id, job_id, lease=second.lease)
    assert _read(client, token, str(job_id)).json()["status"] == "done"


@skip_no_db
def test_a_heartbeat_says_whether_the_job_is_still_ours(
    client, fake_anthropic, with_api_key
):
    token, org_id = _signup(client)
    job_id = uuid.UUID(_enqueue(client, token).json()["job_id"])

    from app.services import generation_queue

    mine = generation_queue.claim()
    assert generation_queue.beat(org_id, job_id, mine.lease) is True

    _go_stale(org_id, job_id, attempts=1)
    generation_queue.claim()  # taken over

    assert generation_queue.beat(org_id, job_id, mine.lease) is False


@skip_no_db
def test_a_month_that_failed_can_be_won_on_the_second_attempt(
    client, fake_anthropic, with_api_key
):
    """A stored failure must not lock out a month that was later paid for.

    The first rule of the store is that a `planned` month is never overwritten:
    a resumed job must not contradict what the manager may already be looking
    at. The exception is a month stored as FAILED -- refusing to promote that
    would throw away a month the provider billed.
    """
    token, org_id = _signup(client)
    job_id = uuid.UUID(_enqueue(client, token).json()["job_id"])

    from app.services import generation_queue

    generation_queue.record_month(org_id, job_id, "2026-10", None)
    assert _months_on_disk(org_id, job_id) == {"2026-10": "failed"}

    generation_queue.record_month(
        org_id,
        job_id,
        "2026-10",
        [{"employeeId": "e1", "date": "2026-10-01", "start": "09:00", "end": "17:00"}],
    )
    assert _months_on_disk(org_id, job_id) == {"2026-10": "planned"}

    # And the other direction never happens: a month that is planned stays.
    generation_queue.record_month(org_id, job_id, "2026-10", None)
    assert _months_on_disk(org_id, job_id) == {"2026-10": "planned"}


@skip_no_db
def test_two_asks_at_once_cannot_both_be_accepted(client, fake_anthropic, with_api_key):
    """The rule is the database's, not the router's.

    Looking for an active job and then inserting is a read-then-write: two
    requests a few milliseconds apart -- a double click, two tabs reloading
    together -- both read "none" and both insert, and the same twelve months get
    bought twice. `uq_generation_job_one_per_org` is what actually refuses.
    """
    from app.db import AppSessionLocal, set_current_org
    from app.services import generation_queue

    token, org_id = _signup(client)

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        first = generation_queue.enqueue(
            db,
            org_id,
            months=["2026-10"],
            context="c",
            employees=[],
            templates=[],
            effort="medium",
        )
        db.commit()
        set_current_org(db, org_id)

        with pytest.raises(generation_queue.AlreadyPlanning) as raised:
            generation_queue.enqueue(
                db,
                org_id,
                months=["2026-10"],
                context="c",
                employees=[],
                templates=[],
                effort="medium",
            )
        # And it names the one that won, so the client can join it.
        assert raised.value.job_id == first.id
    finally:
        db.close()
