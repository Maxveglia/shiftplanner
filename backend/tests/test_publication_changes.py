"""What each person is owed when a rota is published again.

These are the sentences an email and a push notification will be built from,
so the cases that matter are the ones where a naive difference would say
something FALSE to somebody: a republish that changed nothing, a shift that
moved reported as a loss and a gain, and a night shift filed under the wrong
day because the server keeps time in UTC and the business does not.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID, uuid4

from app.services.publication_changes import ShiftFact, changes_between

MADRID_SUMMER = timezone(timedelta(hours=2))
MADRID_WINTER = timezone(timedelta(hours=1))


def shift(
    employee_id: UUID,
    day: int,
    start_hour: int,
    end_hour: int,
    *,
    month: int = 7,
    tz: timezone = MADRID_SUMMER,
    unpaid_break: int = 0,
) -> ShiftFact:
    """One shift on a July day, written in Barcelona's wall clock."""
    start = datetime(2026, month, day, start_hour, 0, tzinfo=tz)
    end = datetime(2026, month, day, end_hour, 0, tzinfo=tz)
    if end <= start:
        end += timedelta(days=1)
    return ShiftFact(
        employee_id=employee_id,
        start_at=start,
        end_at=end,
        unpaid_break_minutes=unpaid_break,
    )


def test_republishing_the_same_rota_tells_nobody_anything():
    """The commonest republish of all: one shift moved, ninety-five did not.

    If this reports the untouched shifts, every message the product ever sends
    is noise and people stop reading them.
    """
    ana, luis = uuid4(), uuid4()
    before = [shift(ana, 6, 9, 17), shift(luis, 6, 17, 23), shift(ana, 7, 9, 17)]
    after = list(before)

    result = changes_between(before, after)

    assert result.is_empty
    assert result.first_publication is False


def test_a_shift_that_moved_is_one_change_and_not_two():
    ana = uuid4()
    before = [shift(ana, 7, 17, 23)]
    after = [shift(ana, 7, 12, 20)]

    result = changes_between(before, after)

    assert len(result.employees) == 1
    (changed,) = result.employees
    assert changed.employee_id == ana
    (day_change,) = changed.days
    assert day_change.kind == "moved"
    assert day_change.day == date(2026, 7, 7)
    assert day_change.before.start_at.astimezone(MADRID_SUMMER).hour == 17
    assert day_change.after.start_at.astimezone(MADRID_SUMMER).hour == 12


def test_only_the_person_affected_is_told():
    ana, luis = uuid4(), uuid4()
    before = [shift(ana, 7, 9, 17), shift(luis, 7, 17, 23)]
    after = [shift(ana, 7, 12, 20), shift(luis, 7, 17, 23)]

    result = changes_between(before, after)

    assert [e.employee_id for e in result.employees] == [ana]


def test_a_shift_added_and_a_shift_taken_away():
    ana = uuid4()
    before = [shift(ana, 7, 9, 17)]
    after = [shift(ana, 8, 9, 17)]

    result = changes_between(before, after)

    (changed,) = result.employees
    kinds = {(c.day, c.kind) for c in changed.days}
    # Moved to another DAY is deliberately two facts, not an arrow: "the 7th is
    # off" and "you are in on the 8th" is how a person plans their week.
    assert kinds == {(date(2026, 7, 7), "removed"), (date(2026, 7, 8), "added")}


def test_the_first_publication_of_a_window_says_so():
    ana = uuid4()

    result = changes_between([], [shift(ana, 7, 9, 17)])

    assert result.first_publication is True
    (changed,) = result.employees
    assert [c.kind for c in changed.days] == ["added"]


def test_a_night_shift_belongs_to_the_day_it_starts_in_barcelona():
    """22:00 on the 7th of January is 21:00Z on the 7th -- but 00:30 on the 8th
    is 23:30Z on the 7th. A reader keeping time in UTC files both on the 7th.
    """
    ana = uuid4()
    before = [shift(ana, 7, 22, 6, month=1, tz=MADRID_WINTER)]
    after = [shift(ana, 7, 23, 6, month=1, tz=MADRID_WINTER)]

    result = changes_between(before, after)

    (changed,) = result.employees
    (day_change,) = changed.days
    assert day_change.kind == "moved"
    assert day_change.day == date(2026, 1, 7)


def test_a_shift_just_after_midnight_is_its_own_day_not_the_night_before():
    ana = uuid4()
    after_midnight = ShiftFact(
        employee_id=ana,
        start_at=datetime(2026, 1, 8, 0, 30, tzinfo=MADRID_WINTER),
        end_at=datetime(2026, 1, 8, 6, 0, tzinfo=MADRID_WINTER),
        unpaid_break_minutes=0,
    )

    result = changes_between([], [after_midnight])

    (changed,) = result.employees
    (day_change,) = changed.days
    assert day_change.day == date(2026, 1, 8)


def test_changing_only_the_unpaid_break_is_a_change():
    """It moves what the person is paid and how long they are on site, and it
    is one of the four things `_shift_identity` compares -- so a message that
    stayed silent about it would contradict the notice the law counts.
    """
    ana = uuid4()
    before = [shift(ana, 7, 9, 17, unpaid_break=0)]
    after = [shift(ana, 7, 9, 17, unpaid_break=30)]

    result = changes_between(before, after)

    (changed,) = result.employees
    (day_change,) = changed.days
    assert day_change.kind == "moved"
    assert day_change.after.unpaid_break_minutes == 30


def test_two_identical_shifts_on_one_day_and_one_of_them_goes():
    """A set difference would say nothing happened. One of them did go."""
    ana = uuid4()
    twice = shift(ana, 7, 9, 13)
    before = [twice, twice]
    after = [twice]

    result = changes_between(before, after)

    (changed,) = result.employees
    (day_change,) = changed.days
    assert day_change.kind == "removed"


def test_a_whole_day_cleared_for_one_person():
    ana = uuid4()
    before = [shift(ana, 7, 9, 13), shift(ana, 7, 18, 23)]
    after = []

    result = changes_between(before, after)

    (changed,) = result.employees
    assert [c.kind for c in changed.days] == ["removed", "removed"]


def test_one_shift_of_three_moved_reports_one_change():
    ana = uuid4()
    morning = shift(ana, 7, 9, 13)
    evening = shift(ana, 7, 18, 23)
    before = [morning, evening, shift(ana, 8, 9, 13)]
    after = [morning, shift(ana, 7, 19, 23), shift(ana, 8, 9, 13)]

    result = changes_between(before, after)

    (changed,) = result.employees
    (day_change,) = changed.days
    assert day_change.kind == "moved"
    assert day_change.before.start_at.astimezone(MADRID_SUMMER).hour == 18
    assert day_change.after.start_at.astimezone(MADRID_SUMMER).hour == 19
