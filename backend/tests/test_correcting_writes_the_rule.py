"""Saying "en la hora punta quiero cuatro" and having it still be true next week.

A correction used to be evidence and nothing else: it changed the calendar on
screen, and then the belief built from it waited for three separate days before
anything would act on it. So the next brief went back to three, and the manager
had to say it again -- which reads as not having been listened to, and is the
reason the learning layer felt like a black box rather than a colleague.

The line between "a rule" and "a one-off" is NOT new here, and that is the whole
design: `_hint_from_op` has always returned None for a correction about one date
and a key for one that names a pattern. It is decided by the OPERATION, never by
reading the sentence the manager typed.
"""

from __future__ import annotations

import pytest

from app.services.business_profile import (
    _hint_from_op,
    apply_declarations,
    declared_rules,
)

from tests.test_business_profile import (
    _auth,
    _org_session,
    _signup,
    client,  # noqa: F401  -- fixture, used by name
    skip_no_db,
)


class FakeProfile:
    def __init__(self, declared=None):
        self.declared = declared


def spec(**over) -> dict:
    base = {
        "minStaff": 2,
        "openMin": 9 * 60,
        "closeMin": 22 * 60,
        "closedWeekdays": [],
        "coverage": [],
        "dayHours": [],
        "rules": [],
        "maxHoursPerWeek": 40,
    }
    base.update(over)
    return base


PEAK = {"op": "set_peak", "start": "13:00", "end": "16:00", "staff": 4}
ONE_DAY = {"op": "add_coverage", "date": "2026-12-24", "start": "18:00",
           "end": "22:00", "staff": 6}


# --- Which corrections are rules -----------------------------------------


def test_a_correction_that_names_a_pattern_is_a_rule():
    assert _hint_from_op(PEAK) is not None


def test_a_correction_about_one_date_is_not():
    # "Six people on the 24th" is about Christmas Eve, not about how this
    # business runs. It stays a retouch of that calendar and teaches nothing.
    assert _hint_from_op(ONE_DAY) is None


def test_a_correction_about_one_person_is_not():
    assert _hint_from_op({"op": "day_off", "employee": "e1", "date": "2026-03-02"}) is None
    assert _hint_from_op({"op": "move_shift", "id": "a1", "hour": 10}) is None


# --- What a declared rule does to the next brief -------------------------


def test_the_peak_survives_into_a_brief_that_says_nothing_about_it():
    # The acceptance criterion, without the network: say four at the peak, and
    # next week's calendar still has four -- no repeating it, no three days.
    key, value, _ = _hint_from_op(PEAK)
    s = spec()

    entries = apply_declarations(s, FakeProfile({"rules": {key: value}}), ["coverage"])

    assert [e["key"] for e in entries] == [key]
    assert s["coverage"] == [
        {
            "weekdays": [],
            "dates": [],
            "startMin": 13 * 60,
            "endMin": 16 * 60,
            "staff": 4,
            "exact": False,
        }
    ]


def test_it_takes_the_field_out_of_play_so_nothing_assumes_over_it():
    key, value, _ = _hint_from_op(PEAK)
    entries = apply_declarations(
        spec(), FakeProfile({"rules": {key: value}}), ["coverage"]
    )

    assert entries[0]["gapField"] == "coverage"


def test_a_brief_that_speaks_about_the_field_wins():
    # The precedence, in one test. A declaration fills silence; it never
    # overrules the manager writing something now.
    key, value, _ = _hint_from_op({"op": "set_min_staff", "staff": 5})
    s = spec(minStaff=2)

    entries = apply_declarations(s, FakeProfile({"rules": {key: value}}), [])

    assert entries == []
    assert s["minStaff"] == 2


def test_a_declaration_may_lower_a_number_where_a_hint_may_not():
    # A HINT is our inference from watching, so it raises cover and never cuts
    # it. A DECLARATION is the manager saying a number out loud, and refusing to
    # go down because we prefer the bigger one is not caution, it is ignoring
    # them.
    key, value, _ = _hint_from_op({"op": "set_min_staff", "staff": 1})
    s = spec(minStaff=3)

    apply_declarations(s, FakeProfile({"rules": {key: value}}), ["min_staff"])

    assert s["minStaff"] == 1


def test_two_corrections_about_the_same_thing_share_a_key():
    # Sharing a key is what makes "four at the peak" said twice one rule rather
    # than two competing ones. The window is the identity; the number is not.
    first, _, _ = _hint_from_op(PEAK)
    second, _, _ = _hint_from_op(
        {"op": "set_peak", "start": "13:00", "end": "16:00", "staff": 6}
    )

    assert first == second


@pytest.mark.parametrize(
    "declared",
    [{"rules": "not a dict"}, {"rules": {"peak:1-2": "not a dict"}}, {}, None],
)
def test_a_malformed_declaration_costs_one_rule_not_the_request(declared):
    assert declared_rules(FakeProfile(declared)) == {}


# --- End to end, through the API -----------------------------------------


@skip_no_db
def test_correcting_a_calendar_writes_the_rule(client):  # noqa: F811
    from app.services.business_profile import get_or_create

    token = _signup(client)
    resp = client.post(
        "/api/v1/profile/observations", headers=_auth(token), json={"ops": [PEAK]}
    )
    assert resp.status_code == 200, resp.text

    db, org_id = _org_session(token)
    try:
        stored = declared_rules(get_or_create(db, org_id))
    finally:
        db.close()

    assert stored == {"peak:780-960": {"staff": 4, "startMin": 780, "endMin": 960}}


@skip_no_db
def test_a_one_off_correction_writes_nothing(client):  # noqa: F811
    from app.services.business_profile import get_or_create

    token = _signup(client)
    client.post(
        "/api/v1/profile/observations", headers=_auth(token), json={"ops": [ONE_DAY]}
    )

    db, org_id = _org_session(token)
    try:
        stored = declared_rules(get_or_create(db, org_id))
    finally:
        db.close()

    assert stored == {}


@skip_no_db
def test_the_manager_can_take_a_rule_back(client):  # noqa: F811
    from app.services.business_profile import get_or_create

    token = _signup(client)
    client.post(
        "/api/v1/profile/observations", headers=_auth(token), json={"ops": [PEAK]}
    )

    resp = client.delete(
        "/api/v1/profile/declared/peak:780-960", headers=_auth(token)
    )
    assert resp.status_code == 204

    db, org_id = _org_session(token)
    try:
        stored = declared_rules(get_or_create(db, org_id))
    finally:
        db.close()

    assert stored == {}


@skip_no_db
def test_taking_back_something_that_is_already_gone_is_not_an_error(client):  # noqa: F811
    token = _signup(client)

    resp = client.delete(
        "/api/v1/profile/declared/peak:780-960", headers=_auth(token)
    )

    assert resp.status_code == 204


@skip_no_db
def test_learning_switched_off_declares_nothing(client):  # noqa: F811
    # Nobody asked for this correction to become a policy; the manager fixed a
    # calendar. A product told to stop adapting must not read that as
    # permission to change every future one.
    from app.services.business_profile import get_or_create

    token = _signup(client)
    client.put(
        "/api/v1/profile", headers=_auth(token), json={"learning_enabled": False}
    )
    client.post(
        "/api/v1/profile/observations", headers=_auth(token), json={"ops": [PEAK]}
    )

    db, org_id = _org_session(token)
    try:
        stored = declared_rules(get_or_create(db, org_id))
    finally:
        db.close()

    assert stored == {}


@skip_no_db
def test_changing_your_mind_replaces_the_rule_rather_than_adding_one(client):  # noqa: F811
    # Through the real endpoint, because the interesting part is the JSONB
    # write: an in-place mutation is invisible to SQLAlchemy and saves one of
    # these two answers at random.
    from app.services.business_profile import get_or_create

    token = _signup(client)
    for staff in (4, 6):
        client.post(
            "/api/v1/profile/observations",
            headers=_auth(token),
            json={"ops": [{**PEAK, "staff": staff}]},
        )

    db, org_id = _org_session(token)
    try:
        stored = declared_rules(get_or_create(db, org_id))
    finally:
        db.close()

    assert list(stored) == ["peak:780-960"]
    assert stored["peak:780-960"]["staff"] == 6
