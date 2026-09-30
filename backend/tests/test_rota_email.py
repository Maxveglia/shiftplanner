"""The words that land in somebody's inbox.

This is the first thing the product has ever sent to an employee, so the cases
here are the ones where a wrong message is worse than no message: the wrong
HOUR (the server keeps time in UTC and the business does not), the wrong number
of hours on the night the clocks change, and a rota sent to somebody nothing
happened to.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.services.publication_changes import ShiftFact, changes_between
from app.services.rota_email import Recipient, compose

MADRID_SUMMER = timezone(timedelta(hours=2))
MADRID_WINTER = timezone(timedelta(hours=1))
OCTOBER = datetime(2026, 10, 1, 0, 0, tzinfo=MADRID_SUMMER)


def shift(employee_id, day, start_hour, end_hour, *, tz=MADRID_SUMMER, brk=0):
    start = datetime(2026, 10, day, start_hour, 0, tzinfo=tz)
    end = datetime(2026, 10, day, end_hour, 0, tzinfo=tz)
    if end <= start:
        end += timedelta(days=1)
    return ShiftFact(
        employee_id=employee_id,
        start_at=start,
        end_at=end,
        unpaid_break_minutes=brk,
    )


def ana():
    return uuid4()


def only_message(changes, who, name="Ana Ruiz"):
    messages = compose(
        changes,
        {who: Recipient(employee_id=who, name=name, email="ana@example.com")},
        period_start=OCTOBER,
        org_name="Bar Vista",
        app_base_url="https://app.example.com",
    )
    assert len(messages) == 1
    return messages[0]


def test_the_hour_is_the_one_the_business_keeps_not_utc():
    """A 09:00 shift in Barcelona is 07:00Z. The person is expected at 09:00."""
    who = ana()
    message = only_message(changes_between([], [shift(who, 7, 9, 17)]), who)

    assert "09:00–17:00" in message.text
    assert "07:00" not in message.text


def test_a_first_publication_hands_over_the_rota():
    who = ana()
    changes = changes_between(
        [], [shift(who, 7, 9, 17), shift(who, 8, 17, 23), shift(who, 10, 9, 13)]
    )

    message = only_message(changes, who)

    assert message.subject == "Tu horario de octubre de 2026"
    assert "Hola Ana," in message.text
    assert "Ya tienes tu horario de octubre de 2026 en Bar Vista." in message.text
    assert "mié 7 oct · 09:00–17:00 (8 h)" in message.text
    assert "3 turnos · 18 h en total" in message.text
    assert "https://app.example.com" in message.text


def test_a_change_names_the_day_and_both_hours():
    who = ana()
    changes = changes_between([shift(who, 7, 17, 23)], [shift(who, 7, 12, 20)])

    message = only_message(changes, who)

    assert message.subject == "Ha cambiado 1 turno de tu horario de octubre de 2026"
    assert "mié 7 oct · ahora 12:00–20:00 (antes 17:00–23:00)" in message.text
    # The rota it did not touch has no business being in a message about what
    # changed -- that is what makes the next one worth opening.
    assert "Ya tienes tu horario" not in message.text


def test_a_shift_taken_away_says_so_plainly():
    who = ana()
    changes = changes_between([shift(who, 7, 9, 17)], [])

    message = only_message(changes, who)

    assert "mié 7 oct · ya no entras (antes 09:00–17:00)" in message.text


def test_several_changes_are_counted_in_the_subject():
    who = ana()
    before = [shift(who, 7, 9, 17), shift(who, 8, 9, 17)]
    after = [shift(who, 7, 12, 20), shift(who, 8, 12, 20)]

    message = only_message(changes_between(before, after), who)

    assert message.subject == "Han cambiado 2 turnos de tu horario de octubre de 2026"


def test_the_night_the_clocks_go_back_is_nine_hours_not_eight():
    """25 Oct 2026, Madrid: 22:00 to 06:00 is nine real hours.

    The browser counts this one in wall clock and says eight. The server counts
    elapsed time between two instants, which is what the person works and what
    the working-year figures already use -- so the email must not repeat the
    browser's answer.
    """
    who = ana()
    overnight = ShiftFact(
        employee_id=who,
        start_at=datetime(2026, 10, 24, 22, 0, tzinfo=MADRID_SUMMER),
        end_at=datetime(2026, 10, 25, 6, 0, tzinfo=MADRID_WINTER),
        unpaid_break_minutes=0,
    )

    message = only_message(changes_between([], [overnight]), who)

    assert "1 turno · 9 h en total" in message.text


def test_an_unpaid_break_comes_off_the_hours():
    who = ana()
    changes = changes_between([], [shift(who, 7, 9, 17, brk=30)])

    message = only_message(changes, who)

    assert "7,5 h" in message.text


def test_nobody_is_written_to_about_a_rota_that_did_not_change():
    who = ana()
    same = [shift(who, 7, 9, 17)]

    messages = compose(
        changes_between(same, same),
        {who: Recipient(employee_id=who, name="Ana", email="ana@example.com")},
        period_start=OCTOBER,
        org_name="Bar Vista",
    )

    assert messages == []


def test_somebody_with_no_way_to_be_reached_gets_no_message():
    """And, crucially, does not stop the people who can be reached."""
    reachable, unreachable = ana(), ana()
    changes = changes_between(
        [], [shift(reachable, 7, 9, 17), shift(unreachable, 7, 17, 23)]
    )

    messages = compose(
        changes,
        {
            reachable: Recipient(
                employee_id=reachable, name="Ana", email="ana@example.com"
            )
        },
        period_start=OCTOBER,
        org_name="Bar Vista",
    )

    assert [m.to for m in messages] == ["ana@example.com"]


def test_no_link_is_better_than_a_link_to_localhost():
    who = ana()
    messages = compose(
        changes_between([], [shift(who, 7, 9, 17)]),
        {who: Recipient(employee_id=who, name="Ana", email="ana@example.com")},
        period_start=OCTOBER,
        org_name="Bar Vista",
        app_base_url="",
    )

    assert "Tu horario completo" not in messages[0].text


def test_a_person_with_one_name_is_still_greeted():
    who = ana()
    message = only_message(changes_between([], [shift(who, 7, 9, 17)]), who, name="Ana")
    assert message.text.startswith("Hola Ana,")
