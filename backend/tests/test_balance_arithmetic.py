from __future__ import annotations

"""The arithmetic under the balance column, proved rather than sampled.

WHY THIS FILE IS DIFFERENT FROM THE ONES BESIDE IT. Every other test of the
working year picks a situation and pins the number it produces. That catches a
change of behaviour, which is what it is for, and it is exactly what let the
three tabs of the planner's "SI PUBLICAS" column ship showing the same three
numbers: no example had ever asked whether the month, the quarter and the year
agreed with each other.

So these check PROPERTIES -- statements that have to hold for every contract,
every stretch and every pattern of leave, not for the one in the example:

  ADDITIVE      the twelve months of a year add up to the year, and so do the
                four quarters, both for what is owed and for what was worked.
                Without this the three tabs are three unrelated opinions.

  COMPLETE      `total + pending` is the whole stretch, always. This is what
                lets the column measure a quarter it has only planned a month
                of without either lying about the rest or hiding it.

  ZERO-SUM      somebody who works their contracted week, every week, is level
                in all three. If this fails the column is worse than useless:
                it accuses people of exceeding a rota that was built to their
                contract, which is precisely what it did.

  TWO READINGS  and the legal ceiling is still the convenio's 1,783 hours. The
                pace says level; art. 35 still says 297 hours of those weeks
                were extraordinary. Both, at once, about the same person.

Generated cases use `random` with a fixed seed rather than `hypothesis`, which
is not a dependency of this project and is not worth becoming one for this.

Pure: no database, no clock, no network. Without Postgres this repository skips
tests in silence, and a proof that stops running is not a proof.
"""

import random
from datetime import date, timedelta

import pytest

from app.services.workday import (
    AbsenceDay,
    ContractTerms,
    WorkdayLimits,
    WorkedShift,
    agreed_year_hours_between,
    contract_pace_hours,
    excused_days,
    month_bounds,
    period_balance,
    quarter_bounds,
    report,
)

#: Barcelona hospitality, as seeded: a 40-hour week averaged over a year that
#: the convenio fixes at 1,783 hours of effective work.
BARCELONA = WorkdayLimits(
    weekly_average_hours=40,
    annual_hours=1783,
    irregular_pct=0.10,
    max_daily_hours=9,
    min_rest_hours=12,
    annual_overtime_cap=80,
    overtime_compensation_months=4,
    part_time_overtime_allowed=False,
    complementary_min_weekly=10,
    complementary_pct_max=0.30,
)

#: The contracts a real roster holds: full-time, half-time, and the awkward
#: ones in between that round badly.
CONTRACTS = [40, 30, 25, 20, 15, 12]

YEARS = [2026, 2027, 2028]  # 2028 is a leap year, deliberately.


# --- Additive: the parts add up to the whole -------------------------------
#
# The property the three tabs rest on. A month, a quarter and a year are three
# cuts of the same calendar, so whatever is true of one has to be the sum of
# what is true of its parts -- otherwise "this month +2 h, this quarter -40 h"
# is not two readings of one person, it is two different people.


@pytest.mark.parametrize("year", YEARS)
@pytest.mark.parametrize("weekly", CONTRACTS)
def test_the_months_of_a_quarter_add_up_to_the_quarter(year, weekly):
    for quarter in (1, 2, 3, 4):
        q_from, q_to = quarter_bounds(year, quarter)
        months = [
            contract_pace_hours(BARCELONA, weekly, *month_bounds(year, m))
            for m in range((quarter - 1) * 3 + 1, (quarter - 1) * 3 + 4)
        ]
        whole = contract_pace_hours(BARCELONA, weekly, q_from, q_to)
        assert sum(months) == pytest.approx(whole, abs=1e-9)


@pytest.mark.parametrize("year", YEARS)
@pytest.mark.parametrize("weekly", CONTRACTS)
def test_the_quarters_of_a_year_add_up_to_the_year(year, weekly):
    quarters = [
        contract_pace_hours(BARCELONA, weekly, *quarter_bounds(year, q))
        for q in (1, 2, 3, 4)
    ]
    whole = contract_pace_hours(
        BARCELONA, weekly, date(year, 1, 1), date(year + 1, 1, 1)
    )
    assert sum(quarters) == pytest.approx(whole, abs=1e-9)


@pytest.mark.parametrize("year", YEARS)
def test_leave_does_not_break_the_addition(year):
    """A fortnight off still leaves the months adding up to the year.

    The days come off the obligation as a SET, so an absence recorded twice --
    or two that overlap -- discounts its days once. Count them one by one
    instead and the year stops being the sum of its months the first time
    somebody corrects a holiday request.
    """
    away = [
        AbsenceDay("e1", date(year, 8, 1) + timedelta(days=d))
        for d in range(21)
    ] + [
        # The same week, entered again: a correction that was never deleted.
        AbsenceDay("e1", date(year, 8, 10) + timedelta(days=d))
        for d in range(7)
    ]
    excused = excused_days(away, "e1")

    months = [
        contract_pace_hours(BARCELONA, 40, *month_bounds(year, m), excused)
        for m in range(1, 13)
    ]
    whole = contract_pace_hours(
        BARCELONA, 40, date(year, 1, 1), date(year + 1, 1, 1), excused
    )
    assert sum(months) == pytest.approx(whole, abs=1e-9)
    # And the fortnight is really gone from the obligation: 21 days at a
    # seventh of the contracted week each.
    assert whole == pytest.approx(
        contract_pace_hours(
            BARCELONA, 40, date(year, 1, 1), date(year + 1, 1, 1)
        )
        - 21 * 40 / 7,
        abs=1e-9,
    )


def test_the_hours_worked_add_up_the_same_way():
    """Not just the obligation -- the other side of the subtraction too.

    A balance is `worked - expected`, and it is only additive if BOTH sides
    are. Shifts are counted by the day they start on, so the months partition
    them exactly; this is what says so rather than assuming it.
    """
    rng = random.Random(20260919)
    day = date(2026, 1, 1)
    shifts = []
    while day < date(2027, 1, 1):
        if rng.random() < 0.7:
            shifts.append(WorkedShift("e1", day, round(rng.uniform(3, 10), 2)))
        day += timedelta(days=1)

    def worked(start, end):
        # `on` well past the end, so the whole stretch is measured.
        return period_balance(
            shifts, "e1", 40, BARCELONA, start, end, date(2028, 1, 1)
        ).worked

    year = worked(date(2026, 1, 1), date(2027, 1, 1))
    quarters = [worked(*quarter_bounds(2026, q)) for q in (1, 2, 3, 4)]
    months = [worked(*month_bounds(2026, m)) for m in range(1, 13)]

    assert sum(quarters) == pytest.approx(year, abs=0.01)
    assert sum(months) == pytest.approx(year, abs=0.01)
    for q in (1, 2, 3, 4):
        q_months = months[(q - 1) * 3:(q - 1) * 3 + 3]
        assert sum(q_months) == pytest.approx(quarters[q - 1], abs=0.01)


# --- Complete: what is measured plus what is left is the whole stretch ------


def test_total_plus_pending_is_the_whole_stretch():
    """The invariant that lets a quarter be measured before it is planned.

    A thousand generated cases: random stretches, random contracts, random
    leave, random windows, random todays. Whatever the horizon lands on,
    `total` and `pending` between them account for every day of the stretch --
    no day counted twice, and none quietly dropped.

    Without it the column has to choose between charging somebody for a
    November nobody has written (a shortfall that is not one) and pretending
    the quarter ends in October (three tabs, one answer). It does neither.
    """
    rng = random.Random(4834221)

    for _ in range(1000):
        year = rng.choice(YEARS)
        start = date(year, rng.randint(1, 11), 1)
        end = start + timedelta(days=rng.randint(20, 300))
        weekly = rng.choice(CONTRACTS)

        absences = [
            AbsenceDay(
                "e1",
                start + timedelta(days=rng.randint(-40, 320)),
                recoverable=rng.random() < 0.3,
            )
            for _ in range(rng.randint(0, 25))
        ]
        shifts = [
            WorkedShift(
                "e1",
                start + timedelta(days=rng.randint(0, (end - start).days - 1)),
                8.0,
            )
            for _ in range(rng.randint(0, 20))
        ]
        window_from = start + timedelta(days=rng.randint(-30, 200))
        window = (window_from, window_from + timedelta(days=rng.randint(7, 40)))
        on = start + timedelta(days=rng.randint(-60, 330))

        b = period_balance(
            shifts,
            "e1",
            weekly,
            BARCELONA,
            start,
            end,
            on,
            window=window if rng.random() < 0.8 else None,
            absences=absences,
            cycle_start=(
                start - timedelta(days=rng.randint(0, 60))
                if rng.random() < 0.5
                else None
            ),
        )

        whole = contract_pace_hours(
            BARCELONA,
            weekly,
            min(b.start, end),
            end,
            excused_days(absences, "e1"),
        )
        assert b.total + b.pending == pytest.approx(whole, abs=0.01), (
            start, end, weekly, window, on, b,
        )
        # Nothing owed is ever negative, whichever way the horizon fell.
        assert b.pending >= 0.0
        assert b.total >= 0.0
        assert b.start <= b.horizon <= end or b.start >= end


def test_a_finished_stretch_has_nothing_left_to_plan():
    """Once the horizon reaches the end there is no `pending` to report."""
    out = period_balance(
        [], "e1", 40, BARCELONA,
        date(2026, 10, 1), date(2026, 11, 1), date(2026, 12, 1),
        window=(date(2026, 10, 1), date(2026, 11, 1)),
    )
    assert out.horizon == date(2026, 11, 1)
    assert out.pending == 0.0
    assert out.total == round(40 * 31 / 7, 2)


# --- The horizon has to see what is already on the noticeboard -------------


def test_the_three_tabs_stop_being_three_copies_of_the_month():
    """The screenshot this whole change comes from.

    Planning October 2026 on the 19th of September, with November and December
    already published. The horizon used to be "the window, or today" and
    nothing else, so the quarter and the year both measured to the 31st of
    October -- and the three tabs printed the same three numbers, because they
    were the same three numbers.

    A published November is a fact about how far the calendar has been
    written. The horizon has to reach it.
    """
    october = (date(2026, 10, 1), date(2026, 11, 1))
    published = [
        WorkedShift("e1", date(2026, 11, 1) + timedelta(days=d), 8.0)
        for d in range(0, 60, 7)  # November and December, weekly
    ]

    month = period_balance(
        published, "e1", 40, BARCELONA,
        *month_bounds(2026, 10), date(2026, 9, 19),
        window=october, cycle_start=date(2026, 10, 1),
    )
    quarter = period_balance(
        published, "e1", 40, BARCELONA,
        *quarter_bounds(2026, 4), date(2026, 9, 19),
        window=october, cycle_start=date(2026, 10, 1),
    )

    # October is October either way.
    assert month.horizon == date(2026, 11, 1)
    assert month.total == round(40 * 31 / 7, 2)
    # The quarter now reaches the end of what is published: November and
    # December both hold shifts, so the written calendar runs to the end of
    # the quarter rather than stopping at the end of the month being edited.
    assert quarter.horizon == date(2027, 1, 1)
    assert quarter.total > month.total * 2
    assert quarter.total != month.total
    assert quarter.pending == 0.0
    assert quarter.total + quarter.pending == pytest.approx(
        contract_pace_hours(BARCELONA, 40, date(2026, 10, 1), date(2027, 1, 1)),
        abs=0.01,
    )


def test_one_shift_in_december_is_not_a_planned_december():
    """The stray New Year's Eve shift, and why the horizon walks months.

    A manager pins down the 31st of December in September, because it is the
    one date everybody argues about. Read as "the last published day", that
    single shift says the year has been planned to the 1st of January -- so
    October, November and December are all measured, all empty, and the column
    answers "-416 h" for three months nobody has been asked to work yet.

    That is the same "-416 h" `test_hours_balance_cycle` has a regression test
    against, arrived at from the other direction. The horizon has to be where
    the calendar STOPS BEING WRITTEN, which is the first month with nothing in
    it -- November here, and the walk never even reaches December.
    """
    october = (date(2026, 10, 1), date(2026, 11, 1))
    new_years_eve = [WorkedShift("e1", date(2026, 12, 31), 8.0)]

    year = period_balance(
        new_years_eve, "e1", 40, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), date(2026, 9, 19),
        window=october, cycle_start=date(2026, 10, 1),
    )

    assert year.horizon == date(2026, 11, 1)
    assert year.total == round(40 * 31 / 7, 2)
    # November and December are work still to plan, not a hole.
    assert year.pending == round(40 * 61 / 7, 2)
    assert year.total + year.pending == pytest.approx(
        contract_pace_hours(BARCELONA, 40, date(2026, 10, 1), date(2027, 1, 1)),
        abs=0.01,
    )

    # A HALF-published month still counts as written: half a November on the
    # noticeboard is a November somebody has worked on, and no screen draws a
    # boundary in the middle of a month.
    half_november = [
        WorkedShift("e1", date(2026, 11, 2) + timedelta(days=d), 8.0)
        for d in range(0, 12, 7)
    ]
    with_november = period_balance(
        half_november, "e1", 40, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), date(2026, 9, 19),
        window=october, cycle_start=date(2026, 10, 1),
    )
    assert with_november.horizon == date(2026, 12, 1)


def test_the_shift_past_the_horizon_is_still_on_the_rota():
    """`planned` stops at the horizon; `planned_stretch` does not.

    The planner's column prints "X of Y hours" for the whole stretch, with Y
    the contract from start to end (`total + pending`). X has to cover the
    same days or the fraction means nothing -- and the New Year's Eve shift
    above, which the horizon rightly leaves out of the MEASURED part, is still
    eight hours somebody is down to work this year.
    """
    october = (date(2026, 10, 1), date(2026, 11, 1))
    rota = [
        WorkedShift("e1", date(2026, 10, 5), 8.0),
        WorkedShift("e1", date(2026, 12, 31), 8.0),
        # Somebody else's shift is nobody's business here.
        WorkedShift("e2", date(2026, 10, 6), 8.0),
        # Before the cycle opened: not this stretch's hours.
        WorkedShift("e1", date(2026, 9, 28), 8.0),
    ]
    year = period_balance(
        rota, "e1", 40, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), date(2026, 9, 24),
        window=october, cycle_start=date(2026, 10, 1),
    )
    assert year.horizon == date(2026, 11, 1)
    assert year.planned == 8.0
    assert year.planned_stretch == 16.0


def test_planned_stretch_is_every_published_hour_of_the_stretch():
    """Whatever the horizon does, X is the rota from `start` to the end.

    Generated cases, like the invariant above: random rotas, windows and
    todays. `planned_stretch` never depends on where the measurement stops,
    never holds less than the measured part, and adds up month by month to
    the quarter.
    """
    rng = random.Random(90412)

    for _ in range(500):
        year = rng.choice(YEARS)
        quarter = rng.randint(1, 4)
        q_from, q_to = quarter_bounds(year, quarter)
        shifts = [
            WorkedShift(
                rng.choice(["e1", "e2"]),
                q_from + timedelta(days=rng.randint(-20, 110)),
                rng.choice([4.0, 6.5, 8.0]),
            )
            for _ in range(rng.randint(0, 40))
        ]
        window_from = q_from + timedelta(days=rng.randint(-30, 90))
        window = (window_from, window_from + timedelta(days=rng.randint(7, 40)))
        on = q_from + timedelta(days=rng.randint(-60, 120))
        cycle = q_from + timedelta(days=rng.randint(-30, 30))

        def over(start, end):
            return period_balance(
                shifts, "e1", 40, BARCELONA, start, end, on,
                window=window, cycle_start=cycle,
            )

        whole = over(q_from, q_to)
        expected = sum(
            s.hours for s in shifts
            if s.employee_id == "e1" and whole.start <= s.day < q_to
        )
        assert whole.planned_stretch == pytest.approx(expected, abs=0.01)
        assert whole.planned <= whole.planned_stretch + 0.01

        months = sum(
            over(*month_bounds(year, m)).planned_stretch
            for m in range(q_from.month, q_from.month + 3)
        )
        assert months == pytest.approx(whole.planned_stretch, abs=0.01)


# --- Zero-sum: working the contract lands on the line ----------------------


@pytest.mark.parametrize("weekly", [40, 20])
def test_working_exactly_the_contract_is_level_in_all_three_stretches(weekly):
    """The property the column exists to report, and the one it got wrong.

    Somebody given their contracted week, spread evenly, is neither ahead nor
    behind -- in the month, in the quarter and in the year. Measured against
    the convenio's annual figure instead, a 40-hour contract "asked for"
    151.43 hours in October while the generator planned it 177.14, so every
    single person on a correctly built rota read as +15 to +46 hours over.
    """
    shifts = []
    day = date(2026, 1, 1)
    while day < date(2027, 1, 1):
        shifts.append(WorkedShift("e1", day, weekly / 7))
        day += timedelta(days=1)

    stretches = (
        ("month", month_bounds(2026, 10)),
        ("quarter", quarter_bounds(2026, 4)),
        ("year", (date(2026, 1, 1), date(2027, 1, 1))),
    )
    for name, (start, end) in stretches:
        out = period_balance(
            shifts, "e1", weekly, BARCELONA, start, end, date(2027, 6, 1)
        )
        assert out.deviation == pytest.approx(0.0, abs=0.01), (name, out)
        assert out.worked == pytest.approx(out.total, abs=0.01), (name, out)


@pytest.mark.parametrize("weekly,daily", [(40, 8.0), (20, 4.0)])
def test_a_monday_to_friday_rota_is_level_too(weekly, daily):
    """The same, with the hours where a real rota puts them.

    A month is not a whole number of weeks, so five-day weeks cannot land on
    exactly zero for every calendar month: a 31-day month holds 21, 22 or 23
    weekdays where the contracted week asks for 22.14 of them, so the gap can
    reach a day and a bit either way. What must hold is that it stays that
    small and does not ACCUMULATE -- over the whole year it comes back to a
    rounding difference, which is the difference between a calendar artefact
    and a verdict about somebody.
    """
    shifts = []
    day = date(2026, 1, 1)
    while day < date(2027, 1, 1):
        if day.weekday() < 5:
            shifts.append(WorkedShift("e1", day, daily))
        day += timedelta(days=1)

    for month in range(1, 13):
        out = period_balance(
            shifts, "e1", weekly, BARCELONA, *month_bounds(2026, month),
            date(2027, 6, 1),
        )
        assert abs(out.deviation) < 2 * daily, (month, out)

    year = period_balance(
        shifts, "e1", weekly, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), date(2027, 6, 1),
    )
    assert abs(year.deviation) < daily, year


# --- The draft is projected, not added twice -------------------------------


def test_publishing_a_draft_does_not_move_the_projection():
    """`planned - published_in_window + draft` before and after publishing.

    The client projects a draft by taking the published hours of the window
    back out first, because publishing REPLACES the rota for those dates. So
    publishing a draft unchanged must leave the projected figure exactly where
    it was -- if it does not, the column jumps the moment the manager presses
    the button and every hour in the window has been counted twice.
    """
    window = (date(2026, 10, 4), date(2026, 10, 11))
    draft = [
        WorkedShift("e1", window[0] + timedelta(days=d), 8.0) for d in range(5)
    ]
    elsewhere = [WorkedShift("e1", date(2026, 10, 20), 8.0)]

    def projected(published):
        b = period_balance(
            published, "e1", 40, BARCELONA,
            *month_bounds(2026, 10), date(2026, 10, 1),
            window=window, cycle_start=date(2026, 10, 1),
        )
        drafted = sum(s.hours for s in draft)
        return round(b.planned - b.published_in_window + drafted - b.total, 2)

    before = projected(elsewhere)
    after = projected(elsewhere + draft)
    assert before == after

    # And the figure is the real one: 48 hours on the rota against the whole
    # of October, which is written end to end -- the month holds published
    # shifts, so the horizon walks past it.
    assert after == round(
        48 - contract_pace_hours(BARCELONA, 40, date(2026, 10, 1), date(2026, 11, 1)),
        2,
    )


# --- Two readings of the same weeks, and both still true -------------------


def test_the_legal_ceiling_is_still_the_convenios_year():
    """The pace says level; art. 35 still says 297 hours were extraordinary.

    This is the half of the change that is easiest to break by accident. The
    balance moved to the contracted week -- 40 x 52 = 2,080 hours a year --
    and if the working-year view had followed it there, a full-timer would
    have been handed three hundred lawful hours a year that the convenio never
    agreed to, and the 80-hour cap of art. 35.2 would never fire again.

    So: the same 52 weeks, read twice. Level against the contract, 297 hours
    over against the 1,783 the sector signed, and the cap breached.
    """
    first_monday = date(2026, 1, 5)
    weeks = [first_monday + timedelta(weeks=n) for n in range(52)]
    shifts = [WorkedShift("e1", w + timedelta(days=1), 40.0) for w in weeks]

    rows = report(
        "e1",
        ContractTerms(weekly_hours=40),
        shifts,
        [],
        BARCELONA,
        weeks,
        year_start=date(2026, 1, 1),
        year_end=date(2027, 1, 1),
    )
    # 2,080 worked against a 1,783-hour year.
    assert sum(r.overtime_hours for r in rows) == pytest.approx(297.0, abs=0.01)
    assert "overtime_cap_exceeded" in {e.rule for r in rows for e in r.errors}
    assert agreed_year_hours_between(
        BARCELONA, 40, date(2026, 1, 1), date(2027, 1, 1)
    ) == pytest.approx(1783.0)

    # And the pace, over the same weeks, is level to the minute.
    balance = period_balance(
        shifts, "e1", 40, BARCELONA,
        first_monday, first_monday + timedelta(weeks=52), date(2027, 6, 1),
    )
    assert balance.deviation == 0.0


def test_the_two_readings_answer_a_part_timer_differently_too():
    """A 20-hour contract, worked to the letter, is level and lawful.

    Both halves at once: the pace is zero, and the year the complementary
    hours of art. 12.5 are measured against is still half of the convenio's,
    not half of 40 x 52.
    """
    first_monday = date(2026, 1, 5)
    weeks = [first_monday + timedelta(weeks=n) for n in range(52)]
    shifts = [WorkedShift("e1", w + timedelta(days=1), 20.0) for w in weeks]

    balance = period_balance(
        shifts, "e1", 20, BARCELONA,
        first_monday, first_monday + timedelta(weeks=52), date(2027, 6, 1),
    )
    assert balance.deviation == 0.0
    assert agreed_year_hours_between(
        BARCELONA, 20, date(2026, 1, 1), date(2027, 1, 1)
    ) == pytest.approx(891.5)
