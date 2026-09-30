from __future__ import annotations

"""The month written short, and read long.

A month of 124 shifts cost 6.090 output tokens to write out one shift at a
time, and output is the expensive half of this product by a factor of forty.
Patterns exist to write the repetition once. What matters is that NOTHING
downstream can tell: the client receives the same five-field shifts it always
received, so the validator, the repair pass and the greedy fill stay the net
they were.

So these tests do not check that patterns are clever. They check the three
ways the expansion could quietly hand the rest of the product something it has
never seen: a shift the manager did not get, a shift on a day the model
excluded, and a pattern silently outranking a shift written out by hand.
"""

from app.services.calendar_plan import (
    MonthPlan,
    ProposedShift,
    WeeklyPattern,
    expand_patterns,
)


def pattern(**kwargs) -> WeeklyPattern:
    base = {
        "employee_id": "e1",
        "weekdays": "mon,tue,wed,thu,fri",
        "start": "09:00",
        "end": "17:00",
    }
    base.update(kwargs)
    return WeeklyPattern(**base)


def test_a_weekday_pattern_becomes_one_shift_per_matching_day():
    # October 2026 has 22 weekdays.
    plan = MonthPlan(patterns=[pattern()])
    out = expand_patterns(plan, "2026-10")

    assert len(out) == 22
    # Never two shifts on one date: a duplicate reads as a split shift, which
    # the validator throws away -- so the person loses the day, not gains one.
    assert len({shift.date for shift in out}) == 22
    assert all(shift.start == "09:00" and shift.end == "17:00" for shift in out)


def test_a_month_with_no_patterns_is_the_shifts_it_came_with():
    """The old behaviour is not a special case that needs its own path -- it is
    this one with an empty list, and a model that ignores patterns entirely
    still gets a correct month."""
    written = [
        ProposedShift(employee_id="e1", date="2026-10-01", start="09:00", end="17:00")
    ]
    out = expand_patterns(MonthPlan(shifts=written), "2026-10")

    assert [shift.model_dump() for shift in out] == [
        shift.model_dump() for shift in written
    ]


def test_a_shift_written_out_by_hand_beats_the_pattern_for_that_day():
    """How "her usual week, but noon on the 14th" is said. Without this the
    exception is either lost or duplicated, and a duplicate is a split shift
    the validator then throws away -- so the manager loses the day entirely."""
    plan = MonthPlan(
        patterns=[pattern()],
        shifts=[
            ProposedShift(
                employee_id="e1", date="2026-10-14", start="12:00", end="20:00"
            )
        ],
    )
    out = expand_patterns(plan, "2026-10")

    fourteenth = [shift for shift in out if shift.date == "2026-10-14"]
    assert len(fourteenth) == 1
    assert fourteenth[0].start == "12:00"
    assert len(out) == 22


def test_skip_dates_remove_the_day_without_removing_the_pattern():
    plan = MonthPlan(patterns=[pattern(skip_dates="2026-10-05, 2026-10-06")])
    out = expand_patterns(plan, "2026-10")

    assert len(out) == 20
    assert not [shift for shift in out if shift.date in ("2026-10-05", "2026-10-06")]


def test_weekday_spellings_we_did_not_ask_for_still_read():
    """"Mondays", "MON" and "monday" are the same day. A pattern is worth
    keeping for the days we understood; the alternative is losing a person's
    whole month to a plural."""
    plan = MonthPlan(patterns=[pattern(weekdays="Mondays, TUE, wednesday")])
    out = expand_patterns(plan, "2026-10")

    # Four Mondays, four Tuesdays and four Wednesdays in October 2026.
    assert len(out) == 12


def test_a_weekday_we_cannot_read_costs_that_pattern_and_nothing_else():
    plan = MonthPlan(
        patterns=[pattern(weekdays="funday"), pattern(employee_id="e2")],
        shifts=[
            ProposedShift(employee_id="e3", date="2026-10-01", start="09:00", end="17:00")
        ],
    )
    out = expand_patterns(plan, "2026-10")

    assert not [shift for shift in out if shift.employee_id == "e1"]
    assert len([shift for shift in out if shift.employee_id == "e2"]) == 22
    assert len([shift for shift in out if shift.employee_id == "e3"]) == 1


def test_a_month_we_cannot_parse_falls_back_to_the_written_out_shifts():
    """A month string we cannot read must not swallow the shifts that came
    with it: the greedy pass can cover what a pattern would have added, and it
    cannot recover a shift we dropped on the floor."""
    written = [
        ProposedShift(employee_id="e1", date="2026-10-01", start="09:00", end="17:00")
    ]
    out = expand_patterns(MonthPlan(shifts=written, patterns=[pattern()]), "not-a-month")

    assert len(out) == 1


def test_two_people_on_the_same_days_do_not_collide():
    plan = MonthPlan(patterns=[pattern(), pattern(employee_id="e2", start="12:00", end="20:00")])
    out = expand_patterns(plan, "2026-10")

    assert len(out) == 44
    assert len({(shift.employee_id, shift.date) for shift in out}) == 44
