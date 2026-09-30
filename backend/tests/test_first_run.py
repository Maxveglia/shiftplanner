from __future__ import annotations

"""Whether an account still owes us the questions a new one is asked once.

The whole feature turns on one boolean being wrong in the safe direction. Ask
twice and the product looks like it forgets; ask an org that has been running
for a year and it looks like it broke. So the assertions here are mostly about
who is NOT asked: the flag defaults to false, only signup ever sets it, and
reading a profile can never set it.

Database tests, and they skip themselves with a clear reason when Postgres is
not reachable -- same convention as ``test_business_profile``.
"""

from tests.test_business_profile import (
    _auth,
    _org_session,
    _signup,
    client,  # noqa: F401  -- fixture, used by name
    skip_no_db,
)

from app.services import business_profile as bp


@skip_no_db
def test_a_brand_new_account_is_owed_the_questions(client):  # noqa: F811
    token = _signup(client)
    body = client.get("/api/v1/profile", headers=_auth(token)).json()

    assert body["first_run_pending"] is True
    # And it still knows nothing about the business itself. The questions are
    # owed precisely because none of these have been answered.
    assert body["vertical"] is None
    assert body["day_boundary_min"] is None
    assert body["weekend_days"] is None


@skip_no_db
def test_answering_or_skipping_ends_them_for_good(client):  # noqa: F811
    """One field, sent by a client that finished OR gave up. Same outcome."""
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile",
        headers=_auth(token),
        json={"first_run_pending": False},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["first_run_pending"] is False
    # Survives the round trip, not just the response: a manager who reloads is
    # exactly the person a repeated question would annoy.
    assert (
        client.get("/api/v1/profile", headers=_auth(token)).json()["first_run_pending"]
        is False
    )


@skip_no_db
def test_answering_one_question_does_not_end_the_rest(client):  # noqa: F811
    """The steps write as they go, and none of them closes the flow early."""
    token = _signup(client)
    resp = client.put(
        "/api/v1/profile",
        headers=_auth(token),
        json={"vertical": "bar", "weekend_days": [5, 6]},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["vertical"] == "bar"
    assert body["weekend_days"] == [5, 6]
    assert body["first_run_pending"] is True


@skip_no_db
def test_reading_a_profile_never_re_opens_the_questions(client):  # noqa: F811
    """The invariant that keeps existing customers out of this entirely.

    ``get_or_create`` writes the profile row for every org that predates the
    adaptive layer, and it runs on nearly every request. If it opened the
    questions, every business already using the product would be interrupted by
    them -- and again after answering, forever. Only ``open_first_run`` sets the
    flag, and only signup calls it.
    """
    token = _signup(client)
    client.put(
        "/api/v1/profile", headers=_auth(token), json={"first_run_pending": False}
    )

    db, org_id = _org_session(token)
    try:
        profile = bp.get_or_create(db, org_id)
        assert profile.first_run_pending is False
    finally:
        db.close()

    assert (
        client.get("/api/v1/profile", headers=_auth(token)).json()["first_run_pending"]
        is False
    )


@skip_no_db
def test_the_questions_belong_to_the_org_and_not_to_one_manager(client):  # noqa: F811
    """Two accounts, two answers, no leakage in either direction.

    The flag sits on ``business_profile`` rather than on the user precisely so a
    second manager joining the same shop is not asked about hours the first one
    already gave. The other half of that -- that a different ORG is unaffected
    -- is what this pins.
    """
    first = _signup(client)
    second = _signup(client)
    client.put(
        "/api/v1/profile", headers=_auth(first), json={"first_run_pending": False}
    )

    assert (
        client.get("/api/v1/profile", headers=_auth(second)).json()["first_run_pending"]
        is True
    )
    assert (
        client.get("/api/v1/profile", headers=_auth(first)).json()["first_run_pending"]
        is False
    )
    # Two distinct orgs, in case the fixture ever stops creating one per signup.
    from app.security import decode_access_token

    assert decode_access_token(first)["org_id"] != decode_access_token(second)["org_id"]
