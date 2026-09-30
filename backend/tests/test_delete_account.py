"""Ending an account, which is the one irreversible thing a customer can do.

What these pin is not that a DELETE deletes -- it is that it cannot happen by
accident, cannot be aimed at anybody else, and when it does happen it leaves
nothing behind. A soft delete would pass a weaker version of the last one, and
a business that asked to be forgotten would still be in the table with its
staff's names in it.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from tests.test_business_profile import (  # noqa: F401 - fixtures by name
    _auth,
    _signup,
    client,
    skip_no_db,
)


def _org_name(client, token) -> str:
    return client.get("/api/v1/auth/me", headers=_auth(token)).json()["org_name"]


def _rows_left(org_id: str) -> dict:
    """What is still in the database for this org, table by table."""
    from app.db import AdminSessionLocal

    db = AdminSessionLocal()
    try:
        out = {}
        for table in (
            "organization",
            "user_account",
            "employee",
            "contract",
            "shift_template",
            "absence_type",
            "assignment",
            "business_profile",
        ):
            key = "id" if table == "organization" else "org_id"
            out[table] = db.execute(
                text("SELECT count(*) FROM %s WHERE %s = :org" % (table, key)),
                {"org": org_id},
            ).scalar()
        return out
    finally:
        db.close()


@skip_no_db
class TestDeleteAccount:
    def test_the_workspace_name_has_to_be_typed_back(self, client):
        token = _signup(client)
        res = client.request(
            "DELETE",
            "/api/v1/org",
            json={"confirm": "not the name"},
            headers=_auth(token),
        )
        assert res.status_code == 422
        # And nothing happened: the account still answers.
        assert client.get("/api/v1/auth/me", headers=_auth(token)).status_code == 200

    def test_deleting_takes_everything_with_it(self, client):
        token = _signup(client)
        me = client.get("/api/v1/auth/me", headers=_auth(token)).json()
        org_id = me["org_id"]
        name = me["org_name"]

        # Something in every table that hangs off the organisation.
        emp = client.post(
            "/api/v1/employees",
            json={
                "external_id": None,
                "full_name": "Ana Ruiz",
                "email": None,
                "employment_status": "active",
                "hire_date": "2026-01-01",
            },
            headers=_auth(token),
        )
        assert emp.status_code in (200, 201), emp.text
        assert _rows_left(org_id)["employee"] >= 1

        res = client.request(
            "DELETE", "/api/v1/org", json={"confirm": name}, headers=_auth(token)
        )
        assert res.status_code == 204, res.text

        left = _rows_left(org_id)
        assert left == {k: 0 for k in left}, left

    def test_the_name_is_read_forgivingly_but_not_loosely(self, client):
        token = _signup(client)
        name = _org_name(client, token)
        res = client.request(
            "DELETE",
            "/api/v1/org",
            json={"confirm": "  %s  " % name.upper()},
            headers=_auth(token),
        )
        assert res.status_code == 204, res.text

    def test_one_account_cannot_end_another(self, client):
        mine = _signup(client)
        theirs = _signup(client)
        their_id = client.get("/api/v1/auth/me", headers=_auth(theirs)).json()["org_id"]
        their_name = _org_name(client, theirs)

        # Their name, my token: the id is never a parameter, so this can only
        # ever delete the caller's own -- and the name will not match it.
        res = client.request(
            "DELETE", "/api/v1/org", json={"confirm": their_name}, headers=_auth(mine)
        )
        assert res.status_code == 422
        assert _rows_left(their_id)["organization"] == 1

    def test_an_employee_cannot_end_the_business(self, client):
        """The role gate, not just the dialog: employees have tokens too."""
        token = _signup(client)
        name = _org_name(client, token)
        created = client.post(
            "/api/v1/employees",
            json={
                "external_id": None,
                "full_name": "Luis Prat",
                "email": None,
                "employment_status": "active",
                "hire_date": "2026-01-01",
            },
            headers=_auth(token),
        )
        if created.status_code != 201:
            pytest.skip("could not create an employee to test the gate with")
        employee_id = created.json()["id"]
        account = client.post(
            "/api/v1/employees/%s/account" % employee_id,
            json={"email": "luis-%s@example.com" % uuid.uuid4().hex[:6], "password": "hunter22!"},
            headers=_auth(token),
        )
        if account.status_code not in (200, 201):
            pytest.skip("this build has no employee accounts to test the gate with")
        login = client.post(
            "/api/v1/auth/login",
            json={
                "email": account.json().get("email"),
                "password": "hunter22!",
            },
        )
        if login.status_code != 200:
            pytest.skip("could not sign in as the employee")
        res = client.request(
            "DELETE",
            "/api/v1/org",
            json={"confirm": name},
            headers=_auth(login.json()["access_token"]),
        )
        assert res.status_code == 403
