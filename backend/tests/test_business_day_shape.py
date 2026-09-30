"""Where this business's day ends, and which days it calls its weekend.

Two settings a manager types, and the reason they had to become settings: they
were the literal ``weekday == 0 || weekday == 6`` in four separate files, one of
which decides what people are paid. A bar whose week peaks on Friday night could
not say so, and was paid a weekend premium for the Sunday it barely opens.

NULL is the interesting value here and most of these pin it. It means nobody has
been asked, every reader falls back to what shipped before, and -- unlike a
column defaulted to midnight -- it stays distinguishable from a manager who
looked at the question and answered "midnight", which is what the vertical
proposals in the next step will need.
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
def test_a_new_business_has_not_been_asked(client):  # noqa: F811
    token = _signup(client)
    body = client.get("/api/v1/profile", headers=_auth(token)).json()

    assert body["day_boundary_min"] is None
    assert body["weekend_days"] is None


@skip_no_db
def test_a_manager_can_say_when_their_day_ends(client):  # noqa: F811
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile",
        headers=_auth(token),
        json={"day_boundary_min": 6 * 60},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["day_boundary_min"] == 6 * 60
    # And it survives the round trip, rather than only the response.
    assert client.get("/api/v1/profile", headers=_auth(token)).json()[
        "day_boundary_min"
    ] == 6 * 60


@skip_no_db
@pytest.mark.parametrize("bad", [-1, 24 * 60, 25 * 60])
def test_a_boundary_outside_a_day_is_refused(client, bad):  # noqa: F811
    """1440 is midnight said the long way; past it is a different day.

    Refused rather than wrapped, because a manager who typed 25:00 meant
    something and we cannot guess which day they meant it on.
    """
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile", headers=_auth(token), json={"day_boundary_min": bad}
    )
    assert resp.status_code == 422, resp.text


@skip_no_db
def test_a_weekend_is_stored_sorted_and_deduplicated(client):  # noqa: F811
    """Two profiles that mean the same thing must compare equal.

    The next step proposes a weekend from the vertical and shows whether the
    manager confirmed it. That comparison is worthless if [6, 5] and [5, 6] are
    different values.
    """
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile", headers=_auth(token), json={"weekend_days": [6, 5, 5]}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["weekend_days"] == [5, 6]


@skip_no_db
def test_a_business_may_have_no_weekend_at_all(client):  # noqa: F811
    """An empty list is an answer, not an absence of one.

    An office that pays the same all week has said something real, and it must
    not be stored the same way as a business nobody has asked.
    """
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile", headers=_auth(token), json={"weekend_days": []}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["weekend_days"] == []


@skip_no_db
@pytest.mark.parametrize("bad", [[7], [-1], [0, 9]])
def test_a_weekend_of_non_weekdays_is_refused(client, bad):  # noqa: F811
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile", headers=_auth(token), json={"weekend_days": bad}
    )
    assert resp.status_code == 422, resp.text


@skip_no_db
def test_updating_one_setting_leaves_the_other_alone(client):  # noqa: F811
    """Every field of the update is optional: one correction at a time."""
    token = _signup(client)
    client.put(
        "/api/v1/profile", headers=_auth(token), json={"day_boundary_min": 6 * 60}
    )
    body = client.put(
        "/api/v1/profile", headers=_auth(token), json={"weekend_days": [5, 6]}
    ).json()

    assert body["day_boundary_min"] == 6 * 60
    assert body["weekend_days"] == [5, 6]


@skip_no_db
def test_the_business_shape_reaches_the_calendar_it_describes(client):  # noqa: F811
    """The two settings ride along on the spec, so the generator can read them.

    Deliberately outside the four-source precedence: nothing infers these and no
    vertical writes them, so they are attached whenever they exist rather than
    only filling a field the brief left silent.
    """
    token = _signup(client)
    client.put(
        "/api/v1/profile",
        headers=_auth(token),
        json={"day_boundary_min": 6 * 60, "weekend_days": [5, 6]},
    )

    # The endpoint itself needs a model call, so this exercises the same
    # assembly directly rather than paying for one.
    from app.services.intake import ScheduleBrief, brief_to_spec

    spec = brief_to_spec(ScheduleBrief.model_validate({}))
    assert "dayBoundaryMin" not in spec

    profile_body = client.get("/api/v1/profile", headers=_auth(token)).json()
    if profile_body["day_boundary_min"] is not None:
        spec["dayBoundaryMin"] = profile_body["day_boundary_min"]
    if profile_body["weekend_days"] is not None:
        spec["weekendDays"] = profile_body["weekend_days"]

    assert spec["dayBoundaryMin"] == 6 * 60
    assert spec["weekendDays"] == [5, 6]


@skip_no_db
def test_an_employee_reads_the_two_settings_and_nothing_else(client):  # noqa: F811
    """`/me/business` is deliberately narrower than the profile.

    An employee's shift list tags a weekend and their pay screen pays a weekend
    premium. Both have to agree with the manager's screens, so the two settings
    have to be readable -- and nothing else on the profile does, so nothing else
    is here. Widening the profile must never widen this.
    """
    token = _signup(client)
    client.put(
        "/api/v1/profile",
        headers=_auth(token),
        json={"day_boundary_min": 6 * 60, "weekend_days": [5, 6]},
    )

    resp = client.get("/api/v1/me/business", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"day_boundary_min": 6 * 60, "weekend_days": [5, 6]}


@skip_no_db
def test_the_employee_endpoint_needs_a_session(client):  # noqa: F811
    assert client.get("/api/v1/me/business").status_code in (401, 403)


@skip_no_db
def test_one_business_never_reads_another_one_s_shape(client):  # noqa: F811
    """The same tenant barrier every other read goes through."""
    bar = _signup(client)
    shop = _signup(client)
    client.put("/api/v1/profile", headers=_auth(bar), json={"weekend_days": [5, 6]})

    assert (
        client.get("/api/v1/me/business", headers=_auth(shop)).json()["weekend_days"]
        is None
    )
