from __future__ import annotations

"""Back-office checks.

Three things are worth a test here and they are not the arithmetic:

1. **The two planes do not touch.** A manager's token must not open the back
   office, and an operator's token must not open a tenant. Everything else in
   this feature rests on that.
2. **Paying means paying.** A fresh signup is a trial, not a customer; it
   becomes one only when the operator moves it, and the headline count follows.
3. **The operator cannot see a customer's staff.** The detail endpoint returns
   totals; an employee's name must not appear anywhere in the response.

Like ``test_tenant_isolation``, the module skips itself when no Postgres is
reachable so the suite still passes offline.
"""

import uuid

import pytest

pytestmark = pytest.mark.filterwarnings("ignore")

ADMIN_PASSWORD = "back-office-test-password"


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
    """A platform admin created straight through the seed helper.

    Deliberately not through an HTTP route -- there is no route that creates
    one, which is the point of the fixture being written this way.
    """
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


def _signup(client, org_name: str) -> tuple[str, str]:
    email = "owner+%s@example.com" % uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": org_name,
            "email": email,
            "password": "s3cret-pass",
            "full_name": "Owner " + org_name,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], body["user"]["org_id"]


# --- The two planes do not touch --------------------------------------------


@skip_no_db
def test_manager_token_cannot_reach_the_back_office(client):
    token, _org_id = _signup(client, "Tenant Co %s" % uuid.uuid4().hex[:6])

    for path in ("/api/v1/backoffice/metrics", "/api/v1/backoffice/customers"):
        resp = client.get(path, headers=_auth(token))
        assert resp.status_code == 401, "%s leaked to a manager token" % path


@skip_no_db
def test_platform_token_cannot_reach_tenant_data(client, admin_token):
    resp = client.get("/api/v1/employees", headers=_auth(admin_token))
    assert resp.status_code == 401


@skip_no_db
def test_back_office_requires_a_token(client):
    assert client.get("/api/v1/backoffice/metrics").status_code in (401, 403)


@skip_no_db
def test_there_is_no_back_office_signup(client):
    resp = client.post(
        "/api/v1/backoffice/signup",
        json={"email": "intruder@example.com", "password": "whatever"},
    )
    assert resp.status_code == 404


# --- Paying means paying -----------------------------------------------------


@skip_no_db
def test_signup_creates_a_trial_not_a_customer(client, admin_token):
    _token, org_id = _signup(client, "Trial Co %s" % uuid.uuid4().hex[:6])

    resp = client.get(
        "/api/v1/backoffice/customers/%s" % org_id, headers=_auth(admin_token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "trialing"
    assert body["plan"] == "trial"
    assert body["trial_ends_at"] is not None
    assert body["activated_at"] is None
    # The owner is reachable -- that is the point of listing administrators.
    assert body["owner_email"]
    assert body["managers"] == 1


@skip_no_db
def test_activating_a_customer_moves_the_paying_count(client, admin_token):
    before = client.get(
        "/api/v1/backoffice/metrics", headers=_auth(admin_token)
    ).json()["customers"]["paying"]

    _token, org_id = _signup(client, "Paying Co %s" % uuid.uuid4().hex[:6])

    updated = client.patch(
        "/api/v1/backoffice/customers/%s/subscription" % org_id,
        headers=_auth(admin_token),
        json={"plan": "growth", "status": "active", "seats": 5},
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["status"] == "active"
    assert body["plan"] == "growth"
    assert body["seats"] == 5
    # Stamped on first activation, so "converted in month X" stays answerable.
    assert body["activated_at"] is not None

    after = client.get(
        "/api/v1/backoffice/metrics", headers=_auth(admin_token)
    ).json()["customers"]["paying"]
    assert after == before + 1


@skip_no_db
def test_cancelling_stamps_churn_and_leaves_the_conversion_intact(
    client, admin_token
):
    _token, org_id = _signup(client, "Churn Co %s" % uuid.uuid4().hex[:6])
    url = "/api/v1/backoffice/customers/%s/subscription" % org_id

    activated = client.patch(
        url, headers=_auth(admin_token), json={"status": "active", "plan": "starter"}
    ).json()
    canceled = client.patch(
        url, headers=_auth(admin_token), json={"status": "canceled"}
    ).json()

    assert canceled["status"] == "canceled"
    assert canceled["canceled_at"] is not None
    assert canceled["activated_at"] == activated["activated_at"]


@skip_no_db
def test_customer_list_filters_by_status_and_search(client, admin_token):
    name = "Findable Co %s" % uuid.uuid4().hex[:6]
    _token, org_id = _signup(client, name)

    found = client.get(
        "/api/v1/backoffice/customers",
        headers=_auth(admin_token),
        params={"q": name, "status": "trialing"},
    )
    assert found.status_code == 200, found.text
    ids = [c["org_id"] for c in found.json()["items"]]
    assert org_id in ids

    # Same org, wrong status filter -> absent.
    missing = client.get(
        "/api/v1/backoffice/customers",
        headers=_auth(admin_token),
        params={"q": name, "status": "canceled"},
    )
    assert org_id not in [c["org_id"] for c in missing.json()["items"]]


# --- Counts, never rosters ---------------------------------------------------


@skip_no_db
def test_customer_detail_counts_staff_without_naming_them(client, admin_token):
    token, org_id = _signup(client, "Private Co %s" % uuid.uuid4().hex[:6])

    secret_name = "Alice Verysecret %s" % uuid.uuid4().hex[:6]
    created = client.post(
        "/api/v1/employees",
        headers=_auth(token),
        json={
            "external_id": None,
            "full_name": secret_name,
            "email": "alice@private.example",
            "employment_status": "active",
            "hire_date": "2025-01-01",
        },
    )
    assert created.status_code == 201, created.text

    resp = client.get(
        "/api/v1/backoffice/customers/%s" % org_id, headers=_auth(admin_token)
    )
    assert resp.status_code == 200, resp.text

    assert resp.json()["employees"] == 1
    assert resp.json()["employees_by_status"].get("active") == 1
    # The whole privacy claim in one assertion: the operator learns the size of
    # the workforce and nothing about the people in it.
    assert secret_name not in resp.text
    assert "alice@private.example" not in resp.text


@skip_no_db
def test_metrics_are_counts_and_carry_no_amounts(client, admin_token):
    body = client.get(
        "/api/v1/backoffice/metrics", headers=_auth(admin_token)
    ).json()

    assert set(body["customers"]) == {
        "total",
        "paying",
        "trialing",
        "trial_expired",
        "past_due",
        "canceled",
    }
    assert all(isinstance(v, int) for v in body["customers"].values())
    assert body["customers"]["total"] >= body["customers"]["paying"]
    assert len(body["monthly"]) == 12
    assert {p["plan"] for p in body["by_plan"]} == {
        "trial",
        "starter",
        "growth",
        "scale",
    }
    # No revenue anywhere: the operator asked how many, not how much.
    for key in ("mrr", "arr", "revenue", "amount", "price"):
        assert key not in body


# --- Deleting a customer ----------------------------------------------------


def test_deleting_a_customer_requires_the_name_typed_back(client, admin_token):
    """The confirmation is checked on the server, not only in the UI.

    A destructive action guarded solely by a dialog is guarded by nothing the
    moment anything calls the API directly.
    """
    _token, org_id = _signup(client, "Typo Co %s" % uuid.uuid4().hex[:6])
    url = "/api/v1/backoffice/customers/%s" % org_id

    wrong = client.request(
        "DELETE", url, headers=_auth(admin_token), json={"confirm_name": "Typo"}
    )
    assert wrong.status_code == 400
    # Still there.
    assert client.get(url, headers=_auth(admin_token)).status_code == 200


def test_deleting_a_customer_needs_an_operator_token(client, admin_token):
    manager_token, org_id = _signup(client, "Guarded Co %s" % uuid.uuid4().hex[:6])
    url = "/api/v1/backoffice/customers/%s" % org_id
    name = client.get(url, headers=_auth(admin_token)).json()["org_name"]

    denied = client.request(
        "DELETE", url, headers=_auth(manager_token), json={"confirm_name": name}
    )
    assert denied.status_code in (401, 403)
    assert client.get(url, headers=_auth(admin_token)).status_code == 200


def test_deleting_a_customer_takes_their_data_and_the_headline_count_with_it(
    client, admin_token
):
    manager_token, org_id = _signup(client, "Gone Co %s" % uuid.uuid4().hex[:6])
    url = "/api/v1/backoffice/customers/%s" % org_id
    name = client.get(url, headers=_auth(admin_token)).json()["org_name"]

    # Give them something to lose, including an employee login.
    employee = client.post(
        "/api/v1/employees",
        headers=_auth(manager_token),
        json={
            "external_id": None,
            "full_name": "Doomed Person",
            "email": "doomed+%s@example.com" % uuid.uuid4().hex[:8],
            "employment_status": "active",
            "hire_date": "2025-01-01",
        },
    ).json()
    login_email = "emp+%s@example.com" % uuid.uuid4().hex[:8]
    assert (
        client.post(
            "/api/v1/employees/%s/account" % employee["id"],
            headers=_auth(manager_token),
            json={"email": login_email, "password": "employee-pass"},
        ).status_code
        == 201
    )

    before = client.get("/api/v1/backoffice/metrics", headers=_auth(admin_token)).json()

    deleted = client.request(
        "DELETE", url, headers=_auth(admin_token), json={"confirm_name": name}
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted_employees"] == 1
    assert deleted.json()["deleted_users"] == 2  # the manager and the employee

    assert client.get(url, headers=_auth(admin_token)).status_code == 404

    # The account is out of the count, not merely hidden.
    after = client.get("/api/v1/backoffice/metrics", headers=_auth(admin_token)).json()
    assert after["customers"]["total"] == before["customers"]["total"] - 1

    # And its people can no longer sign in.
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email": login_email, "password": "employee-pass"},
        ).status_code
        == 401
    )
