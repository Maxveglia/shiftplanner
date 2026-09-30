from __future__ import annotations

"""One person's premiums can differ from the business's.

The night premium, the weekend premium and the price of an extra hour used to
live only on the organization. A contract may now carry its own; NULL on each
means "the same as the business", and 0 is a real answer -- "a Juan no le pago
la nocturnidad" -- that must never collapse into NULL on the way in or out.

Two halves are pinned here: the contract API (stores, returns, refuses what the
law does not allow) and the two AI paths that turn a manager's sentence into
those fields (the intake's team, and the refine call's pay half).
"""

import uuid

import pytest

from app.services.intake import ScheduleBrief, TeamMember, brief_to_team
from unittest.mock import patch

from app.services import triage
from app.services.refine_intake import (
    CalendarOp,
    CalendarPlan,
    EditOp,
    PayOp,
    PayPlan,
    RosterOp,
    RosterPlan,
    merge_pay,
    plan_edits,
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


DB_AVAILABLE = _db_available()

skip_no_db = pytest.mark.skipif(
    not DB_AVAILABLE,
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


def _employee(client) -> tuple[str, str]:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Premium Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["access_token"]
    resp = client.post(
        "/api/v1/employees",
        headers=_auth(token),
        json={
            "external_id": None,
            "full_name": "Juan",
            "email": None,
            "employment_status": "active",
            "hire_date": "2026-09-01",
        },
    )
    assert resp.status_code == 201, resp.text
    return token, resp.json()["id"]


def _contract(**over) -> dict:
    payload = {
        "employment_type": "non_exempt_hourly",
        "hourly_rate": 12,
        "min_hours_per_week": 40,
        "max_hours_per_week": 40,
        "valid_from": "2026-10-01",
    }
    payload.update(over)
    return payload


# ---------------------------------------------------------------- the API


@skip_no_db
def test_a_contract_keeps_its_own_premiums(client):
    token, emp = _employee(client)
    resp = client.post(
        "/api/v1/employees/%s/contracts" % emp,
        headers=_auth(token),
        json=_contract(
            night_premium_pct=0,
            weekend_premium_pct=15.5,
            overtime_multiplier=1.75,
            night_premium_basis="included_in_salary",
        ),
    )
    assert resp.status_code == 201, resp.text
    listed = client.get(
        "/api/v1/employees/%s/contracts" % emp, headers=_auth(token)
    ).json()
    c = listed[0]
    # 0 comes back as 0, not as "the business's figure".
    assert c["night_premium_pct"] == 0
    assert c["weekend_premium_pct"] == 15.5
    assert c["overtime_multiplier"] == 1.75
    assert c["night_premium_basis"] == "included_in_salary"


@skip_no_db
def test_an_unstated_premium_is_the_business_s(client):
    token, emp = _employee(client)
    resp = client.post(
        "/api/v1/employees/%s/contracts" % emp,
        headers=_auth(token),
        json=_contract(),
    )
    assert resp.status_code == 201, resp.text
    c = resp.json()
    for field in (
        "night_premium_pct",
        "weekend_premium_pct",
        "overtime_multiplier",
        "night_premium_basis",
    ):
        assert c[field] is None, field
    # And the default contract a new employee is given invents none either.
    current = client.get(
        "/api/v1/employees/%s/contracts" % emp, headers=_auth(token)
    ).json()
    assert all(v["night_premium_pct"] is None for v in current)


@skip_no_db
@pytest.mark.parametrize(
    "over",
    [
        # An extra hour is never paid below an ordinary one (art. 35.1 ET).
        {"overtime_multiplier": 0.5},
        {"overtime_multiplier": 6},
        {"night_premium_pct": -1},
        {"weekend_premium_pct": 201},
        {"night_premium_basis": "foo"},
    ],
)
def test_the_api_refuses_what_is_not_a_premium(client, over):
    token, emp = _employee(client)
    resp = client.post(
        "/api/v1/employees/%s/contracts" % emp,
        headers=_auth(token),
        json=_contract(**over),
    )
    assert resp.status_code == 422, resp.text


@skip_no_db
def test_the_database_refuses_an_unknown_basis():
    """The CHECK constraint, for a writer that is not the API."""
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    from app.db import admin_engine

    with admin_engine.connect() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(
                text(
                    "UPDATE contract SET night_premium_basis = 'foo' "
                    "WHERE id = (SELECT id FROM contract LIMIT 1)"
                )
            )
        conn.rollback()


# ------------------------------------------------------ the intake's team


def _team(**fields) -> dict:
    brief = ScheduleBrief(team=[TeamMember(name="Juan", **fields)])
    return brief_to_team(brief)[0]


def test_a_zero_night_premium_survives_the_intake():
    row = _team(night_premium_pct=0, weekend_premium_pct=0)
    assert row["nightPremiumPct"] == 0
    assert row["weekendPremiumPct"] == 0


def test_an_unstated_premium_stays_null():
    row = _team()
    assert row["nightPremiumPct"] is None
    assert row["weekendPremiumPct"] is None
    assert row["overtimeMultiplier"] is None
    assert row["nightIncludedInSalary"] is None


def test_the_intake_passes_what_was_stated():
    row = _team(
        night_premium_pct=30, overtime_multiplier=1.75, night_included_in_salary=True
    )
    assert row["nightPremiumPct"] == 30
    assert row["overtimeMultiplier"] == 1.75
    assert row["nightIncludedInSalary"] is True


@pytest.mark.parametrize("bad", [0.5, 0, 6])
def test_an_overtime_multiplier_outside_1_to_5_is_dropped(bad):
    assert _team(overtime_multiplier=bad)["overtimeMultiplier"] is None


def test_a_premium_the_api_would_refuse_is_dropped():
    row = _team(night_premium_pct=-5, weekend_premium_pct=250)
    assert row["nightPremiumPct"] is None
    assert row["weekendPremiumPct"] is None


# --------------------------------------------------- the refine pay call


def _edit(**fields) -> EditOp:
    return EditOp(**fields)


def _flat(ops) -> list:
    return [op.model_dump(exclude_none=True) for op in ops]


def test_a_premium_for_somebody_else_is_its_own_terms_operation():
    out = _flat(
        merge_pay(
            [],
            [PayOp(employee="Juan", night_premium_pct=0, overtime_multiplier=1.75)],
        )
    )
    assert out == [
        {
            "op": "set_employee_terms",
            "employee": "Juan",
            "night_premium_pct": 0,
            "overtime_multiplier": 1.75,
        }
    ]


def test_a_premium_folds_into_the_same_person_s_new_terms():
    """"Súbele a 12 € y quítale la nocturnidad": one contract version, not two
    opening on the same day."""
    roster = [_edit(op="set_employee_terms", employee="Juan", hourly_rate=12)]
    out = _flat(merge_pay(roster, [PayOp(employee="  juan ", night_premium_pct=0)]))
    assert out == [
        {
            "op": "set_employee_terms",
            "employee": "Juan",
            "hourly_rate": 12,
            "night_premium_pct": 0,
        }
    ]


def test_a_premium_folds_into_the_hire():
    roster = [_edit(op="add_employee", name="Ana", count=1)]
    out = _flat(
        merge_pay(roster, [PayOp(employee="ANA", night_included_in_salary=True)])
    )
    assert len(out) == 1
    assert out[0]["op"] == "add_employee"
    assert out[0]["night_included_in_salary"] is True


def test_roster_operations_come_first_and_other_ops_are_untouched():
    roster = [
        _edit(op="add_employee", name="Ana", count=1),
        _edit(op="set_employee_status", employee="Luis", status="on_leave"),
    ]
    out = _flat(merge_pay(roster, [PayOp(employee="Luis", weekend_premium_pct=10)]))
    assert [o["op"] for o in out] == [
        "add_employee",
        "set_employee_status",
        "set_employee_terms",
    ]
    assert "weekend_premium_pct" not in out[1]
    assert out[2]["weekend_premium_pct"] == 10


def test_what_was_not_said_or_is_out_of_range_is_dropped():
    out = _flat(
        merge_pay(
            [],
            [
                PayOp(employee="Pedro", overtime_multiplier=0.5, weekend_premium_pct=300),
                PayOp(employee="Marta", night_included_in_salary=False),
                PayOp(employee=None, night_premium_pct=0),
            ],
        )
    )
    # Nothing usable in any of them, so no empty contract version either.
    assert out == []


def test_going_back_to_the_business_premiums():
    out = _flat(merge_pay([], [PayOp(employee="Ana", premiums_follow_business=True)]))
    assert out == [
        {
            "op": "set_employee_terms",
            "employee": "Ana",
            "premiums_follow_business": True,
        }
    ]


class _Answers:
    """The three planner calls, answered by schema; a schema mapped to an
    exception raises it, like a refused or timed-out call."""

    def __init__(self, answers: dict):
        self.answers = answers

    def parse(self, **kw):
        answer = self.answers[kw["output_format"]]
        if isinstance(answer, Exception):
            raise answer

        class _Response:
            usage = None
            parsed_output = answer

        return _Response()


def _plan(answers: dict):
    class _Client:
        messages = _Answers(answers)

        def with_middleware(self, *_):
            return self

    with patch("anthropic.Anthropic", return_value=_Client()), patch.object(
        triage, "read_the_request", return_value=None
    ), patch("app.services.api_usage.note"):
        return plan_edits("request", "TEAM\n  #1 | Juan", "key")


def test_the_three_calls_are_merged_roster_pay_calendar():
    plan = _plan(
        {
            RosterPlan: RosterPlan(
                ops=[RosterOp(op="set_employee_terms", employee="Juan", hourly_rate=12)]
            ),
            PayPlan: PayPlan(
                ops=[
                    PayOp(employee="Juan", night_premium_pct=0),
                    PayOp(employee="Marta", night_premium_pct=30),
                ]
            ),
            CalendarPlan: CalendarPlan(
                ops=[CalendarOp(op="set_min_staff", staff=2)]
            ),
        }
    )
    out = _flat(plan.ops)
    assert [o["op"] for o in out] == [
        "set_employee_terms",
        "set_employee_terms",
        "set_min_staff",
    ]
    assert out[0]["hourly_rate"] == 12 and out[0]["night_premium_pct"] == 0
    assert out[1]["employee"] == "Marta"


def test_a_failed_pay_call_keeps_the_other_two_halves():
    plan = _plan(
        {
            RosterPlan: RosterPlan(),
            PayPlan: RuntimeError("400 Schema is too complex"),
            CalendarPlan: CalendarPlan(
                ops=[CalendarOp(op="set_min_staff", staff=2)]
            ),
        }
    )
    assert [o.op for o in plan.ops] == ["set_min_staff"]


def test_a_failed_pay_call_with_nothing_else_fails_like_the_others():
    # The premiums may have been the whole request: the caller falls back, as
    # it does when either of the other halves fails.
    with pytest.raises(RuntimeError):
        _plan(
            {
                RosterPlan: RosterPlan(),
                PayPlan: RuntimeError("boom"),
                CalendarPlan: CalendarPlan(),
            }
        )


def _unions(node) -> int:
    if isinstance(node, dict):
        own = 1 if "anyOf" in node or isinstance(node.get("type"), list) else 0
        return own + sum(_unions(v) for v in node.values())
    if isinstance(node, list):
        return sum(_unions(v) for v in node)
    return 0


def test_the_pay_schema_stays_small():
    """Its own call so it can stay far from the complexity ceiling that
    refused the premiums inside `RosterPlan`. Six nullable fields, flat."""
    assert _unions(PayPlan.model_json_schema()) <= 6
    assert len(PayOp.model_fields) <= 6
