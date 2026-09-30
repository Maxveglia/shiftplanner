from __future__ import annotations

"""The working year: art. 34 ET, as arithmetic rather than as a note.

The rule these pin down is the one an American rule set gets wrong, and it is
worth stating plainly because every test below is a consequence of it: in Spain
the contracted week is an ANNUAL AVERAGE, not a weekly ceiling. Forty hours a
week means the year averages forty, so a 45-hour week is lawful when a 35-hour
week answers it -- and reporting the long week as a breach, which this product
did until now, tells a Barcelona manager that their legal rota is illegal.

What stays a ceiling: the nine-hour day and the twelve hours between shifts.
Those are daily limits and the annual average never buys its way past them.
Both are already enforced (`spanishRules.test.ts`, `test_spanish_labour.py`),
and the test at the bottom of this file is here to make sure the annual reading
did not quietly excuse them.

Pure: no database, no clock, no network. That matters more than usual here --
without Postgres this repository skips 93 tests and still reports green, so a
rule that can only be tested against a database is a rule that stops being
tested the moment somebody runs the suite without one.
"""

from datetime import date, datetime, timedelta, timezone

from app.services.workday import (
    ContractTerms,
    HourSplit,
    add_months,
    classify_week,
    compensation_schedule,
    complementary_allowance,
    expected_annual_hours,
    is_part_time,
    month_bounds,
    notice_errors,
    overtime_cap,
    period_balance,
    quarter_bounds,
    quarter_of,
    RecoverableDay,
    recovery_schedule,
    report,
    week_start,
    WorkdayLimits,
    WorkedShift,
)

# A Monday, so the weeks below start where the product's weeks start.
JAN = date(2026, 1, 5)

SPAIN = WorkdayLimits(
    weekly_average_hours=40,
    annual_hours=1800,
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


def week(n: int) -> date:
    """The Monday n weeks after JAN."""
    return JAN + timedelta(weeks=n)


def shifts_for(hours_by_week, employee="e1", published=None):
    """One shift per week, carrying that week's whole hours.

    The working year counts hours and dates, so a week of 45 hours is the same
    to it whether it arrived as one shift or as six. Six would only make these
    tests longer.
    """
    return [
        WorkedShift(
            employee_id=employee,
            day=week(i),
            hours=h,
            published_at=published,
        )
        for i, h in enumerate(hours_by_week)
    ]


# --- The rule itself ------------------------------------------------------


def test_a_long_week_answered_by_a_short_one_is_not_a_breach():
    """45 + 35 over two weeks is 40 a week. The whole point of art. 34.1."""
    rows = report(
        "e1",
        40,
        shifts_for([45, 35]),
        [],
        SPAIN,
        [week(0), week(1)],
        year_start=JAN,
    )

    assert [r.errors for r in rows] == [[], []]
    assert rows[1].annual_hours_to_date == 80
    # And level, which is the point of the whole exercise: two weeks of a
    # 40-hour contract ask for eighty hours, so somebody who worked eighty is
    # neither ahead nor behind. The deviation is measured against the PACE --
    # the contracted week spread over calendar days -- and not against the
    # convenio's 1,800-hour year, which already has the holidays taken out of
    # it and therefore reported everybody permanently ahead of a figure they
    # could only reach by never taking leave.
    assert rows[1].deviation_vs_average == 0.0


def test_a_long_week_is_moved_hours_not_extra_ones():
    """Five hours over the contract, and art. 34.2 has room for them.

    The hours are EARLY, not extra: the employer may move a tenth of the year
    around, a short week owes them back, and only once that tenth is spent does
    an hour above the contract become extraordinary. So the week reports them,
    under the name that says which of the two they are.
    """
    rows = report(
        "e1", 40, shifts_for([45]), [], SPAIN, [week(0)], year_start=JAN
    )
    assert rows[0].week_hours == 45
    assert rows[0].overtime_hours == 0
    assert rows[0].irregular_hours == 5


def test_the_deviation_shows_who_is_running_ahead():
    """Not an error -- a number the manager can act on before December."""
    rows = report(
        "e1", 40, shifts_for([45, 45]), [], SPAIN, [week(0), week(1)],
        year_start=JAN,
    )
    # Five hours over the contracted week, then ten: it GROWS with the hours
    # and is read as a position rather than as a breach.
    assert rows[0].deviation_vs_average == round(45 - 40, 2)
    assert rows[1].deviation_vs_average == round(90 - 80, 2)
    assert rows[1].deviation_vs_average > rows[0].deviation_vs_average


def test_the_deviation_is_measured_from_the_year_not_the_window():
    """A window cannot see the hole behind it.

    Somebody four weeks into a year, asked about the fourth week alone, has to
    read as 120 hours behind rather than as perfectly on pace -- which is what
    counting from the first week of the WINDOW would say.
    """
    rows = report(
        "e1",
        40,
        shifts_for([0, 0, 0, 40]),
        [],
        SPAIN,
        [week(3)],
        year_start=JAN,
    )
    # Four weeks of the year owed, one worked: behind by the other three.
    assert rows[0].deviation_vs_average == round(40 - 40 * 28 / 7, 2)
    assert rows[0].deviation_vs_average < -50


def test_overtime_starts_where_the_irregular_tenth_runs_out():
    """The tenth is 180 hours here, so the 181st hour above the contract is extra.

    This is the rule the product got wrong for so long that it is worth
    spelling out in one test rather than leaving implied. An hour above the
    contract is not automatically extraordinary -- art. 34.2 lets the employer
    move a tenth of the year -- and it is not automatically ordinary either,
    which is what waiting for the annual TOTAL to be passed amounted to. It is
    ordinary until the tenth is spent and extraordinary afterwards.

    Four 85-hour weeks spend 180 of the tenth exactly. The fifth has nothing
    left to draw on, so all 45 of its hours above the contract are extra.
    """
    rows = report(
        "e1",
        40,
        shifts_for([85, 85, 85, 85, 85]),
        [],
        SPAIN,
        [week(n) for n in range(5)],
        year_start=JAN,
    )
    assert [r.irregular_hours for r in rows] == [45, 45, 45, 45, 0]
    assert [r.overtime_hours for r in rows] == [0, 0, 0, 0, 45]


def test_a_part_timer_is_judged_against_twenty_not_forty():
    """The bug this whole change exists to undo.

    Somebody on a 20-hour contract working 35-hour weeks was compared against
    a full-timer's year -- 1,800 hours they would never reach -- so nothing
    they worked was ever above anything. Art. 35.1 measures against the
    contract, so fifteen hours a week are above it, and on a part-time contract
    those hours have a name of their own (art. 12.4.c).
    """
    part_timer = ContractTerms(weekly_hours=20)
    rows = report(
        "e1", part_timer, shifts_for([35]), [], SPAIN, [week(0)], year_start=JAN
    )
    assert rows[0].overtime_hours == 0, "art. 12.4.c: never overtime here"
    assert rows[0].irregular_hours + rows[0].complementary_hours == 15


def test_the_part_timers_year_is_their_own_share_of_it():
    """1,800 hours is a full-time year; half a contract is half a year."""
    assert expected_annual_hours(SPAIN, 20) == 900
    assert expected_annual_hours(SPAIN, 40) == 1800


def test_an_agreed_year_outranks_the_week_multiplied_out():
    """A convenio's annual figure already counts the holidays; 52x cannot."""
    assert expected_annual_hours(SPAIN, 40) == 1800
    assert expected_annual_hours(WorkdayLimits(), 40) == 40 * 52


# --- Irregular distribution (art. 34.2) -----------------------------------


def test_moving_more_than_the_tenth_is_reported():
    """10% of 1800 is 180 hours. 200 hours of long weeks is over it."""
    rows = report(
        "e1",
        40,
        shifts_for([60] * 10),  # 20 hours above the week, ten times
        [],
        SPAIN,
        [week(9)],
        year_start=JAN,
    )
    kinds = [e.rule for e in rows[0].errors]
    assert "irregular_share_exceeded" in kinds


def test_the_short_weeks_are_not_charged_as_a_second_move():
    """A 35-hour week is what a 45-hour week is ANSWERED by, not another move.

    Counting both directions would charge the same displacement twice and put
    every compliant rota over the tenth.
    """
    rows = report(
        "e1",
        40,
        shifts_for([45, 35] * 20),
        [],
        SPAIN,
        [week(39)],
        year_start=JAN,
    )
    assert [e.rule for e in rows[0].errors] == []


def test_a_jurisdiction_without_the_rule_is_left_alone():
    """No seeded percentage, no finding. Every non-Spanish org, unchanged."""
    rows = report(
        "e1", 40, shifts_for([60] * 10), [], WorkdayLimits(), [week(9)],
        year_start=JAN,
    )
    assert rows[0].errors == []


# --- Notice (art. 34.2) ---------------------------------------------------


def test_a_shift_published_two_days_before_is_short_notice():
    told = datetime(2026, 1, 2, 10, 0, tzinfo=timezone.utc)
    shifts = [WorkedShift("e1", date(2026, 1, 4), 8, published_at=told)]
    errors = notice_errors(shifts, SPAIN)
    assert [e.rule for e in errors] == ["short_notice"]
    assert errors[0].detail == {"days": 2.0, "required": 5.0}


def test_a_shift_published_a_fortnight_before_is_not():
    told = datetime(2025, 12, 20, 10, 0, tzinfo=timezone.utc)
    shifts = [WorkedShift("e1", date(2026, 1, 4), 8, published_at=told)]
    assert notice_errors(shifts, SPAIN) == []


def test_a_draft_owes_nobody_notice_yet():
    """Unpublished is the manager thinking. Warning on it would fire always."""
    shifts = [WorkedShift("e1", date(2026, 1, 4), 8, published_at=None)]
    assert notice_errors(shifts, SPAIN) == []


# --- Recoverable days off (the hours are ordinary, not extra) -------------


def test_hours_worked_back_are_recovery_not_overtime():
    """Five hours off in March, five hours back in April: nothing is extra."""
    split = classify_week(
        excess=5, recovery_owed=5, irregular_room=0, part_time=False
    )
    assert split.recovery == 5
    assert split.overtime == 0


def test_hours_beyond_what_is_owed_are_overtime():
    """Five hours owed, eight hours over, no room left: three are extraordinary."""
    split = classify_week(
        excess=8, recovery_owed=5, irregular_room=0, part_time=False
    )
    assert split.recovery == 5
    assert split.overtime == 3


def test_recovery_is_spent_before_the_irregular_allowance():
    """Order matters: recovery is free, the tenth of the year is not.

    Spending the irregular allowance on hours that recovery would have covered
    burns a limited resource on hours that were never going to be extra, and
    brings the moment overtime starts forward for no reason.
    """
    split = classify_week(
        excess=10, recovery_owed=4, irregular_room=100, part_time=False
    )
    assert (split.recovery, split.irregular, split.overtime) == (4, 6, 0)


def test_nothing_is_lost_or_counted_twice_in_a_split():
    split = classify_week(
        excess=30, recovery_owed=4, irregular_room=6, part_time=False
    )
    assert split.total == 30
    assert split.ordinary == 10
    assert split.overtime == 20


def test_recovery_pays_the_oldest_day_off_first():
    """FIFO, checked on WHICH day is repaid rather than on the total.

    Both orders credit the same seven hours, so a test that only added them up
    would pass just as happily against LIFO -- which is how this test was
    written the first time, and it caught nothing. The difference is in the
    pairing: five hours must answer the older day off in full and two the
    newer, not the other way round.
    """
    days = [
        RecoverableDay("e1", week(0), 5),
        RecoverableDay("e1", week(1), 5),
    ]
    credits = recovery_schedule(days, [(week(2), 7.0)])

    assert [(c.day_off, c.hours) for c in credits] == [
        (week(0), 5.0),
        (week(1), 2.0),
    ]


def test_every_recovered_hour_names_the_day_off_it_answers():
    """The link art. 34 asks for: a date, not just a number."""
    days = [RecoverableDay("e1", week(0), 5)]
    credits = recovery_schedule(days, [(week(3), 5.0)])

    assert len(credits) == 1
    assert credits[0].day_off == week(0)
    assert credits[0].week == week(3)
    assert credits[0].hours == 5.0


def test_a_day_off_cannot_be_worked_back_before_it_was_granted():
    """Hours in January do not repay a day off granted in June."""
    days = [RecoverableDay("e1", week(20), 5)]
    assert recovery_schedule(days, [(week(0), 5.0)]) == []


def test_the_recovered_week_reports_its_recovery_hours():
    rows = report(
        "e1",
        40,
        shifts_for([35, 45]),
        [RecoverableDay("e1", week(0), 5)],
        SPAIN,
        [week(0), week(1)],
        year_start=JAN,
    )
    assert rows[0].recovery_hours == 0
    assert rows[1].recovery_hours == 5


# --- What the annual average must NOT excuse ------------------------------


def test_the_annual_average_does_not_touch_the_daily_limits():
    """The nine-hour day and the twelve-hour rest stay where they were.

    They are enforced on the calendar (`validate.ts`), not here, and that is
    the point of this test: the limits travel in the same `WorkdayLimits` this
    module reads, so a future edit that "simplified" them away by folding them
    into the annual reading would trip here.
    """
    assert SPAIN.max_daily_hours == 9
    assert SPAIN.min_rest_hours == 12


def test_the_week_is_anchored_on_monday_like_the_rest_of_the_product():
    """Two anchors would put two different week totals on one screen.

    Monday, and not as a matter of taste: the weekly rest is the longest gap
    around a week, so where the week is cut decides whose weekend gets sliced
    in half. See `services/rota_law.py` and `frontend/.../validate.ts`.
    """
    assert week_start(date(2026, 1, 7)) == date(2026, 1, 5)  # Wednesday -> Monday
    assert week_start(date(2026, 1, 5)) == date(2026, 1, 5)  # Monday -> itself
    assert week_start(date(2026, 1, 4)) == date(2025, 12, 29)  # Sunday -> the Monday before


# --- Balances for the roster: a month, a quarter, a year ------------------


def balance_over(hours_by_week, start, end, on, weekly=40):
    return period_balance(
        shifts_for(hours_by_week),
        "e1",
        weekly,
        SPAIN,
        start,
        end,
        on,
    )


def test_hours_owed_are_counted_up_to_today_not_to_the_end_of_the_month():
    """The one that decides whether this number is usable at all.

    Measured against the WHOLE month, everybody is catastrophically behind on
    the 1st -- zero worked against 173 owed -- and a warning that fires every
    four weeks for everybody is a warning nobody reads. So the hours owed are
    counted up to today.
    """
    first_week = date(2026, 1, 5)
    one_week_in = date(2026, 1, 12)

    fresh = period_balance(
        shifts_for([40]), "e1", 40, SPAIN, first_week, date(2026, 2, 1), one_week_in
    )

    # One week elapsed and one week owed -- not a whole month of it. And the
    # week owed is the CONTRACTED one, so working it lands exactly on zero.
    assert fresh.expected == 40.0
    assert fresh.worked == 40
    assert fresh.deviation == 0.0
    assert fresh.complete is False


def test_a_finished_stretch_is_measured_whole():
    """A closed month is a verdict; the current one is only a position."""
    done = period_balance(
        shifts_for([40, 40]),
        "e1",
        40,
        SPAIN,
        JAN,
        JAN + timedelta(days=14),
        date(2026, 6, 1),
    )
    assert done.complete is True
    assert done.expected == round(40 * 14 / 7, 2)


def test_somebody_short_reads_as_behind():
    short = period_balance(
        shifts_for([30, 30]),
        "e1",
        40,
        SPAIN,
        JAN,
        JAN + timedelta(days=14),
        date(2026, 6, 1),
    )
    assert short.deviation < 0
    assert short.deviation == round(60 - 40 * 14 / 7, 2)


def test_somebody_over_reads_as_ahead():
    over = period_balance(
        shifts_for([50, 50]),
        "e1",
        40,
        SPAIN,
        JAN,
        JAN + timedelta(days=14),
        date(2026, 6, 1),
    )
    assert over.deviation > 0
    assert over.deviation == round(100 - 40 * 14 / 7, 2)


def test_another_persons_hours_are_not_counted():
    mine = period_balance(
        shifts_for([40], employee="e2"),
        "e1",
        40,
        SPAIN,
        JAN,
        JAN + timedelta(days=7),
        date(2026, 6, 1),
    )
    assert mine.worked == 0


def test_quarters_are_the_calendar_ones():
    """What a gestoría means, and what makes four of them a year."""
    assert quarter_of(date(2026, 1, 1)) == 1
    assert quarter_of(date(2026, 3, 31)) == 1
    assert quarter_of(date(2026, 4, 1)) == 2
    assert quarter_of(date(2026, 12, 31)) == 4

    start, end = quarter_bounds(2026, 4)
    assert (start, end) == (date(2026, 10, 1), date(2027, 1, 1))

    first, second = quarter_bounds(2026, 1)
    assert (first, second) == (date(2026, 1, 1), date(2026, 4, 1))


def test_a_month_runs_to_the_first_of_the_next():
    assert month_bounds(2026, 10) == (date(2026, 10, 1), date(2026, 11, 1))
    # December rolls the year, rather than reaching for a thirteenth month.
    assert month_bounds(2026, 12) == (date(2026, 12, 1), date(2027, 1, 1))


def test_a_part_timer_is_measured_against_their_own_contract():
    """Found by looking at real numbers, not by reasoning about them.

    On a roster of four, the 20-hour contract came out as badly behind as the
    40-hour ones. The balance was reading `weekly_average_hours` -- the legal
    maximum, the SAME figure for everybody -- as what each person was owed, so
    a part-timer was reported 20 hours short every week they worked exactly
    their contract.
    """
    full = period_balance(
        shifts_for([40]), "e1", 40, SPAIN, JAN, JAN + timedelta(days=7), date(2026, 6, 1)
    )
    part = period_balance(
        shifts_for([20]), "e1", 20, SPAIN, JAN, JAN + timedelta(days=7), date(2026, 6, 1)
    )

    # Each is owed their OWN contract -- rather than the legal maximum, which
    # is one figure for the whole business and reported the part-timer twenty
    # hours short of it every week they worked exactly what they signed for.
    assert part.expected == 20.0
    assert full.expected == 40.0
    # And each worked exactly theirs, so both land on zero. Not "half as far
    # from the line as the other": on it.
    assert full.deviation == part.deviation == 0.0


def test_the_statute_still_caps_a_bigger_contract():
    """A contract above the annual average cannot be owed more than the law."""
    big = period_balance(
        shifts_for([40]), "e1", 60, SPAIN, JAN, JAN + timedelta(days=7), date(2026, 6, 1)
    )
    assert big.expected == 40.0


def test_hours_not_yet_worked_do_not_count_as_worked():
    """The other half of the same discovery.

    A rota is planned ahead, so the stretch holds shifts nobody has worked
    yet. Counting those as done while counting only the elapsed part of the
    contract as owed reported somebody as comfortably AHEAD on the 1st,
    because their whole month was already drafted.
    """
    # Four weeks drafted, one week elapsed.
    one_week_in = JAN + timedelta(days=7)
    out = period_balance(
        shifts_for([40, 40, 40, 40]),
        "e1",
        40,
        SPAIN,
        JAN,
        JAN + timedelta(days=28),
        one_week_in,
    )

    assert out.worked == 40  # the week that has happened, not the four drafted
    assert out.expected == 40.0


def test_the_bar_needs_the_whole_stretch_as_well_as_today():
    """Four numbers, and each answers a different question.

    `worked` / `expected` is "is she keeping up?" -- both measured to today.
    `planned` / `total` is "has the month been filled in?" -- both measured
    over the whole stretch. A bar drawn from the first pair cannot show a
    month with a fortnight still unstaffed; one drawn from the second cannot
    show somebody falling behind. The card shows both.
    """
    one_week_in = JAN + timedelta(days=7)
    out = period_balance(
        shifts_for([40, 40, 0, 0]),  # two weeks on the rota, four in the month
        "e1",
        40,
        SPAIN,
        JAN,
        JAN + timedelta(days=28),
        one_week_in,
    )

    # Keeping up, on the week that has happened.
    assert out.worked == 40
    assert out.expected == 40.0
    # But the rota only covers half the stretch.
    assert out.planned == 80
    assert out.total == round(40 * 28 / 7, 2)


def test_the_end_of_the_bar_follows_the_contract():
    """A 20-hour contract's month is half a 40-hour contract's month."""
    full = period_balance(
        shifts_for([]), "e1", 40, SPAIN, JAN, JAN + timedelta(days=28), JAN
    )
    part = period_balance(
        shifts_for([]), "e1", 20, SPAIN, JAN, JAN + timedelta(days=28), JAN
    )

    assert full.total == round(40 * 28 / 7, 2)
    assert part.total == round(20 * 28 / 7, 2)
    assert round(full.total, 2) == round(part.total * 2, 2)


def test_a_finished_stretch_has_planned_and_worked_agree():
    """Once the month is over there is no future left for them to differ on."""
    done = period_balance(
        shifts_for([40, 40]),
        "e1",
        40,
        SPAIN,
        JAN,
        JAN + timedelta(days=14),
        date(2026, 6, 1),
    )
    assert done.worked == done.planned == 80
    assert done.total == round(40 * 14 / 7, 2)
