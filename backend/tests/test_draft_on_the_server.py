from __future__ import annotations

"""The draft lives on the server, and stays the manager's.

Until now the unpublished rota lived in one browser's localStorage, so a
manager who started a week on the office PC and opened the laptop at home
found nothing. Keeping the draft in ``assignment`` as ``status = 'draft'``
rows fixes that -- and creates a new way to get it wrong: the same table, the
same window, the same employees, now holding two versions of the week at
once. Every test here is about keeping the two apart.

The rota an employee reads must never contain a draft row. The draft the
manager reads must never contain a published one. A draft may overlap the
rota it is about to replace, but not itself. Publishing swallows the draft.
An employee cannot see or write the draft at all, and neither can another
organization.

Like ``test_removed_employee_is_gone``, the module skips itself when no
Postgres is reachable so the suite still passes offline.
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


DB_AVAILABLE = _db_available()

skip_no_db = pytest.mark.skipif(
    not DB_AVAILABLE,
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


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _signup(client, label: str = "Draft Co") -> tuple[str, str]:
    email = "owner+%s@example.com" % uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "%s %s" % (label, uuid.uuid4().hex[:6]),
            "email": email,
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], body["user"]["org_id"]


def _add(client, token: str, name: str) -> dict:
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
    return resp.json()


def _employee_token(client, manager_token: str, employee_id: str) -> str:
    """A login for one employee, so their own app can read the rota."""
    account = client.post(
        "/api/v1/employees/%s/account" % employee_id,
        headers=_auth(manager_token),
        json={
            "email": "staff+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
        },
    )
    assert account.status_code == 201, account.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": account.json()["email"], "password": "s3cret-pass"},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"]


def _window():
    """A week starting a week from today, as aware instants."""
    start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=7)
    return start, start + timedelta(days=7)


def _shift(employee_id: str, start: datetime, hours: int = 8, day: int = 0) -> dict:
    at = start + timedelta(days=day, hours=9)
    return {
        "employee_id": employee_id,
        "start_at": at.isoformat(),
        "end_at": (at + timedelta(hours=hours)).isoformat(),
        "computed_cost": 80.0,
    }


def _body(start: datetime, end: datetime, shifts: list) -> dict:
    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "shifts": shifts,
    }


def _params(start: datetime, end: datetime) -> dict:
    return {"from": start.isoformat(), "to": end.isoformat()}


def _put_draft(client, token: str, start, end, shifts: list):
    return client.put(
        "/api/v1/schedule/draft", headers=_auth(token), json=_body(start, end, shifts)
    )


def _get_draft(client, token: str, start, end):
    return client.get(
        "/api/v1/schedule/draft", headers=_auth(token), params=_params(start, end)
    )


def _get_rota(client, token: str, start, end):
    return client.get(
        "/api/v1/schedule/assignments",
        headers=_auth(token),
        params=_params(start, end),
    )


def _publish(client, token: str, start, end, shifts: list):
    return client.post(
        "/api/v1/schedule/publish", headers=_auth(token), json=_body(start, end, shifts)
    )


def _keys(rows: list) -> set:
    """What identifies a shift to the client: who, and when.

    Compared as instants, not strings: the server answers in UTC and the
    request may have been written in any offset.
    """
    return {
        (
            r["employee_id"],
            datetime.fromisoformat(r["start_at"]),
            datetime.fromisoformat(r["end_at"]),
        )
        for r in rows
    }


# --- 1. Round trip, replace, clear -------------------------------------------


@skip_no_db
def test_put_then_get_returns_the_draft_and_a_second_put_replaces_it(client):
    token, _org = _signup(client)
    ana = _add(client, token, "Ana")
    ben = _add(client, token, "Ben")
    start, end = _window()

    first = [_shift(ana["id"], start, day=0), _shift(ben["id"], start, day=1)]
    saved = _put_draft(client, token, start, end, first)
    assert saved.status_code == 200, saved.text
    assert saved.json()["saved"] == 2
    assert saved.json()["replaced"] == 0
    assert saved.json()["saved_at"]

    got = _get_draft(client, token, start, end)
    assert got.status_code == 200, got.text
    rows = got.json()
    assert _keys(rows) == _keys(first)
    assert {r["status"] for r in rows} == {"draft"}
    assert all(r["published_at"] is None for r in rows)

    # A second save is a REPLACE for the window, not an append.
    second = [_shift(ana["id"], start, day=2)]
    again = _put_draft(client, token, start, end, second)
    assert again.status_code == 200, again.text
    assert again.json() | {"saved_at": None} == {
        "saved": 1,
        "replaced": 2,
        "saved_at": None,
    }
    assert _keys(_get_draft(client, token, start, end).json()) == _keys(second)

    # And an empty save is how the draft is cleared, not an error.
    cleared = _put_draft(client, token, start, end, [])
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["saved"] == 0
    assert cleared.json()["replaced"] == 1
    assert _get_draft(client, token, start, end).json() == []


# --- 2. The two readers never see each other's rows --------------------------


@skip_no_db
def test_employees_read_the_rota_and_managers_read_both_apart(client):
    token, _org = _signup(client)
    ana = _add(client, token, "Ana")
    ben = _add(client, token, "Ben")
    start, end = _window()

    # The draft and the rota disagree on purpose: Ana on Monday in the draft,
    # Ben on Tuesday on the noticeboard.
    draft = [_shift(ana["id"], start, day=0)]
    rota = [_shift(ben["id"], start, day=1)]
    assert _put_draft(client, token, start, end, draft).status_code == 200
    assert _publish(client, token, start, end, rota).status_code == 200
    # Publishing sweeps the window, so the draft is written again afterwards
    # to have both present at once (test 4 covers the sweep itself).
    assert _put_draft(client, token, start, end, draft).status_code == 200

    # The employee, on their own app, sees the rota only -- and only theirs.
    ana_token = _employee_token(client, token, ana["id"])
    ben_token = _employee_token(client, token, ben["id"])
    seen_by_ana = _get_rota(client, ana_token, start, end).json()
    assert seen_by_ana == []
    seen_by_ben = _get_rota(client, ben_token, start, end).json()
    assert _keys(seen_by_ben) == _keys(rota)
    assert {r["status"] for r in seen_by_ben} == {"published"}

    # The manager's rota read is published only, and the draft read is draft
    # only. Neither list carries a row of the other kind.
    managers_rota = _get_rota(client, token, start, end).json()
    assert _keys(managers_rota) == _keys(rota)
    assert {r["status"] for r in managers_rota} == {"published"}
    managers_draft = _get_draft(client, token, start, end).json()
    assert _keys(managers_draft) == _keys(draft)
    assert {r["status"] for r in managers_draft} == {"draft"}


# --- 3. Overlap: allowed across statuses, refused within one -----------------


@skip_no_db
def test_a_draft_may_overlap_the_rota_but_not_itself(client):
    token, _org = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()

    # Monday 09-17 on the noticeboard...
    assert (
        _publish(client, token, start, end, [_shift(ana["id"], start, day=0)]).status_code
        == 200
    )
    # ...and Monday 09-17 again in the draft, for the same person. That is the
    # normal state of a week being reworked, not a double booking.
    same_hours = _put_draft(client, token, start, end, [_shift(ana["id"], start, day=0)])
    assert same_hours.status_code == 200, same_hours.text

    # Two draft shifts that overlap for the same person ARE a double booking.
    monday_9_17 = _shift(ana["id"], start, day=0)
    monday_12_20 = _shift(ana["id"], start, day=0)
    monday_12_20["start_at"] = (start + timedelta(hours=12)).isoformat()
    monday_12_20["end_at"] = (start + timedelta(hours=20)).isoformat()
    clash = _put_draft(client, token, start, end, [monday_9_17, monday_12_20])
    assert clash.status_code == 409, clash.text

    # The failed save was atomic: the previous draft is still there, whole.
    assert _keys(_get_draft(client, token, start, end).json()) == _keys(
        [_shift(ana["id"], start, day=0)]
    )


# --- 4. Publishing swallows the draft ----------------------------------------


@skip_no_db
def test_publish_clears_the_draft_for_the_window(client):
    token, _org = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()
    next_start, next_end = end, end + timedelta(days=7)

    assert (
        _put_draft(client, token, start, end, [_shift(ana["id"], start, day=0)]).status_code
        == 200
    )
    # A draft for the FOLLOWING week, which must survive.
    assert (
        _put_draft(
            client, token, next_start, next_end, [_shift(ana["id"], next_start, day=0)]
        ).status_code
        == 200
    )

    published = _publish(
        client, token, start, end, [_shift(ana["id"], start, day=3)]
    )
    assert published.status_code == 200, published.text
    # The draft row counted among the replaced: it was in the window.
    assert published.json()["replaced"] == 1

    assert _get_draft(client, token, start, end).json() == []
    assert len(_get_draft(client, token, next_start, next_end).json()) == 1


# --- 5. Employees have no draft ----------------------------------------------


@skip_no_db
def test_an_employee_cannot_read_or_write_the_draft(client):
    token, _org = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()
    ana_token = _employee_token(client, token, ana["id"])

    read = _get_draft(client, ana_token, start, end)
    assert read.status_code == 403, read.text
    write = _put_draft(client, ana_token, start, end, [_shift(ana["id"], start)])
    assert write.status_code == 403, write.text
    # Nothing was written on the way to the refusal.
    assert _get_draft(client, token, start, end).json() == []


# --- 6. Tenant isolation -----------------------------------------------------


@skip_no_db
def test_another_organization_cannot_read_the_draft(client):
    token_a, _org_a = _signup(client, "Org A")
    token_b, _org_b = _signup(client, "Org B")
    ana = _add(client, token_a, "Ana from A")
    start, end = _window()

    assert (
        _put_draft(client, token_a, start, end, [_shift(ana["id"], start)]).status_code
        == 200
    )

    assert _get_draft(client, token_b, start, end).json() == []
    # Nor write into it: B's save names A's employee and is refused outright.
    theirs = _put_draft(client, token_b, start, end, [_shift(ana["id"], start)])
    assert theirs.status_code == 422, theirs.text
    assert "Unknown employee" in theirs.text
    # A's draft is exactly as A left it.
    assert len(_get_draft(client, token_a, start, end).json()) == 1


@skip_no_db
def test_the_draft_is_committed_before_the_response_leaves(client):
    """A GET fired the instant the PUT answers sees the new rows.

    `get_db` commits when the request closes, and FastAPI closes it after the
    body is sent; a client that refetches on 200 would otherwise read the
    draft of before and adopt it over the one it just saved. The write
    endpoints commit themselves. Under TestClient the two requests are
    serialised, so this proves the endpoint commits, not the race -- the race
    is why it must: a fresh session, opened right after the 200, sees the row.
    """
    from sqlalchemy import func, select

    from app.db import AppSessionLocal, set_current_org
    from app.models.assignment import Assignment

    token, org_id = _signup(client)
    emp = _add(client, token, "Sarah")
    start, end = _window()
    assert _put_draft(client, token, start, end, [_shift(emp["id"], start)]).status_code == 200

    db = AppSessionLocal()
    try:
        set_current_org(db, uuid.UUID(org_id))
        n = db.execute(
            select(func.count()).select_from(Assignment).where(Assignment.status == "draft")
        ).scalar()
    finally:
        db.close()
    assert n == 1
