from __future__ import annotations

"""Publishing a schedule, keeping the draft, and reading either back.

The manager iterates on a draft; publishing is the moment it becomes a
commitment: it is written as intervals, marked ``published``, and from then on
it is what every employee sees and is paid for.

The draft is kept here too, as rows of the same table marked ``draft``, so that
the manager finds the same unfinished week on every browser they open. It is
still nobody's commitment: no employee read ever selects a draft row, and
nothing else in the product turns a draft into a published shift, so this is
the single place the manager -> employee handover happens.
"""

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select, text

# Range lives under the postgresql dialect, not at the top level of sqlalchemy
# (importing it from `sqlalchemy` raises ImportError on 2.0.52).
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.errors import detail
from app.models.assignment import Assignment
from app.models.shift_template import ShiftTemplate
from app.schemas.assignment import AssignmentOut, PublishIn, ShiftIn
from app.services.employees import live_ids
from app.services.publication_changes import (
    PublicationChanges,
    ShiftFact,
    changes_between,
)

PUBLISHED = "published"
DRAFT = "draft"


def naive_timestamps(*values: datetime) -> bool:
    """True if any timestamp arrives without a timezone offset.

    Shifts are stored as ``tstzrange``: instants, not wall-clock strings. A
    naive timestamp would have to be *guessed* into a zone, and guessing wrong
    moves somebody's shift by hours -- so we refuse it and say so, rather than
    assuming UTC and quietly telling an employee to come in at the wrong time.
    """
    return any(v.tzinfo is None or v.utcoffset() is None for v in values)


def _starts_within(start: datetime, end: datetime):
    """A shift belongs to the period it STARTS in.

    Not the periods it overlaps. An overnight shift on 30 September runs into
    1 October, but it is a September shift: publishing October must not delete
    it, listing October must not count its hours twice, and the manager's own
    draft prices it under the day it starts on. One rule, applied everywhere.
    """
    lower = func.lower(Assignment.during)
    return (lower >= start) & (lower < end)


# "2026-09-01T00:00:00 00:00" -- an offset whose "+" was eaten by query-string
# decoding, where "+" means space. Nothing else produces a bare space there.
_EATEN_PLUS = re.compile(r"\s(\d{2}:?\d{2})$")


def parse_aware_datetime(value: str) -> Optional[datetime]:
    """Parse an ISO-8601 instant from a query parameter. None if unusable.

    A "+" in a query string decodes to a space, so a client that correctly
    sends "...T00:00:00+00:00" is handed "...T00:00:00 00:00" by the time we
    see it. Rejecting that as "missing a timezone" would be telling them to fix
    something they already did right, so the space is put back -- it cannot
    have been anything but a "+" in that position.
    """
    text = _EATEN_PLUS.sub(r"+\1", value.strip())
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if not naive_timestamps(parsed) else None


def to_assignment_out(a: Assignment) -> AssignmentOut:
    rng = a.during
    return AssignmentOut(
        id=a.id,
        employee_id=a.employee_id,
        start_at=getattr(rng, "lower", None),
        end_at=getattr(rng, "upper", None),
        shift_template_id=a.shift_template_id,
        unpaid_break_minutes=a.unpaid_break_minutes,
        status=a.status,
        source=a.source,
        is_overtime=a.is_overtime,
        is_premium=a.is_premium,
        published_at=a.published_at,
    )


def _list_with_status(
    db: Session,
    org_id: UUID,
    status: str,
    start: datetime,
    end: datetime,
    employee_id: Optional[UUID] = None,
) -> List[Assignment]:
    """Shifts of one status starting in [start, end), optionally for one person.

    ``status`` is always given explicitly. A reader that forgot it would hand
    the draft to whoever asked, and the draft is the one thing an employee
    must never be shown.
    """
    stmt = (
        select(Assignment)
        .where(Assignment.org_id == org_id)
        .where(Assignment.status == status)
        # Nobody who has been taken off the roster stands in a rota, published
        # or drafted. Erasing the row used to delete their shifts outright (ON
        # DELETE CASCADE); a shift attributed to somebody the team no longer
        # has is worse than no shift, because somebody reads it and does not
        # turn up -- and a draft that still names them would be re-published
        # onto the team the moment the manager pressed the button.
        .where(Assignment.employee_id.in_(live_ids(org_id)))
        .where(_starts_within(start, end))
        .order_by(Assignment.during.asc())
    )
    if employee_id is not None:
        stmt = stmt.where(Assignment.employee_id == employee_id)
    return list(db.execute(stmt).scalars())


def list_published(
    db: Session,
    org_id: UUID,
    start: datetime,
    end: datetime,
    employee_id: Optional[UUID] = None,
) -> List[Assignment]:
    """Published shifts starting in [start, end), optionally for one person."""
    return _list_with_status(db, org_id, PUBLISHED, start, end, employee_id)


def list_draft(
    db: Session, org_id: UUID, start: datetime, end: datetime
) -> List[Assignment]:
    """The manager's unpublished shifts starting in [start, end).

    No per-employee narrowing, on purpose: the only caller is the manager's
    own screen, and offering the parameter would invite an employee-facing
    reader to use it one day.
    """
    return _list_with_status(db, org_id, DRAFT, start, end)


def list_marks(
    db: Session, org_id: UUID, start: datetime, end: datetime
) -> List[tuple]:
    """Every shift starting in [start, end), as (start_at, status) pairs.

    What the year grid is drawn from. It asks about twelve months at once, and
    a year of full assignments is megabytes of employees, costs and templates
    to decide the colour of 365 squares -- so this reads two columns and
    nothing else.

    Draft rows are included and kept apart by ``status``: a month drafted and
    not yet published is precisely the state the grid exists to make visible,
    and merging the two would let a finished-looking year hide a month the
    team has never seen.
    """
    rows = db.execute(
        select(Assignment.during, Assignment.status)
        .where(Assignment.org_id == org_id)
        .where(Assignment.status.in_([PUBLISHED, DRAFT]))
        .where(Assignment.employee_id.in_(live_ids(org_id)))
        .where(_starts_within(start, end))
        .order_by(Assignment.during.asc())
    ).all()
    return [(during.lower, status) for during, status in rows]


def validate_shifts(
    db: Session,
    org_id: UUID,
    shifts: Sequence[ShiftIn],
    period_start: datetime,
    period_end: datetime,
) -> Optional[Dict[str, Any]]:
    """Reject anything we would not be able to honour. Returns an error, or None.

    An error is the ``detail`` body of `app.errors`, ready to hand to an
    HTTPException: a code the client turns into a sentence in the manager's
    language, and the English one for everybody else. It used to be the English
    sentence alone, which is how "Unknown employee <uuid>" reached a Spanish
    screen.
    """
    if naive_timestamps(period_start, period_end):
        return detail(
            "naive_period",
            "period_start and period_end must include a timezone offset "
            "(e.g. 2026-09-01T00:00:00-04:00 or ...Z)",
        )
    if period_end <= period_start:
        return detail(
            "period_end_before_start", "period_end must be after period_start"
        )

    # Only people still on the roster can be given a shift. Publishing one for
    # somebody who was removed is rejected by name here rather than accepted
    # and then hidden by the read filter, which would silently drop shifts the
    # manager believes they published.
    known = set(db.execute(live_ids(org_id)).scalars())

    # And only this org's own shift templates. The check above is about a
    # person's data; this one is about a REFERENCE that crosses the tenant
    # border in the other direction, which is easy to miss because nothing
    # leaks when it happens.
    #
    # A payload naming another customer's template used to be stored exactly as
    # sent. The row itself stays inside this org -- RLS sees to that, and
    # `AssignmentOut` only ever echoes the id back, so the other customer's
    # name and colour never reach this screen. What was wrong is subtler: the
    # shift then DEPENDED on a row belonging to somebody else.
    # `assignment.shift_template_id` is ON DELETE SET NULL, so the day that
    # other business closed its account -- an action it takes alone, with no
    # idea this org exists -- these shifts would quietly lose their template
    # and start rendering as orphans. One tenant's rows must not be reachable
    # from another tenant's data in EITHER direction, and a foreign key is a
    # reach.
    #
    # No legitimate client is affected: the browser sends back only ids it read
    # from its own `/shift-templates`, and sends null for its placeholder
    # identities (see `frontend/src/lib/schedule/persist.ts`). There is no
    # endpoint that deletes a template, so an id that was this org's a moment
    # ago is still this org's now.
    known_templates = set(
        db.execute(
            select(ShiftTemplate.id).where(ShiftTemplate.org_id == org_id)
        ).scalars()
    )

    for shift in shifts:
        if (
            shift.shift_template_id is not None
            and shift.shift_template_id not in known_templates
        ):
            return detail(
                "unknown_shift_template",
                "Unknown shift template %s" % shift.shift_template_id,
                template=str(shift.shift_template_id),
            )
        if shift.employee_id not in known:
            return detail(
                "unknown_employee",
                "Unknown employee %s" % shift.employee_id,
                employee=str(shift.employee_id),
            )
        if naive_timestamps(shift.start_at, shift.end_at):
            return detail(
                "naive_shift_times",
                "Shift times must include a timezone offset "
                "(e.g. 2026-09-01T09:00:00-04:00 or ...Z)",
            )
        if shift.end_at <= shift.start_at:
            return detail("shift_ends_before_start", "A shift ends before it starts")
        # A shift is owned by the window it STARTS in. Overnight shifts may run
        # past period_end; one starting outside the window would survive the
        # replace and silently duplicate on the next publish.
        if not (period_start <= shift.start_at < period_end):
            return detail(
                "shift_outside_period", "A shift starts outside the published period"
            )
        if shift.unpaid_break_minutes < 0:
            return detail(
                "negative_break", "unpaid_break_minutes cannot be negative"
            )
    return None


def _shift_identity(shift) -> tuple:
    """What makes two shifts the same shift, to the person working it.

    Accepts either a stored ``Assignment`` (whose interval is a range) or an
    incoming ``ShiftIn`` (whose interval is two datetimes), because the point
    is to compare one against the other. The template is deliberately NOT part
    of it: renaming the template a shift was cut from changes nothing about
    when the employee is expected, and would reset their notice for nothing.
    """
    during = getattr(shift, "during", None)
    if during is not None:
        start, end = during.lower, during.upper
    else:
        start, end = shift.start_at, shift.end_at
    return (
        str(shift.employee_id),
        start,
        end,
        shift.unpaid_break_minutes,
    )


def parse_window(from_: str, to: str) -> tuple:
    """The [from, to) window of a listing, or a 422 that names the problem.

    One parser for every read of the table, so that the draft, the rota and
    the working year agree on what "this week" means -- the client asks for
    them with the same two strings and would be very confused by two answers.
    It lives here rather than in a router because it now has more than one.
    """
    window_start = parse_aware_datetime(from_)
    window_end = parse_aware_datetime(to)
    if window_start is None or window_end is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "naive_window",
                "'from' and 'to' must be ISO-8601 instants with a timezone "
                "offset (e.g. 2026-09-01T00:00:00-04:00 or ...Z)",
            ),
        )
    if window_end <= window_start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("window_end_before_start", "'to' must be after 'from'"),
        )
    return window_start, window_end


def _replace_window(
    db: Session,
    org_id: UUID,
    period_start: datetime,
    period_end: datetime,
    shifts: Sequence[ShiftIn],
    status: str,
    published_at: Optional[datetime],
    only_status: Optional[str],
) -> Tuple[int, int, datetime, PublicationChanges]:
    """Delete what starts in the window, insert ``shifts`` as ``status``.

    Delete-then-insert inside the caller's transaction: the team never sees a
    half-published week, and the overlap EXCLUDE constraint stays satisfiable
    because the old rows are gone before the new ones land.

    ``only_status`` decides what the delete reaches. Publishing passes None
    and sweeps everything, drafts included, because the rota it writes is the
    whole truth for that window. Saving a draft passes ``DRAFT`` and leaves
    the published rows exactly where the team is reading them.

    WHAT SURVIVES THE REPLACE: the moment a shift was first published.

    Delete-then-insert is the right shape for the rota and the wrong shape for
    a shift's history, because the row that comes back is a NEW row and knows
    nothing. That did not matter while ``published_at`` was only a timestamp on
    a receipt. It matters now that art. 34.2 ET measures notice from it: a
    manager who republishes October on the 14th to move one Tuesday would
    otherwise restamp all ninety-five other shifts as published that day, and
    every one of them inside the five-day notice would be reported as sprung on
    the team -- shifts that had been on the noticeboard for weeks.

    So a shift that is IDENTICAL to one already published in this window keeps
    the date it was published on. Identical means the whole of what an employee
    reads: the same person, the same start, the same end, the same unpaid
    break. Change any of those and it is a different shift, correctly stamped
    as announced today, which is exactly when notice is owed again.

    WHAT ELSE COMES BACK: who has to be told what.

    The two lists this function already holds -- what was on the noticeboard
    and what is going on it -- are the only place in the product where both
    exist at once, so the per-person difference is computed here and handed
    back rather than recovered later from a row that no longer remembers.
    See `publication_changes`. Saving a DRAFT answers an empty set: a draft
    was never announced, so nothing about it is news to anybody.
    """
    now = datetime.now(timezone.utc)

    # One writer per organization at a time. Two saves of the same window
    # racing each other -- a debounced PUT still on the wire when "New
    # calendar" sends an empty one, two browsers pausing at once -- would
    # otherwise each SELECT the rows of before, each delete those, and each
    # insert its own: the union of both, or a draft surviving the PUT meant
    # to clear it. The lock is transaction-scoped and released on commit.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:org))"), {"org": str(org_id)}
    )

    stmt = (
        select(Assignment)
        .where(Assignment.org_id == org_id)
        .where(_starts_within(period_start, period_end))
    )
    if only_status is not None:
        stmt = stmt.where(Assignment.status == only_status)
    existing = list(db.execute(stmt).scalars())

    # What was already on the noticeboard, keyed by everything an employee
    # reads off it. Only PUBLISHED rows are in here: a draft was never
    # announced, so it has no notice to preserve.
    announced = {
        _shift_identity(old): old.published_at
        for old in existing
        if old.status == PUBLISHED and old.published_at is not None
    }

    # Who has to be told what. Computed BEFORE the delete, from the rows that
    # are about to stop existing -- and only when the window is being
    # published, because nobody was ever told about a draft.
    if status == PUBLISHED:
        changes = changes_between(
            [
                ShiftFact(
                    employee_id=old.employee_id,
                    start_at=old.during.lower,
                    end_at=old.during.upper,
                    unpaid_break_minutes=old.unpaid_break_minutes,
                )
                for old in existing
                if old.status == PUBLISHED
            ],
            [
                ShiftFact(
                    employee_id=shift.employee_id,
                    start_at=shift.start_at,
                    end_at=shift.end_at,
                    unpaid_break_minutes=shift.unpaid_break_minutes,
                )
                for shift in shifts
            ],
        )
    else:
        changes = PublicationChanges(first_publication=False, employees=[])

    for old in existing:
        db.delete(old)
    db.flush()

    for shift in shifts:
        # An unchanged shift was announced when it was announced. A new or
        # edited one is announced now.
        first_announced = announced.get(_shift_identity(shift), published_at)
        db.add(
            Assignment(
                org_id=org_id,
                employee_id=shift.employee_id,
                shift_template_id=shift.shift_template_id,
                during=Range(shift.start_at, shift.end_at, bounds="[)"),
                unpaid_break_minutes=shift.unpaid_break_minutes,
                status=status,
                source=shift.source,
                computed_cost=shift.computed_cost,
                is_overtime=shift.is_overtime,
                is_premium=shift.is_premium,
                published_at=first_announced if published_at is not None else None,
            )
        )
    db.flush()
    return len(shifts), len(existing), now, changes


def publish(
    db: Session,
    org_id: UUID,
    period_start: datetime,
    period_end: datetime,
    shifts: Sequence[ShiftIn],
) -> Tuple[int, int, datetime, PublicationChanges]:
    """Replace the schedule for a window. Returns (published, replaced, at, changes).

    Every row that starts in the window goes, whatever its status: the draft
    the manager was editing is what they just approved, so once it is on the
    noticeboard there is nothing left to keep as "unpublished". The next read
    of the draft for this window comes back empty, and the client falls back
    to the rota.
    """
    now = datetime.now(timezone.utc)
    return _replace_window(
        db,
        org_id,
        period_start,
        period_end,
        shifts,
        status=PUBLISHED,
        published_at=now,
        only_status=None,
    )


def save_draft(
    db: Session, org_id: UUID, payload: PublishIn
) -> Tuple[int, int, datetime]:
    """Replace the draft for a window. Returns (saved, replaced, saved_at).

    Same shape as ``publish`` and the same validation before it -- a draft the
    server could not publish is a draft the manager should hear about now,
    not at the moment they press the button. But it touches ONLY draft rows:
    the published rota is the team's and stays untouched until publish. An
    empty ``shifts`` is a legitimate draft: it clears the window.
    """
    # The change set `_replace_window` returns is always empty for a draft --
    # nobody was ever told about one -- so it is dropped here rather than
    # handed to a caller who would have to know that it means nothing.
    saved, replaced, at, _ = _replace_window(
        db,
        org_id,
        payload.period_start,
        payload.period_end,
        payload.shifts,
        status=DRAFT,
        published_at=None,
        only_status=DRAFT,
    )
    return saved, replaced, at


def day_team(
    db: Session, org_id: UUID, employee_id: UUID, start: datetime, end: datetime
) -> Optional[List[tuple]]:
    """Who else is on, in a window the asker themself works.

    Returns ``None`` when the asker has no published shift in the window --
    which the router turns into a 403. That check is the permission itself, so
    it lives with the query rather than in the caller: sharing a shift with
    somebody is what entitles you to know they are there, and a day you have
    off tells you nothing about your own work.

    PUBLISHED ONLY. A draft belongs to the manager until they publish it, and
    an employee app that showed one would turn every plan into an announcement
    -- including the plans that get changed before anybody was meant to see
    them.
    """
    mine = db.execute(
        select(Assignment.id)
        .where(Assignment.org_id == org_id)
        .where(Assignment.employee_id == employee_id)
        .where(Assignment.status == PUBLISHED)
        .where(_starts_within(start, end))
        .limit(1)
    ).scalar_one_or_none()
    if mine is None:
        return None

    from app.models.employee import Employee

    rows = db.execute(
        select(
            Assignment.employee_id,
            Employee.full_name,
            Assignment.during,
            Assignment.unpaid_break_minutes,
        )
        .join(Employee, Employee.id == Assignment.employee_id)
        .where(Assignment.org_id == org_id)
        .where(Assignment.status == PUBLISHED)
        .where(Assignment.employee_id.in_(live_ids(org_id)))
        .where(_starts_within(start, end))
        .order_by(Assignment.during.asc())
    ).all()

    return [
        (emp_id, name, during.lower, during.upper, break_min)
        for emp_id, name, during, break_min in rows
    ]
