"""Hours that run past midnight, which the intake used to throw away.

A bar that writes "abrimos de seis de la tarde a cuatro" was handed 8:00-22:00.
Not refused, not queried -- replaced, silently, because a close before an open
looked like a typo to a comparison that only knew how to read a daytime. The
manager typed their real hours and got a bakery's, and the only symptom was a
calendar that did not match what they had said.

A window that ends before it starts is a night. These pin that reading, and the
one case that really is nothing: a window zero minutes long.

Pure conversion tests -- no database, no network, no model call.
"""

from __future__ import annotations

from app.services.intake import ScheduleBrief, brief_to_spec


def spec_for(**fields) -> dict:
    return brief_to_spec(ScheduleBrief.model_validate(fields))


def test_a_close_before_the_open_rolls_into_the_next_day():
    spec = spec_for(open_time="18:00", close_time="04:00")
    assert spec["openMin"] == 18 * 60
    # 04:00 the following morning, in the same units the frontend already
    # documents for an overnight assignment's endMin.
    assert spec["closeMin"] == 28 * 60


def test_a_night_still_reaches_the_panel_as_a_stated_requirement():
    """The rule, not just the minutes.

    The rollover first shipped as an `elif` sitting between the fallback and the
    branch that emits the rule, so a business working through midnight got the
    right `openMin`/`closeMin` and no `opening_hours` rule at all -- the one
    thing it had said most plainly, missing from the panel where the manager
    reads back what we understood. The minutes were right, which is exactly why
    nothing else caught it.
    """
    spec = spec_for(open_time="18:00", close_time="04:00")
    hours = [r for r in spec["rules"] if r["kind"] == "opening_hours"]
    assert len(hours) == 1
    assert hours[0]["origin"] == "parsed"


def test_a_day_that_says_nothing_states_no_opening_rule():
    """The mirror of the case above: silence must not become a stated rule."""
    spec = spec_for(open_time="20:00", close_time="20:00")
    assert [r for r in spec["rules"] if r["kind"] == "opening_hours"] == []


def test_ordinary_daytime_hours_are_untouched():
    spec = spec_for(open_time="09:00", close_time="17:00")
    assert (spec["openMin"], spec["closeMin"]) == (9 * 60, 17 * 60)


def test_open_and_close_at_the_same_minute_still_means_nothing():
    """The one backwards-looking window that really is empty."""
    spec = spec_for(open_time="20:00", close_time="20:00")
    assert (spec["openMin"], spec["closeMin"]) == (8 * 60, 22 * 60)


def test_a_brief_that_says_nothing_still_gets_the_generic_default():
    spec = spec_for()
    assert (spec["openMin"], spec["closeMin"]) == (8 * 60, 22 * 60)


def test_midnight_close_is_not_mistaken_for_a_night():
    """'24:00' is the end of this day, not four in the morning of the next."""
    spec = spec_for(open_time="08:00", close_time="24:00")
    assert spec["closeMin"] == 24 * 60


def test_a_weekday_override_may_run_past_midnight():
    """'Los viernes hasta las cuatro' used to vanish without a trace."""
    spec = spec_for(
        open_time="09:00",
        close_time="17:00",
        day_hours=[{"weekdays": ["friday"], "open_time": "18:00", "close_time": "04:00"}],
    )
    assert spec["dayHours"] == [
        {"weekday": 5, "openMin": 18 * 60, "closeMin": 28 * 60}
    ]


def test_a_weekday_override_of_zero_length_is_still_dropped():
    spec = spec_for(
        open_time="09:00",
        close_time="17:00",
        day_hours=[{"weekdays": ["friday"], "open_time": "18:00", "close_time": "18:00"}],
    )
    assert spec["dayHours"] == []


def test_the_spec_carries_no_business_shape_of_its_own():
    """The two parameters come from the profile, never from the brief.

    The intake schema is at the API's structured-output complexity ceiling, so
    nothing here was added to it. `dayBoundaryMin` and `weekendDays` are
    settings a manager typed into their profile, and the interpret endpoint
    attaches them after this function has run.
    """
    spec = spec_for(open_time="18:00", close_time="04:00")
    assert "dayBoundaryMin" not in spec
    assert "weekendDays" not in spec


# --- Coverage windows -------------------------------------------------------
#
# The opening hours learned to roll over; the coverage rules did not, and the
# cost was worse than losing them. A window whose close lands before its open
# was erased, and a coverage rule with no window and no weekday falls through
# to the flat minimum -- so "three people from 23:00 to 04:00" did not go
# missing, it became three people at ten in the morning and one at two. The
# manager's busiest stretch turned into the one hour left short.


def test_a_coverage_window_may_run_past_midnight():
    spec = spec_for(
        open_time="18:00",
        close_time="04:00",
        coverage=[{"staff": 3, "start_time": "23:00", "end_time": "04:00"}],
    )
    assert len(spec["coverage"]) == 1
    window = spec["coverage"][0]
    assert (window["startMin"], window["endMin"]) == (23 * 60, 28 * 60)
    assert window["staff"] == 3


def test_a_night_peak_does_not_become_the_whole_day_s_floor():
    """The inversion this test exists for.

    `minStaff` must stay where the brief left it. If the night window is erased
    it lands here instead, and every daytime hour inherits the staffing the
    manager asked for at three in the morning.
    """
    spec = spec_for(
        open_time="18:00",
        close_time="04:00",
        min_staff=1,
        coverage=[{"staff": 3, "start_time": "23:00", "end_time": "04:00"}],
    )
    assert spec["minStaff"] == 1


def test_a_daytime_coverage_window_is_untouched():
    spec = spec_for(
        open_time="09:00",
        close_time="22:00",
        coverage=[{"staff": 3, "start_time": "13:00", "end_time": "16:00"}],
    )
    window = spec["coverage"][0]
    assert (window["startMin"], window["endMin"]) == (13 * 60, 16 * 60)


def test_a_coverage_window_of_zero_length_still_means_the_whole_day():
    """Unchanged behaviour, and the reason the check is `==` and not `<=`.

    "Three people, from eight to eight" is not a night: it is a rule with no
    window, and it belongs to every open hour of the days it scopes.
    """
    spec = spec_for(
        open_time="09:00",
        close_time="22:00",
        min_staff=1,
        coverage=[{"staff": 3, "start_time": "20:00", "end_time": "20:00", "weekdays": ["monday"]}],
    )
    window = spec["coverage"][0]
    assert (window["startMin"], window["endMin"]) == (None, None)
    assert window["weekdays"] == [1]
