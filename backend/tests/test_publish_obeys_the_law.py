from __future__ import annotations

"""Publishing, once the server has read the rules for itself.

`validate_shifts` has always asked whether a rota is COHERENT -- these people
exist, these instants carry an offset, this shift starts inside the window. It
would happily publish fourteen hours straight, or call somebody back four hours
after they went home. The rules that stop that lived only in the browser, which
means the product's central promise rested on the one component a client can
replace.

These tests are about the wiring rather than the rules themselves (those are
`test_rota_law.py`, and they are the port's own contract): that the check runs
where it can see what it needs, that OBSERVING cannot cost anybody a rota, and
that ENFORCING refuses without writing anything.
"""

import uuid

import pytest

from tests.test_rota_law import (  # the harness, not the subject
    WEEK_END,
    WEEK_START,
    _add,
    _auth,
    _signup,
    client,  # noqa: F401 - a fixture, used by name
    skip_no_db,
)

# Nine hours apart, where the Catalan hospitality agreement wants twelve. Legal
# in every other respect: one person, two ordinary days, inside the window.
TOO_LITTLE_REST = [
    {
        "start_at": "2026-03-02T09:00:00+00:00",
        "end_at": "2026-03-02T17:00:00+00:00",
    },
    {
        "start_at": "2026-03-03T02:00:00+00:00",
        "end_at": "2026-03-03T08:00:00+00:00",
    },
]


def _publish(client, token, employee_id):
    return client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": WEEK_START.isoformat(),
            "period_end": WEEK_END.isoformat(),
            "shifts": [
                dict(employee_id=employee_id, **shift) for shift in TOO_LITTLE_REST
            ],
        },
    )


def _published_count(client, token):
    resp = client.get(
        "/api/v1/schedule/assignments",
        headers=_auth(token),
        params={"from": WEEK_START.isoformat(), "to": WEEK_END.isoformat()},
    )
    assert resp.status_code == 200, resp.text
    return len(resp.json())


@pytest.fixture
def enforcing(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "publish_law_enforced", True)


@skip_no_db
def test_while_observing_a_rota_that_breaks_the_rules_still_publishes(client):
    """The default, and it matters that it is the default.

    The browser judges with the figures in the brief and this judges with the
    ones in the jurisdiction tables, so the two can disagree about a rota a
    manager deliberately asked for. A control that starts refusing the day it
    ships turns our reading of the rules into somebody else's Monday with no
    shifts up. Watch the log first.
    """
    token, _ = _signup(client)
    ana = _add(client, token, "Ana")

    resp = _publish(client, token, ana["id"])

    assert resp.status_code == 200, resp.text
    assert resp.json()["published"] == 2
    assert _published_count(client, token) == 2


@skip_no_db
def test_enforcing_refuses_it_and_writes_nothing(client, enforcing):
    token, _ = _signup(client)
    ana = _add(client, token, "Ana")

    resp = _publish(client, token, ana["id"])

    assert resp.status_code == 422, resp.text
    body = resp.json()["detail"]
    assert body["code"] == "schedule_breaks_the_law"
    # The findings travel as data -- a code and numbers per breach -- because a
    # rota breaks the law in batches and the manager needs the list.
    assert body["params"]["count"] >= 1
    # `rule`, not `code`: `code` is taken by the error body itself, so a
    # finding names its rule under a key that cannot collide with it.
    assert "rest" in {v["rule"] for v in body["params"]["violations"]}
    # And the team was told nothing: a refused publish is not a partial one.
    assert _published_count(client, token) == 0


@skip_no_db
def test_enforcing_still_publishes_a_rota_that_keeps_the_rules(client, enforcing):
    """The other half of the previous test: this is a gate, not a wall."""
    token, _ = _signup(client)
    ana = _add(client, token, "Ana")

    resp = client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": WEEK_START.isoformat(),
            "period_end": WEEK_END.isoformat(),
            "shifts": [
                {
                    "employee_id": ana["id"],
                    "start_at": "2026-03-02T09:00:00+00:00",
                    "end_at": "2026-03-02T17:00:00+00:00",
                },
                {
                    "employee_id": ana["id"],
                    "start_at": "2026-03-03T09:00:00+00:00",
                    "end_at": "2026-03-03T17:00:00+00:00",
                },
            ],
        },
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["published"] == 2


@skip_no_db
@pytest.mark.parametrize("enforce", [False, True])
def test_a_check_that_cannot_answer_never_costs_a_rota(client, monkeypatch, enforce):
    """A bug in our own judge must not be the reason a team has no shifts.

    Obvious while observing -- nobody asked it to be there. Enforcing, it is
    still the lesser of two bad outcomes: refusing would stop a manager with a
    perfectly legal rota because of a fault of ours. It is logged loudly
    instead, because a check that is silently not running is exactly what this
    was built to end.
    """
    from app.config import settings
    from app.routers import schedule as schedule_router

    monkeypatch.setattr(settings, "publish_law_enforced", enforce)

    def broken(*_args, **_kwargs):
        raise RuntimeError("the judge itself fell over")

    monkeypatch.setattr(schedule_router.rota_law, "judge", broken)

    token, _ = _signup(client)
    ana = _add(client, token, "Ana")

    resp = _publish(client, token, ana["id"])

    assert resp.status_code == 200, resp.text
    assert _published_count(client, token) == 2


@skip_no_db
def test_the_check_runs_after_the_one_that_says_these_people_exist(client, enforcing):
    """Order, not coincidence.

    Every rule in `rota_law` reads a contract, an absence, a hire date. Asked
    about somebody who is not on the roster it would have nothing to say, so the
    integrity check has to be the one that answers -- by name, as it always did.
    """
    token, _ = _signup(client)

    resp = _publish(client, token, str(uuid.uuid4()))

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "unknown_employee"
