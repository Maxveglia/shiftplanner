from __future__ import annotations

"""Every number the manager did not give, and why it is the number it is.

The product has always filled the silences. What it has not done is say what it
filled them with, or on what grounds -- `gaps` reported a static English
sentence about a default and never the figure that actually reached the
calendar. So a manager could be told "the same number of people all day" and had
no way to learn that the number was two, or that two came from nothing.

Two grounds, and telling them apart is the whole point. A DERIVED figure rests
on something this brief said. A GENERIC one rests on nothing, and says so.
"""

from app.services import business_profile as bp
from app.services.intake import (
    CoverageRule,
    ScheduleBrief,
    brief_to_spec,
    ranked_signals,
    unstated_fields,
)


def report(brief: ScheduleBrief):
    """The spec and its gaps, assembled the way the router assembles them."""
    spec = brief_to_spec(brief)
    silent = unstated_fields(brief)
    assumed = bp.assume(spec, silent, ranked_signals(brief))
    silent = [f for f in silent if f not in {a["field"] for a in assumed}]
    return spec, bp.gaps(silent, [], assumed, spec)


def by_field(gaps, field):
    return [g for g in gaps if g["field"] == field]


def test_a_generic_default_admits_it_rests_on_nothing():
    _, gaps = report(ScheduleBrief())
    rest = by_field(gaps, "min_rest")[0]

    assert rest["filledBy"] == "default"
    assert rest["reason"] == "generic"
    # The figure, not a sentence about the figure.
    assert rest["value"] == 11


def test_the_figure_that_reached_the_calendar_is_the_figure_reported():
    spec, gaps = report(ScheduleBrief())
    assert by_field(gaps, "min_staff")[0]["value"] == spec["minStaff"]
    assert by_field(gaps, "max_weekly_hours")[0]["value"] == spec["maxHoursPerWeek"]
    assert by_field(gaps, "opening_hours")[0]["value"] == [
        spec["openMin"],
        spec["closeMin"],
    ]


def test_a_derived_figure_carries_what_it_was_derived_from():
    brief = ScheduleBrief(busy_windows=["13:00-16:00"], min_staff=1)
    _, gaps = report(brief)
    cover = by_field(gaps, "coverage")[0]

    assert cover["filledBy"] == "derived"
    assert cover["reason"] == "ranked_window"
    assert cover["value"] == 2
    # The floor travels too, because "two" is only defensible next to the one
    # it is one more than.
    assert cover["params"]["floor"] == 1


def test_a_field_that_was_assumed_is_not_also_reported_as_a_default():
    """One field, one entry. Two would be two answers to the same question."""
    brief = ScheduleBrief(busy_weekdays=["saturday"], min_staff=2)
    _, gaps = report(brief)

    cover = by_field(gaps, "coverage")
    assert len(cover) == 1
    assert cover[0]["filledBy"] == "derived"


def test_a_stated_field_is_no_gap_at_all():
    brief = ScheduleBrief(min_staff=3, max_hours_per_week=35)
    _, gaps = report(brief)
    assert by_field(gaps, "min_staff") == []
    assert by_field(gaps, "max_weekly_hours") == []


def test_assuming_the_shop_never_closes_is_finally_reported():
    """The one decision this list made and did not report.

    `closures` had no label, and `gaps` skips a field without one -- so "we
    assumed you are open seven days" was the single silent assumption left in a
    function whose entire job is to end silent assumptions.
    """
    _, gaps = report(ScheduleBrief())
    assert len(by_field(gaps, "closures")) == 1

    stated = ScheduleBrief(closed_weekdays=["sunday"])
    _, gaps = report(stated)
    assert by_field(gaps, "closures") == []


def test_the_loud_ranking_is_untouched():
    """`LOUD_GAPS` decided which of these deserve attention. It still does."""
    _, gaps = report(ScheduleBrief())
    loud = {g["field"] for g in gaps if g["loud"]}
    assert loud == {"opening_hours", "min_staff", "coverage"}


def test_a_learned_hint_still_wins_over_a_report():
    """A field a hint filled was decided on evidence, and is reported there."""
    brief = ScheduleBrief()
    spec = brief_to_spec(brief)
    silent = unstated_fields(brief)
    applied = [{"field": "minStaff", "key": "min_staff", "label": "x",
                "source": "profile", "evidence": 3}]
    gaps = bp.gaps(silent, applied, [], spec)
    assert by_field(gaps, "min_staff") == []


def test_nothing_is_reported_without_a_reason():
    """The promise: no figure appears in a calendar without its grounds."""
    brief = ScheduleBrief(
        busy_weekdays=["saturday"],
        coverage=[CoverageRule(weekdays=["monday"], staff=1, exact=True)],
    )
    _, gaps = report(brief)

    assert gaps
    for g in gaps:
        assert g["reason"]
        assert g["filledBy"] in {"default", "derived"}
