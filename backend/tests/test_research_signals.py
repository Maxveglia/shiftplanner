from __future__ import annotations

"""What the research infers, and everywhere it is not allowed to speak.

The feature in one sentence: Gemini already searches for how a bar in
Barcelona runs, and until now the answer reached Claude as BACKGROUND under an
instruction forbidding it from adding any coverage -- so the reasoning was
written down and changed nothing. Now it becomes the same kind of coverage rule
the brief's own "los viernes son los fuertes" becomes, announced the same way.

Which makes the interesting tests the NEGATIVE ones. A model that has read the
internet about bars is being allowed to put somebody on a shift, so most of
what is pinned here is where it must stay quiet: anywhere the manager already
spoke, any figure past what an inference may buy, any holiday outside the
period, any month the trade is dead.

Pure: no network, no database, no clock. The HTTP call is injected, the same
way `test_research` and `test_interview` do it.
"""

import pytest

from app.services import business_profile as bp
from app.services.research import (
    MAX_PEAK_OVER_FLOOR,
    ResearchInput,
    ResearchSignals,
    derive_signals,
    parse_signals,
)

FRIDAY, SATURDAY, TUESDAY = 5, 6, 2


def signals(**over) -> ResearchSignals:
    base = dict(
        busy_weekdays=[FRIDAY, SATURDAY],
        busy_windows=[(21 * 60, 25 * 60)],
        peak_staff=None,
        rationale="un bar en Barcelona llena el viernes y el sábado noche",
    )
    base.update(over)
    return ResearchSignals(**base)


def spec(**over) -> dict:
    base = {"minStaff": 2, "coverage": [], "closedDates": []}
    base.update(over)
    return base


def payload(obj: dict) -> dict:
    """A generateContent reply carrying `obj` as its JSON body."""
    import json

    return {"candidates": [{"content": {"parts": [{"text": json.dumps(obj)}]}}]}


# --- Where an inference may speak -----------------------------------------


def test_it_fills_an_axis_the_brief_left_silent():
    """The whole point: nobody said which nights are busy, so we infer them."""
    merged = bp.merge_signals({}, signals(), spec())

    assert merged["weekdays"] == [FRIDAY, SATURDAY]
    assert merged["researched_weekdays"] == [FRIDAY, SATURDAY]
    assert "Barcelona" in merged["rationale"]


def test_the_inference_becomes_a_coverage_rule_and_says_so():
    """Through `assume`: a rule on the spec and an assumption to show for it."""
    target = spec()
    assumed = bp.assume(target, [], bp.merge_signals({}, signals(), target))

    fridays = [
        r for r in target["coverage"] if r["weekdays"] == [FRIDAY]
    ]
    assert fridays, "Friday got a coverage rule"
    # Never exact: an assumption may raise cover, never cap it.
    assert fridays[0]["exact"] is False
    assert fridays[0]["staff"] > target["minStaff"]

    reasons = [a["reason"] for a in assumed]
    assert "researched_weekday" in reasons
    # And it carries the sentence the manager will be shown as the "because".
    why = [a for a in assumed if a["reason"] == "researched_weekday"][0]
    assert "Barcelona" in why["why"]


# --- Where it may not -----------------------------------------------------


def test_it_stays_quiet_where_the_brief_ranked_its_own_days():
    """"Los martes son los fuertes" settles WHICH days, and Friday is not added.

    The subtle half of the rule: the brief does not have to CONTRADICT the
    inference for the inference to be unwelcome. Having spoken about the axis
    at all is enough.
    """
    merged = bp.merge_signals({"weekdays": [TUESDAY]}, signals(), spec())

    assert merged["weekdays"] == [TUESDAY]
    assert "researched_weekdays" not in merged


def test_it_stays_quiet_where_the_brief_staffed_a_weekday_with_a_number():
    """"Cuatro los sábados" is the manager talking about days, with a figure."""
    target = spec(
        coverage=[
            {
                "weekdays": [SATURDAY],
                "dates": [],
                "startMin": None,
                "endMin": None,
                "staff": 4,
            }
        ]
    )
    merged = bp.merge_signals({}, signals(), target)

    assert "researched_weekdays" not in merged


def test_it_stays_quiet_about_hours_the_brief_scoped():
    target = spec(
        coverage=[
            {
                "weekdays": [],
                "dates": [],
                "startMin": 13 * 60,
                "endMin": 16 * 60,
                "staff": 3,
            }
        ]
    )
    merged = bp.merge_signals({}, signals(), target)

    assert "researched_windows" not in merged


def test_nothing_inferred_leaves_the_spec_as_it_was():
    """A business whose research never ran plans exactly as it did before."""
    assert bp.merge_signals({}, None, spec()) == {}
    assert bp.merge_signals({}, ResearchSignals(), spec()) == {}


# --- What an inference may buy --------------------------------------------


def test_a_headcount_is_capped_over_the_floor():
    """A model that has never seen the room does not get to fill it."""
    parsed = parse_signals(
        payload({"busy_weekdays": ["friday"], "peak_staff": 12, "rationale": "x"}),
        floor=2,
    )
    assert parsed.peak_staff == 2 + MAX_PEAK_OVER_FLOOR


def test_a_headcount_never_lowers_the_assumption():
    """An inference below the planner's own +1 is ignored, not obeyed.

    Cutting cover is not something an assumption may do in either direction:
    not by capping a rule, and not by proposing a smaller peak than the one
    the product would have assumed on its own.
    """
    target = spec()
    bp.assume(target, [], bp.merge_signals({}, signals(peak_staff=1), target))

    fridays = [r for r in target["coverage"] if r["weekdays"] == [FRIDAY]]
    assert fridays[0]["staff"] == target["minStaff"] + bp.RANKED_EXTRA


def test_busy_every_day_is_busy_on_no_day():
    """Five ranked days would raise cover over the whole week."""
    parsed = parse_signals(
        payload(
            {
                "busy_weekdays": [
                    "monday",
                    "tuesday",
                    "wednesday",
                    "thursday",
                    "friday",
                ],
                "rationale": "x",
            }
        )
    )
    assert parsed.busy_weekdays == []


def test_a_dead_month_is_a_reason_not_to_add():
    """August in a city that empties: the peak is not staffed up.

    It does not CUT anything -- nothing here may -- it simply declines to add.
    """
    august = {"2026-08-%02d" % d for d in range(1, 32)}
    merged = bp.merge_signals(
        {}, signals(quiet_months=[8]), spec(), period_dates=august
    )

    assert "researched_weekdays" not in merged


def test_a_busy_month_still_staffs_the_peak():
    july = {"2026-07-%02d" % d for d in range(1, 32)}
    merged = bp.merge_signals(
        {}, signals(quiet_months=[8], busy_months=[7]), spec(), period_dates=july
    )

    assert merged["researched_weekdays"] == [FRIDAY, SATURDAY]


# --- Holidays: the most expensive inference -------------------------------


def test_a_holiday_inside_the_period_closes_the_day():
    october = {"2026-10-%02d" % d for d in range(1, 32)}
    merged = bp.merge_signals(
        {},
        signals(holidays=[{"date": "10-12", "name": "Fiesta", "closes": True}]),
        spec(),
        period_dates=october,
    )
    assert merged["closures"] == ["2026-10-12"]


def test_a_holiday_outside_the_period_is_not_acted_on():
    """A rota for October has no business acting on Sant Joan."""
    october = {"2026-10-%02d" % d for d in range(1, 32)}
    merged = bp.merge_signals(
        {},
        signals(holidays=[{"date": "06-24", "name": "Sant Joan", "closes": True}]),
        spec(),
        period_dates=october,
    )
    assert "closures" not in merged


def test_a_holiday_that_merely_changes_trade_does_not_close_anything():
    october = {"2026-10-%02d" % d for d in range(1, 32)}
    merged = bp.merge_signals(
        {},
        signals(holidays=[{"date": "10-12", "name": "Fiesta", "closes": False}]),
        spec(),
        period_dates=october,
    )
    assert "closures" not in merged


def test_an_inferred_closure_is_announced_loudly():
    """A shutter down is not something to find by reading a rota carefully."""
    october = {"2026-10-%02d" % d for d in range(1, 32)}
    target = spec()
    assumed = bp.assume(
        target,
        [],
        bp.merge_signals(
            {},
            signals(holidays=[{"date": "10-12", "name": "Fiesta", "closes": True}]),
            target,
            period_dates=october,
        ),
    )
    closures = [a for a in assumed if a["reason"] == "researched_holiday"]
    assert closures and closures[0]["loud"] is True
    assert target["closedDates"] == ["2026-10-12"]


def test_closures_stay_out_where_the_brief_named_its_own():
    october = {"2026-10-%02d" % d for d in range(1, 32)}
    target = spec(closedDates=["2026-10-20"])
    bp.assume(
        target,
        [],
        bp.merge_signals(
            {},
            signals(holidays=[{"date": "10-12", "name": "Fiesta", "closes": True}]),
            target,
            period_dates=october,
        ),
    )
    assert target["closedDates"] == ["2026-10-20"]


# --- Reading the reply ----------------------------------------------------


def test_a_window_through_midnight_is_read_as_one():
    """A bar's peak runs 21:00 to 01:00, which is four hours, not minus twenty."""
    parsed = parse_signals(
        payload({"busy_windows": ["21:00-01:00"], "rationale": "x"})
    )
    assert parsed.busy_windows == [(21 * 60, 25 * 60)]


def test_rubbish_costs_its_own_field_and_nothing_else():
    parsed = parse_signals(
        payload(
            {
                "busy_weekdays": ["friday", "Blursday"],
                "busy_windows": ["not-a-window", "21:00-23:00"],
                "holidays": [{"date": "99-99", "name": "x", "closes": True}],
                "rationale": "x",
            }
        )
    )
    assert parsed.busy_weekdays == [FRIDAY]
    assert parsed.busy_windows == [(21 * 60, 23 * 60)]
    assert parsed.holidays == []


def test_a_stored_row_survives_a_round_trip():
    original = signals(busy_months=[7], holidays=[{"date": "10-12", "name": "F", "closes": True}])
    assert ResearchSignals.from_json(original.to_json()).to_json() == original.to_json()


def test_a_malformed_stored_row_is_not_a_crash():
    """A column written by a model must never take the calendar down."""
    assert ResearchSignals.from_json(None).has_anything is False
    assert ResearchSignals.from_json({"busy_weekdays": "friday"}).busy_weekdays == []


def test_the_call_asks_without_a_search_tool():
    """Schema and search cannot be combined, so this one carries no tool."""
    seen = {}

    def fake(req, api_key, model):
        seen["system"] = req.system_instruction
        seen["prompt"] = req.prompt
        return payload({"busy_weekdays": ["friday"], "rationale": "porque sí"})

    out = derive_signals(
        ResearchInput(notes="un bar", location="Barcelona", language="es"),
        summary="los bares llenan el fin de semana",
        api_key="k",
        model="m",
        call=fake,
    )

    assert out.busy_weekdays == [FRIDAY]
    assert "Barcelona" in seen["prompt"]
    # The instruction that keeps it from guessing is the one worth pinning.
    assert "must not do" in seen["system"]
    assert "Never contradict the manager" in seen["system"]
