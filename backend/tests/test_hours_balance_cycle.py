from __future__ import annotations

"""The hours balance: what it counts, and from when.

These come from a screenshot. Four people on the roster, every one of them
reading -91.4 h this month, -445.7 h the quarter and -1,480 h the year, and
not one of them owed a single hour. Two separate faults were adding up:

  THE PACE WAS WRONG. Hours owed were the contracted week times the weeks
  elapsed: 40 x 52 = 2,080 hours a year, against a convenio that fixes the
  year at 1,783. The 297 hours between them are the holidays and public days
  the annual figure already excludes, so everybody was charged for a month of
  leave they had not taken and never could.

  THE CLOCK STARTED TOO EARLY. Counting ran from the 1st of January whatever
  the business had done, so a bar that published its first rota in September
  was charged with the eight months before it had a calendar, and somebody
  hired in June with the five months before they were employed.

And one decision on top of the fix: the balance counts PUBLISHED hours only.
It settles when the manager publishes. That is what makes it a fixed thing to
plan a draft against instead of a figure that slides away as they work.

Pure: no database, no clock.
"""

from datetime import date, timedelta

from app.services.workday import (
    AbsenceDay,
    ContractTerms,
    WorkedShift,
    agreed_year_hours_between,
    effective_start,
    period_balance,
)

#: Barcelona hospitality, as seeded.
BARCELONA_ANNUAL = 1783.0

from app.services.workday import WorkdayLimits

BARCELONA = WorkdayLimits(
    weekly_average_hours=40,
    annual_hours=BARCELONA_ANNUAL,
    irregular_pct=0.10,
    max_daily_hours=9,
    min_rest_hours=12,
)

#: A jurisdiction nobody has written down: no annual figure anywhere.
UNSEEDED = WorkdayLimits()


# --- What a contract asks for over a stretch ------------------------------


def test_the_year_is_the_convenios_year_and_not_the_week_times_fifty_two():
    """1,783 hours, not 2,080. The whole of the first fault, in one line."""
    whole_year = agreed_year_hours_between(
        BARCELONA, 40, date(2026, 1, 1), date(2027, 1, 1)
    )
    assert round(whole_year) == round(BARCELONA_ANNUAL)
    assert round(40 * 365 / 7) == 2086  # what it used to say


def test_a_part_timers_stretch_is_their_own_share_of_it():
    full = agreed_year_hours_between(BARCELONA, 40, date(2026, 1, 1), date(2026, 2, 1))
    half = agreed_year_hours_between(BARCELONA, 20, date(2026, 1, 1), date(2026, 2, 1))
    assert round(full, 2) == round(half * 2, 2)


def test_a_contract_above_the_statutory_week_is_still_capped_by_it():
    big = agreed_year_hours_between(BARCELONA, 60, date(2026, 1, 1), date(2026, 2, 1))
    full = agreed_year_hours_between(BARCELONA, 40, date(2026, 1, 1), date(2026, 2, 1))
    assert big == full


def test_a_jurisdiction_with_no_annual_figure_keeps_the_old_reading():
    """Nobody has written this place's law down, so nothing new is invented."""
    out = agreed_year_hours_between(UNSEEDED, 40, date(2026, 1, 1), date(2026, 1, 8))
    assert out == 40


# --- Where the counting starts --------------------------------------------


def test_the_latest_of_the_three_wins():
    stretch = date(2026, 1, 1)
    assert effective_start(stretch, None, None) == stretch
    assert effective_start(stretch, date(2026, 9, 1), None) == date(2026, 9, 1)
    assert effective_start(stretch, None, date(2026, 6, 15)) == date(2026, 6, 15)
    # First published in September, hired in June: September is when there is
    # a record, so September is when the counting can start.
    assert effective_start(
        stretch, date(2026, 9, 1), date(2026, 6, 15)
    ) == date(2026, 9, 1)


def test_the_screenshot_does_not_happen_again():
    """The regression this file exists for.

    A 40-hour contract, a business whose first published rota was the 1st of
    September, asked on the 17th. Nothing worked yet in the window. The old
    reading said -1,480 h for the year. Whatever the new one says, it may not
    charge anybody for a January this product never saw.
    """
    on = date(2026, 9, 17)
    year = period_balance(
        [], "e1", 40, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), on,
        cycle_start=date(2026, 9, 1),
    )
    # Sixteen days of obligation, not two hundred and fifty-nine.
    assert year.start == date(2026, 9, 1)
    assert -100 < year.deviation < 0, year
    assert round(year.expected, 2) == round(40 * 16 / 7, 2)


def test_somebody_hired_mid_year_owes_nothing_for_the_months_before():
    on = date(2026, 9, 17)
    hired_in_june = period_balance(
        [], "e1", 40, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), on,
        contract_start=date(2026, 6, 15),
    )
    assert hired_in_june.start == date(2026, 6, 15)
    assert round(hired_in_june.expected, 2) == round(
        40 * (on - date(2026, 6, 15)).days / 7, 2
    )


def test_a_stretch_that_had_not_begun_yet_is_simply_empty():
    """A month that ends before the business published anything owes nothing."""
    out = period_balance(
        [], "e1", 40, BARCELONA,
        date(2026, 3, 1), date(2026, 4, 1), date(2026, 9, 17),
        cycle_start=date(2026, 9, 1),
    )
    assert (out.expected, out.total, out.deviation) == (0.0, 0.0, 0.0)


def test_working_the_contracted_week_every_week_lands_on_zero():
    """The property that makes the figure worth showing at all.

    Somebody who works their contracted week, every week, finishes level. Not
    approximately level, and not level only if they never take a day off:
    exactly level, because the balance asks whether they kept their side of
    the contract and forty hours a week is what the contract says.

    Measured against the convenio's 1,783 hours instead -- which is what this
    function used to do -- the same person finishes nearly three hundred hours
    AHEAD, because that figure already has their holiday taken out of it. That
    is the arithmetic behind "todo el mundo sale con +15...+46 h".
    """
    start = date(2026, 1, 4)  # a Sunday
    weeks = [start + timedelta(weeks=n) for n in range(52)]
    shifts = [WorkedShift("e1", w + timedelta(days=1), 40.0) for w in weeks]

    out = period_balance(
        shifts, "e1", 40, BARCELONA,
        start, start + timedelta(weeks=52), start + timedelta(weeks=52),
    )
    assert out.expected == 40 * 52
    assert out.deviation == 0.0, out


def test_the_holiday_comes_off_the_pace_when_it_is_taken():
    """How the contracted week and the convenio's year are reconciled.

    40 x 365/7 is 2,086 hours and the convenio fixes 1,783: the three hundred
    hours between them are the leave and the public days. The pace does not
    smear them over the year in advance -- that is what made an October of
    exactly-contracted weeks read as +26 h. It takes them off the day they are
    actually taken, as approved leave that is not worked back.
    """
    start = date(2026, 1, 4)
    away = [
        AbsenceDay("e1", start + timedelta(days=d), recoverable=False)
        for d in range(14)
    ]

    out = period_balance(
        [], "e1", 40, BARCELONA,
        start, start + timedelta(days=28), start + timedelta(days=28),
        absences=away,
    )
    # Four weeks, two of them away: two weeks of obligation.
    assert out.expected == 80.0

    # Leave that IS worked back still owes its hours -- the recovery circuit
    # answers those, and forgiving them here would cancel the debt twice.
    worked_back = [
        AbsenceDay("e1", start + timedelta(days=d), recoverable=True)
        for d in range(14)
    ]
    owed = period_balance(
        [], "e1", 40, BARCELONA,
        start, start + timedelta(days=28), start + timedelta(days=28),
        absences=worked_back,
    )
    assert owed.expected == 160.0


# --- The cycle closes on the 31st of December -----------------------------


def test_a_shift_that_opens_on_new_years_eve_closes_the_old_year():
    """22:00 on the 31st to 04:00 on the 1st belongs to the year that ends.

    A shift counts on the day it STARTS, so the hours are not split across the
    boundary and the cycle shuts tidily. Said out loud here because it is a
    decision -- the alternative is to cut the shift at midnight and give each
    year its share -- and because a New Year's Eve shift in hospitality is
    long, real, and the single most likely one to land on the line.
    """
    new_years_eve = WorkedShift("e1", date(2026, 12, 31), 6.0)

    closing = period_balance(
        [new_years_eve], "e1", 40, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), date(2027, 1, 1),
    )
    opening = period_balance(
        [new_years_eve], "e1", 40, BARCELONA,
        date(2027, 1, 1), date(2028, 1, 1), date(2028, 1, 1),
    )
    assert closing.worked == 6.0
    assert opening.worked == 0.0


# --- A draft does not move the balance; publishing does -------------------


def test_the_window_hours_come_back_so_a_draft_can_be_projected():
    """What the planner subtracts before adding its draft.

    Publishing REPLACES the rota for the dates being edited. A projection that
    only added the draft would count every shift already there twice, and the
    manager would be told they had given somebody double the hours they had.
    """
    week = date(2026, 9, 6)
    shifts = [
        WorkedShift("e1", week + timedelta(days=d), 8.0) for d in range(5)
    ]
    out = period_balance(
        shifts, "e1", 40, BARCELONA,
        date(2026, 9, 1), date(2026, 10, 1), date(2026, 9, 30),
        window=(week, week + timedelta(days=7)),
    )
    assert out.published_in_window == 40.0
    assert out.planned == 40.0

    # The window is what the manager is editing. Asked about a different one,
    # the same rota has nothing inside it.
    elsewhere = period_balance(
        shifts, "e1", 40, BARCELONA,
        date(2026, 9, 1), date(2026, 10, 1), date(2026, 9, 30),
        window=(date(2026, 9, 20), date(2026, 9, 27)),
    )
    assert elsewhere.published_in_window == 0.0
    assert elsewhere.planned == 40.0


def test_no_window_asked_for_means_no_window_hours():
    out = period_balance(
        [WorkedShift("e1", date(2026, 9, 7), 8.0)],
        "e1", 40, BARCELONA,
        date(2026, 9, 1), date(2026, 10, 1), date(2026, 9, 30),
    )
    assert out.published_in_window == 0.0


# --- How far a projection may look ----------------------------------------


def test_a_year_is_not_charged_with_the_months_nobody_has_planned_yet():
    """Found on screen, not in a test.

    The column read "Aldric P. -416 h" for the year, in September, from a rota
    that only ran to the end of the month. The figure was arithmetically
    perfect and useless: it counted October, November and December as zeros
    because nobody had written them yet, and a shortfall that big is
    indistinguishable from a real one.

    So a named window caps how far the stretch is measured. What the manager is
    told is where the year stands AS PLANNED -- not where it would stand if
    they never planned again.
    """
    september = [
        WorkedShift("e1", date(2026, 9, 1) + timedelta(days=d), 8.0)
        for d in range(0, 26, 7)
    ]
    window = (date(2026, 9, 1), date(2026, 10, 1))

    to_december = period_balance(
        september, "e1", 40, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), date(2026, 9, 17),
        cycle_start=date(2026, 9, 1),
    )
    to_the_rota = period_balance(
        september, "e1", 40, BARCELONA,
        date(2026, 1, 1), date(2027, 1, 1), date(2026, 9, 17),
        cycle_start=date(2026, 9, 1),
        window=window,
    )

    # Without a window the year still reaches December -- the roster's progress
    # bar exists to show exactly how much is unstaffed, so that must not change.
    assert to_december.total == round(40 * 122 / 7, 2)
    assert to_december.pending == 0.0
    # With one, it stops where the rota does...
    assert to_the_rota.total == round(40 * 30 / 7, 2)
    assert to_the_rota.total < to_december.total / 3
    # ...and what is left comes back as work still to plan, not as a hole.
    assert to_the_rota.pending == round(40 * 92 / 7, 2)
    assert round(to_the_rota.total + to_the_rota.pending, 2) == to_december.total


def test_the_horizon_never_falls_behind_today():
    """A window already in the past does not shrink the stretch to nothing.

    The manager editing last week still wants this month measured to today,
    not to last Sunday -- otherwise publishing a correction to a past week
    would report the month as almost over and almost even.
    """
    out = period_balance(
        [], "e1", 40, BARCELONA,
        date(2026, 9, 1), date(2026, 10, 1), date(2026, 9, 25),
        window=(date(2026, 9, 6), date(2026, 9, 13)),
    )
    assert out.horizon == date(2026, 9, 25)
    assert out.total == round(40 * 24 / 7, 2)
