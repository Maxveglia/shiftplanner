from __future__ import annotations

"""Hours above the contract: art. 35 and art. 12.5, as arithmetic.

The rule every test here is a consequence of: an extra hour is an hour worked
above the ordinary day THIS PERSON'S CONTRACT fixes (art. 35.1 ET), not above
the statutory forty and not above the convenio's full-time year. Those two
figures describe a full-time contract; read as though they described everybody,
they let somebody on twenty hours a week work thirty-five, every week, forever,
and never once appear above their contract.

What the excess then becomes depends on the contract, and Spanish law gives it
two different names with two different ceilings:

    full-time   horas extraordinarias  art. 35    80 a year, cap prorated
    part-time   horas complementarias  art. 12.5  a pact, and 30%/60% of it

And two things stop an hour above the contract being either: hours worked back
against a recoverable day off, and the tenth of the year art. 34.2 lets the
employer move around. Those are ordinary hours and `test_annual_workday.py`
holds them.

Pure: no database, no clock. Without Postgres this repository skips 93 tests
and still reports green, so a rule that can only be exercised through a router
is a rule that quietly stops being tested.
"""

from datetime import date, timedelta

from app.services.workday import (
    ContractTerms,
    add_months,
    classify_week,
    compensation_schedule,
    complementary_allowance,
    expected_annual_hours,
    full_time_share,
    is_part_time,
    overtime_cap,
    report,
    WorkdayLimits,
    WorkedShift,
)

# A Monday, so the weeks below start where the product's weeks start.
JAN = date(2026, 1, 5)

#: Barcelona hospitality, as `app/seeds/labor.py` seeds it -- the statute's
#: figures with the convenio's 1,783-hour year on top.
BARCELONA = WorkdayLimits(
    weekly_average_hours=40,
    annual_hours=1783,
    irregular_pct=0.10,
    irregular_notice_days=5,
    max_daily_hours=9,
    min_rest_hours=12,
    annual_overtime_cap=80,
    overtime_compensation_months=4,
    part_time_overtime_allowed=False,
    complementary_min_weekly=10,
    complementary_pct_max=0.30,
    complementary_pct_max_by_agreement=0.60,
    voluntary_complementary_pct=0.15,
    complementary_notice_days=3,
)

#: The same business with no irregular distribution agreed, so a test can ask
#: what an hour above the contract IS without art. 34.2 absorbing it first.
#: The rule is ABSENT rather than set to zero, and the difference matters: a
#: rule present at zero means "nothing may be moved" and reports every excess
#: as a breach of it, which would drown the finding each test is looking for.
NO_ROOM = WorkdayLimits(
    weekly_average_hours=40,
    annual_hours=1783,
    irregular_pct=None,
    annual_overtime_cap=80,
    overtime_compensation_months=4,
    part_time_overtime_allowed=False,
    complementary_min_weekly=10,
    complementary_pct_max=0.30,
    voluntary_complementary_pct=0.15,
)

FULL_TIME = ContractTerms(weekly_hours=40)


def week(n: int) -> date:
    return JAN + timedelta(weeks=n)


def shifts_for(hours_by_week, employee="e1"):
    """One shift a week, carrying that week's hours. Weeks start at JAN."""
    return [
        WorkedShift(employee_id=employee, day=week(i) + timedelta(days=1), hours=h)
        for i, h in enumerate(hours_by_week)
        if h
    ]


def rows_for(contract, hours_by_week, limits=NO_ROOM, weeks=None, **kw):
    weeks = weeks or [week(i) for i in range(len(hours_by_week))]
    return report(
        "e1", contract, shifts_for(hours_by_week), [], limits, weeks, JAN, **kw
    )


def rules(row):
    return {e.rule for e in row.errors}


# --- The contract is the line (art. 35.1) ---------------------------------


def test_the_excess_is_measured_against_the_contract_not_the_statute():
    """A 30-hour contract worked at 38 is eight hours above it, not below 40."""
    rows = rows_for(ContractTerms(weekly_hours=30), [38])
    assert rows[0].complementary_hours == 8


def test_a_full_week_over_the_contract_is_extraordinary():
    rows = rows_for(FULL_TIME, [46])
    assert rows[0].overtime_hours == 6
    assert rows[0].complementary_hours == 0


def test_a_contract_that_states_no_hours_is_not_judged():
    """Silence is not a forty-hour week, and it is not a zero-hour one either.

    Art. 35.1 measures the excess against the ordinary day. A contract with no
    hours in it fixes no ordinary day, so there is nothing here to exceed --
    and calling every hour extraordinary because the agreement is silent would
    be the loudest possible way of reporting "unknown".
    """
    rows = rows_for(ContractTerms(weekly_hours=0), [38])
    assert rows[0].overtime_hours == 0
    assert rows[0].complementary_hours == 0
    assert rows[0].errors == []


def test_a_contract_above_the_statutory_week_is_still_capped_by_it():
    """45 hours cannot be contracted as ordinary; the statute's 40 stands."""
    rows = rows_for(ContractTerms(weekly_hours=45), [45])
    assert rows[0].overtime_hours == 5


# --- Part-time: a different word, and a different ceiling (art. 12) -------


def test_a_part_timers_excess_is_never_called_overtime():
    """Art. 12.4.c forbids extra hours here, so the label would be a lie."""
    rows = rows_for(ContractTerms(weekly_hours=20, complementary_pct=0.30), [28])
    assert rows[0].overtime_hours == 0
    assert rows[0].complementary_hours == 8


def test_part_time_is_decided_against_the_full_time_week():
    assert is_part_time(ContractTerms(weekly_hours=20), BARCELONA)
    assert not is_part_time(FULL_TIME, BARCELONA)
    # Nothing is part-time where no full-time week is seeded: an unseeded
    # jurisdiction behaves exactly as it did before any of this existed.
    assert not is_part_time(ContractTerms(weekly_hours=20), WorkdayLimits())


def test_hours_above_a_part_time_contract_with_no_pact_are_reported():
    """No pact, no complementary hours -- not one of them could be required.

    The finding is about the CONTRACT, so it says so rather than telling the
    manager to take hours off a rota that may be perfectly sensible.
    """
    rows = rows_for(ContractTerms(weekly_hours=20), [28])
    assert "complementary_without_pact" in rules(rows[0])


def test_a_pact_makes_the_same_hours_lawful():
    rows = rows_for(ContractTerms(weekly_hours=20, complementary_pct=0.30), [28])
    assert rules(rows[0]) == set()


def test_a_contract_under_ten_hours_cannot_have_a_pact_at_all():
    """Art. 12.5.a. Only raising the contract fixes this one, so say that."""
    rows = rows_for(ContractTerms(weekly_hours=8, complementary_pct=0.30), [14])
    assert "complementary_contract_too_short" in rules(rows[0])
    assert "complementary_without_pact" not in rules(rows[0])


def test_complementary_hours_run_out_at_the_agreed_share():
    """20 hours a week is 891.5 a year here; 30% + 15% voluntary is 401.

    Forty weeks at 30 hours is 400 complementary hours, which fits. The
    forty-first does not.
    """
    part_timer = ContractTerms(weekly_hours=20, complementary_pct=0.30)
    allowed = complementary_allowance(
        part_timer, NO_ROOM, expected_annual_hours(NO_ROOM, 20)
    )
    assert round(allowed, 1) == 401.2

    rows = rows_for(part_timer, [30] * 41, weeks=[week(39), week(40)])
    assert rules(rows[0]) == set()
    assert "complementary_cap_exceeded" in rules(rows[1])


def test_the_voluntary_share_is_only_added_for_an_open_ended_contract():
    """Art. 12.5.g offers them on indefinite contracts and on no other kind."""
    year = expected_annual_hours(NO_ROOM, 20)
    open_ended = ContractTerms(weekly_hours=20, complementary_pct=0.30)
    fixed_term = ContractTerms(
        weekly_hours=20, complementary_pct=0.30, open_ended=False
    )
    assert complementary_allowance(open_ended, NO_ROOM, year) > (
        complementary_allowance(fixed_term, NO_ROOM, year)
    )
    assert complementary_allowance(fixed_term, NO_ROOM, year) == year * 0.30


def test_a_pact_claiming_more_than_the_law_allows_is_reported_on_its_own():
    """70% is void above 60% (art. 12.5.c), and it is void before anybody works.

    So the finding appears in a week with no excess at all: the manager would
    rather hear it now than the first time they call on it.
    """
    rows = rows_for(ContractTerms(weekly_hours=20, complementary_pct=0.70), [20])
    assert "complementary_pact_above_statute" in rules(rows[0])


# --- The 80-hour year, and the rest that empties it (art. 35.1, 35.2) -----


def test_the_cap_is_eighty_for_a_full_time_contract():
    assert overtime_cap(BARCELONA, FULL_TIME) == 80


def test_the_cap_is_reduced_in_the_contracts_own_proportion():
    """Art. 35.2's second sentence: half a year is half a cap, not the whole one."""
    assert overtime_cap(BARCELONA, ContractTerms(weekly_hours=20)) == 40
    assert full_time_share(ContractTerms(weekly_hours=20), BARCELONA) == 0.5


def test_passing_the_cap_is_reported():
    """Ten weeks at 49 hours is 90 extra hours, and 80 is the year's lot."""
    rows = rows_for(FULL_TIME, [49] * 10)
    assert "overtime_cap_exceeded" not in rules(rows[7])
    assert "overtime_cap_exceeded" in rules(rows[9])


def test_rest_within_four_months_empties_the_cap_again():
    """Art. 35.2 in one test: the compensated hours do not count.

    Ten long weeks answered by ten short ones is a rota that balanced itself.
    Counting the long weeks alone would fire an 80-hour breach at a business
    that never worked an uncompensated extra hour.
    """
    rows = rows_for(FULL_TIME, [49] * 10 + [31] * 10)
    last = rows[19]
    assert "overtime_cap_exceeded" not in rules(last)
    assert sum(r.compensated_hours for r in rows) == 90


def test_rest_before_the_hours_compensates_nothing():
    """A quiet January does not pay for a busy September.

    Art. 35.1 gives rest "dentro de los cuatro meses siguientes a su
    realizacion" -- after, not before. Pairing backwards would let any slow
    start absorb a whole year of overtime.
    """
    paid = compensation_schedule(
        [(week(20), 10.0)], [(week(1), 10.0)], months=4
    )
    assert paid == {}


def test_rest_after_the_four_months_is_too_late():
    paid = compensation_schedule(
        [(week(0), 10.0)], [(week(30), 10.0)], months=4
    )
    assert paid == {}


def test_a_jurisdiction_with_no_compensation_window_pairs_nothing():
    assert compensation_schedule([(week(0), 10.0)], [(week(1), 10.0)], None) == {}


def test_holiday_is_not_rest_given_in_exchange_for_overtime():
    """The weeks somebody was away cannot answer the weeks they worked long.

    A fortnight of annual leave was owed whatever the rota did. Letting it
    compensate August would empty the 80-hour cap every summer, which is
    exactly when a hospitality business is most likely to breach it.
    """
    hours = [49] * 10 + [0, 0]
    worked = rows_for(FULL_TIME, hours)
    excused = rows_for(FULL_TIME, hours, excused_weeks=[week(10), week(11)])

    assert sum(r.compensated_hours for r in worked) == 80
    assert sum(r.compensated_hours for r in excused) == 0
    assert "overtime_cap_exceeded" in rules(excused[11])


def test_months_are_calendar_months_and_survive_a_short_one():
    assert add_months(date(2026, 1, 31), 4) == date(2026, 5, 31)
    assert add_months(date(2026, 10, 31), 4) == date(2027, 2, 28)
    assert add_months(date(2026, 9, 17), 4) == date(2027, 1, 17)


# --- What the new reading must not have broken ----------------------------


def test_a_part_timer_has_no_overtime_cap_finding_however_many_hours():
    """Their ceiling is art. 12.5's share, and firing both would name it twice."""
    rows = rows_for(ContractTerms(weekly_hours=20, complementary_pct=0.30), [40] * 20)
    assert all(r.overtime_hours == 0 for r in rows)
    assert not any("overtime_cap_exceeded" in rules(r) for r in rows)


def test_the_split_still_adds_up_over_a_whole_year():
    """Every hour above the contract lands in exactly one of the four names."""
    rows = rows_for(FULL_TIME, [45, 50, 35, 60], limits=BARCELONA)
    named = sum(
        r.recovery_hours + r.irregular_hours + r.overtime_hours
        + r.complementary_hours
        for r in rows
    )
    above = sum(max(h - 40, 0) for h in [45, 50, 35, 60])
    assert named == above


# --- The year and the week, which are not the same question ---------------
#
# These two came out of running a year of a real bar through the engine and
# reading the columns, not out of writing tests. Both were wrong, and neither
# was visible from any single week.


def test_a_year_above_its_total_is_overtime_even_if_no_week_was():
    """Forty hours, forty-nine weeks, never one hour over the contracted week.

    And 177 hours over the contracted YEAR, because 1,783 hours is not 40 x 52:
    the difference is the holidays the annual figure already excludes. Judged
    week by week this rota is spotless. It is 177 hours of overtime.
    """
    rows = rows_for(FULL_TIME, [40] * 49, limits=BARCELONA)
    assert all(r.week_hours == 40 for r in rows)
    assert round(sum(r.overtime_hours for r in rows), 1) == 177.0
    assert "overtime_cap_exceeded" in rules(rows[-1])


def test_a_moved_hour_and_an_extra_hour_are_never_the_same_hour():
    """The columns add up to the hours worked over the contract. Once.

    Ten 48-hour weeks put 80 hours above the contract, and the year ends 185
    hours above its total. Counted separately -- 80 moved under art. 34.2 and
    185 extra under art. 35 -- the screen would show 265 hours nobody worked.
    Art. 34.2 only permits the displacement that a short week answers, so hours
    the year never gave back were never moved; they were extra all along.
    """
    hours = [48] * 10 + [40] * 39
    rows = rows_for(FULL_TIME, hours, limits=BARCELONA)
    above_the_year = sum(hours) - 1783

    named = sum(
        r.irregular_hours + r.overtime_hours + r.complementary_hours for r in rows
    )
    assert round(named, 1) == round(above_the_year, 1)
    assert sum(r.irregular_hours for r in rows) == 0


def test_a_summer_answered_by_an_autumn_is_moved_hours_and_nothing_else():
    """The other side of the same rule, and the one that must stay quiet.

    Ten long weeks and ten short ones, inside the year's own total: art. 34.2
    is exactly what this is for. Not one extra hour, and no finding.
    """
    rows = rows_for(FULL_TIME, [48] * 10 + [32] * 10, limits=BARCELONA)
    assert sum(r.irregular_hours for r in rows) == 80
    assert sum(r.overtime_hours for r in rows) == 0
    assert all(rules(r) == set() for r in rows)
