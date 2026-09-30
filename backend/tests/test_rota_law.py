"""The browser's labour-law checks, now answerable by the server.

WHAT THESE PIN. `app/services/rota_law.py` is a SECOND judge of rules that
already have one: `frontend/src/lib/schedule/validate.ts`. A second judge is
worth having because the first one can be bypassed -- curl, an old bundle, the
iOS app, a model writing the payload -- and is dangerous for exactly one
reason: the day the two disagree, a manager is told a rota is illegal by one
half of the product and legal by the other, and nobody can say which half is
wrong.

So almost every test here is a port, and each one cites the TypeScript test it
came from. Where the port is not literal the comment says what changed and why.
The cases come from `validate.test.ts` (18 tests) and `spanishRules.test.ts`
(13). The ones left out are left out because they judge the BRIEF rather than
the law -- closed days, opening hours, split caps, weekly ceilings, coverage
gaps -- and the server never receives a brief; see the module docstring.

Most of the file needs no database, deliberately: `Person` and `LabourFloor`
are values, and a rule that can only be exercised through a Session is a rule
that silently stops being checked the moment Postgres is missing (this
repository skips 93 tests and still reports green). The tests that DO need one
are the ones about what the tables say: that the rest figure comes out of
``compliance_rule`` and not out of this file, that an approved absence blocks a
day and a requested one does not, and that overlapping shifts are refused by
Postgres rather than by Python.
"""
from __future__ import annotations

import dataclasses
import uuid
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Sequence

import pytest

from app.schemas.assignment import ShiftIn
from app.services.labour_floor import LabourFloor
from app.services import rota_law
from app.services.rota_law import (
    BELOW_MINIMUM_WAGE,
    DAILY_HOURS,
    NIGHT_AVERAGE,
    NIGHT_WORKER_OVERTIME,
    REST,
    TOO_MANY_SHIFTS,
    UNAVAILABLE,
    WEEKLY_REST,
    Person,
    Violation,
    judge_shifts,
    place,
)

UTC = timezone.utc

# What `floor_for` answers for a Catalan hospitality business, pinned by
# `test_spanish_labour.py` and read from ``compliance_rule``. Written out here
# so the pure tests need no database; the DB tests below check that `judge`
# really reads these from the table rather than from anywhere in this file.
SPAIN = LabourFloor(
    min_rest_hours=12.0,
    max_daily_hours=9.0,
    weekly_rest_hours=36.0,
    night_average_max=8.0,
    night_window=(22.0, 6.0),
    weekly_average_hours=40.0,
)

#: A jurisdiction with nothing seeded -- every customer before Spain.
NOTHING_SEEDED = LabourFloor()

# Sunday 1 March to Saturday 7 March 2026: one whole week, exactly the period
# `validate.test.ts` judges (`const WEEK = days('2026-03-01', 7)`).
WEEK_START = datetime(2026, 3, 1, tzinfo=UTC)
WEEK_END = WEEK_START + timedelta(days=7)

# Monday 5 October to Sunday 25 October 2026, the period `spanishRules.test.ts`
# uses. Three whole Sunday-anchored weeks fall inside it.
OCTOBER_START = datetime(2026, 10, 5, tzinfo=UTC)
OCTOBER_END = OCTOBER_START + timedelta(days=21)

ANA = "11111111-1111-4111-8111-111111111111"
BEN = "22222222-2222-4222-8222-222222222222"


def _shift(
    day: str,
    start_min: float,
    end_min: float,
    employee_id: str = ANA,
    break_min: int = 0,
) -> ShiftIn:
    """One shift written the way the browser thinks and the server receives.

    ``start_min`` / ``end_min`` are minutes from local midnight, so an
    overnight shift is written 17:00-27:00 exactly as the calendar holds it,
    and `place` turns it back into that shape after the round trip through two
    instants. The period in these tests starts at UTC midnight, so the local
    day and the UTC day are the same and the dates read as written.
    """
    midnight = datetime.combine(date.fromisoformat(day), time.min, tzinfo=UTC)
    return ShiftIn(
        employee_id=uuid.UUID(employee_id),
        start_at=midnight + timedelta(minutes=start_min),
        end_at=midnight + timedelta(minutes=end_min),
        unpaid_break_minutes=break_min,
    )


def _team(*ids: str, **over) -> Dict[str, Person]:
    """A roster of people nothing is wrong with, so only the rota is judged."""
    return {
        i: Person(
            employee_id=i,
            employment_status=over.get("employment_status", "active"),
            hire_date=over.get("hire_date", date(2025, 1, 1)),
            contract_from=over.get("contract_from", date(2025, 1, 1)),
            hourly_rate=over.get("hourly_rate"),
        )
        for i in (ids or (ANA,))
    }


def _judge(
    shifts: Sequence[ShiftIn],
    floor: LabourFloor = SPAIN,
    roster: Optional[Dict[str, Person]] = None,
    period_start: datetime = WEEK_START,
    period_end: datetime = WEEK_END,
    overtime_weeks: Optional[Dict[str, Dict[date, float]]] = None,
) -> List[Violation]:
    zone = rota_law.local_zone(period_start)
    return judge_shifts(
        place(shifts, zone),
        roster if roster is not None else _team(ANA, BEN),
        floor,
        days=rota_law.days_of(period_start, period_end, zone),
        zone=zone,
        overtime_weeks=overtime_weeks,
    )


def _codes(violations: Sequence[Violation]) -> List[str]:
    return [v.code for v in violations]


def _only(violations: Sequence[Violation], code: str) -> List[Violation]:
    return [v for v in violations if v.code == code]


# --- rest between shifts (art. 34.3 ET) --------------------------------------


def test_catches_too_little_rest_between_two_days():
    """From validate.test.ts, 'catches too little rest between two days'.

    Finishes 22:00 Monday, back at 06:00 Tuesday. The TS test asserts eight
    hours against a required eleven, because its spec carried the intake's
    American default; here the requirement comes from the Spanish floor, so the
    same eight hours are judged against twelve. The finding is the same finding.
    """
    found = _only(
        _judge(
            [
                _shift("2026-03-02", 14 * 60, 22 * 60),
                _shift("2026-03-03", 6 * 60, 14 * 60),
            ]
        ),
        REST,
    )
    assert len(found) == 1
    assert found[0].params == {"gap_min": 8 * 60, "required_min": 12 * 60}
    assert found[0].on == date(2026, 3, 3)
    assert found[0].employee_id == ANA


def test_does_not_call_a_legal_split_day_a_rest_breach():
    """From validate.test.ts, 'does NOT call a legal split day a rest breach'.

    Two halves of one day ninety minutes apart. The twelve-hour rule must not
    be applied inside a day, or every split shift in Spain becomes a breach.
    """
    result = _judge(
        [
            _shift("2026-03-02", 9 * 60, 13 * 60),
            _shift("2026-03-02", 14 * 60 + 30, 19 * 60),
        ]
    )
    assert _codes(result) == []


def test_sixty_minutes_is_the_line_for_a_split_day():
    """The split exception is a limit too, not a licence.

    Not in the TS suite, and it should be: `SPLIT_MIN_GAP` is what stops "it is
    the same day" from excusing a person walking out at 13:00 and back at
    13:20. Thirty minutes apart is a breach; sixty is not.
    """
    tight = _judge(
        [
            _shift("2026-03-02", 9 * 60, 13 * 60),
            _shift("2026-03-02", 13 * 60 + 30, 19 * 60),
        ]
    )
    assert _only(tight, REST)[0].params["required_min"] == 60
    exact = _judge(
        [
            _shift("2026-03-02", 9 * 60, 13 * 60),
            _shift("2026-03-02", 14 * 60, 19 * 60),
        ]
    )
    assert _codes(exact) == []


def test_does_not_read_a_night_that_ends_after_midnight_as_a_split():
    """From validate.test.ts, 'does not read a night that ends after midnight
    as a split'.

    Ends 02:00 Tuesday (26:00 Monday), back 08:00 Tuesday: six hours apart.
    Keyed on the CLOCK this looks like Tuesday's second shift and would get the
    sixty-minute break. Keyed on the START DATE -- which is what both files do
    -- it is a new day and owes the full twelve.
    """
    found = _only(
        _judge(
            [
                _shift("2026-03-02", 18 * 60, 26 * 60),
                _shift("2026-03-03", 8 * 60, 14 * 60),
            ]
        ),
        REST,
    )
    assert len(found) == 1
    assert found[0].params == {"gap_min": 6 * 60, "required_min": 12 * 60}


def test_an_overlap_is_not_reported_as_a_rest_breach():
    """validate.ts reports the overlap and calls rest moot (`continue`).

    Here the overlap is Postgres' finding rather than Python's (see
    `test_two_overlapping_shifts_are_refused_by_the_database`), so what this
    pins is the other half: a negative gap produces no `rest` line saying
    somebody had minus ninety minutes off, which explains nothing.
    """
    result = _judge(
        [
            _shift("2026-03-02", 9 * 60, 17 * 60),
            _shift("2026-03-02", 16 * 60, 20 * 60),
        ]
    )
    assert REST not in _codes(result)
    assert "overlap" not in _codes(result)


def test_says_nothing_about_rest_where_no_such_rule_is_seeded():
    """The regression that matters for every customer before Spain.

    Note the asymmetry with the browser, which is deliberate and documented in
    `judge_shifts`: the client would still apply the ELEVEN hours the intake
    defaults to, because a spec always carries a figure. The server has no
    brief, so where no statute is seeded it says nothing rather than enforcing
    a number the manager typed.
    """
    result = _judge(
        [
            _shift("2026-03-02", 14 * 60, 22 * 60),
            _shift("2026-03-03", 6 * 60, 14 * 60),
        ],
        NOTHING_SEEDED,
    )
    assert _codes(result) == []


# --- the nine-hour day (art. 34.3 ET) ----------------------------------------


def test_reports_a_ten_hour_shift():
    """From spanishRules.test.ts, 'the nine-hour day: reports a ten-hour shift'."""
    found = _only(
        _judge([_shift("2026-10-05", 17 * 60, 27 * 60)], period_start=OCTOBER_START,
               period_end=OCTOBER_END),
        DAILY_HOURS,
    )
    assert len(found) == 1
    assert found[0].params == {"hours": 10.0, "allowed": 9.0}


def test_the_nine_hour_day_says_nothing_where_no_such_rule_is_seeded():
    """From spanishRules.test.ts, 'says nothing where no such rule is seeded'."""
    result = _judge(
        [_shift("2026-10-05", 17 * 60, 27 * 60)],
        NOTHING_SEEDED,
        period_start=OCTOBER_START,
        period_end=OCTOBER_END,
    )
    assert DAILY_HOURS not in _codes(result)


def test_the_two_halves_of_a_split_are_one_day_against_the_limit():
    """Summed per day, not per shift (validate.ts:395-408).

    Five hours and five hours with a legal gap between them is a ten-hour day
    and art. 34.3 does not care that it arrived in two pieces.
    """
    found = _only(
        _judge(
            [
                _shift("2026-03-02", 8 * 60, 13 * 60),
                _shift("2026-03-02", 14 * 60, 19 * 60),
            ]
        ),
        DAILY_HOURS,
    )
    assert len(found) == 1
    assert found[0].params == {"hours": 10.0, "allowed": 9.0}


def test_exactly_nine_hours_is_nine_hours():
    """The rounding the original spells out in a comment (validate.ts:399-401).

    Nine hours is not a breach; nine hours and a minute is. Rounding happens
    BEFORE the comparison so arithmetic noise never arrives dressed as a legal
    finding -- and it rounds half UP like JavaScript's `Math.round`, not half to
    even like Python's `round`.
    """
    assert DAILY_HOURS not in _codes(_judge([_shift("2026-03-02", 9 * 60, 18 * 60)]))
    over = _only(_judge([_shift("2026-03-02", 9 * 60, 18 * 60 + 1)]), DAILY_HOURS)
    assert over[0].params["hours"] == 9.02
    assert rota_law._round(0.125, 2) == 0.13, "Python's round() would say 0.12"


def test_the_unpaid_break_comes_off_the_day():
    """PAID hours, like the original (`paidHours`), and like payroll.

    A ten-hour span with an hour off the clock is a nine-hour day. Getting this
    wrong would report a breach on every long split shift in the product.
    """
    result = _judge([_shift("2026-03-02", 9 * 60, 19 * 60, break_min=60)])
    assert DAILY_HOURS not in _codes(result)


def test_an_annual_average_week_never_excuses_the_nine_hour_day():
    """From spanishRules.test.ts, 'never excuses the nine-hour day'.

    Its companion -- 'does not report a 45-hour week where the year is the
    unit' -- is pinned by the same assertion from the other side: a 45-hour
    week of 7.5-hour days produces NOTHING here, because the weekly ceiling is
    not this module's business at all (art. 34.1 ET makes the week an annual
    average, and `services/workday.py` judges the year).
    """
    long_week = [
        _shift("2026-10-%02d" % (5 + d), 17 * 60, 17 * 60 + 450) for d in range(6)
    ]
    assert (
        _codes(_judge(long_week, period_start=OCTOBER_START, period_end=OCTOBER_END))
        == []
    )

    ten_hours = [_shift("2026-10-05", 17 * 60, 27 * 60)]
    assert DAILY_HOURS in _codes(
        _judge(ten_hours, period_start=OCTOBER_START, period_end=OCTOBER_END)
    )


# --- the day and a half off (art. 37.1 ET) -----------------------------------


def test_reports_a_week_worked_straight_through():
    """From spanishRules.test.ts, 'reports a week worked straight through'.

    Monday 12 to Sunday 18 October, 17:00-22:00 every day: every gap is the
    nineteen hours between one finish and the next start, and none of them is
    the day and a half owed.

    The days either side are worked too, and that is not decoration. The rest
    around a week is measured to the NEIGHBOURING SHIFT, so a week with
    nothing before or after it is a week whose rest runs off the edge of what
    was handed in -- unbounded, and not a breach. Here both edges are pinned.
    """
    week = [
        _shift("2026-10-%d" % d, 17 * 60, 22 * 60) for d in range(11, 20)
    ]
    found = _only(
        _judge(week, period_start=OCTOBER_START, period_end=OCTOBER_END), WEEKLY_REST
    )
    assert len(found) == 1
    assert found[0].params["required"] == 36.0
    assert found[0].params["hours"] == 19.0
    # Reported ON the week, i.e. its Monday -- as the client reports it.
    assert found[0].on == date(2026, 10, 12)


def test_accepts_a_week_with_a_clear_day_and_a_half_in_it():
    """From spanishRules.test.ts, 'accepts a week with a clear day and a half'.

    Monday to Friday of the same week: the Sunday before and the Saturday after
    are free, which is the rest the article asks for.
    """
    week = [_shift("2026-10-%d" % d, 17 * 60, 22 * 60) for d in range(12, 17)]
    result = _judge(week, period_start=OCTOBER_START, period_end=OCTOBER_END)
    assert WEEKLY_REST not in _codes(result)


def test_only_whole_weeks_inside_the_period_are_judged():
    """From validate.ts (`wholeWeeks`), which has no TS test of its own.

    Seven days worked straight through, judged by a period that starts on a
    WEDNESDAY: it holds no whole week, so it holds no week whose rest this
    publish could see in full -- the rest owed for each of them is partly in a
    week this call was not given. Without this the check would fire on every
    rota whose period does not begin on a Monday, which is most of them.
    """
    week = [_shift("2026-10-%d" % d, 17 * 60, 22 * 60) for d in range(14, 21)]
    from_wednesday = _judge(
        week,
        period_start=datetime(2026, 10, 14, tzinfo=UTC),
        period_end=datetime(2026, 10, 21, tzinfo=UTC),
    )
    assert WEEKLY_REST not in _codes(from_wednesday)


def test_a_rest_that_crosses_the_week_boundary_is_not_cut_in_half():
    """The bug that moving the week to Monday was only half of.

    Monday to Friday, three weeks running: 09:00-17:00, then nothing until the
    following Monday. That is 64 hours of unbroken rest every weekend and the
    plainest lawful rota there is.

    It used to be reported as a breach, because the rest was measured only
    INSIDE [week, week+7d) and the boundary cut it: whichever day the week
    started on, one of these weekends was sliced and the smaller half judged.
    The product then acted on the finding -- dropping the Friday shift, and
    paying for a second model call to replan the month.

    Two anchors, one behaviour: `validate.ts` measures the same way, and the
    shifts either side of a week are what its two ends are measured to.
    """
    weeks = [
        _shift("2026-10-%02d" % d, 9 * 60, 17 * 60)
        for d in (5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23)
    ]
    result = _judge(weeks, period_start=OCTOBER_START, period_end=OCTOBER_END)
    assert WEEKLY_REST not in _codes(result)


def test_the_day_off_inside_the_week_is_enough_on_its_own():
    """Six days Tuesday to Sunday with the Monday free, and the weeks either
    side worked: the rest is the free Monday plus the evening around it, 43
    hours, and nothing is reported. The mirror of the test above -- rest that
    sits INSIDE a week was never the broken case, and must not become one."""
    week = [_shift("2026-10-%d" % d, 17 * 60, 22 * 60) for d in range(13, 19)]
    week = [_shift("2026-10-11", 17 * 60, 22 * 60)] + week + [
        _shift("2026-10-19", 17 * 60, 22 * 60)
    ]
    result = _judge(week, period_start=OCTOBER_START, period_end=OCTOBER_END)
    assert WEEKLY_REST not in _codes(result)


def test_the_weekly_rest_says_nothing_where_no_such_rule_is_seeded():
    """From spanishRules.test.ts, the second half of every Spanish describe."""
    week = [_shift("2026-10-%d" % d, 17 * 60, 22 * 60) for d in range(11, 18)]
    result = _judge(
        week, NOTHING_SEEDED, period_start=OCTOBER_START, period_end=OCTOBER_END
    )
    assert WEEKLY_REST not in _codes(result)


# --- the night worker's average (art. 36.1 ET) -------------------------------


def test_reports_ten_hour_nights_as_a_habit():
    """From spanishRules.test.ts, 'reports ten-hour nights as a habit'."""
    nights = [_shift("2026-10-%02d" % d, 17 * 60, 27 * 60) for d in range(5, 9)]
    found = _only(
        _judge(nights, period_start=OCTOBER_START, period_end=OCTOBER_END),
        NIGHT_AVERAGE,
    )
    assert len(found) == 1
    assert found[0].params == {"average": 10.0, "allowed": 8.0, "days": 4}


def test_leaves_a_day_worker_alone():
    """From spanishRules.test.ts, 'leaves a day worker alone'.

    Ten hours, none of them after 22:00: long, and not night work. The day is
    still reported as a `daily_hours` breach, which is the other article and
    the point of asserting only on this one.
    """
    daytime = [_shift("2026-10-%02d" % d, 9 * 60, 19 * 60) for d in (5, 6)]
    result = _judge(daytime, period_start=OCTOBER_START, period_end=OCTOBER_END)
    assert NIGHT_AVERAGE not in _codes(result)


def test_one_night_average_finding_per_person():
    """validate.ts:478 -- 'one finding per person: the fortnight, not every day'.

    Twelve bad nights are one habit. Reported once per person, or the screen
    fills with the same finding and the manager learns to scroll past it.
    """
    nights = [_shift("2026-10-%02d" % d, 17 * 60, 27 * 60) for d in range(5, 17)]
    result = _judge(nights, period_start=OCTOBER_START, period_end=OCTOBER_END)
    assert len(_only(result, NIGHT_AVERAGE)) == 1


def test_a_bad_fortnight_inside_a_good_month_is_still_found():
    """The sliding window, which is why the article says "15 days".

    Ten six-hour nights from the 5th, then four ten-hour ones from the 15th.
    Averaged over all fourteen nights that is 7.1 hours and lawful; no window
    starting at the beginning finds anything. The window that opens on the 12th
    holds three short nights and all four long ones -- 8.3 hours -- and that is
    the one reported, because the check walks every window and stops at the
    FIRST that breaches, exactly as the original does (validate.ts:470-480).
    """
    good = [_shift("2026-10-%02d" % d, 22 * 60, 28 * 60) for d in range(5, 15)]
    bad = [_shift("2026-10-%02d" % d, 17 * 60, 27 * 60) for d in range(15, 19)]
    found = _only(
        _judge(good + bad, period_start=OCTOBER_START, period_end=OCTOBER_END),
        NIGHT_AVERAGE,
    )
    assert len(found) == 1
    assert found[0].on == date(2026, 10, 12)
    assert found[0].params == {"average": 8.3, "allowed": 8.0, "days": 7}


def test_the_night_average_says_nothing_where_no_window_is_seeded():
    nights = [_shift("2026-10-%02d" % d, 17 * 60, 27 * 60) for d in range(5, 9)]
    result = _judge(
        nights, NOTHING_SEEDED, period_start=OCTOBER_START, period_end=OCTOBER_END
    )
    assert NIGHT_AVERAGE not in _codes(result)


def test_night_hours_count_at_both_ends_of_midnight():
    """The arithmetic `night.ts` documents: 18:00-04:00 is six night hours.

    A port of the one number that decides who is a night worker at all. Judged
    in UTC a Spanish evening shift loses two of those hours and the person stops
    being a night worker, which is why the whole module works in the client's
    own offset.
    """
    assert rota_law.night_hours_in(18 * 60, 28 * 60, (22.0, 6.0)) == 6.0
    assert rota_law.night_hours_in(17 * 60, 27 * 60, (22.0, 6.0)) == 5.0
    assert rota_law.night_hours_in(9 * 60, 19 * 60, (22.0, 6.0)) == 0.0
    # Three hours is the line (`NIGHT_WORKER_MIN_HOURS`), and a shift that ends
    # at 01:00 is over it while one that ends at midnight is not.
    assert rota_law.night_hours_in(17 * 60, 25 * 60, (22.0, 6.0)) == 3.0
    assert rota_law.night_hours_in(17 * 60, 24 * 60, (22.0, 6.0)) == 2.0


# --- no overtime for a night worker (art. 36.1 ET) ---------------------------
#
# Which hours are overtime is the working year's answer, handed in as
# `overtime_weeks`; these tests hand it in by hand so the rule is exercised
# without a database. The floor that forbids it is SPAIN plus the one flag
# `floor_for` derives from ``night_worker_no_overtime`` -- the DB test further
# down checks that the flag really comes out of the table.

SPAIN_NO_NIGHT_OVERTIME = dataclasses.replace(
    SPAIN, night_worker_overtime_allowed=False
)

# Monday 5 to Thursday 8 October 2026: four 17:00-03:00 nights, five night
# hours each, so every one of them is a night-worker day. Monday-anchored week.
NIGHTS_WEEK = date(2026, 10, 5)
NEXT_WEEK = date(2026, 10, 12)


def _nights(*days: int) -> List[ShiftIn]:
    return [_shift("2026-10-%02d" % d, 17 * 60, 27 * 60) for d in days]


def test_overtime_in_a_week_of_nights_is_reported():
    """The article in one line: a night worker may not do extra hours."""
    found = _only(
        _judge(
            _nights(5, 6, 7, 8),
            SPAIN_NO_NIGHT_OVERTIME,
            period_start=OCTOBER_START,
            period_end=OCTOBER_END,
            overtime_weeks={ANA: {NIGHTS_WEEK: 4.0}},
        ),
        NIGHT_WORKER_OVERTIME,
    )
    assert len(found) == 1
    assert found[0].employee_id == ANA
    # Dated on the Monday of the week, which is the unit the overtime was
    # classified in -- not on any one night.
    assert found[0].on == NIGHTS_WEEK
    assert found[0].params == {"hours": 4.0}


def test_overtime_in_a_week_without_nights_is_not_a_night_workers():
    """Nights one week, extra hours the next: two lawful facts, not one breach.

    The rule asks about the WEEK. Somebody who worked nights in early October
    and a long day shift the week after did overtime as a day worker, and
    reporting it as a night worker's would forbid every rotating rota there is.
    """
    result = _judge(
        _nights(5, 6, 7, 8) + [_shift("2026-10-13", 9 * 60, 17 * 60)],
        SPAIN_NO_NIGHT_OVERTIME,
        period_start=OCTOBER_START,
        period_end=OCTOBER_END,
        overtime_weeks={ANA: {NEXT_WEEK: 6.0}},
    )
    assert NIGHT_WORKER_OVERTIME not in _codes(result)


def test_night_overtime_says_nothing_where_the_floor_allows_it():
    """A floor with no ``night_worker_no_overtime`` row is not Spain.

    `LabourFloor`'s default is True -- allowed -- because the ban is stated as
    the PRESENCE of a rule, and a jurisdiction nobody seeded states nothing.
    """
    kwargs = dict(
        period_start=OCTOBER_START,
        period_end=OCTOBER_END,
        overtime_weeks={ANA: {NIGHTS_WEEK: 4.0}},
    )
    assert SPAIN.night_worker_overtime_allowed is True
    assert NIGHT_WORKER_OVERTIME not in _codes(
        _judge(_nights(5, 6, 7, 8), SPAIN, **kwargs)
    )
    assert NIGHT_WORKER_OVERTIME not in _codes(
        _judge(_nights(5, 6, 7, 8), NOTHING_SEEDED, **kwargs)
    )


def test_night_overtime_says_nothing_without_the_years_classification():
    """No `overtime_weeks` means nobody said which hours were extra.

    `judge_shifts` cannot answer that from one month -- it is the working
    year's question -- so without the answer it must stay silent rather than
    guess that every long week was overtime.
    """
    result = _judge(
        _nights(5, 6, 7, 8),
        SPAIN_NO_NIGHT_OVERTIME,
        period_start=OCTOBER_START,
        period_end=OCTOBER_END,
    )
    assert NIGHT_WORKER_OVERTIME not in _codes(result)


def test_one_night_overtime_finding_per_person():
    """Two bad weeks are one habit, reported on the first, like the average.

    Ben works the same nights with no overtime at all and must not be dragged
    into Ana's finding: the classification is per person.
    """
    nights = _nights(5, 6, 7, 8, 12, 13, 14, 15)
    bens = [
        _shift("2026-10-%02d" % d, 17 * 60, 27 * 60, employee_id=BEN)
        for d in (5, 6, 7, 8)
    ]
    found = _only(
        _judge(
            nights + bens,
            SPAIN_NO_NIGHT_OVERTIME,
            period_start=OCTOBER_START,
            period_end=OCTOBER_END,
            overtime_weeks={ANA: {NIGHTS_WEEK: 2.0, NEXT_WEEK: 7.5}},
        ),
        NIGHT_WORKER_OVERTIME,
    )
    assert len(found) == 1
    assert found[0].employee_id == ANA
    assert found[0].on == NIGHTS_WEEK
    assert found[0].params == {"hours": 2.0}


# --- the minimum wage (art. 27 ET) -------------------------------------------

#: The SMI as `floor_for` reads it for the statute (`ES`), per hour.
SPAIN_WITH_SMI = dataclasses.replace(SPAIN, minimum_wage=8.22)

TWO_DAYS = [
    _shift("2026-03-02", 9 * 60, 17 * 60),
    _shift("2026-03-04", 9 * 60, 17 * 60),
]


def test_an_hourly_rate_under_the_minimum_wage_is_reported():
    """Once per person, on their first day: the rate is the same every shift."""
    found = _only(
        _judge(TWO_DAYS, SPAIN_WITH_SMI, roster=_team(ANA, hourly_rate=7.0)),
        BELOW_MINIMUM_WAGE,
    )
    assert len(found) == 1
    assert found[0].employee_id == ANA
    assert found[0].on == date(2026, 3, 2)
    assert found[0].params == {"rate": 7.0, "minimum": 8.22}


def test_the_minimum_wage_itself_is_lawful():
    """Exactly 8.22 is the minimum, not under it."""
    result = _judge(TWO_DAYS, SPAIN_WITH_SMI, roster=_team(ANA, hourly_rate=8.22))
    assert BELOW_MINIMUM_WAGE not in _codes(result)


def test_a_contract_with_no_hourly_rate_is_not_compared():
    """A salaried contract, or the default one creation opens, states no rate.

    Its hourly figure depends on the year it is read against, which is not
    this module's question -- and "no rate" must never read as "a rate of 0".
    """
    result = _judge(TWO_DAYS, SPAIN_WITH_SMI, roster=_team(ANA, hourly_rate=None))
    assert BELOW_MINIMUM_WAGE not in _codes(result)


def test_the_minimum_wage_says_nothing_where_none_is_seeded():
    """SPAIN as the pure tests write it carries no SMI: nothing to compare."""
    assert SPAIN.minimum_wage is None
    result = _judge(TWO_DAYS, SPAIN, roster=_team(ANA, hourly_rate=7.0))
    assert BELOW_MINIMUM_WAGE not in _codes(result)


# --- more than two shifts in a day -------------------------------------------


def test_catches_a_third_shift_in_one_day():
    """From validate.ts:300-306. Two shifts are a split; three are a mistake.

    The gaps here are exactly the sixty minutes a split day allows, so nothing
    else fires and the assertion is about this rule alone.
    """
    result = _judge(
        [
            _shift("2026-03-02", 9 * 60, 11 * 60),
            _shift("2026-03-02", 12 * 60, 14 * 60),
            _shift("2026-03-02", 15 * 60, 17 * 60),
        ]
    )
    assert _codes(result) == [TOO_MANY_SHIFTS]
    assert _only(result, TOO_MANY_SHIFTS)[0].params == {"count": 3}


def test_two_shifts_in_a_day_are_a_split_and_not_a_count_error():
    result = _judge(
        [
            _shift("2026-03-02", 9 * 60, 13 * 60),
            _shift("2026-03-02", 14 * 60, 18 * 60),
        ]
    )
    assert TOO_MANY_SHIFTS not in _codes(result)


# --- who can work a day (availability.ts) ------------------------------------


def test_catches_a_shift_on_somebody_who_is_away():
    """From validate.test.ts, 'catches a shift on somebody who is away'."""
    away = Person(
        employee_id=ANA,
        employment_status="active",
        hire_date=date(2025, 1, 1),
        contract_from=date(2025, 1, 1),
        approved_absences=(
            (
                datetime(2026, 3, 2, tzinfo=UTC),
                datetime(2026, 3, 2, 23, 59, tzinfo=UTC),
            ),
        ),
    )
    found = _only(_judge([_shift("2026-03-02", 9 * 60, 17 * 60)], roster={ANA: away}),
                  UNAVAILABLE)
    assert len(found) == 1
    assert found[0].params == {"reason": "absence"}


def test_a_requested_absence_is_not_a_block():
    """availability.ts:168 -- only APPROVED blocks.

    A pending holiday request must not disappear from the rota before anybody
    has answered it. `roster_facts` never puts one in `approved_absences`, so
    the day is judged workable and the absence is the manager's to decide.
    """
    asked = Person(
        employee_id=ANA,
        employment_status="active",
        hire_date=date(2025, 1, 1),
        contract_from=date(2025, 1, 1),
    )
    day = [_shift("2026-03-02", 9 * 60, 17 * 60)]
    assert _codes(_judge(day, roster={ANA: asked})) == []


@pytest.mark.parametrize(
    "person,expected",
    [
        (
            Person(employee_id=ANA, employment_status="resigned",
                   hire_date=date(2025, 1, 1), contract_from=date(2025, 1, 1)),
            "resigned",
        ),
        (
            Person(employee_id=ANA, employment_status="on_leave",
                   hire_date=date(2025, 1, 1), contract_from=date(2025, 1, 1)),
            "on_leave",
        ),
        (
            # Hired the day after. The contract opens with them, so this is the
            # case where the ORDER decides which reason is given.
            Person(employee_id=ANA, employment_status="active",
                   hire_date=date(2026, 3, 3), contract_from=date(2026, 3, 3)),
            "not_started",
        ),
        (
            Person(employee_id=ANA, employment_status="active",
                   hire_date=date(2025, 1, 1), has_contract=False),
            "contract",
        ),
        (
            Person(employee_id=ANA, employment_status="active",
                   hire_date=date(2025, 1, 1), contract_from=date(2026, 6, 1)),
            "contract",
        ),
        (
            Person(employee_id=ANA, employment_status="active",
                   hire_date=date(2025, 1, 1), contract_from=date(2025, 1, 1),
                   contract_to=date(2026, 1, 31)),
            "contract",
        ),
        (
            Person(employee_id=ANA, employment_status="onboarding",
                   hire_date=date(2025, 1, 1), contract_from=date(2025, 1, 1)),
            None,
        ),
    ],
    ids=["resigned", "on_leave", "not_started", "no_contract", "contract_starts",
         "contract_ended", "onboarding_can_still_work"],
)
def test_the_order_of_the_reasons_is_the_clients_order(person, expected):
    """Ported from availability.ts:85-175, which decides in this sequence.

    The order IS the answer, so it is what a test has to hold: status first,
    then the hire date, then the contract, then the absences. An onboarding
    employee is not blocked at all -- their ramp-up is a cap on hours and a bar
    on nights, which is the generator's business and not a reason a day cannot
    be worked.
    """
    assert rota_law.blocked_on(person, date(2026, 3, 2), UTC) == expected


def test_a_resigned_employee_with_a_holiday_reads_as_resigned():
    """Two reasons at once, and the first one wins (availability.ts order).

    Not a TS test, but it is the assertion that would catch somebody reordering
    the checks for tidiness: an `absence` reason on somebody who left months
    ago sends the manager looking at the wrong screen.
    """
    gone = Person(
        employee_id=ANA,
        employment_status="resigned",
        hire_date=date(2025, 1, 1),
        contract_from=date(2025, 1, 1),
        approved_absences=(
            (
                datetime(2026, 3, 2, tzinfo=UTC),
                datetime(2026, 3, 2, 23, 59, tzinfo=UTC),
            ),
        ),
    )
    found = _only(_judge([_shift("2026-03-02", 9 * 60, 17 * 60)], roster={ANA: gone}),
                  UNAVAILABLE)
    assert found[0].params == {"reason": "resigned"}


def test_nothing_is_said_about_somebody_who_is_not_on_the_roster():
    """From validate.test.ts, 'catches a shift given to somebody who does not
    work here' -- which this module deliberately does NOT report.

    `validate_shifts` has already refused the publish by name
    (``unknown_employee``), and every rule here reads a contract this person
    does not have. Two findings for one fact would make the error body say the
    same thing twice.
    """
    assert _codes(_judge([_shift("2026-03-02", 9 * 60, 27 * 60)], roster={})) == []


# --- scope -------------------------------------------------------------------


def test_ignores_shifts_outside_the_period_being_judged():
    """From validate.test.ts, 'ignores shifts outside the period being judged'.

    A neighbouring month's shift is one this publish can neither see nor fix.
    Twelve hours long and it still produces nothing.
    """
    assert _codes(_judge([_shift("2026-04-15", 9 * 60, 21 * 60)])) == []


def test_the_day_grid_is_the_clients_own_and_not_utc():
    """The piece with no TS counterpart, because the browser never needed it.

    `period_start` is local midnight sent as an instant, so a period that
    starts at 22:00Z is October in Madrid. Two shifts that are 17:00-03:00 and
    17:00-03:00 on consecutive LOCAL days are two days' work; read in UTC the
    second one's start falls on the same UTC date as the first one's end, and
    the whole day grid slides.
    """
    madrid = datetime(2026, 9, 30, 22, tzinfo=UTC)  # 1 October 00:00 in +02:00
    zone = rota_law.local_zone(madrid)
    assert zone.utcoffset(None) == timedelta(hours=2)
    days = rota_law.days_of(madrid, madrid + timedelta(days=31), zone)
    assert days[0] == date(2026, 10, 1) and days[-1] == date(2026, 10, 31)
    assert len(days) == 31

    # 01:30-09:30 local on 2 October is 23:30Z on the 1st: a UTC reading would
    # file it under 1 October and sum it with that day's work.
    placed = place(
        [
            ShiftIn(
                employee_id=uuid.UUID(ANA),
                start_at=datetime(2026, 10, 1, 23, 30, tzinfo=UTC),
                end_at=datetime(2026, 10, 2, 7, 30, tzinfo=UTC),
            )
        ],
        zone,
    )
    assert placed[0].day == date(2026, 10, 2)
    assert placed[0].start_min == 90.0
    assert placed[0].end_min == 570.0


def test_a_utc_caller_gets_utc_days():
    """Nothing is guessed: a period at UTC midnight is judged in UTC.

    Which is what every test above relies on, and what a business that really
    runs on UTC means.
    """
    assert rota_law.local_zone(WEEK_START).utcoffset(None) == timedelta(0)
    assert rota_law.local_zone(
        datetime(2026, 3, 1, 5, tzinfo=UTC)
    ).utcoffset(None) == timedelta(hours=-5)


# --- observe before reject ---------------------------------------------------


def test_enforcement_is_off_until_somebody_turns_it_on(monkeypatch):
    """The `api_budget_enforced` pattern, for the same reason it was chosen.

    A control that starts refusing on the day it is deployed turns an estimate
    into somebody else's outage -- here, a manager refused the calendar they
    have published all year, at the moment they press the button. So the
    findings are logged first and the switch is an environment variable.

    ``publish_law_enforced`` does not exist in `config.py` yet, which is why
    `enforced()` reads it with `getattr` and why this test can set it.
    """
    from app.config import settings

    assert rota_law.enforced() is False
    assert rota_law.mode() == "observe"

    monkeypatch.setattr(settings, "publish_law_enforced", True, raising=False)
    assert rota_law.enforced() is True
    assert rota_law.mode() == "enforce"


def test_a_finding_travels_as_a_code_and_numbers():
    """The `errors.py` convention: a code to translate, numbers to interpolate.

    No prose in the data, in either language. The English is the log line and
    the curl output, exactly as that module describes, and it is never built by
    interpolating the figures -- those travel in ``params`` so the client can
    compose the sentence in the manager's own language.
    """
    violations = _judge(
        [
            _shift("2026-03-02", 14 * 60, 22 * 60),
            _shift("2026-03-03", 6 * 60, 14 * 60),
        ]
    )
    body = rota_law.as_detail(violations)
    assert body["code"] == rota_law.BREAKS_THE_LAW
    assert body["params"]["count"] == 1
    first = body["params"]["violations"][0]
    assert first["rule"] == REST
    assert first["day"] == "2026-03-03"
    assert first["gap_min"] == 480 and first["required_min"] == 720
    # Nothing in the numbers is a sentence, and no figure is baked into the
    # message -- the client interpolates, so the message must not.
    assert "480" not in body["message"] and "12" not in body["message"]


# --- what only the database can answer ---------------------------------------


def _db_available() -> bool:
    try:
        from sqlalchemy import text

        from app.db import app_engine

        with app_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


skip_no_db = pytest.mark.skipif(
    not _db_available(),
    reason="No Postgres reachable. Start it and run `alembic upgrade head`.",
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


def _signup(client) -> tuple:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Bar de la Ley %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return body["access_token"], uuid.UUID(body["user"]["org_id"])


def _add(client, token: str, name: str, **over) -> dict:
    payload = {
        "external_id": None,
        "full_name": name,
        "email": None,
        "employment_status": "active",
        "hire_date": "2025-01-01",
    }
    payload.update(over)
    resp = client.post("/api/v1/employees", headers=_auth(token), json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


@contextmanager
def _session(org_id: uuid.UUID):
    """A runtime session with the org set -- without it RLS returns nothing."""
    from app.db import AppSessionLocal, set_current_org

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        yield db
    finally:
        db.close()


@skip_no_db
def test_the_rest_it_requires_comes_out_of_the_rules_table(client):
    """The design rule this module exists to keep: no second copy of a limit.

    Twelve hours, not eleven, and not because anything here says twelve: the
    figure is ``daily_rest_between_shifts`` for the organization's own
    jurisdiction, read through `labour_floor.floor_for`. The assertion compares
    the finding against that row rather than against a literal, so seeding a
    different agreement moves both sides together -- which is the whole point
    of the rules living in a table.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")

    with _session(org_id) as db:
        from app.services.labour_floor import floor_for

        floor = floor_for(db, rota_law.jurisdiction_of(db, org_id))
        assert floor.min_rest_hours is not None, "Spain is seeded in this database"

        violations = rota_law.judge(
            db,
            org_id,
            [
                _shift("2026-03-02", 14 * 60, 22 * 60, employee_id=ana["id"]),
                _shift("2026-03-03", 6 * 60, 14 * 60, employee_id=ana["id"]),
            ],
            period_start=WEEK_START,
            period_end=WEEK_END,
        )

    found = _only(violations, REST)
    assert len(found) == 1
    assert found[0].params["required_min"] == floor.min_rest_hours * 60
    assert found[0].employee_id == ana["id"]


@skip_no_db
def test_an_approved_absence_blocks_the_day_and_a_request_does_not(client):
    """From validate.test.ts, 'catches a shift on somebody who is away', end to
    end: the absence is created and approved through the API, and `judge` reads
    it back out of ``absence`` rather than being handed it.

    Both halves in one test on purpose -- the row is the same row, and what
    changes is one word in its status. Splitting them would let a bug that
    ignores `status` pass the first half.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")

    types = client.get("/api/v1/absence-types", headers=_auth(token))
    assert types.status_code == 200, types.text
    holiday = types.json()[0]["id"]

    created = client.post(
        "/api/v1/absences",
        headers=_auth(token),
        json={
            "employee_id": ana["id"],
            "absence_type_id": holiday,
            "start_at": "2026-03-02T00:00:00+00:00",
            "end_at": "2026-03-02T23:59:00+00:00",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "requested"

    shifts = [_shift("2026-03-02", 9 * 60, 17 * 60, employee_id=ana["id"])]

    with _session(org_id) as db:
        asked = rota_law.judge(
            db, org_id, shifts, period_start=WEEK_START, period_end=WEEK_END
        )
    assert _codes(asked) == [], "a request nobody answered is not a block"

    approved = client.post(
        "/api/v1/absences/%s/approve" % created.json()["id"], headers=_auth(token)
    )
    assert approved.status_code == 200, approved.text

    with _session(org_id) as db:
        now_blocked = rota_law.judge(
            db, org_id, shifts, period_start=WEEK_START, period_end=WEEK_END
        )
    found = _only(now_blocked, UNAVAILABLE)
    assert len(found) == 1
    assert found[0].params == {"reason": "absence"}


@skip_no_db
def test_somebody_who_left_cannot_be_given_a_shift(client):
    """`employment_status` read off the row, not off anything in the payload.

    The same finding `availability()` gives the grid, so the manager sees the
    reason the server used.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    patched = client.patch(
        "/api/v1/employees/%s" % ana["id"],
        headers=_auth(token),
        json={"employment_status": "resigned"},
    )
    assert patched.status_code == 200, patched.text

    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            [_shift("2026-03-02", 9 * 60, 17 * 60, employee_id=ana["id"])],
            period_start=WEEK_START,
            period_end=WEEK_END,
        )
    assert _only(violations, UNAVAILABLE)[0].params == {"reason": "resigned"}


@skip_no_db
def test_a_new_hires_contract_decides_whether_the_day_can_be_worked(client):
    """`hire_date` in the future is `not_started`, and the ORDER says so.

    Created through the endpoint, which opens a contract from the hire date
    (`default_contract`), so both the hire date and the contract start are
    ahead of the day. The client answers `not_started` because it asks about
    the hire date first, and so does this.
    """
    token, org_id = _signup(client)
    later = _add(client, token, "Nuria", hire_date="2026-06-01")

    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            [_shift("2026-03-02", 9 * 60, 17 * 60, employee_id=later["id"])],
            period_start=WEEK_START,
            period_end=WEEK_END,
        )
    assert _only(violations, UNAVAILABLE)[0].params == {"reason": "not_started"}


@skip_no_db
def test_a_lawful_rota_is_judged_lawful(client):
    """The other half of every check: silence when nothing is wrong.

    Four eight-hour days with a clear weekend in the week, for somebody with a
    contract and no absences. A module that reported something here would be
    worse than no module at all -- see what a spend ceiling that fires on
    everybody costs in `test_generation_cost_controls.py`.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    shifts = [
        _shift("2026-03-%02d" % d, 9 * 60, 17 * 60, employee_id=ana["id"])
        for d in (2, 3, 4, 5)
    ]

    with _session(org_id) as db:
        violations = rota_law.judge(
            db, org_id, shifts, period_start=WEEK_START, period_end=WEEK_END
        )
    assert violations == []


@skip_no_db
def test_two_overlapping_shifts_are_refused_by_the_database(client):
    """From validate.test.ts, 'catches the same person in two places at once'.

    Not ported, and this is the demonstration rather than a comment claiming
    it: ``assignment_no_overlap`` -- ``EXCLUDE USING gist (employee_id WITH =,
    status WITH =, during WITH &&)``, written in ``0001_initial.py`` and
    widened with ``status`` in ``0016_draft_no_overlap.py`` -- makes the second
    insert impossible, and the router turns the IntegrityError into a 409. A
    Python copy of the rule would be a second answer to a question Postgres
    answers definitively, and the weaker of the two: it cannot see the
    neighbouring period's shifts, which is the overlap that 409 is mostly for.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")

    body = {
        "period_start": WEEK_START.isoformat(),
        "period_end": WEEK_END.isoformat(),
        "shifts": [
            {
                "employee_id": ana["id"],
                "start_at": "2026-03-02T09:00:00+00:00",
                "end_at": "2026-03-02T17:00:00+00:00",
            },
            {
                "employee_id": ana["id"],
                "start_at": "2026-03-02T16:00:00+00:00",
                "end_at": "2026-03-02T20:00:00+00:00",
            },
        ],
    }
    resp = client.post("/api/v1/schedule/publish", headers=_auth(token), json=body)
    assert resp.status_code == 409, resp.text

    # And this module stays quiet about it rather than saying the same thing in
    # a weaker voice. The rest check skips a negative gap for the same reason.
    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            [ShiftIn(**s) for s in body["shifts"]],
            period_start=WEEK_START,
            period_end=WEEK_END,
        )
    assert "overlap" not in _codes(violations)


@skip_no_db
def test_a_jurisdiction_with_nothing_seeded_is_judged_by_nothing(client):
    """The regression that matters: every customer before Spain.

    The organization is filed under a code the rules table has never heard of,
    and a rota that breaks all four statutory rules at once comes back clean.
    A module that judged it anyway would be enforcing Spanish law on a business
    in another country -- which is the mistake this product already made once
    in the other direction, with the FLSA.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")

    from sqlalchemy import text

    from app.db import AdminSessionLocal

    admin = AdminSessionLocal()
    try:
        admin.execute(
            text(
                "UPDATE organization SET jurisdiction_code = 'ZZ-NOWHERE' "
                "WHERE id = :id"
            ),
            {"id": str(org_id)},
        )
        admin.commit()
    finally:
        admin.close()

    week = [
        _shift("2026-03-%02d" % d, 14 * 60, 26 * 60, employee_id=ana["id"])
        for d in range(1, 8)
    ]
    with _session(org_id) as db:
        assert rota_law.jurisdiction_of(db, org_id) == "ZZ-NOWHERE"
        violations = rota_law.judge(
            db, org_id, week, period_start=WEEK_START, period_end=WEEK_END
        )
    assert violations == []


# --- the clock change, and the week that is not there -------------------------


def test_october_has_thirty_one_days_and_not_thirty_two():
    """The hour Spain gives back must not add a day to the period.

    `local_zone` reads ONE fixed offset off `period_start`, so it cannot know
    about the change on the last Sunday of October. Walking local midnights
    against `period_end` therefore counted 1 November as inside October: the
    real period is 745 hours, and 745 hours of +02:00 midnights reach into the
    next day.
    """
    start = datetime(2025, 10, 1, tzinfo=timezone(timedelta(hours=2)))
    end = datetime(2025, 11, 1, tzinfo=timezone(timedelta(hours=1)))
    zone = rota_law.local_zone(start)

    days = rota_law.days_of(start, end, zone)

    assert len(days) == 31
    assert days[0] == date(2025, 10, 1)
    assert days[-1] == date(2025, 10, 31)


def test_a_november_after_the_change_is_still_thirty_days():
    """The other direction: a period entirely inside winter time."""
    start = datetime(2025, 11, 1, tzinfo=timezone(timedelta(hours=1)))
    end = datetime(2025, 12, 1, tzinfo=timezone(timedelta(hours=1)))
    zone = rota_law.local_zone(start)

    assert len(rota_law.days_of(start, end, zone)) == 30


def test_the_last_week_of_october_is_not_judged_as_a_whole_one():
    """The refusal this would have caused, and the browser never would.

    Ana works Monday 27 to Friday 31 October 2025; her day and a half of rest is
    1 and 2 November, outside the period. With 32 days the week anchored on
    Sunday 26 October looked complete, so `weekly_rest` fired on a rota the app
    had shown as legal -- and once enforcement is on, that is a manager unable
    to publish, at the moment they press the button, for no reason they can see.
    """
    start = datetime(2025, 10, 1, tzinfo=timezone(timedelta(hours=2)))
    end = datetime(2025, 11, 1, tzinfo=timezone(timedelta(hours=1)))
    shifts = [
        _shift(day, 9 * 60, 17 * 60)
        for day in (
            "2025-10-27",
            "2025-10-28",
            "2025-10-29",
            "2025-10-30",
            "2025-10-31",
        )
    ]

    violations = _judge(shifts, period_start=start, period_end=end)

    assert "weekly_rest" not in _codes(violations)


# --- the working year, asked from the publish side ----------------------------
#
# `judge` now runs `law_if_published` (routers/workday.py): the engine behind
# the working-year tab, over the year AS PUBLISHING WOULD LEAVE IT. These need
# the database because that is the whole point -- the year is what is already
# on the noticeboard, and no value handed in could stand for it.
#
# The figures below are ES-CT-HOSTELERIA's, which signup assigns: a 1,783-hour
# year, a tenth of it movable (art. 34.2), 80 extra hours a year (art. 35.2).


def _contract(client, token: str, employee_id: str, weekly: float, **over) -> dict:
    """Open a real contract through the endpoint, replacing the default one.

    From 1 January 2026, so the contract never moves where the year starts
    counting -- the first published day does, and each test says which it is.
    """
    payload = {
        "employment_type": "non_exempt_hourly",
        "min_hours_per_week": weekly,
        "max_hours_per_week": weekly,
        "valid_from": "2026-01-01",
    }
    payload.update(over)
    resp = client.post(
        "/api/v1/employees/%s/contracts" % employee_id,
        headers=_auth(token),
        json=payload,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _weeks_of(
    monday: date, weeks: int, employee_id: str, hours: int, days: int = 7
) -> List[ShiftIn]:
    """``weeks`` whole weeks from ``monday``, ``days`` shifts of ``hours`` each."""
    return [
        _shift(
            (monday + timedelta(days=7 * w + d)).isoformat(),
            8 * 60,
            (8 + hours) * 60,
            employee_id=employee_id,
        )
        for w in range(weeks)
        for d in range(days)
    ]


def _utc(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=UTC)


def _publish_shifts(client, token: str, start: date, end: date, shifts) -> None:
    """Publish through the real endpoint: `published_at` is stamped as in life."""
    resp = client.post(
        "/api/v1/schedule/publish",
        headers=_auth(token),
        json={
            "period_start": _utc(start).isoformat(),
            "period_end": _utc(end).isoformat(),
            "shifts": [s.model_dump(mode="json") for s in shifts],
        },
    )
    assert resp.status_code == 200, resp.text


# Monday 5 January 2026: the first published day, so the reference period runs
# from here to New Year -- 361/365 of a year. Each heavy week is seven twelve-
# hour days, 84 hours, 44 above a 40-hour contract.
#
# THE ARITHMETIC, because a test of a cap is only as good as the distance to
# it. The agreed year is 1,783 x 361/365 = 1,763.5 h. A tenth of it, 176.4 h,
# may be moved around (art. 34.2) and is spent FIRST; only what is left is
# overtime. The cap is 80 x 361/365 = 79.1 h. So:
#   5 heavy weeks  = 220 h above contract -> 43.6 h overtime: under the cap.
#   6 heavy weeks  = 264 h above contract -> 87.6 h overtime: over it.
YEAR_OPENS = date(2026, 1, 5)
HEAVY = 12


@skip_no_db
def test_a_publish_that_takes_somebody_past_80_extra_hours_is_found(client):
    """The cap the working-year tab has always reported, now seen on publish.

    Five heavy weeks already on the noticeboard leave Ana at 43.6 extra hours,
    under her 79.1. The month being published adds four more such weeks, and
    the first of them -- her sixth -- crosses the line. Nobody has to open the
    working-year tab for that to be said.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 40)

    published_to = YEAR_OPENS + timedelta(weeks=5)
    _publish_shifts(
        client,
        token,
        YEAR_OPENS,
        published_to,
        _weeks_of(YEAR_OPENS, 5, ana["id"], HEAVY),
    )

    window_end = published_to + timedelta(weeks=4)
    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            _weeks_of(published_to, 4, ana["id"], HEAVY),
            period_start=_utc(published_to),
            period_end=_utc(window_end),
        )

    found = _only(violations, rota_law.OVERTIME_CAP_EXCEEDED)
    assert len(found) == 1, "one finding per rule and person, not one per week"
    assert found[0].employee_id == ana["id"]
    # The sixth heavy week, which is the first week of the month published.
    assert found[0].on == published_to
    assert found[0].params["cap"] == pytest.approx(79.12, abs=0.01)
    assert found[0].params["worked"] > found[0].params["cap"]


@skip_no_db
def test_a_month_worked_to_contract_is_not_blamed_for_last_months_overtime(client):
    """The other half, and the reason `_ADDS_TO` exists.

    Six heavy weeks already published put Ana past the cap. The working-year
    tab says so, and keeps saying so every week after, because it is a ledger.
    But the month being published now is her contract to the hour -- five
    eight-hour days a week -- and it adds nothing to the pile. Refusing it
    would refuse a lawful month over a past one it cannot change.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 40)

    published_to = YEAR_OPENS + timedelta(weeks=6)
    _publish_shifts(
        client,
        token,
        YEAR_OPENS,
        published_to,
        _weeks_of(YEAR_OPENS, 6, ana["id"], HEAVY),
    )

    # First, that the premise holds: the ledger itself finds the cap passed
    # in the last published week. Without this the assertion below could pass
    # because the year was never over the cap at all.
    last_week = published_to - timedelta(weeks=1)
    ledger = client.get(
        "/api/v1/workday",
        headers=_auth(token),
        params={
            "from": _utc(last_week).isoformat(),
            "to": _utc(published_to).isoformat(),
        },
    )
    assert ledger.status_code == 200, ledger.text
    assert "overtime_cap_exceeded" in {
        e["rule"] for w in ledger.json()["weeks"] for e in w["errors"]
    }

    window_end = published_to + timedelta(weeks=4)
    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            _weeks_of(published_to, 4, ana["id"], 8, days=5),
            period_start=_utc(published_to),
            period_end=_utc(window_end),
        )
    assert rota_law.OVERTIME_CAP_EXCEEDED not in _codes(violations)


@skip_no_db
def test_a_part_timer_with_no_pact_cannot_be_given_complementary_hours(client):
    """Art. 12.5: without a written pact not one complementary hour is owed.

    Twenty contracted hours, no pact, and three sixty-hour weeks. Nothing else
    is published, so the year opens on 2 March: 305/365 of half of 1,783 is
    745 h, a tenth of which (74.5 h) is spent first as moved hours. The three
    weeks are 120 h above the contract, so 45.5 of them are complementary --
    and there is no pact to cover a single one.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 20)

    opens = date(2026, 3, 2)
    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            _weeks_of(opens, 3, ana["id"], 12, days=5),
            period_start=_utc(opens),
            period_end=_utc(opens + timedelta(weeks=3)),
        )

    found = _only(violations, rota_law.COMPLEMENTARY_WITHOUT_PACT)
    assert len(found) == 1
    assert found[0].employee_id == ana["id"]
    # And never as overtime: a part-timer's excess has no such name (12.4.c).
    assert rota_law.OVERTIME_CAP_EXCEEDED not in _codes(violations)


def _nights_from(monday: date, employee_id: str, start_h: int, count: int):
    """``count`` nights from ``monday``, each from ``start_h`` to 06:00."""
    return [
        _shift(
            (monday + timedelta(days=d)).isoformat(),
            start_h * 60,
            30 * 60,
            employee_id=employee_id,
        )
        for d in range(count)
    ]


@skip_no_db
def test_a_night_worker_given_overtime_by_this_publish_is_found(client):
    """Art. 36.1 end to end: the year classifies the hours, the rota the nights.

    Four heavy day weeks already published spend the whole movable tenth
    (4 x 44 = 176 of 176.4 h), so nothing is overtime yet. The week published
    now is seven 18:00-06:00 nights -- 84 hours, eight of each night inside
    22:00-06:00 -- and its 43.65 hours above the contract can only be extra.
    A night worker may not do a single one.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 40)

    published_to = YEAR_OPENS + timedelta(weeks=4)
    _publish_shifts(
        client,
        token,
        YEAR_OPENS,
        published_to,
        _weeks_of(YEAR_OPENS, 4, ana["id"], HEAVY),
    )

    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            _nights_from(published_to, ana["id"], 18, 7),
            period_start=_utc(published_to),
            period_end=_utc(published_to + timedelta(weeks=1)),
        )
    found = _only(violations, NIGHT_WORKER_OVERTIME)
    assert len(found) == 1
    assert found[0].on == published_to
    assert found[0].params["hours"] == pytest.approx(43.65, abs=0.01)


@skip_no_db
def test_a_night_week_at_contract_is_not_charged_with_januarys_overtime(client):
    """Overtime done by day in January is not overtime done at night in February.

    Six heavy day weeks leave Ana 87.6 extra hours into the year. The week
    published now is five 22:00-06:00 nights, forty hours: her contract to the
    minute, not one of them extra. The nights make her a night worker this
    week; the overtime was all in weeks she worked by day.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 40)

    published_to = YEAR_OPENS + timedelta(weeks=6)
    _publish_shifts(
        client,
        token,
        YEAR_OPENS,
        published_to,
        _weeks_of(YEAR_OPENS, 6, ana["id"], HEAVY),
    )

    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            _nights_from(published_to, ana["id"], 22, 5),
            period_start=_utc(published_to),
            period_end=_utc(published_to + timedelta(weeks=1)),
        )
    assert NIGHT_WORKER_OVERTIME not in _codes(violations)


# A day far enough ahead that the real clock can never make it "the past",
# with the `now` it is published at fixed beside it.
NOTICE_DAY = date(2030, 6, 12)


@skip_no_db
def test_a_shift_published_the_day_before_is_short_notice(client):
    """Five days' notice (art. 34.2 ET), measured from the moment of publishing.

    Asked through `law_if_published` with an explicit ``now``, so the test
    does not depend on the day it runs; and then once through `judge` on the
    real clock, for tomorrow, to pin that the wiring passes it through.
    """
    from app.routers.workday import law_if_published
    from app.services.labour_floor import floor_for

    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 40)

    shift = _shift(NOTICE_DAY.isoformat(), 9 * 60, 17 * 60, employee_id=ana["id"])
    with _session(org_id) as db:
        floor = floor_for(db, rota_law.jurisdiction_of(db, org_id))
        errors, _ = law_if_published(
            db,
            org_id,
            [shift],
            period_start=_utc(NOTICE_DAY),
            period_end=_utc(NOTICE_DAY + timedelta(days=1)),
            zone=UTC,
            floor=floor,
            now=_utc(NOTICE_DAY - timedelta(days=1)) + timedelta(hours=10),
        )
    notice = [e for e in errors if e.rule == "short_notice"]
    assert len(notice) == 1
    assert notice[0].day == NOTICE_DAY
    assert notice[0].detail == {"days": 1.0, "required": 5.0}

    tomorrow = datetime.now(UTC).date() + timedelta(days=1)
    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            [_shift(tomorrow.isoformat(), 9 * 60, 17 * 60, employee_id=ana["id"])],
            period_start=_utc(tomorrow),
            period_end=_utc(tomorrow + timedelta(days=1)),
        )
    assert rota_law.SHORT_NOTICE in _codes(violations)


@skip_no_db
def test_republishing_a_shift_already_announced_keeps_its_notice(client):
    """The mirror of what `_replace_window` does with ``published_at``.

    The shift went up on the noticeboard today, years ahead of the day. The
    day before it, the manager republishes the window: the IDENTICAL shift
    was announced long ago and owes nothing, while one moved by an hour is a
    new announcement and owes the five days again.
    """
    from app.routers.workday import law_if_published
    from app.services.labour_floor import floor_for

    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 40)

    start, end = _utc(NOTICE_DAY), _utc(NOTICE_DAY + timedelta(days=1))
    same = _shift(NOTICE_DAY.isoformat(), 9 * 60, 17 * 60, employee_id=ana["id"])
    _publish_shifts(client, token, NOTICE_DAY, NOTICE_DAY + timedelta(days=1), [same])

    the_day_before = start - timedelta(hours=14)
    moved = _shift(NOTICE_DAY.isoformat(), 10 * 60, 18 * 60, employee_id=ana["id"])
    with _session(org_id) as db:
        floor = floor_for(db, rota_law.jurisdiction_of(db, org_id))
        kept, _ = law_if_published(
            db,
            org_id,
            [same],
            period_start=start,
            period_end=end,
            zone=UTC,
            floor=floor,
            now=the_day_before,
        )
        changed, _ = law_if_published(
            db,
            org_id,
            [moved],
            period_start=start,
            period_end=end,
            zone=UTC,
            floor=floor,
            now=the_day_before,
        )
    assert "short_notice" not in {e.rule for e in kept}
    assert "short_notice" in {e.rule for e in changed}


@skip_no_db
def test_the_minimum_wage_is_inherited_where_an_agreement_states_no_figure(client):
    """`floor_for` walks the chain for the first profile that STATES a wage.

    ES-CT-COMERCIO carries a ``minimum_wage`` row with no threshold -- its
    salary table not loaded yet -- which means "the agreement's own table",
    never "no minimum". So it inherits the statute's 8.22, while hospitality,
    whose convenio states 9.59, keeps its own. And the night-worker ban is a
    statutory row, so it reaches every Spanish profile.
    """
    from app.services.labour_floor import floor_for

    _, org_id = _signup(client)
    with _session(org_id) as db:
        assert floor_for(db, "ES").minimum_wage == pytest.approx(8.22)
        assert floor_for(db, "ES-CT-COMERCIO").minimum_wage == pytest.approx(8.22)
        assert floor_for(db, "ES-CT-HOSTELERIA").minimum_wage == pytest.approx(9.59)
        assert floor_for(db, "ES").night_worker_overtime_allowed is False
        assert floor_for(db, "ES-CT-HOSTELERIA").night_worker_overtime_allowed is False
        # And a code nobody seeded says nothing about either.
        nowhere = floor_for(db, "ZZ-NOWHERE")
        assert nowhere.minimum_wage is None
        assert nowhere.night_worker_overtime_allowed is True


@skip_no_db
def test_an_hourly_contract_under_the_agreements_wage_is_found(client):
    """End to end: the rate read off the contract, the minimum off the table.

    8.50 is above the statute's 8.22 and under hospitality's 9.59, so the
    finding can only come from the agreement's figure -- which is the one that
    applies to a Catalan bar.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 40, hourly_rate=8.5)

    with _session(org_id) as db:
        violations = rota_law.judge(
            db,
            org_id,
            [_shift("2026-03-02", 9 * 60, 17 * 60, employee_id=ana["id"])],
            period_start=WEEK_START,
            period_end=WEEK_END,
        )
    found = _only(violations, BELOW_MINIMUM_WAGE)
    assert len(found) == 1
    assert found[0].params == {"rate": 8.5, "minimum": 9.59}


# --- what a REPUBLISH is responsible for --------------------------------------


@skip_no_db
def test_republishing_away_the_rest_that_compensated_overtime_is_found(client):
    """Art. 35.1: extra hours answered by rest within four months stop counting.

    Six heavy weeks leave Ana 87.65 extra hours gross, over her 79.12. The
    month after is published SHORT -- five seven-hour days, 5 h under contract
    a week, 20 h of rest in all -- and that rest brings the counted figure to
    67.65, under the cap. Republishing the same month at her contract takes
    the rest away and puts her back over it: that is this publish's doing,
    and the baseline has to be the year as it stood WITH the short month in
    it, or the change is invisible. Republishing the short month unchanged
    changes nothing and must say nothing.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 40)

    month_opens = YEAR_OPENS + timedelta(weeks=6)
    month_closes = month_opens + timedelta(weeks=4)
    _publish_shifts(
        client,
        token,
        YEAR_OPENS,
        month_opens,
        _weeks_of(YEAR_OPENS, 6, ana["id"], HEAVY),
    )
    short = _weeks_of(month_opens, 4, ana["id"], 7, days=5)
    _publish_shifts(client, token, month_opens, month_closes, short)

    # The premise, read off the working-year tab: with the short month the
    # year is UNDER the cap in every week of it, and the rest is counted.
    ledger = client.get(
        "/api/v1/workday",
        headers=_auth(token),
        params={
            "from": _utc(month_opens).isoformat(),
            "to": _utc(month_closes).isoformat(),
        },
    )
    assert ledger.status_code == 200, ledger.text
    weeks = ledger.json()["weeks"]
    assert len(weeks) == 4
    assert "overtime_cap_exceeded" not in {
        e["rule"] for w in weeks for e in w["errors"]
    }

    def judged(shifts):
        with _session(org_id) as db:
            return rota_law.judge(
                db,
                org_id,
                shifts,
                period_start=_utc(month_opens),
                period_end=_utc(month_closes),
            )

    to_contract = judged(_weeks_of(month_opens, 4, ana["id"], 8, days=5))
    found = _only(to_contract, rota_law.OVERTIME_CAP_EXCEEDED)
    assert len(found) == 1
    assert found[0].employee_id == ana["id"]
    assert found[0].params["worked"] == pytest.approx(87.65, abs=0.01)

    unchanged = judged(short)
    assert rota_law.OVERTIME_CAP_EXCEEDED not in _codes(unchanged)


@skip_no_db
def test_a_shift_carried_over_unchanged_is_not_announced_again(client):
    """Notice is owed by what a publish ANNOUNCES, not by what it carries over.

    Ana's shift two days from now goes up today: short notice, rightly. The
    window is then republished with her shift untouched and a new one for Ben
    ten days out. Her shift keeps the day it was announced -- `_replace_window`
    keeps ``published_at`` -- and was already short then; that was the first
    publish's doing, and repeating it on every republish would make fixing
    anything else in the window look like a fresh breach. Ben's has notice.

    On the real clock, because the first publish goes through the endpoint and
    stamps ``published_at`` with it.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    ben = _add(client, token, "Ben")
    _contract(client, token, ana["id"], 40)
    _contract(client, token, ben["id"], 40)

    today = datetime.now(UTC).date()
    opens, closes = today + timedelta(days=1), today + timedelta(days=12)
    hers = _shift(
        (today + timedelta(days=2)).isoformat(), 9 * 60, 17 * 60, employee_id=ana["id"]
    )
    his = _shift(
        (today + timedelta(days=10)).isoformat(), 9 * 60, 17 * 60, employee_id=ben["id"]
    )

    def judged(shifts):
        with _session(org_id) as db:
            return rota_law.judge(
                db, org_id, shifts, period_start=_utc(opens), period_end=_utc(closes)
            )

    first = _only(judged([hers]), rota_law.SHORT_NOTICE)
    assert [v.employee_id for v in first] == [ana["id"]]
    _publish_shifts(client, token, opens, closes, [hers])

    again = judged([hers, his])
    assert rota_law.SHORT_NOTICE not in _codes(again)


@skip_no_db
def test_a_pact_above_the_statute_is_the_rotas_business_only_when_it_is_used(client):
    """Art. 12.5.c: a pact for 90 % is void above the convenio's 60 %.

    That is a flaw in the CONTRACT, and the working-year tab reports it every
    week. A rota is party to it only when it hands Ana complementary hours.

    THE ARITHMETIC, because 26 hours a week is not enough on its own: a
    part-timer's first hours above the contract are ordinary hours moved under
    art. 34.2 -- a tenth of her year, 1,783 x 0.5 x 361/365 x 0.1 = 88.2 h --
    and only after that are they complementary. So three sixty-hour weeks are
    published first (120 h above contract): the tenth is spent, and every hour
    above twenty after it is complementary.
    """
    token, org_id = _signup(client)
    ana = _add(client, token, "Ana")
    _contract(client, token, ana["id"], 20, complementary_pct=0.9)

    month_opens = YEAR_OPENS + timedelta(weeks=3)
    month_closes = month_opens + timedelta(weeks=2)
    _publish_shifts(
        client,
        token,
        YEAR_OPENS,
        month_opens,
        _weeks_of(YEAR_OPENS, 3, ana["id"], 12, days=5),
    )

    def judged(hours_a_day):
        with _session(org_id) as db:
            return rota_law.judge(
                db,
                org_id,
                _weeks_of(month_opens, 2, ana["id"], hours_a_day, days=2)
                + _weeks_of(
                    month_opens + timedelta(days=2), 2, ana["id"], 4, days=3
                ),
                period_start=_utc(month_opens),
                period_end=_utc(month_closes),
            )

    # 2 x 4 + 3 x 4 = 20 h a week: her contract, not one hour on top.
    assert rota_law.COMPLEMENTARY_PACT_ABOVE_STATUTE not in _codes(judged(4))
    # 2 x 7 + 3 x 4 = 26 h a week: six complementary hours, under a void pact.
    found = _only(judged(7), rota_law.COMPLEMENTARY_PACT_ABOVE_STATUTE)
    assert len(found) == 1
    assert found[0].params == {"agreed": 90.0, "allowed": 60.0}
