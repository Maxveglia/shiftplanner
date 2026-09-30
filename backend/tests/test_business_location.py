"""Where a business is, and which labour rules it is under.

Two facts, deliberately stored in two places, and these tests are mostly about
why they are not one.

``location`` is what the manager typed. It exists to be searched from and to be
told to a planner, and it is never parsed: "a beach town near Alicante" says
more about a rota than any code we could normalise it into.

``jurisdiction_code`` is a body of labour rules we actually hold. They were
three and all American until Spain was seeded on 2026-09-14; a business
somewhere we still hold nothing for has a real location and no applicable
jurisdiction, and the product has to hold that state honestly instead of
filing a Spanish bar under Arizona law.

Needs a database: these go through the API as a manager.
"""

import pytest

from tests.test_business_profile import (  # noqa: F401 - fixtures by name
    _auth,
    _signup,
    client,
    skip_no_db,
)


@pytest.fixture
def spain_seeded():
    """The labour reference tables, seeded.

    CI runs migrations but not `python -m app.seeds.labor`, so a test that
    needs a jurisdiction has to put it there itself. Global reference data and
    an idempotent seeder, so running it per test costs a few inserts once and
    nothing afterwards.
    """
    from app.db import AdminSessionLocal
    from app.seeds.labor import seed

    db = AdminSessionLocal()
    try:
        seed(db)
        db.commit()
    finally:
        db.close()


def _known_jurisdictions(client, token) -> list:
    res = client.get("/api/v1/labor-profiles", headers=_auth(token))
    if res.status_code != 200:
        return []
    return sorted({p["jurisdiction_code"] for p in res.json()})


@skip_no_db
class TestLocation:
    def test_a_new_business_has_not_said_where_it_is(self, client):
        token = _signup(client)
        res = client.get("/api/v1/profile", headers=_auth(token))
        assert res.status_code == 200
        assert res.json()["location"] is None

    def test_keeps_the_answer_exactly_as_written(self, client):
        # Not normalised, not geocoded, not turned into a country. The value of
        # this answer is in its detail.
        token = _signup(client)
        said = "un pueblo de playa cerca de Alicante"
        res = client.put(
            "/api/v1/profile", json={"location": said}, headers=_auth(token)
        )
        assert res.status_code == 200
        assert res.json()["location"] == said

    def test_an_empty_answer_clears_it(self, client):
        # A manager who moved and has not decided what to write must be able to
        # take the old answer away rather than leave a wrong one standing.
        token = _signup(client)
        client.put("/api/v1/profile", json={"location": "Valencia"}, headers=_auth(token))
        res = client.put("/api/v1/profile", json={"location": "  "}, headers=_auth(token))
        assert res.json()["location"] is None

    def test_leaving_it_out_does_not_touch_it(self, client):
        # Every field on this endpoint is optional because the manager corrects
        # one thing at a time; omitting location while setting something else
        # must not wipe it.
        token = _signup(client)
        client.put("/api/v1/profile", json={"location": "Valencia"}, headers=_auth(token))
        res = client.put("/api/v1/profile", json={"vertical": "bar"}, headers=_auth(token))
        assert res.json()["location"] == "Valencia"


@skip_no_db
class TestJurisdiction:
    def test_a_new_business_starts_on_the_signup_default(self, client):
        token = _signup(client)
        res = client.get("/api/v1/profile", headers=_auth(token))
        # Whatever signup sets, the manager can now SEE it. That is the change:
        # this belief used to be invisible and unchangeable.
        assert res.json()["jurisdiction_code"]

    def test_refuses_a_jurisdiction_we_hold_no_rules_for(self, client):
        # This test named Spain until 2026-09-14, which was the honest example
        # then and is the point of the change now: the gap it described is
        # filled, so it asks about a country whose rules we still do not hold.
        token = _signup(client)
        res = client.put(
            "/api/v1/profile", json={"jurisdiction_code": "FR"}, headers=_auth(token)
        )
        assert res.status_code == 422
        detail = res.json()["detail"]
        # A code the client turns into a sentence in the manager's language,
        # and the English one alongside it (see app/errors.py).
        assert detail["code"] == "unknown_jurisdiction"
        # What IS available travels as a parameter, because this is our gap and
        # not the manager's typo, and a bare "invalid" would read as the
        # opposite. The sentence has to be able to name it in either language.
        assert detail["params"]["jurisdiction"] == "FR"
        assert detail["params"]["known"]
        assert "FR" in detail["message"]
        assert "Known jurisdictions" in detail["message"]

    def test_accepts_spain_and_moves_the_premiums_with_it(self, client, spain_seeded):
        """Choosing Spain is what turns the American defaults off.

        The three premiums this org was created with are American facts --
        15% at night, 10% at weekends, time and a half past forty. None of
        them is Spanish law, so the jurisdiction change carries them.
        """
        token = _signup(client)
        res = client.put(
            "/api/v1/profile",
            json={"jurisdiction_code": "ES-CT-HOSTELERIA"},
            headers=_auth(token),
        )
        assert res.status_code == 200, res.text

        policy = client.get("/api/v1/org/pay-policy", headers=_auth(token))
        assert policy.status_code == 200, policy.text
        body = policy.json()
        assert float(body["night_differential_pct"]) == 25.0
        assert float(body["weekend_premium_pct"]) == 0.0
        assert float(body["overtime_multiplier"]) == 1.0

    def test_accepts_one_we_do_hold(self, client):
        token = _signup(client)
        known = _known_jurisdictions(client, token)
        if not known:
            pytest.skip("no labour profiles seeded in this database")
        res = client.put(
            "/api/v1/profile",
            json={"jurisdiction_code": known[0]},
            headers=_auth(token),
        )
        assert res.status_code == 200
        assert res.json()["jurisdiction_code"] == known[0]

    def test_the_change_survives_a_fresh_read(self, client):
        # It is written to the ORGANIZATION, not to the profile row, so a read
        # that goes through a different path has to see it too. This is the
        # test that would have caught the original bug: the column was set at
        # signup and nothing ever read it back.
        token = _signup(client)
        known = _known_jurisdictions(client, token)
        if not known:
            pytest.skip("no labour profiles seeded in this database")
        client.put(
            "/api/v1/profile",
            json={"jurisdiction_code": known[-1]},
            headers=_auth(token),
        )
        res = client.get("/api/v1/profile", headers=_auth(token))
        assert res.json()["jurisdiction_code"] == known[-1]

    def test_it_travels_with_the_session(self, client):
        # The scheduler reads it off the logged-in user rather than fetching a
        # profile on every screen, so it has to be on /me as well.
        token = _signup(client)
        res = client.get("/api/v1/auth/me", headers=_auth(token))
        assert res.status_code == 200
        assert res.json()["org_jurisdiction"]
