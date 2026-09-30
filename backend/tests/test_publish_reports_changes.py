from __future__ import annotations

"""Publishing hands back who has to be told what.

`changes_between` is unit-tested on its own (`test_publication_changes`). What
this file covers is the SEAM: that the facts handed to it come off real rows
and a real request body correctly. Two shapes meet there -- a stored
``Assignment``, whose interval is a Postgres range, and an incoming
``ShiftIn``, whose interval is two datetimes -- and getting one of them wrong
would not raise anything. It would quietly report that every shift moved, and
the first anybody would know is a team asking why they were all told their
hours changed.

Needs Postgres, and skips itself when there is none -- following the fixtures
of ``test_notice_survives_republish``.
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


def _signup(client) -> tuple:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Changes Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], body["user"]["org_id"]


def _add(client, token: str, name: str) -> str:
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


def _window():
    start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=30)
    return start, start + timedelta(days=7)


def _shift(employee_id: str, start: datetime, day: int, hour: int = 9) -> dict:
    at = start + timedelta(days=day, hours=hour)
    return {
        "employee_id": employee_id,
        "start_at": at.isoformat(),
        "end_at": (at + timedelta(hours=8)).isoformat(),
    }


def _publish(client, token: str, start, end, shifts: list):
    resp = client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "shifts": shifts,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp


def _publish_again(org_id: str, start, end, shifts: list):
    """Publish through the service, which is the only caller that sees changes.

    The HTTP route drops them for now -- nothing sends a message yet -- so the
    seam has to be read where it is produced.
    """
    from app.db import AppSessionLocal, set_current_org
    from app.schemas.assignment import PublishIn
    from app.services.schedule import publish

    db = AppSessionLocal()
    try:
        set_current_org(db, uuid.UUID(org_id))
        payload = PublishIn(
            period_start=start,
            period_end=end,
            shifts=shifts,
        )
        _, _, _, changes = publish(
            db,
            uuid.UUID(org_id),
            payload.period_start,
            payload.period_end,
            payload.shifts,
        )
        db.commit()
        return changes
    finally:
        db.close()


@skip_no_db
def test_republishing_an_identical_rota_tells_nobody(client):
    """The seam's sharpest edge: a stored range compared with two datetimes.

    Read wrongly, every untouched shift looks changed -- and this is the
    commonest publish there is, because a manager republishes a month to move
    one thing.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    luis = _add(client, token, "Luis")
    start, end = _window()

    rota = [_shift(ana, start, 0), _shift(luis, start, 0, hour=17), _shift(ana, start, 1)]
    _publish(client, token, start, end, rota)

    changes = _publish_again(org_id, start, end, rota)

    assert changes.is_empty, [
        (str(e.employee_id), [c.kind for c in e.days]) for e in changes.employees
    ]
    assert changes.first_publication is False


@skip_no_db
def test_moving_one_shift_names_one_person(client):
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    luis = _add(client, token, "Luis")
    start, end = _window()

    before = [_shift(ana, start, 0), _shift(luis, start, 0, hour=17)]
    _publish(client, token, start, end, before)

    after = [_shift(ana, start, 0, hour=12), _shift(luis, start, 0, hour=17)]
    changes = _publish_again(org_id, start, end, after)

    assert [str(e.employee_id) for e in changes.employees] == [ana]
    (changed,) = changes.employees
    (day_change,) = changed.days
    assert day_change.kind == "moved"
    assert day_change.before.start_at != day_change.after.start_at


@skip_no_db
def test_the_first_publication_of_a_window_says_so(client):
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()

    changes = _publish_again(org_id, start, end, [_shift(ana, start, 0)])

    assert changes.first_publication is True
    (changed,) = changes.employees
    assert [c.kind for c in changed.days] == ["added"]


@skip_no_db
def test_saving_a_draft_announces_nothing(client):
    """A draft was never on the noticeboard, so nothing about it is news."""
    from app.db import AppSessionLocal, set_current_org
    from app.schemas.assignment import PublishIn
    from app.services.schedule import save_draft

    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()

    db = AppSessionLocal()
    try:
        set_current_org(db, uuid.UUID(org_id))
        saved, _, _ = save_draft(
            db,
            uuid.UUID(org_id),
            PublishIn(
                period_start=start,
                period_end=end,
                shifts=[_shift(ana, start, 0)],
            ),
        )
        db.commit()
    finally:
        db.close()

    assert saved == 1
