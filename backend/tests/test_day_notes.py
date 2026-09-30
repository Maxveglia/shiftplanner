"""The manager's notes of each day, and the list of addresses that read them.

Needs a database: these go through the API as a manager and as employees.
"""

import uuid

import pytest
from sqlalchemy import text

from app.services import day_note_email
from app.services.mailer import SendResult
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    _signup,
    client,
    skip_no_db,
)


def _staff(client, manager_token):
    """An employee with a login; returns (token, email)."""
    employee = _add(client, manager_token, "Ana")
    email = "Staff+%s@Example.com" % uuid.uuid4().hex[:8]
    account = client.post(
        "/api/v1/employees/%s/account" % employee["id"],
        headers=_auth(manager_token),
        json={"email": email, "password": "s3cret-pass"},
    )
    assert account.status_code == 201, account.text
    login = client.post(
        "/api/v1/auth/login",
        json={"email": account.json()["email"], "password": "s3cret-pass"},
    )
    assert login.status_code == 200, login.text
    return login.json()["access_token"], account.json()["email"]


def _put(client, token, day, body, send=False):
    return client.put(
        "/api/v1/day-notes/%s" % day,
        json={"body": body, "send": send},
        headers=_auth(token),
    )


def _readers(client, token, emails):
    return client.put(
        "/api/v1/day-notes/readers", json={"emails": emails}, headers=_auth(token)
    )


@skip_no_db
class TestNotes:
    def test_write_read_and_rewrite_a_day(self, client):
        token, _ = _signup(client)
        res = _put(client, token, "2026-09-24", "  Mucha gente, faltó hielo.  ")
        assert res.status_code == 200, res.text
        assert res.json()["body"] == "Mucha gente, faltó hielo."
        assert res.json()["sent_at"] is None
        # The same day again replaces it: one note per day.
        _put(client, token, "2026-09-24", "Mucha gente.")
        got = client.get("/api/v1/day-notes/2026-09-24", headers=_auth(token)).json()
        assert got["body"] == "Mucha gente."
        listed = client.get("/api/v1/day-notes", headers=_auth(token)).json()
        assert [n["note_date"] for n in listed] == ["2026-09-24"]

    def test_the_list_is_newest_first(self, client):
        token, _ = _signup(client)
        for day in ("2026-09-20", "2026-09-24", "2026-09-22"):
            _put(client, token, day, "nota %s" % day)
        listed = client.get("/api/v1/day-notes", headers=_auth(token)).json()
        assert [n["note_date"] for n in listed] == ["2026-09-24", "2026-09-22", "2026-09-20"]

    def test_a_blank_note_is_refused(self, client):
        token, _ = _signup(client)
        assert _put(client, token, "2026-09-24", "   ").status_code == 422

    def test_a_day_with_no_note_is_a_named_404(self, client):
        token, _ = _signup(client)
        res = client.get("/api/v1/day-notes/2026-09-24", headers=_auth(token))
        assert res.status_code == 404
        assert res.json()["detail"]["code"] == "day_note_not_found"

    def test_delete(self, client):
        token, _ = _signup(client)
        _put(client, token, "2026-09-24", "x")
        assert client.delete("/api/v1/day-notes/2026-09-24", headers=_auth(token)).status_code == 204
        assert client.get("/api/v1/day-notes", headers=_auth(token)).json() == []

    def test_an_employee_cannot_write(self, client):
        manager, _ = _signup(client)
        staff, _ = _staff(client, manager)
        assert _put(client, staff, "2026-09-24", "x").status_code == 403
        assert client.get("/api/v1/day-notes", headers=_auth(staff)).status_code == 403
        assert _readers(client, staff, ["a@b.co"]).status_code == 403


@skip_no_db
class TestReaders:
    def test_the_list_is_cleaned_and_marks_who_has_a_login(self, client):
        manager, _ = _signup(client)
        _, staff_email = _staff(client, manager)
        res = _readers(
            client,
            manager,
            ["  Socio@Bar.es ", "socio@bar.es", "", staff_email.upper()],
        )
        assert res.status_code == 200, res.text
        readers = {r["email"]: r["has_login"] for r in res.json()["readers"]}
        assert readers == {"socio@bar.es": False, staff_email.lower(): True}
        # Tests run with no provider configured.
        assert res.json()["mail_configured"] is False

    def test_a_malformed_address_is_refused(self, client):
        manager, _ = _signup(client)
        assert _readers(client, manager, ["no-es-un-correo"]).status_code == 422

    def test_only_employees_on_the_list_read_the_notes(self, client):
        manager, _ = _signup(client)
        on_list, on_email = _staff(client, manager)
        off_list, _ = _staff(client, manager)
        _put(client, manager, "2026-09-24", "Cierre tranquilo.")
        _readers(client, manager, [on_email])

        feed = client.get("/api/v1/day-notes/feed", headers=_auth(on_list)).json()
        assert feed["can_read"] is True
        assert [n["body"] for n in feed["notes"]] == ["Cierre tranquilo."]

        feed = client.get("/api/v1/day-notes/feed", headers=_auth(off_list)).json()
        assert feed == {"can_read": False, "notes": []}

        # Taken off the list, the access goes with it.
        _readers(client, manager, [])
        feed = client.get("/api/v1/day-notes/feed", headers=_auth(on_list)).json()
        assert feed["can_read"] is False

    def test_a_manager_always_reads_the_feed(self, client):
        manager, _ = _signup(client)
        _put(client, manager, "2026-09-24", "x")
        feed = client.get("/api/v1/day-notes/feed", headers=_auth(manager)).json()
        assert feed["can_read"] is True


@skip_no_db
class TestSending:
    def test_without_a_provider_nothing_is_marked_as_sent(self, client):
        manager, _ = _signup(client)
        _readers(client, manager, ["socio@bar.es"])
        res = _put(client, manager, "2026-09-24", "x", send=True).json()
        assert res["emailed"] == 0
        assert res["mail_configured"] is False
        assert res["sent_at"] is None

    def test_with_a_provider_every_reader_gets_it(self, client, monkeypatch):
        sent = []

        class FakeMailer:
            configured = True

            def send(self, messages):
                sent.extend(messages)
                return SendResult(delivered=len(messages), failed=0, failures=[])

        from app.routers import day_notes

        monkeypatch.setattr(day_notes, "mailer", lambda: FakeMailer())
        manager, _ = _signup(client)
        _readers(client, manager, ["socio@bar.es", "jefa@bar.es"])
        res = _put(client, manager, "2026-09-24", "Faltó hielo.", send=True).json()
        assert res["emailed"] == 2
        assert res["sent_at"] is not None
        assert sorted(m.to for m in sent) == ["jefa@bar.es", "socio@bar.es"]
        assert "jueves 24 de septiembre de 2026" in sent[0].subject
        assert "Faltó hielo." in sent[0].text

    def test_saving_without_send_emails_nobody(self, client, monkeypatch):
        sent = []

        class FakeMailer:
            configured = True

            def send(self, messages):
                sent.extend(messages)
                return SendResult(delivered=len(messages), failed=0, failures=[])

        from app.routers import day_notes

        monkeypatch.setattr(day_notes, "mailer", lambda: FakeMailer())
        manager, _ = _signup(client)
        _readers(client, manager, ["socio@bar.es"])
        res = _put(client, manager, "2026-09-24", "x").json()
        assert res["emailed"] == 0
        assert sent == []


@skip_no_db
class TestIsolation:
    def test_another_business_sees_nothing(self, client):
        mine, _ = _signup(client)
        theirs, _ = _signup(client)
        _put(client, mine, "2026-09-24", "secreto")
        _readers(client, mine, ["socio@bar.es"])
        assert client.get("/api/v1/day-notes", headers=_auth(theirs)).json() == []
        assert client.get("/api/v1/day-notes/2026-09-24", headers=_auth(theirs)).status_code == 404
        assert client.get("/api/v1/day-notes/readers", headers=_auth(theirs)).json()["readers"] == []

    def test_being_on_another_business_list_gives_nothing_here(self, client):
        # The same address on business A's list must not open business B's notes.
        a, _ = _signup(client)
        b, _ = _signup(client)
        staff_b, staff_email = _staff(client, b)
        _put(client, a, "2026-09-24", "de A")
        _readers(client, a, [staff_email])
        feed = client.get("/api/v1/day-notes/feed", headers=_auth(staff_b)).json()
        assert feed["can_read"] is False

    def test_both_tables_are_behind_row_level_security(self):
        from app.db import AdminSessionLocal

        db = AdminSessionLocal()
        try:
            rows = db.execute(
                text(
                    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relname IN ('day_note', 'day_note_reader')"
                )
            ).all()
        finally:
            db.close()
        assert sorted(r[0] for r in rows) == ["day_note", "day_note_reader"]
        assert all(r[1] and r[2] for r in rows)


def test_the_email_says_the_day_in_spanish():
    from datetime import date

    [msg] = day_note_email.compose(date(2026, 9, 24), "Hola", ["a@b.co"], "Bar", "https://x.app/")
    assert msg.subject == "Bar · Notas del jueves 24 de septiembre de 2026"
    assert "https://x.app" in msg.text
