"""The one question worth interrupting a manager for, and what happens to the answer.

Everything else a brief leaves open is an assumption now: staff it with a
defensible number, draw it, and let a wrong guess be corrected in a sentence.
The test that decides which of the two applies is not how confident we are --
it is whether the manager would SEE the mistake. "Los sabados abrimos casi todo
el dia" is the case that fails it: a Saturday drawn nine-to-ten looks exactly
like a Saturday that is right, and the whole day's cover hangs off an hour
nobody can guess.

The other half of these is the promise that makes answering worth the trouble:
the same question is never asked twice.
"""

from __future__ import annotations

import pytest

from app.services.business_profile import apply_declarations, declared_day_hours
from app.services.intake import ScheduleBrief, UnclearHours, hour_questions

from tests.test_business_profile import (
    _auth,
    _org_session,
    _signup,
    client,  # noqa: F401  -- fixture, used by name
    skip_no_db,
)


def brief(**over) -> ScheduleBrief:
    return ScheduleBrief(**over)


def spec(**over) -> dict:
    base = {"dayHours": [], "closedWeekdays": [], "rules": []}
    base.update(over)
    return base


class FakeProfile:
    """Just the column the declaration code reads."""

    def __init__(self, declared=None):
        self.declared = declared


# --- Which days get asked about ------------------------------------------


def test_a_day_singled_out_without_hours_is_asked_about():
    questions = hour_questions(
        brief(
            unclear_hours=[
                UnclearHours(weekday="saturday", quote="los sabados casi todo el dia")
            ]
        ),
        spec(),
    )

    assert len(questions) == 1
    assert questions[0]["weekday"] == 6
    assert questions[0]["kind"] == "day_hours"


def test_the_question_carries_the_manager_own_words():
    # Without the quote it reads as not having listened: they just wrote about
    # Saturdays and we ask, in the abstract, about Saturdays.
    questions = hour_questions(
        brief(
            unclear_hours=[
                UnclearHours(weekday="saturday", quote="los sabados casi todo el dia")
            ]
        ),
        spec(),
    )

    assert questions[0]["quote"] == "los sabados casi todo el dia"


def test_a_day_the_brief_gave_hours_for_is_not_asked_about():
    # The model can flag a day AND give its hours in the same brief; the hours
    # win, and asking anyway would be asking something already answered.
    questions = hour_questions(
        brief(unclear_hours=[UnclearHours(weekday="friday", quote="los viernes")]),
        spec(dayHours=[{"weekday": 5, "openMin": 1080, "closeMin": 1680}]),
    )

    assert questions == []


def test_a_closed_day_is_not_asked_about():
    questions = hour_questions(
        brief(unclear_hours=[UnclearHours(weekday="sunday", quote="los domingos")]),
        spec(closedWeekdays=[0]),
    )

    assert questions == []


def test_a_weekday_name_we_cannot_read_is_dropped_silently():
    questions = hour_questions(
        brief(unclear_hours=[UnclearHours(weekday="sabado", quote="los sabados")]),
        spec(),
    )

    assert questions == []


def test_the_same_day_twice_is_one_question():
    questions = hour_questions(
        brief(
            unclear_hours=[
                UnclearHours(weekday="saturday", quote="los sabados abrimos antes"),
                UnclearHours(weekday="saturday", quote="y cerramos mas tarde"),
            ]
        ),
        spec(),
    )

    assert len(questions) == 1


def test_a_brief_that_singles_out_nothing_asks_nothing():
    assert hour_questions(brief(), spec()) == []


# --- What the answer does ------------------------------------------------


def test_a_declared_day_fills_a_brief_that_stayed_quiet():
    # Quiet means no hours at all: no standing ones either.
    s = spec()
    entries = apply_declarations(s, FakeProfile({"day_hours": {"6": [480, 1440]}}), ["opening_hours"])

    assert [e["key"] for e in entries] == ["day_hours:6"]
    assert s["dayHours"] == [{"weekday": 6, "openMin": 480, "closeMin": 1440}]


def test_the_brief_still_wins_over_something_declared_earlier():
    # The precedence in one test: a declaration fills silence, it never
    # overrules the manager writing something now.
    s = spec(dayHours=[{"weekday": 6, "openMin": 600, "closeMin": 1320}])
    entries = apply_declarations(s, FakeProfile({"day_hours": {"6": [480, 1440]}}), [])

    assert entries == []
    assert s["dayHours"] == [{"weekday": 6, "openMin": 600, "closeMin": 1320}]


def test_a_day_the_brief_closes_is_not_reopened_by_an_old_answer():
    s = spec(closedWeekdays=[6])
    entries = apply_declarations(s, FakeProfile({"day_hours": {"6": [480, 1440]}}), [])

    assert entries == []
    assert s["dayHours"] == []


def test_answering_means_never_being_asked_again():
    # The promise, end to end and without the network: the answer goes into the
    # spec, and a day with hours is a day nothing asks about.
    s = spec()
    apply_declarations(s, FakeProfile({"day_hours": {"6": [480, 1440]}}), ["opening_hours"])

    assert (
        hour_questions(
            brief(
                unclear_hours=[
                    UnclearHours(weekday="saturday", quote="los sabados casi todo el dia")
                ]
            ),
            s,
        )
        == []
    )


@pytest.mark.parametrize(
    "declared",
    [
        {"day_hours": {"nope": [480, 1440]}},
        {"day_hours": {"6": [480]}},
        {"day_hours": {"9": [480, 1440]}},
        {"day_hours": "not a dict"},
        {},
        None,
    ],
)
def test_a_malformed_answer_costs_one_weekday_not_the_request(declared):
    # This column is written by this code today and by a fix-up script one day.
    assert declared_day_hours(FakeProfile(declared)) == {}


# --- The endpoint that remembers -----------------------------------------


@skip_no_db
def test_an_answer_is_remembered_for_the_next_brief(client):  # noqa: F811
    token = _signup(client)

    resp = client.post(
        "/api/v1/schedule/declare",
        json={"weekday": 6, "open_min": 480, "close_min": 1440},
        headers=_auth(token),
    )

    assert resp.status_code == 200
    assert resp.json() == {"weekday": 6, "open_min": 480, "close_min": 1440}


@skip_no_db
def test_a_second_answer_for_another_day_keeps_the_first(client):  # noqa: F811
    # JSONB is not tracked by SQLAlchemy when it is mutated in place, so the
    # obvious implementation saves one answer and silently drops the other
    # depending on what else touched the row in the same request.
    from app.services.business_profile import get_or_create

    token = _signup(client)
    for weekday, open_min, close_min in ((6, 480, 1440), (5, 1080, 1680)):
        resp = client.post(
            "/api/v1/schedule/declare",
            json={"weekday": weekday, "open_min": open_min, "close_min": close_min},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text

    db, org_id = _org_session(token)
    try:
        stored = declared_day_hours(get_or_create(db, org_id))
    finally:
        db.close()

    assert stored == {5: [1080, 1680], 6: [480, 1440]}


@skip_no_db
def test_answering_the_same_day_twice_keeps_the_newer_answer(client):  # noqa: F811
    from app.services.business_profile import get_or_create

    token = _signup(client)
    for open_min, close_min in ((480, 1440), (600, 1320)):
        client.post(
            "/api/v1/schedule/declare",
            json={"weekday": 6, "open_min": open_min, "close_min": close_min},
            headers=_auth(token),
        )

    db, org_id = _org_session(token)
    try:
        stored = declared_day_hours(get_or_create(db, org_id))
    finally:
        db.close()

    assert stored == {6: [600, 1320]}


@skip_no_db
@pytest.mark.parametrize(
    "payload",
    [
        {"weekday": 7, "open_min": 480, "close_min": 1440},
        {"weekday": -1, "open_min": 480, "close_min": 1440},
        {"weekday": 6, "open_min": 600, "close_min": 600},
        {"weekday": 6, "open_min": 900, "close_min": 600},
        {"weekday": 6, "open_min": 480, "close_min": 3000},
    ],
)
def test_an_answer_that_is_not_a_day_is_refused(client, payload):  # noqa: F811
    token = _signup(client)

    resp = client.post(
        "/api/v1/schedule/declare", json=payload, headers=_auth(token)
    )

    assert resp.status_code == 422


# --- Standing hours are the brief speaking about every day ---------------


def test_the_opening_form_does_not_overrule_the_brief_standing_hours():
    """The bar: "lunes a viernes de 17:00 a 03:00", weekend overrides only.

    The standing hours used to count for nothing here, so whatever the opening
    form had saved for Monday to Friday replaced the brief's 17:00-03:00 on all
    five days -- nine to eight, in the form's default.
    """
    s = spec(
        openMin=17 * 60,
        closeMin=27 * 60,
        dayHours=[
            {"weekday": 0, "openMin": 17 * 60, "closeMin": 28 * 60},
            {"weekday": 6, "openMin": 17 * 60, "closeMin": 28 * 60},
        ],
    )
    form = {"day_hours": {str(d): [9 * 60, 20 * 60] for d in range(7)}}
    entries = apply_declarations(s, FakeProfile(form), [])

    assert entries == []
    assert sorted(d["weekday"] for d in s["dayHours"]) == [0, 6]


def test_a_day_the_brief_leaves_in_doubt_still_takes_the_answer():
    """Standing hours, but "los sábados abrimos casi todo el día": that Saturday
    is the day the question was asked about, and the answer fills it."""
    s = spec(openMin=9 * 60, closeMin=17 * 60)
    entries = apply_declarations(
        s, FakeProfile({"day_hours": {"6": [8 * 60, 22 * 60]}}), [], unclear_weekdays=[6]
    )

    assert [e["key"] for e in entries] == ["day_hours:6"]
    assert s["dayHours"] == [{"weekday": 6, "openMin": 480, "closeMin": 1320}]


def test_the_brief_names_the_doubtful_days_by_weekday():
    from app.services.intake import unclear_weekdays

    b = brief(
        unclear_hours=[
            UnclearHours(weekday="saturday", quote="sábados casi todo el día"),
            UnclearHours(weekday="Saturday", quote="otra vez"),
            UnclearHours(weekday="caturday", quote="?"),
        ]
    )
    assert unclear_weekdays(b) == [6]
