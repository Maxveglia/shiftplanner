"""Jev in front of the three planner halves: what it may skip, and what never.

None of this calls the network. Whether Jev reads "sube el plus de noche de
Ana" correctly is its own question and an eval's; what is tested here is the
wiring, which is where a second opinion in front of a working call turns into
a request nobody carried out:

1. Off, it is not asked, and the three halves run as they always did.
2. In the shadow -- the default when on -- it is asked, the three halves still
   run, and two log lines put its answer next to what each half returned.
3. Enforced, a half it is nearly sure of is skipped, but never the calendar
   and the roster together, and never on an answer with a hole in it.
4. What it reads is the manager's sentence with the names taken out.
"""

import logging
import uuid

import pytest

from app.config import settings
from app.services import jev, triage
from app.services import refine_intake
from app.services.refine_intake import (
    CalendarOp,
    CalendarPlan,
    PayOp,
    PayPlan,
    RosterOp,
    RosterPlan,
    plan_edits,
)

CONTEXT = """PERIOD 2026-10-01 to 2026-10-31. Today is 2026-10-12.

TEAM (#number | name | status | hours planned | days unavailable in this period).
  #1 | Juan Perez | active | 120h | none

SHIFTS PLANNED (date, employee, start-end):
  2026-10-01 Juan Perez 09:00-17:00"""


class _Halves:
    """The three planner calls, answered by schema, recording which were asked.

    A schema mapped to an exception raises it, like a refused or timed-out
    call; one missing from the map answers its empty plan.
    """

    def __init__(self, answers=None):
        self.answers = answers or {}
        self.asked = []

    def parse(self, **kw):
        schema = kw["output_format"]
        self.asked.append(schema.__name__)
        answer = self.answers.get(schema, schema())
        if isinstance(answer, Exception):
            raise answer

        class _Response:
            usage = None
            parsed_output = answer

        return _Response()


class _Client:
    def __init__(self, halves):
        self.messages = halves

    def with_middleware(self, *_):
        return self


@pytest.fixture
def halves(monkeypatch):
    """The planner, stubbed. The desk is left out: it is not what is tested."""
    import anthropic

    stub = _Halves()
    monkeypatch.setattr(anthropic, "Anthropic", lambda *a, **k: _Client(stub))
    monkeypatch.setattr(triage, "read_the_request", lambda *a, **k: None)
    monkeypatch.setattr("app.services.api_usage.note", lambda *a, **k: None)
    return stub


@pytest.fixture
def jev_on(monkeypatch):
    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(settings, "jev_api_key", "test-key")


def _jev_says(monkeypatch, answers):
    """Stub ``jev.ask`` with a fixed answer (P per half, or None for no
    answer at all) and return the list of calls it received."""
    calls = []

    def ask(state, questions, purpose):
        calls.append({"state": state, "questions": questions, "purpose": purpose})
        if answers is None:
            return None
        return {k: jev.Answer(yes=p) for k, p in answers.items()}

    monkeypatch.setattr(jev, "ask", ask)
    return calls


def _refusing_jev(monkeypatch):
    def ask(*a, **k):
        raise AssertionError("Jev may not be asked here")

    monkeypatch.setattr(jev, "ask", ask)


# ------------------------------------------------------------------ off


def test_off_nothing_is_asked_of_jev_and_all_three_halves_run(halves, monkeypatch):
    _refusing_jev(monkeypatch)
    plan_edits("Juan libra el viernes", CONTEXT, "key")
    assert sorted(halves.asked) == ["CalendarPlan", "PayPlan", "RosterPlan"]


# ------------------------------------------------------------------ the shadow


def test_the_shadow_asks_all_three_and_logs_both_lines(
    halves, jev_on, monkeypatch, caplog
):
    halves.answers = {
        CalendarPlan: CalendarPlan(
            ops=[CalendarOp(op="day_off", employee="Juan", weekday=5)]
        ),
    }
    calls = _jev_says(monkeypatch, {"calendar": 0.97, "roster": 0.02, "pay": 0.01})

    with caplog.at_level(logging.INFO, logger=refine_intake.log.name):
        plan = plan_edits(
            "Juan libra el viernes", CONTEXT, "key", route_state="e1 libra el viernes"
        )

    # Low as they are, the roster and the pay halves were asked: off by
    # default means Jev is watched, not obeyed.
    assert settings.jev_route_enforced is False
    assert sorted(halves.asked) == ["CalendarPlan", "PayPlan", "RosterPlan"]
    assert [o.op for o in plan.ops] == ["day_off"]

    (call,) = calls
    assert call["state"] == "e1 libra el viernes"
    assert call["purpose"] == "route"
    assert set(call["questions"]) == {"calendar", "roster", "pay"}

    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("jev:")]
    assert "jev: routed calendar=0.97 roster=0.02 pay=0.01 enforced=False" in lines
    assert "jev: route check calendar=0.97/1 roster=0.02/0 pay=0.01/0" in lines


def test_every_question_says_that_in_doubt_the_answer_is_true():
    # The asymmetry the whole design rests on, written where Jev reads it.
    for half, question in refine_intake.ROUTE_QUESTIONS.items():
        assert "in any doubt, answer true" in question.false, half


def test_a_failed_pay_call_writes_no_route_check(halves, jev_on, monkeypatch, caplog):
    # A pay call that failed returns no operations, and a line saying "pay
    # 0.01/0" would count that failure as Jev being right.
    halves.answers = {
        PayPlan: RuntimeError("boom"),
        CalendarPlan: CalendarPlan(ops=[CalendarOp(op="set_min_staff", staff=2)]),
    }
    _jev_says(monkeypatch, {"calendar": 0.9, "roster": 0.1, "pay": 0.01})
    with caplog.at_level(logging.INFO, logger=refine_intake.log.name):
        plan = plan_edits("x", CONTEXT, "key", route_state="x")
    assert [o.op for o in plan.ops] == ["set_min_staff"]
    assert not any("route check" in r.getMessage() for r in caplog.records)


# ------------------------------------------------------------------ enforced


@pytest.fixture
def enforced(monkeypatch, jev_on):
    monkeypatch.setattr(settings, "jev_route_enforced", True)


def test_enforced_a_half_jev_is_sure_of_is_not_asked(
    halves, enforced, monkeypatch, caplog
):
    halves.answers = {
        RosterPlan: RosterPlan(
            ops=[RosterOp(op="set_employee_terms", employee="Juan", hourly_rate=12)]
        ),
        CalendarPlan: CalendarPlan(ops=[CalendarOp(op="set_min_staff", staff=2)]),
        # Would be merged into Juan's terms if it were asked. It must not be.
        PayPlan: PayPlan(ops=[PayOp(employee="Juan", night_premium_pct=0)]),
    }
    _jev_says(monkeypatch, {"calendar": 0.8, "roster": 0.9, "pay": 0.01})

    with caplog.at_level(logging.INFO, logger=refine_intake.log.name):
        plan = plan_edits(
            "Juan a 12 € y dos personas mínimo",
            CONTEXT,
            "key",
            route_state="e1 a 12 € y dos personas mínimo",
        )

    assert sorted(halves.asked) == ["CalendarPlan", "RosterPlan"]
    # The result is what the two halves said, merged as always.
    out = [o.model_dump(exclude_none=True) for o in plan.ops]
    assert out == [
        {"op": "set_employee_terms", "employee": "Juan", "hourly_rate": 12},
        {"op": "set_min_staff", "staff": 2},
    ]
    assert plan.unsupported is None
    messages = [r.getMessage() for r in caplog.records]
    assert "jev: routed calendar=0.80 roster=0.90 pay=0.01 enforced=True" in messages
    assert "jev: skipped pay" in messages
    # A skipped half returned nothing because it was not asked: no evidence.
    assert not any("route check" in m for m in messages)


def test_enforced_the_calendar_alone_can_be_skipped(halves, enforced, monkeypatch):
    halves.answers = {
        PayPlan: PayPlan(ops=[PayOp(employee="Juan", night_premium_pct=0)]),
    }
    _jev_says(monkeypatch, {"calendar": 0.01, "roster": 0.3, "pay": 0.99})
    plan = plan_edits(
        "a Juan no le pago la nocturnidad",
        CONTEXT,
        "key",
        route_state="a e1 no le pago la nocturnidad",
    )
    assert sorted(halves.asked) == ["PayPlan", "RosterPlan"]
    assert [o.model_dump(exclude_none=True) for o in plan.ops] == [
        {"op": "set_employee_terms", "employee": "Juan", "night_premium_pct": 0.0}
    ]


def test_enforced_never_skips_the_calendar_and_the_roster_together(
    halves, enforced, monkeypatch
):
    _jev_says(monkeypatch, {"calendar": 0.01, "roster": 0.02, "pay": 0.9})
    plan_edits("x", CONTEXT, "key", route_state="x")
    assert sorted(halves.asked) == ["CalendarPlan", "PayPlan", "RosterPlan"]


def test_enforced_all_three_low_is_not_believed_either(halves, enforced, monkeypatch):
    # "Neither" is the answer being wrong; nothing in it is trusted, pay
    # included.
    _jev_says(monkeypatch, {"calendar": 0.01, "roster": 0.01, "pay": 0.01})
    plan_edits("x", CONTEXT, "key", route_state="x")
    assert sorted(halves.asked) == ["CalendarPlan", "PayPlan", "RosterPlan"]


def test_enforced_no_answer_from_jev_asks_all_three(halves, enforced, monkeypatch):
    _jev_says(monkeypatch, None)
    plan_edits("x", CONTEXT, "key", route_state="x")
    assert sorted(halves.asked) == ["CalendarPlan", "PayPlan", "RosterPlan"]


def test_enforced_an_answer_with_a_hole_asks_all_three(halves, enforced, monkeypatch):
    # Pay came back sure; the roster did not come back at all. A route with a
    # hole in it is not a route.
    _jev_says(monkeypatch, {"calendar": 0.9, "pay": 0.01})
    plan_edits("x", CONTEXT, "key", route_state="x")
    assert sorted(halves.asked) == ["CalendarPlan", "PayPlan", "RosterPlan"]


def test_enforced_the_premiums_that_were_the_whole_request_still_fail_loudly(
    halves, enforced, monkeypatch
):
    # The pay half's tolerance is unchanged: when it fails and the others
    # brought nothing, the caller falls back as before. A skipped calendar
    # counts as bringing nothing.
    halves.answers = {PayPlan: RuntimeError("boom")}
    _jev_says(monkeypatch, {"calendar": 0.01, "roster": 0.6, "pay": 0.99})
    with pytest.raises(RuntimeError):
        plan_edits("x", CONTEXT, "key", route_state="x")


def test_enforced_nothing_is_asked_of_jev_without_a_state(halves, enforced, monkeypatch):
    # The router sends no state when Jev is off; enforced alone changes nothing.
    _refusing_jev(monkeypatch)
    plan_edits("x", CONTEXT, "key")
    assert sorted(halves.asked) == ["CalendarPlan", "PayPlan", "RosterPlan"]


# ------------------------------------------------------------------ the router


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


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _signup(client) -> str:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Routed Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _hire(client, token: str, name: str) -> None:
    resp = client.post(
        "/api/v1/employees",
        headers=_auth(token),
        json={
            "external_id": None,
            "full_name": name,
            "email": None,
            "employment_status": "active",
            "hire_date": "2025-01-01",
        },
    )
    assert resp.status_code == 201, resp.text


def _refine(client, token: str, text: str):
    return client.post(
        "/api/v1/schedule/refine",
        headers=_auth(token),
        json={"text": text, "context": CONTEXT},
    )


@skip_no_db
def test_the_router_sends_jev_the_sentence_with_no_name_in_it(
    client, halves, jev_on, monkeypatch
):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    token = _signup(client)
    _hire(client, token, "Ana García")
    _hire(client, token, "Luis Romero")
    calls = _jev_says(monkeypatch, {"calendar": 0.9, "roster": 0.1, "pay": 0.1})

    resp = _refine(client, token, "Ana García libra el viernes y Luis cierra")
    assert resp.status_code == 200, resp.text

    (call,) = calls
    state = call["state"]
    for part in ("Ana", "García", "Luis", "Romero"):
        assert part not in state, state
    assert "libra el viernes" in state and "cierra" in state
    # The sentence and nothing else: not the team, not the shifts.
    assert "Juan Perez" not in state
    assert "SHIFTS PLANNED" not in state


@skip_no_db
def test_the_router_does_not_ask_jev_while_it_is_off(client, halves, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    _refusing_jev(monkeypatch)
    token = _signup(client)
    _hire(client, token, "Ana García")

    resp = _refine(client, token, "Ana García libra el viernes")
    assert resp.status_code == 200, resp.text
    assert sorted(halves.asked) == ["CalendarPlan", "PayPlan", "RosterPlan"]
