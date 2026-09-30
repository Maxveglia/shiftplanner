from __future__ import annotations

"""Approving time off takes the person off the shifts it covers.

It used to change a status and a vacation balance and nothing else, so three
people held three different beliefs about one Tuesday: the employee still saw
the shift on their phone, the manager thought the matter settled, and the rota
still showed the hours as covered by somebody who was not coming.

Needs Postgres, and skips itself when there is none.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.filterwarnings("ignore")


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
            "org_name": "Time Off Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _add(client, token: str, name: str = "Ana") -> str:
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
    return resp.json()["id"]


def _day(offset: int) -> datetime:
    """Midnight UTC, well in the future so nothing else in the org touches it."""
    base = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return base + timedelta(days=30 + offset)


def _shift(employee_id: str, day: int, hour: int = 9, hours: int = 8) -> dict:
    at = _day(day) + timedelta(hours=hour)
    return {
        "employee_id": employee_id,
        "start_at": at.isoformat(),
        "end_at": (at + timedelta(hours=hours)).isoformat(),
    }


def _publish(client, token: str, shifts: list, span: int = 7):
    resp = client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": _day(0).isoformat(),
            "period_end": _day(span).isoformat(),
            "shifts": shifts,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp


def _published(client, token: str, span: int = 7) -> list:
    resp = client.get(
        "/api/v1/schedule/assignments",
        headers=_auth(token),
        params={"from": _day(0).isoformat(), "to": _day(span).isoformat()},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _type(client, token: str, consumes: bool = False) -> str:
    resp = client.get("/api/v1/absence-types", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    for row in resp.json():
        if bool(row.get("consumes_balance")) == consumes:
            return row["id"]
    return resp.json()[0]["id"]


def _ask(client, token: str, employee: str, first: int, last: int) -> str:
    """Time off from the start of `first` to the end of `last`, as the UI asks."""
    resp = client.post(
        "/api/v1/absences",
        headers=_auth(token),
        json={
            "employee_id": employee,
            "absence_type_id": _type(client, token),
            "start_at": _day(first).isoformat(),
            "end_at": _day(last + 1).isoformat(),
            "note": None,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _approve(client, token: str, absence_id: str) -> dict:
    resp = client.post(
        "/api/v1/absences/%s/approve" % absence_id, headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@skip_no_db
def test_approving_takes_the_person_off_the_shifts_it_covers(client):
    token = _signup(client)
    ana = _add(client, token)
    _publish(client, token, [_shift(ana, 1), _shift(ana, 2), _shift(ana, 5)])

    body = _approve(client, token, _ask(client, token, ana, 1, 2))

    assert body["status"] == "approved"
    assert body["shifts_cleared"] == 2
    assert body["published_cleared"] == 2
    assert body["hours_cleared"] == 16.0

    # And the rota agrees: the fifth day is all that is left of her week.
    left = [a for a in _published(client, token) if a["employee_id"] == ana]
    assert len(left) == 1
    assert left[0]["start_at"].startswith(_day(5).date().isoformat())


@skip_no_db
def test_it_leaves_everybody_else_where_they_were(client):
    """The hole is one person's. Nobody else's shift moves to fill it here."""
    token = _signup(client)
    ana, ben = _add(client, token, "Ana"), _add(client, token, "Ben")
    _publish(client, token, [_shift(ana, 1), _shift(ben, 1), _shift(ben, 2)])

    body = _approve(client, token, _ask(client, token, ana, 1, 1))

    assert body["shifts_cleared"] == 1
    assert len([a for a in _published(client, token) if a["employee_id"] == ben]) == 2


@skip_no_db
def test_the_night_before_a_day_off_is_still_worked(client):
    """A shift that opens at 22:00 and runs past midnight into the first day
    off belongs to the evening before, which is a day the person worked.

    Same rule the generator uses: `availability.ts` blocks a DAY, and that
    night belongs to the day before. Deleting it would take an evening of pay
    off somebody for a holiday that starts tomorrow.
    """
    token = _signup(client)
    ana = _add(client, token)
    _publish(client, token, [_shift(ana, 0, hour=22, hours=6)])

    body = _approve(client, token, _ask(client, token, ana, 1, 2))

    assert body["shifts_cleared"] == 0
    assert len([a for a in _published(client, token) if a["employee_id"] == ana]) == 1


@skip_no_db
def test_a_drafted_shift_goes_too(client):
    """Or the conflict is handed straight back at publish time."""
    token = _signup(client)
    ana = _add(client, token)
    saved = client.put(
        "/api/v1/schedule/draft",
        headers=_auth(token),
        json={
            "period_start": _day(0).isoformat(),
            "period_end": _day(7).isoformat(),
            "shifts": [_shift(ana, 1), _shift(ana, 4)],
        },
    )
    assert saved.status_code in (200, 201), saved.text

    body = _approve(client, token, _ask(client, token, ana, 1, 1))

    assert body["shifts_cleared"] == 1
    # Drafted, so nobody had been told about it.
    assert body["published_cleared"] == 0
    read = client.get(
        "/api/v1/schedule/draft",
        headers=_auth(token),
        params={"from": _day(0).isoformat(), "to": _day(7).isoformat()},
    )
    assert read.status_code == 200, read.text
    assert len(read.json()) == 1


@skip_no_db
def test_an_absence_over_an_empty_week_clears_nothing_and_says_so(client):
    token = _signup(client)
    ana = _add(client, token)

    body = _approve(client, token, _ask(client, token, ana, 1, 3))

    assert body["shifts_cleared"] == 0
    assert body["hours_cleared"] == 0.0


@skip_no_db
def test_publishing_cannot_put_an_absent_person_back_on_the_rota(client):
    """The guarantee behind the tidy-up.

    The manager's draft lives in their browser. Approving from the Absences
    page empties the shifts on the server, but a dashboard that was already
    open still holds its own copy -- and the next publish would put the absent
    person straight back on the rota and, now that publishing writes to the
    team, tell them about it.
    """
    token = _signup(client)
    ana, ben = _add(client, token, "Ana"), _add(client, token, "Ben")
    _publish(client, token, [_shift(ana, 1), _shift(ben, 1)])
    _approve(client, token, _ask(client, token, ana, 1, 1))

    # The stale browser publishes the week it was holding, Ana included.
    resp = _publish(client, token, [_shift(ana, 1), _shift(ben, 1)])
    body = resp.json()

    assert body["skipped_on_leave"] == 1
    assert body["published"] == 1
    live = _published(client, token)
    assert [a["employee_id"] for a in live] == [ben]
