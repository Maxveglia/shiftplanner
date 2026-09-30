from __future__ import annotations

"""Every employee leaves the API schedulable.

`availability()` refuses anyone without a contract, on every day, so an
employee created without one is invisible to the scheduler -- and the manager
gets an empty calendar with nothing on screen saying why. That shipped. The
fix that followed covered the two paths that go through the brief, and missed
the Employees page, which kept making people nobody could ever roster.

This is the invariant stated where it cannot be forgotten: the creation
endpoint is the only door employees come through, so no client can reopen the
hole by not knowing about it.
"""

import uuid

import pytest


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


def _signup(client) -> str:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Contract Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _create(client, token: str, **over) -> dict:
    payload = {
        "external_id": None,
        "full_name": "Hugo",
        "email": None,
        "employment_status": "active",
        "hire_date": "2026-09-03",
    }
    payload.update(over)
    resp = client.post("/api/v1/employees", headers=_auth(token), json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


@skip_no_db
def test_a_new_employee_always_has_a_contract(client):
    token = _signup(client)
    emp = _create(client, token)
    assert emp["current_contract"] is not None


@skip_no_db
def test_the_default_contract_invents_no_pay_and_no_hours(client):
    """The weakest thing that can be true.

    It must not put a wage on somebody nobody priced, and it must not promise
    hours the business never agreed to. All it does is make them schedulable.
    """
    token = _signup(client)
    c = _create(client, token)["current_contract"]
    assert c["hourly_rate"] is None
    assert c["base_annual_salary"] is None
    assert float(c["min_hours_per_week"]) == 0
    assert c["max_hours_per_week"] is None
    assert c["employment_type"] == "non_exempt_hourly"


@skip_no_db
def test_the_contract_starts_when_the_person_does(client):
    token = _signup(client)
    c = _create(client, token, hire_date="2026-10-01")["current_contract"]
    assert c["valid_from"] == "2026-10-01"


@skip_no_db
def test_real_terms_replace_the_default_as_a_new_version(client):
    """The default is a starting point in a history, never something to undo."""
    token = _signup(client)
    emp = _create(client, token)
    resp = client.post(
        "/api/v1/employees/%s/contracts" % emp["id"],
        headers=_auth(token),
        json={
            "employment_type": "non_exempt_hourly",
            "base_annual_salary": None,
            "hourly_rate": 18.5,
            "min_hours_per_week": 20,
            "max_hours_per_week": 20,
            "pay_period": "monthly",
            "valid_from": "2026-09-10",
        },
    )
    assert resp.status_code == 201, resp.text

    fresh = client.get(
        "/api/v1/employees/%s" % emp["id"], headers=_auth(token)
    ).json()
    assert float(fresh["current_contract"]["hourly_rate"]) == 18.5

    history = client.get(
        "/api/v1/employees/%s/contracts" % emp["id"], headers=_auth(token)
    ).json()
    assert len(history) == 2
    closed = [c for c in history if c["valid_to"] is not None]
    assert len(closed) == 1
    assert closed[0]["hourly_rate"] is None


@skip_no_db
def test_every_employee_in_the_org_is_schedulable(client):
    """The invariant as the scheduler sees it, over a whole roster."""
    token = _signup(client)
    for name in ["Hugo", "Adri", "Aldridge", "Ethan", "Uri"]:
        _create(client, token, full_name=name)
    roster = client.get("/api/v1/employees", headers=_auth(token)).json()
    assert len(roster) == 5
    assert all(e["current_contract"] is not None for e in roster)


# --- Base hours are a setting a manager turns by hand --------------------------


@skip_no_db
def test_base_hours_change_in_place_on_the_open_contract(client):
    """"She does 30 from now on" is one number and one call, and it does not
    spawn a new contract version: the same contract id comes back."""
    token = _signup(client)
    emp = _create(client, token)
    before = emp["current_contract"]

    resp = client.patch(
        "/api/v1/employees/%s/contracts/current/hours" % emp["id"],
        headers=_auth(token),
        json={"hours_per_week": 30},
    )
    assert resp.status_code == 200, resp.text
    after = resp.json()
    assert after["id"] == before["id"]
    assert after["min_hours_per_week"] == 30

    roster = client.get("/api/v1/employees", headers=_auth(token)).json()
    mine = next(e for e in roster if e["id"] == emp["id"])
    assert mine["current_contract"]["min_hours_per_week"] == 30


@skip_no_db
def test_a_ceiling_below_the_new_hours_is_lifted_to_them(client):
    token = _signup(client)
    emp = _create(client, token)
    # Give them a contract with a ceiling first.
    resp = client.post(
        "/api/v1/employees/%s/contracts" % emp["id"],
        headers=_auth(token),
        json={
            "employment_type": "non_exempt_hourly",
            "min_hours_per_week": 20,
            "max_hours_per_week": 25,
            "valid_from": "2026-09-05",
        },
    )
    assert resp.status_code == 201, resp.text

    resp = client.patch(
        "/api/v1/employees/%s/contracts/current/hours" % emp["id"],
        headers=_auth(token),
        json={"hours_per_week": 30},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["min_hours_per_week"] == 30
    assert resp.json()["max_hours_per_week"] == 30


@skip_no_db
def test_zero_or_absurd_hours_are_refused(client):
    token = _signup(client)
    emp = _create(client, token)
    for bad in (0, -5, 200):
        resp = client.patch(
            "/api/v1/employees/%s/contracts/current/hours" % emp["id"],
            headers=_auth(token),
            json={"hours_per_week": bad},
        )
        assert resp.status_code == 422, (bad, resp.text)
