from __future__ import annotations

"""The email a person gets when their rota is published or changed.

WHAT IT IS FOR. Publishing a rota told nobody. The team found out by opening
the app, if they remembered to, which meant the product's central act -- a
manager approving a month of somebody's life -- reached that somebody only by
luck. This is the first channel out.

WHAT IT SAYS, and why that is the whole point. "El horario de octubre ha
cambiado" is noise by the second month and trains people to ignore the next
one. So the message is built from `publication_changes`: the first publication
of a window hands the person their rota, and every one after it names what
MOVED, for them, by day and by hour. A message somebody can act on without
opening anything.

IN SPANISH, said out loud. The product speaks two languages and the choice
lives in the browser -- there is no column anywhere that records which one a
given person reads (see `frontend/src/lib/locale.ts`). The server composes
this for somebody who is not here to be asked, so it uses the language of the
one market this product sells to, the same reasoning as `business_time`. When
a person's language becomes a stored fact, this file is where it is read.

PLAIN TEXT, not HTML. It is read on a phone, in a hurry, and often in a
preview pane; a table of shifts survives that and a layout does not. It also
cannot be the thing that lands the domain in a spam folder on day one.

THE HOURS ARE REAL ELAPSED TIME, not wall clock -- `end - start` over two
instants. On the night the clocks change that is 7 or 9 hours and not 8, which
is what the person actually works, and it is what the server's own working-year
figures use. The browser still counts that one in wall clock (a known
disagreement, see the audit); this side is the correct one.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID

from app.services.business_time import to_business_time
from app.services.mailer import Message
from app.services.publication_changes import (
    DayChange,
    PublicationChanges,
    ShiftFact,
)

log = logging.getLogger(__name__)

# Written out rather than taken from `locale`: the container's locale is C and
# setting a global one to format a date is a change with a much longer reach
# than this file.
_DAYS = ("lun", "mar", "mié", "jue", "vie", "sáb", "dom")
_MONTHS = (
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
)
_MONTHS_SHORT = (
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
)


@dataclass(frozen=True)
class Recipient:
    """Somebody who can be written to: a person with a login and an address."""

    employee_id: UUID
    name: str
    email: str


def _clock(instant: datetime) -> str:
    return to_business_time(instant).strftime("%H:%M")


def _range(shift: ShiftFact) -> str:
    return "%s–%s" % (_clock(shift.start_at), _clock(shift.end_at))


def _hours(shift: ShiftFact) -> float:
    worked = (shift.end_at - shift.start_at).total_seconds() / 3600.0
    return max(0.0, worked - shift.unpaid_break_minutes / 60.0)


def _hours_text(hours: float) -> str:
    # "7 h" and "7,5 h" -- the decimal comma the rest of the product uses.
    rounded = round(hours, 1)
    if abs(rounded - round(rounded)) < 0.05:
        return "%d h" % round(rounded)
    return ("%.1f h" % rounded).replace(".", ",")


def _day_label(change: DayChange) -> str:
    day = change.day
    return "%s %d %s" % (_DAYS[day.weekday()], day.day, _MONTHS_SHORT[day.month - 1])


def _first_name(full_name: str) -> str:
    return full_name.strip().split(" ")[0] if full_name.strip() else ""


def _month_label(period_start: datetime) -> str:
    local = to_business_time(period_start)
    return "%s de %d" % (_MONTHS[local.month - 1], local.year)


def _shift_line(change: DayChange) -> str:
    """One day, in the fewest words that still say what to do.

    The wording leads with the NEW fact, because that is the one the person has
    to act on; what it replaced goes in brackets so they can see it is the
    shift they had memorised and not a second one.
    """
    if change.kind == "added":
        after = change.after
        assert after is not None
        return "%s · %s (%s)" % (_day_label(change), _range(after), _hours_text(_hours(after)))
    if change.kind == "removed":
        before = change.before
        assert before is not None
        return "%s · ya no entras (antes %s)" % (_day_label(change), _range(before))
    before, after = change.before, change.after
    assert before is not None and after is not None
    return "%s · ahora %s (antes %s)" % (
        _day_label(change),
        _range(after),
        _range(before),
    )


def _body(
    recipient: Recipient,
    changes: List[DayChange],
    *,
    first_publication: bool,
    org_name: str,
    month: str,
    app_base_url: str,
) -> str:
    greeting = (
        "Hola %s," % _first_name(recipient.name)
        if _first_name(recipient.name)
        else "Hola,"
    )
    lines = [greeting, ""]

    if first_publication:
        total = sum(_hours(c.after) for c in changes if c.after is not None)
        lines.append("Ya tienes tu horario de %s en %s." % (month, org_name))
        lines.append("")
        lines.extend(_shift_line(c) for c in changes)
        lines.append("")
        lines.append(
            "%d turno%s · %s en total"
            % (len(changes), "" if len(changes) == 1 else "s", _hours_text(total))
        )
    else:
        count = len(changes)
        lines.append(
            "%s en tu horario de %s en %s:"
            % (
                "Ha cambiado 1 turno" if count == 1 else "Han cambiado %d turnos" % count,
                month,
                org_name,
            )
        )
        lines.append("")
        lines.extend(_shift_line(c) for c in changes)

    if app_base_url:
        lines.append("")
        lines.append("Tu horario completo: %s" % app_base_url.rstrip("/"))

    lines.append("")
    lines.append(
        "Recibes este correo porque trabajas en %s. "
        "Puedes desactivarlo desde tu horario, en Ajustes." % org_name
    )
    return "\n".join(lines)


def _subject(
    changes: List[DayChange], *, first_publication: bool, month: str
) -> str:
    if first_publication:
        return "Tu horario de %s" % month
    count = len(changes)
    if count == 1:
        return "Ha cambiado 1 turno de tu horario de %s" % month
    return "Han cambiado %d turnos de tu horario de %s" % (count, month)


def compose(
    changes: PublicationChanges,
    recipients: Dict[UUID, Recipient],
    *,
    period_start: datetime,
    org_name: str,
    app_base_url: str = "",
) -> List[Message]:
    """One message per person who changed AND can be written to.

    Somebody with no login, or who turned these off, is simply absent from
    ``recipients`` and gets no message. The caller counts them -- the manager
    needs to know the team was not fully reached, and finding that out from a
    log is finding it out too late.
    """
    month = _month_label(period_start)
    messages: List[Message] = []
    for employee in changes.employees:
        recipient = recipients.get(employee.employee_id)
        if recipient is None:
            continue
        messages.append(
            Message(
                to=recipient.email,
                subject=_subject(
                    employee.days,
                    first_publication=changes.first_publication,
                    month=month,
                ),
                text=_body(
                    recipient,
                    employee.days,
                    first_publication=changes.first_publication,
                    org_name=org_name,
                    month=month,
                    app_base_url=app_base_url,
                ),
            )
        )
    return messages


# --- Who can actually be written to -----------------------------------------
#
# The one part of this file that touches the database. Kept here rather than in
# the router because "who gets the email" is a question about the email, and
# splitting it across two files is how the answer and the message drift apart.
# `compose` above stays pure and stays the tested part.


@dataclass(frozen=True)
class Audience:
    """Who a publication can be announced to, and who it cannot.

    ``unreachable`` is the number that matters operationally and the reason
    this is a return value rather than a log line. A manager who publishes and
    is told "12 avisados" believes the team knows; one who is told "9 avisados,
    3 sin avisar" picks up a phone. The three are people with no login, or with
    no address on it, or who turned the email off -- and the product created
    the first of those itself, by requiring an address to make a login at all.
    """

    recipients: Dict[UUID, Recipient]
    unreachable: int


def audience_for(db, org_id: UUID, employee_ids: List[UUID]) -> Audience:
    """The people among ``employee_ids`` who can be emailed about their rota."""
    from sqlalchemy import select

    from app.models.employee import Employee
    from app.models.user_account import UserAccount
    from app.services.employees import LIVE

    if not employee_ids:
        return Audience(recipients={}, unreachable=0)

    rows = db.execute(
        select(
            Employee.id,
            Employee.full_name,
            Employee.notify_by_email,
            UserAccount.email,
            UserAccount.is_active,
        )
        .join(UserAccount, UserAccount.employee_id == Employee.id, isouter=True)
        .where(Employee.org_id == org_id)
        .where(LIVE)
        .where(Employee.id.in_(employee_ids))
    ).all()

    recipients: Dict[UUID, Recipient] = {}
    seen: set = set()
    for employee_id, full_name, wants_email, email, is_active in rows:
        seen.add(employee_id)
        if not wants_email or not email or not is_active:
            continue
        recipients[employee_id] = Recipient(
            employee_id=employee_id, name=full_name, email=email
        )

    # Anyone asked about and not found is unreachable too: a shift can be
    # published for somebody the manager removed from the roster in the same
    # sitting, and counting them as reached would be the exact lie this number
    # exists to prevent.
    return Audience(
        recipients=recipients,
        unreachable=len(set(employee_ids)) - len(recipients),
    )
