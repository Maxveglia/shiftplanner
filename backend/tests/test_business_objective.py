"""What this business wants a calendar to optimise for.

One column, holding one of four words, and everything interesting about it is a
boundary rather than a feature.

The generator has always weighed its choices -- what the wage bill is worth
against spreading hours, how far to bend a contract before leaving an hour
uncovered -- and until now nobody could say which trade-off they wanted. These
tests pin the three rules that make the choice safe to offer:

* NULL is a real answer and the default. A business that never chooses gets the
  calendar it already has, and the empty string is how it gets back there --
  which is the difference between a setting and a one-way door.
* Only words we know are stored. The WEIGHTS live in the frontend beside the
  generator, so a typo persisted here would produce a business that believes it
  chose something and a calendar built on the default, with nothing anywhere to
  say which was true.
* It is a manager's setting. An employee's endpoint must not learn it, for the
  same reason it does not learn the vertical: widening the profile must never
  widen what staff can read about their employer.
"""

from __future__ import annotations

import pytest

from tests.test_business_profile import (
    _auth,
    _signup,
    client,  # noqa: F401  -- fixture, used by name
    skip_no_db,
)


@skip_no_db
def test_a_new_business_has_chosen_nothing(client):  # noqa: F811
    """Null, and not a profile we picked for them.

    Defaulting this column to "fair" would have been a change of calendar for
    every existing tenant, decided by us, delivered as a migration.
    """
    token = _signup(client)
    assert client.get("/api/v1/profile", headers=_auth(token)).json()["objective"] is None


@skip_no_db
@pytest.mark.parametrize("code", ["cheapest", "fair", "familiar", "protective"])
def test_a_manager_can_choose_what_the_calendar_optimises_for(client, code):  # noqa: F811
    token = _signup(client)
    resp = client.put("/api/v1/profile", headers=_auth(token), json={"objective": code})
    assert resp.status_code == 200, resp.text
    assert resp.json()["objective"] == code
    # And it survives the round trip, rather than only the response.
    assert client.get("/api/v1/profile", headers=_auth(token)).json()["objective"] == code


@skip_no_db
@pytest.mark.parametrize("bad", ["cheap", "FAIR", "balanced", "wageSensitivity=5"])
def test_an_objective_we_do_not_know_is_refused(client, bad):  # noqa: F811
    """Refused, not stored and ignored.

    The frontend maps the code to weights; a code it has never heard of maps to
    nothing, so the calendar quietly falls back to the default while the profile
    screen shows a choice that is doing nothing at all.
    """
    token = _signup(client)
    resp = client.put("/api/v1/profile", headers=_auth(token), json={"objective": bad})
    assert resp.status_code == 422, resp.text


@skip_no_db
def test_a_manager_can_go_back_to_having_chosen_nothing(client):  # noqa: F811
    """"" clears it. None cannot, because None already means "not touching".

    Same shape as the empty weekend: the absence of a choice is a choice a
    manager is allowed to make twice.
    """
    token = _signup(client)
    client.put("/api/v1/profile", headers=_auth(token), json={"objective": "fair"})
    resp = client.put("/api/v1/profile", headers=_auth(token), json={"objective": ""})
    assert resp.status_code == 200, resp.text
    assert resp.json()["objective"] is None
    assert client.get("/api/v1/profile", headers=_auth(token)).json()["objective"] is None


@skip_no_db
def test_choosing_an_objective_leaves_the_rest_of_the_profile_alone(client):  # noqa: F811
    """Every field on this endpoint is optional; one PUT must move one thing."""
    token = _signup(client)
    client.put(
        "/api/v1/profile",
        headers=_auth(token),
        json={"day_boundary_min": 6 * 60, "weekend_days": [4, 5], "vertical": "bar"},
    )
    resp = client.put(
        "/api/v1/profile", headers=_auth(token), json={"objective": "protective"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["objective"] == "protective"
    assert body["day_boundary_min"] == 6 * 60
    assert body["weekend_days"] == [4, 5]
    assert body["vertical"] == "bar"


@skip_no_db
def test_an_employee_never_reads_which_objective_their_employer_picked(client):  # noqa: F811
    """The two settings an employee's screens need, and still only those two.

    ``/me/business`` exists because an employee has to agree with their employer
    about when a day ends and which days are the weekend. What the rota
    optimises for is not that: it is a management decision about them, and there
    is no screen of theirs that would be more correct for knowing it.
    """
    token = _signup(client)
    client.put("/api/v1/profile", headers=_auth(token), json={"objective": "cheapest"})
    body = client.get("/api/v1/me/business", headers=_auth(token)).json()
    assert set(body) == {"day_boundary_min", "weekend_days"}
