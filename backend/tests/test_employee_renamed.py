from __future__ import annotations

"""Correcting somebody's name from the roster.

A name is typed by a person in a hurry on the day somebody is hired, and it is
the one field every other screen identifies them by. So it is editable in the
list itself -- and the only thing worth testing about that is what the manager
would blame the feature for: a correction that appears to save and is not
there on the next read, and a correction that reaches the wrong organization.

Like ``test_removed_employee_is_gone``, the module skips itself when no
Postgres is reachable so the suite still passes offline.
"""

import uuid

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


def _rename(client, token: str, employee_id: str, name: str):
    return client.patch(
        "/api/v1/employees/%s" % employee_id,
        headers=_auth(token),
        json={"full_name": name},
    )


@skip_no_db
def test_a_corrected_name_is_the_name_on_every_read(client):
    """And nothing else about the person moves with it."""
    token, _org_id = _signup(client)
    emp = _add(client, token, "Ana Ruis")

    renamed = _rename(client, token, emp["id"], "Ana Ruiz")
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["full_name"] == "Ana Ruiz"

    # The code, the position in the list and the hire date are what the rest of
    # the product joins on. A rename that quietly reissued any of them would
    # break the link to contracts and shifts already signed under the old row.
    for field in ("id", "external_id", "display_number", "hire_date", "employment_status"):
        assert renamed.json()[field] == emp[field], field

    roster = client.get("/api/v1/employees", headers=_auth(token)).json()
    assert [e["full_name"] for e in roster if e["id"] == emp["id"]] == ["Ana Ruiz"]
    file = client.get("/api/v1/employees/%s" % emp["id"], headers=_auth(token))
    assert file.json()["full_name"] == "Ana Ruiz"


@skip_no_db
def test_the_new_name_is_committed_before_the_response_leaves(client):
    """A roster refetched the instant the PATCH answers reads the new name.

    `get_db` commits when the request closes, and FastAPI closes it after the
    body is sent. The list refetches itself on 200, so without the endpoint's
    own commit the corrected name would be replaced on screen by the old one
    -- the exact failure the manager reads as "it did not save". Under
    TestClient the two requests are serialised, so this proves the endpoint
    commits, not that the race is survivable.
    """
    from sqlalchemy import select

    from app.db import AppSessionLocal, set_current_org
    from app.models.employee import Employee

    token, org_id = _signup(client)
    emp = _add(client, token, "Ana Ruis")
    assert _rename(client, token, emp["id"], "Ana Ruiz").status_code == 200

    db = AppSessionLocal()
    try:
        set_current_org(db, uuid.UUID(org_id))
        name = db.execute(
            select(Employee.full_name).where(Employee.id == uuid.UUID(emp["id"]))
        ).scalar()
    finally:
        db.close()
    assert name == "Ana Ruiz"


@skip_no_db
def test_nobody_renames_an_employee_of_another_organization(client):
    token_a, _ = _signup(client, "Org A")
    token_b, _ = _signup(client, "Org B")
    theirs = _add(client, token_a, "Ana Ruiz")

    refused = _rename(client, token_b, theirs["id"], "Somebody Else")
    assert refused.status_code == 404, refused.text
    assert (
        client.get("/api/v1/employees/%s" % theirs["id"], headers=_auth(token_a)).json()[
            "full_name"
        ]
        == "Ana Ruiz"
    )
