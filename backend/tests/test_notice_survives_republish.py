from __future__ import annotations

"""A shift that did not change was announced when it was announced.

Art. 34.2 ET gives the employee five days' notice of when they are expected,
and this product measures that notice from ``assignment.published_at``. Which
puts a load on that column it was never built to carry.

Publishing is a REPLACE: every shift starting in the window is deleted and the
new set inserted (`services/schedule._replace_window`). The rows that come back
are new rows, so before this they were all stamped with the moment of the
republish -- including the ninety-five shifts nobody touched. A manager moving
one Tuesday in a published month would restamp the whole month as announced
today, and every shift inside the next five days would be reported as sprung on
the team. The compliance view would have been loudest exactly where it was
least true, and a manager learns to ignore a warning like that long before the
real one arrives.

So identity survives the replace: same person, same start, same end, same
unpaid break keeps the date it was first published on. Anything else is a
different shift and is announced today, which is when notice is owed again.

Needs Postgres, and skips itself when there is none -- like
``test_draft_on_the_server``, whose fixtures these follow.
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
            "org_name": "Notice Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
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


def _window():
    start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    ) + timedelta(days=30)
    return start, start + timedelta(days=7)


def _shift(employee_id: str, start: datetime, day: int, hours: int = 8) -> dict:
    at = start + timedelta(days=day, hours=9)
    return {
        "employee_id": employee_id,
        "start_at": at.isoformat(),
        "end_at": (at + timedelta(hours=hours)).isoformat(),
        "computed_cost": 80.0,
    }


def _publish(client, token: str, start, end, shifts: list):
    return client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "shifts": shifts,
        },
    )


def _published(client, token: str, start, end) -> list:
    resp = client.get(
        "/api/v1/schedule/assignments",
        headers=_auth(token),
        params={"from": start.isoformat(), "to": end.isoformat()},
    )
    assert resp.status_code == 200, resp.text
    return sorted(resp.json(), key=lambda a: a["start_at"])


@skip_no_db
def test_an_untouched_shift_keeps_the_date_it_was_published_on(client):
    """The whole point: move one Tuesday, and Monday's notice is not reset."""
    token = _signup(client)
    employee = _add(client, token, "Ana")
    start, end = _window()

    monday = _shift(employee, start, day=0)
    tuesday = _shift(employee, start, day=1)
    assert _publish(client, token, start, end, [monday, tuesday]).status_code == 200

    first = _published(client, token, start, end)
    assert len(first) == 2
    monday_first_published = first[0]["published_at"]
    assert monday_first_published is not None

    # Republish the window with Tuesday moved two hours later. Monday is
    # untouched and must keep its original announcement.
    moved = _shift(employee, start, day=1)
    moved_at = datetime.fromisoformat(moved["start_at"]) + timedelta(hours=2)
    moved["start_at"] = moved_at.isoformat()
    moved["end_at"] = (moved_at + timedelta(hours=8)).isoformat()

    assert _publish(client, token, start, end, [monday, moved]).status_code == 200

    after = _published(client, token, start, end)
    assert len(after) == 2
    assert after[0]["published_at"] == monday_first_published


@skip_no_db
def test_a_moved_shift_is_announced_again(client):
    """Changing when somebody is expected starts their notice over."""
    token = _signup(client)
    employee = _add(client, token, "Bruno")
    start, end = _window()

    original = _shift(employee, start, day=0)
    assert _publish(client, token, start, end, [original]).status_code == 200
    before = _published(client, token, start, end)[0]["published_at"]

    moved = dict(original)
    moved_at = datetime.fromisoformat(original["start_at"]) + timedelta(hours=3)
    moved["start_at"] = moved_at.isoformat()
    moved["end_at"] = (moved_at + timedelta(hours=8)).isoformat()
    assert _publish(client, token, start, end, [moved]).status_code == 200

    after = _published(client, token, start, end)[0]["published_at"]
    assert after != before


@skip_no_db
def test_a_shift_handed_to_somebody_else_is_announced_again(client):
    """It is not the same shift to the person who now has to work it."""
    token = _signup(client)
    ana = _add(client, token, "Ana")
    bruno = _add(client, token, "Bruno")
    start, end = _window()

    assert _publish(
        client, token, start, end, [_shift(ana, start, day=0)]
    ).status_code == 200
    before = _published(client, token, start, end)[0]["published_at"]

    assert _publish(
        client, token, start, end, [_shift(bruno, start, day=0)]
    ).status_code == 200
    after = _published(client, token, start, end)[0]["published_at"]
    assert after != before


@skip_no_db
def test_a_draft_is_never_stamped_as_announced(client):
    """A draft was never on the noticeboard, so it owes nobody notice."""
    token = _signup(client)
    employee = _add(client, token, "Ana")
    start, end = _window()

    resp = client.put(
        "/api/v1/schedule/draft",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "shifts": [_shift(employee, start, day=0)],
        },
    )
    assert resp.status_code == 200, resp.text

    draft = client.get(
        "/api/v1/schedule/draft",
        headers=_auth(token),
        params={"from": start.isoformat(), "to": end.isoformat()},
    )
    assert draft.status_code == 200, draft.text
    assert [a["published_at"] for a in draft.json()] == [None]


@skip_no_db
def test_the_year_grid_reads_shifts_without_reading_a_rota(client):
    """`/schedule/marks`: two fields a shift, for colouring 365 squares.

    A year of full assignments is megabytes of employees, costs and templates
    to decide a shade, so the grid has its own reader. What it must NOT do is
    blur the two states apart from each other: a month drafted and never
    published is exactly what the grid exists to make visible.
    """
    token = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()

    # One published day, and one drafted day a week later.
    assert _publish(
        client, token, start, end, [_shift(ana, start, day=0)]
    ).status_code == 200

    later_start = start + timedelta(days=14)
    later_end = later_start + timedelta(days=7)
    draft = client.put(
        "/api/v1/schedule/draft",
        headers=_auth(token),
        json={
            "period_start": later_start.isoformat(),
            "period_end": later_end.isoformat(),
            "shifts": [_shift(ana, later_start, day=0)],
        },
    )
    assert draft.status_code == 200, draft.text

    marks = client.get(
        "/api/v1/schedule/marks",
        headers=_auth(token),
        params={
            "from": (start - timedelta(days=1)).isoformat(),
            "to": (later_end + timedelta(days=1)).isoformat(),
        },
    )
    assert marks.status_code == 200, marks.text
    body = marks.json()

    statuses = sorted(m["status"] for m in body)
    assert statuses == ["draft", "published"]
    # Two fields and no more: no employee, no cost, no template.
    assert set(body[0]) == {"start_at", "status"}


@skip_no_db
def test_the_year_grid_is_not_readable_by_an_employee(client):
    """A draft is the manager's alone -- not even as a colour on a square."""
    token = _signup(client)
    employee = _add(client, token, "Ana")

    account = client.post(
        "/api/v1/employees/%s/account" % employee,
        headers=_auth(token),
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

    start, end = _window()
    denied = client.get(
        "/api/v1/schedule/marks",
        headers=_auth(login.json()["access_token"]),
        params={"from": start.isoformat(), "to": end.isoformat()},
    )
    assert denied.status_code == 403


# --- What an employee may see of their colleagues -------------------------


def _employee_token(client, manager_token: str, employee_id: str) -> str:
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


def _day_window(start, day: int):
    """The 24 hours of one day of the published window."""
    opens = start + timedelta(days=day)
    return opens, opens + timedelta(days=1)


@skip_no_db
def test_an_employee_sees_who_they_are_on_with(client):
    """The point of the feature: sharing a shift is what entitles you to it."""
    token = _signup(client)
    ana = _add(client, token, "Ana")
    bruno = _add(client, token, "Bruno")
    start, end = _window()

    assert _publish(
        client,
        token,
        start,
        end,
        [_shift(ana, start, day=0), _shift(bruno, start, day=0)],
    ).status_code == 200

    staff = _employee_token(client, token, ana)
    day_from, day_to = _day_window(start, 0)
    resp = client.get(
        "/api/v1/schedule/day-team",
        headers=_auth(staff),
        params={"from": day_from.isoformat(), "to": day_to.isoformat()},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert sorted(r["employee_name"] for r in body) == ["Ana", "Bruno"]
    assert [r["is_self"] for r in body if r["employee_name"] == "Ana"] == [True]


@skip_no_db
def test_the_payload_carries_nothing_about_a_colleague_but_their_shift(client):
    """The privacy decision IS the shape, so the shape is what is pinned.

    No cost, no contract, no weekly hours, no employee code, no absence. Two
    of those are not merely tidiness: weekly hours carry the "short of
    contract" warning, and an absence may be of a type marked as health data.
    """
    token = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()
    assert _publish(
        client, token, start, end, [_shift(ana, start, day=0)]
    ).status_code == 200

    staff = _employee_token(client, token, ana)
    day_from, day_to = _day_window(start, 0)
    body = client.get(
        "/api/v1/schedule/day-team",
        headers=_auth(staff),
        params={"from": day_from.isoformat(), "to": day_to.isoformat()},
    ).json()

    assert set(body[0]) == {
        "employee_id",
        "employee_name",
        "start_at",
        "end_at",
        "unpaid_break_minutes",
        "is_self",
    }


@skip_no_db
def test_an_employee_cannot_open_a_day_they_are_off(client):
    """Who works a day you are not there is not your business."""
    token = _signup(client)
    ana = _add(client, token, "Ana")
    bruno = _add(client, token, "Bruno")
    start, end = _window()

    # Ana works Monday; Bruno works Tuesday.
    assert _publish(
        client,
        token,
        start,
        end,
        [_shift(ana, start, day=0), _shift(bruno, start, day=1)],
    ).status_code == 200

    staff = _employee_token(client, token, ana)
    day_from, day_to = _day_window(start, 1)  # Bruno's day, not hers
    resp = client.get(
        "/api/v1/schedule/day-team",
        headers=_auth(staff),
        params={"from": day_from.isoformat(), "to": day_to.isoformat()},
    )

    assert resp.status_code == 403


@skip_no_db
def test_a_year_cannot_be_asked_for_one_day_at_a_time(client):
    """The leak this cap exists to close, reproduced and then refused.

    The permission is "does the asker work in this window", which is the right
    question and a useless one if the window can be a year. Ana works one day;
    she asks for twelve months and gets everybody's year -- who is off when,
    who does the nights -- by changing two dates in a URL.
    """
    token = _signup(client)
    ana = _add(client, token, "Ana")
    bruno = _add(client, token, "Bruno")
    start, end = _window()

    assert _publish(
        client,
        token,
        start,
        end,
        [_shift(ana, start, day=0), _shift(bruno, start, day=1)],
    ).status_code == 200

    staff = _employee_token(client, token, ana)
    resp = client.get(
        "/api/v1/schedule/day-team",
        headers=_auth(staff),
        params={
            "from": (start - timedelta(days=180)).isoformat(),
            "to": (start + timedelta(days=180)).isoformat(),
        },
    )

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "window_too_wide"


@skip_no_db
def test_two_days_is_already_too_many(client):
    """Not a round-number cap: the day after is a day she may be off."""
    token = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()
    assert _publish(
        client, token, start, end, [_shift(ana, start, day=0)]
    ).status_code == 200

    staff = _employee_token(client, token, ana)
    day_from, _ = _day_window(start, 0)
    resp = client.get(
        "/api/v1/schedule/day-team",
        headers=_auth(staff),
        params={
            "from": day_from.isoformat(),
            "to": (day_from + timedelta(days=2)).isoformat(),
        },
    )

    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "window_too_wide"


@skip_no_db
def test_the_longest_day_of_the_year_still_fits(client):
    """The clocks going back make a local day 25 hours long, and the phone
    asks for the whole of it. A cap that refused that would break the feature
    twice a year in the one market this product sells to."""
    token = _signup(client)
    ana = _add(client, token, "Ana")
    start, end = _window()
    assert _publish(
        client, token, start, end, [_shift(ana, start, day=0)]
    ).status_code == 200

    staff = _employee_token(client, token, ana)
    day_from, _ = _day_window(start, 0)
    resp = client.get(
        "/api/v1/schedule/day-team",
        headers=_auth(staff),
        params={
            "from": day_from.isoformat(),
            "to": (day_from + timedelta(hours=25)).isoformat(),
        },
    )

    assert resp.status_code == 200, resp.text


@skip_no_db
def test_a_draft_is_not_shown_to_the_team(client):
    """A plan stays the manager's until they publish it."""
    token = _signup(client)
    ana = _add(client, token, "Ana")
    bruno = _add(client, token, "Bruno")
    start, end = _window()

    assert _publish(
        client, token, start, end, [_shift(ana, start, day=0)]
    ).status_code == 200
    # Bruno is only DRAFTED onto the same day.
    draft = client.put(
        "/api/v1/schedule/draft",
        headers=_auth(token),
        json={
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "shifts": [_shift(bruno, start, day=0)],
        },
    )
    assert draft.status_code == 200, draft.text

    staff = _employee_token(client, token, ana)
    day_from, day_to = _day_window(start, 0)
    body = client.get(
        "/api/v1/schedule/day-team",
        headers=_auth(staff),
        params={"from": day_from.isoformat(), "to": day_to.isoformat()},
    ).json()

    assert [r["employee_name"] for r in body] == ["Ana"]


@skip_no_db
def test_an_employee_can_no_longer_read_what_the_business_pays(client):
    """Hiding the tab is not taking the access away; this is."""
    token = _signup(client)
    ana = _add(client, token, "Ana")
    staff = _employee_token(client, token, ana)

    assert client.get("/api/v1/org/pay-policy", headers=_auth(staff)).status_code == 403
    # And the manager still can.
    assert client.get("/api/v1/org/pay-policy", headers=_auth(token)).status_code == 200
