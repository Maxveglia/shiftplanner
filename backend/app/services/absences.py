from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from decimal import Decimal
from typing import List
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.absence import Absence
from app.models.absence_type import AbsenceType
from app.models.assignment import Assignment
from app.models.vacation_ledger import VacationLedger

log = logging.getLogger(__name__)

PUBLISHED = "published"
DRAFT = "draft"


def _duration_days(absence: Absence) -> Decimal:
    rng = absence.during
    lower = getattr(rng, "lower", None)
    upper = getattr(rng, "upper", None)
    if lower is None or upper is None:
        return Decimal("0")
    seconds = (upper - lower).total_seconds()
    days = math.ceil(seconds / 86400.0)
    if days < 1:
        days = 1
    return Decimal(days)


@dataclass(frozen=True)
class Cleared:
    """What approving took off the calendar.

    Returned rather than logged because it is the manager's next piece of
    work: hours that were covered a second ago are uncovered now, and the only
    person who can fix that is the one who just pressed Approve.
    """

    shifts: int
    hours: float
    published: int


def _paid_hours(row: Assignment) -> float:
    start, end = row.during.lower, row.during.upper
    minutes = (end - start).total_seconds() / 60.0
    return max(minutes - (row.unpaid_break_minutes or 0), 0.0) / 60.0


def clear_shifts_for(db: Session, absence: Absence) -> Cleared:
    """Take this person off the shifts their approved absence covers.

    WHY THIS EXISTS. Approving used to change a status and a balance and
    nothing else: the employee went on seeing the shift on their phone, the
    manager believed the matter settled, and the hours stayed on the rota with
    nobody behind them. Three people held three different beliefs about one
    Tuesday.

    WHICH SHIFTS. The ones that START inside the absence, which is how the
    rest of the product decides what day a shift belongs to. A shift that
    opens at 22:00 the night BEFORE and runs past midnight into the first day
    off is therefore kept -- the person worked that evening, and the generator
    would have placed it too (`availability.ts` blocks a DAY, and that night
    belongs to the day before).

    DRAFT SHIFTS GO TOO. A draft is the rota about to be published; leaving
    the shift there would hand the conflict straight back at publish time.

    The rows are DELETED rather than flagged. Nothing in the product reads a
    shift that is not on the calendar, and a status nobody renders is how the
    first version of this feature failed.
    """
    rows: List[Assignment] = list(
        db.execute(
            select(Assignment)
            .where(Assignment.org_id == absence.org_id)
            .where(Assignment.employee_id == absence.employee_id)
            .where(Assignment.status.in_([PUBLISHED, DRAFT]))
            .where(Assignment.during.op("&&")(absence.during))
        ).scalars()
    )
    lower, upper = absence.during.lower, absence.during.upper
    caught = [
        r
        for r in rows
        if lower is not None
        and upper is not None
        and lower <= r.during.lower < upper
    ]
    hours = sum(_paid_hours(r) for r in caught)
    published = sum(1 for r in caught if r.status == PUBLISHED)
    for row in caught:
        db.delete(row)
    if caught:
        db.flush()
        log.info(
            "absence %s approved: %d shift(s) cleared, %d of them published",
            absence.id,
            len(caught),
            published,
        )
    return Cleared(shifts=len(caught), hours=round(hours, 2), published=published)


def approve_absence(
    db: Session,
    absence: Absence,
    absence_type: AbsenceType,
    approver_id: UUID,
) -> Cleared:
    """Approve an absence: the status, the balance, and the calendar.

    The consumption is recorded as a NEGATIVE day amount so the balance is a
    straight SUM of the ledger. What comes back is what the CALENDAR lost,
    because that is the part the manager has to do something about.
    """
    absence.status = "approved"
    absence.approver_id = approver_id
    db.flush()

    if absence_type.consumes_balance:
        rng = absence.during
        effective = getattr(rng, "lower", None)
        db.add(
            VacationLedger(
                org_id=absence.org_id,
                employee_id=absence.employee_id,
                movement_type="consumption",
                days=-_duration_days(absence),
                effective_date=effective.date() if effective is not None else None,
                reason="Absence approved",
                source_absence_id=absence.id,
            )
        )
        db.flush()

    return clear_shifts_for(db, absence)


def drop_shifts_on_leave(db: Session, org_id: UUID, shifts):
    """The shifts in ``shifts`` that land on somebody's approved absence.

    Returns ``(keep, dropped)``. The rule is the one `clear_shifts_for` uses
    and the one the generator uses: a shift belongs to the day it STARTS on,
    and an approved absence covering that instant means the person is not
    there.

    WHY THIS GUARD EXISTS, on top of clearing the calendar at approval time.
    The manager's draft lives in their browser. Approving from the Absences
    page empties the shifts on the server, but a dashboard already open still
    holds its own copy -- so the next publish would put the absent person
    straight back on the rota and tell the team about it. Clearing is the
    tidy-up; this is the guarantee. A published rota cannot contain a shift
    for somebody the manager has signed off as away.
    """
    rows = list(
        db.execute(
            select(Absence.employee_id, Absence.during)
            .where(Absence.org_id == org_id)
            .where(Absence.status == "approved")
        )
    )
    if not rows:
        return list(shifts), []

    away = {}
    for employee_id, during in rows:
        away.setdefault(str(employee_id), []).append(during)

    keep, dropped = [], []
    for shift in shifts:
        spans = away.get(str(shift.employee_id))
        if spans and any(
            span.lower is not None
            and span.upper is not None
            and span.lower <= shift.start_at < span.upper
            for span in spans
        ):
            dropped.append(shift)
        else:
            keep.append(shift)
    if dropped:
        log.info(
            "publish: %d shift(s) refused, the person has approved time off",
            len(dropped),
        )
    return keep, dropped
