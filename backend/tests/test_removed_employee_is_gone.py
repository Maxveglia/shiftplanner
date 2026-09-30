from __future__ import annotations

"""Removing somebody is reversible, and everywhere at once.

Removal stopped being ``DELETE FROM employee`` and became a mark on the row, so
that the manager can undo it. That trade is only worth making if the mark is
honoured by EVERY read. A row that is still in the table and still answers a
query is a person who is off the roster on one screen and on the rota on
another -- and the rota is the one somebody turns up for.

So the interesting test here is not "delete works". It is the sweep: one
employee, removed once, checked against every place that used to list, resolve
or count them -- the roster, the file, the contracts, the balance, the absences,
the published shifts, the employee's own login, and the two numbers a platform
operator reads about this customer. Each of those used to be emptied by ON
DELETE CASCADE; each of them has to look the same now.

Then the half that is new: undo puts them back whole, with the same code and
the same position, and none of it crosses an organization boundary.

Like ``test_tenant_isolation``, the module skips itself when no Postgres is
reachable so the suite still passes offline.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.filterwarnings("ignore")

ADMIN_PASSWORD = "removed-employee-test-password"


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


@pytest.fixture(scope="module")
def admin_token(client):
    from app.db import AdminSessionLocal
    from app.seeds.platform_admin import ensure_platform_admin

    email = "operator+%s@example.com" % uuid.uuid4().hex[:8]
    db = AdminSessionLocal()
    try:
        ensure_platform_admin(
            db, email=email, password=ADMIN_PASSWORD, full_name="Test Operator"
        )
        db.commit()
    finally:
        db.close()

    resp = client.post(
        "/api/v1/backoffice/login",
        json={"email": email, "password": ADMIN_PASSWORD},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _signup(client, label: str = "Roster Co") -> tuple[str, str]:
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


def _add(client, token: str, name: str, external_id=None) -> dict:
    resp = client.post(
        "/api/v1/employees",
        headers=_auth(token),
        json={
            "external_id": external_id,
            "full_name": name,
            "email": None,
            "employment_status": "active",
            "hire_date": "2025-01-01",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _ids(client, token: str) -> list:
    resp = client.get("/api/v1/employees", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    return [e["id"] for e in resp.json()]


def _window():
    """A week starting next Monday-ish, as aware instants."""
    start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=7)
    return start, start + timedelta(days=7)


# --- The sweep: gone from every read -----------------------------------------


@skip_no_db
def test_a_removed_employee_is_gone_from_every_read(client):
    token, _org_id = _signup(client)
    keeper = _add(client, token, "Keeper")
    victim = _add(client, token, "Victim")
    vid = victim["id"]

    # Their time off, on the books before the removal.
    types = client.get("/api/v1/absence-types", headers=_auth(token)).json()
    vac = next(t for t in types if t["code"] == "VAC")
    start, end = _window()
    absence = client.post(
        "/api/v1/absences",
        headers=_auth(token),
        json={
            "employee_id": vid,
            "absence_type_id": vac["id"],
            "start_at": start.isoformat(),
            "end_at": (start + timedelta(days=1)).isoformat(),
            "note": None,
        },
    )
    assert absence.status_code == 201, absence.text
    absence_id = absence.json()["id"]

    # A published shift, which somebody would otherwise turn up for.
    published = client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "shifts": [
                {
                    "employee_id": vid,
                    "start_at": (start + timedelta(hours=9)).isoformat(),
                    "end_at": (start + timedelta(hours=17)).isoformat(),
                },
                {
                    "employee_id": keeper["id"],
                    "start_at": (start + timedelta(hours=9)).isoformat(),
                    "end_at": (start + timedelta(hours=17)).isoformat(),
                },
            ],
        },
    )
    assert published.status_code == 200, published.text

    # And a login, so the person's own app has something to lose.
    account = client.post(
        "/api/v1/employees/%s/account" % vid,
        headers=_auth(token),
        json={
            "email": "victim+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
        },
    )
    assert account.status_code == 201, account.text
    employee_token = client.post(
        "/api/v1/auth/login",
        json={"email": account.json()["email"], "password": "s3cret-pass"},
    ).json()["access_token"]
    assert (
        client.get("/api/v1/me/profile", headers=_auth(employee_token)).status_code
        == 200
    )

    removed = client.delete("/api/v1/employees/%s" % vid, headers=_auth(token))
    assert removed.status_code == 204, removed.text

    params = {"from": start.isoformat(), "to": end.isoformat()}

    # 1. The roster.
    assert vid not in _ids(client, token)
    # 2. The file.
    assert client.get("/api/v1/employees/%s" % vid, headers=_auth(token)).status_code == 404
    # 3. The contract history and 4. the vacation balance.
    assert (
        client.get("/api/v1/employees/%s/contracts" % vid, headers=_auth(token)).status_code
        == 404
    )
    assert (
        client.get(
            "/api/v1/employees/%s/vacation-balance" % vid, headers=_auth(token)
        ).status_code
        == 404
    )
    # 5. The absences screen -- and the approval that would post a ledger row.
    listed = client.get("/api/v1/absences", headers=_auth(token))
    assert listed.status_code == 200, listed.text
    assert absence_id not in [a["id"] for a in listed.json()]
    assert (
        client.post(
            "/api/v1/absences/%s/approve" % absence_id, headers=_auth(token)
        ).status_code
        == 404
    )
    # 6. The published rota -- theirs is gone, the colleague's is untouched.
    shifts = client.get(
        "/api/v1/schedule/assignments", headers=_auth(token), params=params
    )
    assert shifts.status_code == 200, shifts.text
    owners = [s["employee_id"] for s in shifts.json()]
    assert vid not in owners
    assert keeper["id"] in owners
    # 7. Their own app. Since 28-sep-2026 the login goes with them
    # (routers/employees.py): the session they had open ends -- a 401, not a
    # door still open onto a profile that is a 404 and an empty rota.
    assert (
        client.get("/api/v1/me/profile", headers=_auth(employee_token)).status_code
        == 401
    )
    assert (
        client.get(
            "/api/v1/schedule/assignments", headers=_auth(employee_token), params=params
        ).status_code
        == 401
    )
    # 8. The manager's access card for them.
    assert (
        client.get("/api/v1/employees/%s/account" % vid, headers=_auth(token)).status_code
        == 404
    )


@skip_no_db
def test_a_removed_employee_cannot_be_given_a_shift(client):
    token, _org_id = _signup(client)
    gone = _add(client, token, "Gone")
    client.delete("/api/v1/employees/%s" % gone["id"], headers=_auth(token))

    start, end = _window()
    resp = client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "shifts": [
                {
                    "employee_id": gone["id"],
                    "start_at": (start + timedelta(hours=9)).isoformat(),
                    "end_at": (start + timedelta(hours=17)).isoformat(),
                }
            ],
        },
    )
    # Refused by name, not accepted and then hidden: a manager who publishes a
    # shift has to be told it did not happen.
    assert resp.status_code == 422, resp.text
    assert "Unknown employee" in resp.text


@skip_no_db
def test_removal_closes_ranks_and_undo_reopens_them(client):
    """``display_number`` is 1..N with no gaps, before and after."""
    token, _org_id = _signup(client)
    first = _add(client, token, "First")
    second = _add(client, token, "Second")
    third = _add(client, token, "Third")

    client.delete("/api/v1/employees/%s" % second["id"], headers=_auth(token))

    after = client.get("/api/v1/employees", headers=_auth(token)).json()
    assert [e["display_number"] for e in after] == [1, 2]
    assert [e["id"] for e in after] == [first["id"], third["id"]]

    restored = client.post(
        "/api/v1/employees/%s/restore" % second["id"], headers=_auth(token)
    )
    assert restored.status_code == 200, restored.text
    # Back in the place they held, not appended: the order is by created_at.
    assert restored.json()["display_number"] == 2

    back = client.get("/api/v1/employees", headers=_auth(token)).json()
    assert [e["id"] for e in back] == [first["id"], second["id"], third["id"]]
    assert [e["display_number"] for e in back] == [1, 2, 3]


@skip_no_db
def test_undo_returns_the_person_whole(client):
    token, _org_id = _signup(client)
    person = _add(client, token, "Whole Again")
    pid = person["id"]

    client.delete("/api/v1/employees/%s" % pid, headers=_auth(token))
    client.post("/api/v1/employees/%s/restore" % pid, headers=_auth(token))

    again = client.get("/api/v1/employees/%s" % pid, headers=_auth(token))
    assert again.status_code == 200, again.text
    body = again.json()
    assert body["external_id"] == person["external_id"]
    assert body["full_name"] == person["full_name"]
    # The default contract survived the round trip -- without it this person is
    # on the roster and invisible to the scheduler, which is the failure mode
    # `test_employee_contract_invariant` exists to prevent.
    assert body["current_contract"] is not None


@skip_no_db
def test_undo_is_idempotent_and_a_second_removal_is_a_404(client):
    """The notice the manager clicks is about to vanish; a retry must be safe."""
    token, _org_id = _signup(client)
    person = _add(client, token, "Twice")
    pid = person["id"]

    client.delete("/api/v1/employees/%s" % pid, headers=_auth(token))
    assert client.delete("/api/v1/employees/%s" % pid, headers=_auth(token)).status_code == 404

    assert (
        client.post("/api/v1/employees/%s/restore" % pid, headers=_auth(token)).status_code
        == 200
    )
    assert (
        client.post("/api/v1/employees/%s/restore" % pid, headers=_auth(token)).status_code
        == 200
    )


@skip_no_db
def test_a_removed_employee_keeps_its_code_until_it_comes_back(client):
    """Otherwise undo would collide with whoever was given EMP-001 meanwhile."""
    token, _org_id = _signup(client)
    first = _add(client, token, "First")
    assert first["external_id"] == "EMP-001"

    client.delete("/api/v1/employees/%s" % first["id"], headers=_auth(token))

    second = _add(client, token, "Second")
    assert second["external_id"] == "EMP-002"

    restored = client.post(
        "/api/v1/employees/%s/restore" % first["id"], headers=_auth(token)
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["external_id"] == "EMP-001"


# --- The operator's numbers --------------------------------------------------


@skip_no_db
def test_the_back_office_stops_counting_a_removed_employee(client, admin_token):
    token, org_id = _signup(client, "Counted Co")
    _add(client, token, "Stays")
    leaves = _add(client, token, "Leaves")

    metrics_url = "/api/v1/backoffice/metrics"
    detail_url = "/api/v1/backoffice/customers/%s" % org_id
    list_url = "/api/v1/backoffice/customers"

    before_total = client.get(metrics_url, headers=_auth(admin_token)).json()["people"][
        "employees_total"
    ]
    before_detail = client.get(detail_url, headers=_auth(admin_token)).json()
    assert before_detail["employees"] == 2
    assert before_detail["employees_by_status"]["active"] == 2

    client.delete("/api/v1/employees/%s" % leaves["id"], headers=_auth(token))

    after_total = client.get(metrics_url, headers=_auth(admin_token)).json()["people"][
        "employees_total"
    ]
    assert after_total == before_total - 1

    after_detail = client.get(detail_url, headers=_auth(admin_token)).json()
    assert after_detail["employees"] == 1
    assert after_detail["employees_by_status"]["active"] == 1

    row = next(
        c
        for c in client.get(
            list_url, headers=_auth(admin_token), params={"q": before_detail["org_name"]}
        ).json()["items"]
        if c["org_id"] == org_id
    )
    assert row["employees"] == 1

    # Undo is visible to the operator too -- the number is derived, not stored.
    client.post("/api/v1/employees/%s/restore" % leaves["id"], headers=_auth(token))
    assert client.get(detail_url, headers=_auth(admin_token)).json()["employees"] == 2


# --- The barrier is unchanged ------------------------------------------------


@skip_no_db
def test_removing_and_restoring_never_crosses_an_organization(client):
    """The new filter is added to the org filter, never in place of it."""
    token_a, _org_a = _signup(client, "Org A")
    token_b, _org_b = _signup(client, "Org B")

    theirs = _add(client, token_b, "Bob from B")

    # A cannot remove B's employee...
    assert (
        client.delete("/api/v1/employees/%s" % theirs["id"], headers=_auth(token_a)).status_code
        == 404
    )
    assert theirs["id"] in _ids(client, token_b)

    # ...and cannot restore one either, which is the endpoint that deliberately
    # looks past `deleted_at`. Looking past the ORG would be the leak.
    client.delete("/api/v1/employees/%s" % theirs["id"], headers=_auth(token_b))
    assert (
        client.post(
            "/api/v1/employees/%s/restore" % theirs["id"], headers=_auth(token_a)
        ).status_code
        == 404
    )
    assert theirs["id"] not in _ids(client, token_b)

    # B can, and nothing about A moved.
    assert (
        client.post(
            "/api/v1/employees/%s/restore" % theirs["id"], headers=_auth(token_b)
        ).status_code
        == 200
    )
    assert theirs["id"] in _ids(client, token_b)
    assert theirs["id"] not in _ids(client, token_a)
