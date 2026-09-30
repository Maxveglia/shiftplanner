from __future__ import annotations

"""Publishing a rota reaches the people in it -- or says that it did not.

The rota is the product and the email is a courtesy on top of it, so the case
that matters most here is the ugly one: a mail provider having a bad day must
not turn a published month into a 500. The rest is about the number the manager
reads afterwards being TRUE -- somebody with no login, or who switched the
email off, is somebody the manager still has to phone.

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


class FakeMailer:
    """A provider that works, and remembers what it was given."""

    def __init__(self) -> None:
        self.sent = []

    @property
    def configured(self) -> bool:
        return True

    def send(self, messages):
        from app.services.mailer import SendResult

        self.sent.extend(messages)
        return SendResult(delivered=len(messages), failed=0, failures=[])


class BrokenMailer:
    """A provider having the worst possible day."""

    @property
    def configured(self) -> bool:
        return True

    def send(self, messages):
        raise RuntimeError("the provider is down")


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _signup(client) -> str:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Told Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Marta",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


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


def _give_login(client, token: str, employee_id: str) -> tuple:
    email = "worker+%s@example.com" % uuid.uuid4().hex[:8]
    resp = client.post(
        "/api/v1/employees/%s/account" % employee_id,
        headers=_auth(token),
        json={"email": email, "password": "another-s3cret"},
    )
    assert resp.status_code == 201, resp.text
    return email, "another-s3cret"


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
    return resp.json()


@skip_no_db
def test_the_person_whose_rota_it_is_gets_the_email(client, monkeypatch):
    post = FakeMailer()
    monkeypatch.setattr("app.routers.schedule.mailer", lambda: post)

    token = _signup(client)
    ana = _add(client, token, "Ana Ruiz")
    email, _ = _give_login(client, token, ana)
    start, end = _window()

    body = _publish(client, token, start, end, [_shift(ana, start, 0)])

    assert body["notified"] == 1
    assert body["unreachable"] == 0
    assert body["mail_configured"] is True
    assert [m.to for m in post.sent] == [email]
    assert "Ana" in post.sent[0].text


@skip_no_db
def test_somebody_with_no_login_is_counted_as_not_told(client, monkeypatch):
    """The product creates this case itself: a login needs an address, so the
    kitchen porter without one simply has no account."""
    post = FakeMailer()
    monkeypatch.setattr("app.routers.schedule.mailer", lambda: post)

    token = _signup(client)
    ana = _add(client, token, "Ana Ruiz")
    _give_login(client, token, ana)
    luis = _add(client, token, "Luis Marin")  # no account
    start, end = _window()

    body = _publish(
        client, token, start, end, [_shift(ana, start, 0), _shift(luis, start, 1)]
    )

    assert body["notified"] == 1
    assert body["unreachable"] == 1
    assert len(post.sent) == 1


@skip_no_db
def test_somebody_who_turned_it_off_is_not_written_to_and_is_counted(client, monkeypatch):
    post = FakeMailer()
    monkeypatch.setattr("app.routers.schedule.mailer", lambda: post)

    token = _signup(client)
    ana = _add(client, token, "Ana Ruiz")
    email, password = _give_login(client, token, ana)
    start, end = _window()

    logged_in = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert logged_in.status_code == 200, logged_in.text
    off = client.patch(
        "/api/v1/me/notifications",
        headers=_auth(logged_in.json()["access_token"]),
        json={"notify_by_email": False},
    )
    assert off.status_code == 200, off.text
    assert off.json()["notify_by_email"] is False

    body = _publish(client, token, start, end, [_shift(ana, start, 0)])

    assert body["notified"] == 0
    assert body["unreachable"] == 1
    assert post.sent == []


@skip_no_db
def test_republishing_the_same_rota_writes_to_nobody(client, monkeypatch):
    post = FakeMailer()
    monkeypatch.setattr("app.routers.schedule.mailer", lambda: post)

    token = _signup(client)
    ana = _add(client, token, "Ana Ruiz")
    _give_login(client, token, ana)
    start, end = _window()
    rota = [_shift(ana, start, 0), _shift(ana, start, 1)]

    _publish(client, token, start, end, rota)
    post.sent.clear()

    body = _publish(client, token, start, end, rota)

    assert body["notified"] == 0
    assert body["unreachable"] == 0
    assert post.sent == []


@skip_no_db
def test_a_provider_that_is_down_does_not_lose_the_rota(client, monkeypatch):
    """The whole reason the send is scheduled and not awaited."""
    monkeypatch.setattr("app.routers.schedule.mailer", lambda: BrokenMailer())

    token = _signup(client)
    ana = _add(client, token, "Ana Ruiz")
    _give_login(client, token, ana)
    start, end = _window()

    body = _publish(client, token, start, end, [_shift(ana, start, 0)])

    assert body["published"] == 1
    published = client.get(
        "/api/v1/schedule/assignments",
        headers=_auth(token),
        params={"from": start.isoformat(), "to": end.isoformat()},
    )
    assert published.status_code == 200
    assert len(published.json()) == 1


@skip_no_db
def test_with_no_mail_configured_the_manager_is_told_nobody_was_reached(client):
    """The default everywhere today, and the honest answer rather than a zero.

    A manager who believes the team was told and was not is worse off than one
    who knows to pick up a phone.
    """
    token = _signup(client)
    ana = _add(client, token, "Ana Ruiz")
    _give_login(client, token, ana)
    start, end = _window()

    body = _publish(client, token, start, end, [_shift(ana, start, 0)])

    assert body["published"] == 1
    assert body["notified"] == 0
    assert body["unreachable"] == 1
    # And WHY, which is a different sentence on screen: nobody here is missing
    # a login or has switched anything off, there is simply no provider yet.
    assert body["mail_configured"] is False
