from __future__ import annotations

"""Stretches a brief ranks as busy without staffing them.

"Los lunes, jueves, viernes y sábados son los días de más actividad" and "a
mediodía hace falta más gente" are the same statement on two axes: a manager
saying WHERE the pressure is and leaving HOW MANY to us.

THIS FILE USED TO DEFEND THE OPPOSITE RULE, and the reversal is the point. It
said: "we surface the QUESTION and never answer it. A staffing level nobody
stated must not appear in a calendar just because we could guess a plausible
one." That was a defensible position and it was wrong for one reason -- asking
"how many people at the peak?" makes somebody answer in the abstract, about a
calendar they cannot see. Showing them the peak staffed with one more than the
floor makes them answer about a rota in front of them, where a wrong guess is
obvious and a spoken correction costs a sentence.

So the number is now chosen, and the promise that replaces "never answer" is
narrower and keeps the same fear honest: nothing is chosen in SILENCE. Every
assumption comes back with the reason it was made, and one more than the floor
is the smallest thing "more" can mean rather than a plausible-sounding guess.

What survives untouched is the pruning. Every rule below about days that cannot
be busy, days already staffed, and every-day-is-busy was written against the
question and applies word for word to the assumption -- a rule we would not have
asked about is a rule we must not invent either.
"""

import pytest

from app.services import business_profile as bp
from app.services.intake import (
    CoverageRule,
    ScheduleBrief,
    brief_to_spec,
    ranked_signals,
    unstated_fields,
)


def assumptions_for(brief: ScheduleBrief):
    """The spec and the assumptions, assembled the way the router assembles."""
    spec = brief_to_spec(brief)
    silent = unstated_fields(brief)
    assumed = bp.assume(spec, silent, ranked_signals(brief))
    return spec, assumed


# --- What a ranked stretch now becomes --------------------------------------


def test_ranked_days_become_cover_one_above_the_floor():
    brief = ScheduleBrief(busy_weekdays=["monday", "saturday"], min_staff=2)
    spec, assumed = assumptions_for(brief)

    assert [r["weekdays"] for r in spec["coverage"]] == [[1], [6]]
    assert {r["staff"] for r in spec["coverage"]} == {3}
    # Never exact: an assumption may raise cover, never cap it below something
    # the manager asked for elsewhere.
    assert all(r["exact"] is False for r in spec["coverage"])
    assert [a["reason"] for a in assumed] == ["ranked_weekday", "ranked_weekday"]


def test_a_ranked_window_becomes_cover_over_those_hours():
    """The axis the product could not read at all until now."""
    brief = ScheduleBrief(busy_windows=["13:00-16:00"], min_staff=1)
    spec, assumed = assumptions_for(brief)

    assert spec["coverage"] == [
        {
            "weekdays": [],
            "dates": [],
            "startMin": 13 * 60,
            "endMin": 16 * 60,
            "staff": 2,
            "exact": False,
        }
    ]
    assert assumed[0]["reason"] == "ranked_window"
    assert assumed[0]["params"]["floor"] == 1


def test_a_ranked_window_may_run_past_midnight():
    brief = ScheduleBrief(busy_windows=["23:00-04:00"], min_staff=1)
    spec, _ = assumptions_for(brief)
    assert spec["coverage"][0]["startMin"] == 23 * 60
    assert spec["coverage"][0]["endMin"] == 28 * 60


def test_every_assumption_says_why_it_was_made():
    """The promise that replaced "never answer": never in silence."""
    brief = ScheduleBrief(busy_weekdays=["saturday"], min_staff=2)
    _, assumed = assumptions_for(brief)

    assert assumed
    for a in assumed:
        assert a["filledBy"] == "derived"
        assert a["reason"]
        assert a["params"]


def test_the_floor_comes_from_the_lowest_whole_day_number_stated():
    """"Sólo una persona los lunes" says one person can run this shop.

    A number BELOW our default is evidence the default is too high here. A
    number above it is a peak, and a peak sets no floor.
    """
    quiet = ScheduleBrief(
        coverage=[CoverageRule(weekdays=["monday"], staff=1, exact=True)]
    )
    spec, assumed = assumptions_for(quiet)
    assert spec["minStaff"] == 1
    assert assumed[0]["reason"] == "lowest_stated"

    busy = ScheduleBrief(coverage=[CoverageRule(weekdays=["saturday"], staff=4)])
    spec, _ = assumptions_for(busy)
    assert spec["minStaff"] == 2


def test_a_lunchtime_dip_does_not_set_the_weekly_floor():
    """A window is the manager talking about a stretch, not about the week.

    Reading "solo uno a mediodía" as the floor would run the whole shop on its
    quietest hour.
    """
    brief = ScheduleBrief(
        coverage=[
            CoverageRule(start_time="13:00", end_time="15:00", staff=1, exact=True)
        ]
    )
    spec, _ = assumptions_for(brief)
    assert spec["minStaff"] == 2


# --- The pruning, inherited word for word from the question -----------------


def test_a_day_the_shop_is_shut_is_never_ranked_busy():
    """A Sunday-closed shop cannot be busy on Sunday.

    Staffing it would put people on a day nobody works.
    """
    brief = ScheduleBrief(
        closed_weekdays=["sunday"], busy_weekdays=["sunday", "saturday"]
    )
    assert ranked_signals(brief)["weekdays"] == [6]


def test_ranking_every_day_ranks_nothing():
    """"Every day is our busiest day" is not a requirement.

    Cover on all seven days is the flat minimum said twice -- and now that we
    ACT on the ranking rather than asking about it, this guard stops being a
    saved question and starts being a saved payroll.
    """
    every = ScheduleBrief(
        busy_weekdays=[
            "sunday", "monday", "tuesday", "wednesday",
            "thursday", "friday", "saturday",
        ]
    )
    assert ranked_signals(every)["weekdays"] == []


def test_every_OPEN_day_being_busy_ranks_nothing():
    """Six busy days IS every day, for a shop that closes on Sunday."""
    brief = ScheduleBrief(
        closed_weekdays=["sunday"],
        busy_weekdays=[
            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"
        ],
    )
    assert ranked_signals(brief)["weekdays"] == []


def test_a_day_the_brief_already_staffed_is_left_alone():
    """The manager gave a number for Saturday; ours must not compete with it."""
    brief = ScheduleBrief(
        busy_weekdays=["saturday", "friday"],
        coverage=[CoverageRule(weekdays=["saturday"], staff=4)],
    )
    assert ranked_signals(brief)["weekdays"] == [5]


def test_nothing_is_assumed_when_every_ranked_day_was_already_staffed():
    brief = ScheduleBrief(
        busy_weekdays=["saturday"],
        coverage=[CoverageRule(weekdays=["saturday"], staff=4)],
    )
    assert ranked_signals(brief)["weekdays"] == []


def test_unknown_weekday_names_are_dropped_not_guessed():
    brief = ScheduleBrief(busy_weekdays=["lunes", "monday", "funday"])
    assert brief_to_spec(brief)["busyWeekdays"] == [1]
    assert ranked_signals(brief)["weekdays"] == [1]


def test_a_malformed_window_is_dropped_not_guessed():
    brief = ScheduleBrief(
        busy_windows=["mediodia", "13:00", "13:00-13:00", "13:00-16:00"]
    )
    assert ranked_signals(brief)["windows"] == [(13 * 60, 16 * 60)]


def test_a_brief_that_ranks_nothing_assumes_nothing_about_cover():
    brief = ScheduleBrief()
    spec, assumed = assumptions_for(brief)
    assert spec["coverage"] == []
    assert [a for a in assumed if a["field"] == "coverage"] == []


# --- What ranking still does NOT do -----------------------------------------


def test_ranked_days_do_not_count_as_stated_coverage():
    """Ranking is not stating. `unstated_fields` still reports the silence.

    It is `assume` that fills it and says so, which is what takes the field out
    of the adaptive layer's reach -- not a claim that the brief spoke.
    """
    brief = ScheduleBrief(busy_weekdays=["saturday"])
    assert "coverage" in unstated_fields(brief)


@pytest.mark.parametrize(
    "field", ["min_staff", "opening_hours", "max_weekly_hours", "shift_length"]
)
def test_ranking_days_changes_nothing_else(field):
    assert field in unstated_fields(ScheduleBrief(busy_weekdays=["monday"]))


def test_the_days_travel_in_the_spec_so_the_client_can_show_them():
    brief = ScheduleBrief(busy_weekdays=["monday", "saturday"])
    assert brief_to_spec(brief)["busyWeekdays"] == [1, 6]
