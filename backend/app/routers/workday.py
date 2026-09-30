from __future__ import annotations

"""The working year, read out of the database and handed to the pure engine.

This module does the fetching and nothing else. Every judgement lives in
`services/workday.py`, which never sees a Session -- the split matters because
without Postgres this repository skips 93 tests and still reports green, so a
rule that can only be exercised through a router is a rule that quietly stops
being tested.

WHY THE WHOLE YEAR IS READ. An annual average cannot be computed from the four
weeks on screen. Asked about October alone, somebody who has been running 30
hours light since March reads as perfectly on pace, because the window cannot
see the hole. So the window decides what is REPORTED and the year decides what
it is measured against.

WHY THE DRAFT COUNTS HERE AND NOT IN THE BALANCE. The two endpoints in this
file read the same rota and deliberately disagree about the draft, because
they answer different questions.

    GET /workday           "is the calendar I am about to publish lawful?"
    GET /workday/balances  "how many hours do I owe this person?"

The first is asked in order to DECIDE whether to publish, so it has to see the
draft: counting only the published rota would answer after the fact, and the
warning would arrive on the noticeboard, the one place it is too late to be
useful. Where a draft exists for a window it replaces the published rota
there, exactly as publishing would.

The second is what the manager plans AGAINST, so it must not see the draft: a
balance that moved as they dragged shifts would answer "am I giving her enough
hours?" differently every time they placed one. It settles on publish, and the
planner projects the draft on top of it from `published_in_window`.
"""

from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Dict, List, Optional, Sequence, Set, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_manager
from app.models.absence import Absence
from app.models.absence_type import AbsenceType
from app.models.assignment import Assignment
from app.models.contract import Contract
from app.models.employee import Employee
from app.schemas.assignment import ShiftIn
from app.schemas.auth import UserOut
from app.errors import detail
from app.schemas.workday import (
    BalanceOut,
    BalancesOut,
    EmployeeBalancesOut,
    EmployeeWorkdayOut,
    FindingOut,
    RecoveryCreditOut,
    WeekReportOut,
    WorkdayErrorOut,
    WorkdayOut,
)
from app.services import labour_floor
from app.services.employees import LIVE
from app.services.schedule import DRAFT, PUBLISHED, _shift_identity, parse_window
from app.services.workday import (
    AbsenceDay,
    ContractTerms,
    contract_pace_hours,
    effective_start,
    excused_days,
    month_bounds,
    overtime_cap,
    period_balance,
    quarter_bounds,
    quarter_of,
    RecoverableDay,
    written_through,
    WorkdayError,
    WorkdayLimits,
    WorkedShift,
    is_part_time,
    report,
    week_start,
)

router = APIRouter(prefix="/workday", tags=["workday"])

#: A standard day, for a day off belonging to a contract that states no week
#: at all. Anything that does state one is priced at a SEVENTH of it -- the
#: same figure the obligation charges for that calendar day, see
#: `_recoverable_days`.
_FALLBACK_DAY_HOURS = 8.0


def _day_in(moment: datetime, zone: Optional[ZoneInfo]) -> date:
    """Which DAY an instant falls on, in the zone the business lives in.

    WHY THIS IS NOT ``moment.date()``. Shifts are stored as instants, and
    Postgres hands them back in UTC. A shift that runs 18:00 to 02:00 in
    Phoenix is stored as 01:00 to 09:00 UTC, so its UTC date is TOMORROW: a
    31st-of-October evening shift lands in November, leaves October short and
    November long, and neither figure can be reconciled against anything the
    manager can see. The browser, meanwhile, has always grouped shifts by the
    LOCAL day -- so the draft on one side of the subtraction and the published
    rota on the other were being cut on two different days.

    Passing no zone keeps the old reading (whatever the instant already
    carries), because a caller that has not said where it is has not earned an
    opinion about which midnight it means.
    """
    return _moment_in(moment, zone).date()


def _moment_in(moment: datetime, zone: Optional[ZoneInfo]) -> datetime:
    """The same instant, read on the business's own clock."""
    return moment if zone is None else moment.astimezone(zone)


def _last_day_touched(upper: datetime, zone: Optional[ZoneInfo]) -> date:
    """The last calendar day a half-open range reaches into.

    A range that ends exactly at midnight ends where the previous day ends: it
    touches nothing of the day it names. A range that ends at any other time
    of day is INSIDE that day, and the day counts.

    This is the half of an absence that a straight ``(upper - lower).days``
    gets wrong, and it gets it wrong on the only shape that occurs in
    practice. The absence form is two `datetime-local` inputs, so real leave
    arrives as "5 October 09:00 to 9 October 17:00": four days by subtraction,
    five days off by every other reckoning, and the 9th silently still owing
    its hours.
    """
    local = _moment_in(upper, zone)
    if local.timetz().replace(tzinfo=None) == time.min:
        return local.date() - timedelta(days=1)
    return local.date()


def _zone(name: Optional[str]) -> Optional[ZoneInfo]:
    """The IANA zone by name, or a 422 that says which name failed."""
    if not name:
        return None
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            # ``bad_date`` rather than a code of its own, and deliberately: the
            # browser's dictionary translates it as "the app asked about a date
            # it had written wrongly", which is exactly what an unreadable zone
            # is -- the client picks it from `Intl`, never the user. A new code
            # with no sentence beside it in
            # frontend/src/lib/i18n/messages/errors.ts would fall back to
            # English on a Spanish screen, which is the bug the codes exist to
            # stop. Worth splitting out the day the dictionary has an entry.
            detail=detail(
                "bad_date",
                "'tz' must be an IANA timezone name (e.g. Europe/Madrid)",
            ),
        ) from None


def _jurisdiction(db: Session, org_id: UUID) -> str:
    from app.models.organization import Organization

    return (
        db.execute(
            select(Organization.jurisdiction_code).where(Organization.id == org_id)
        ).scalar_one_or_none()
        or ""
    )


def _paid_hours(row: Assignment) -> float:
    """The hours of one shift, break excluded -- what the employee is paid for."""
    start, end = row.during.lower, row.during.upper
    minutes = (end - start).total_seconds() / 60.0
    return max(minutes - (row.unpaid_break_minutes or 0), 0.0) / 60.0


def _shifts_for_year(
    db: Session,
    org_id: UUID,
    year_start: datetime,
    year_end: datetime,
    zone: Optional[ZoneInfo] = None,
) -> List[Assignment]:
    """The published rota for the year, with the draft laid over it.

    Overlaid per WINDOW rather than per shift, because that is what publishing
    does: a draft replaces the whole of the window it was saved for, so a day
    the manager has emptied in the draft must read as empty here too. Merging
    shift by shift would leave yesterday's published shifts standing
    underneath the draft that deleted them.

    THE WINDOW IS THE DRAFT'S OWN SPAN -- first drafted day to last -- and not
    the weeks it touches. It used to be the weeks, which was close enough
    while a week started on Sunday and the window that mattered was a November
    that happened to start on one. It is not close enough in general: a draft
    for November laid over Monday weeks reached back into the week of the 26th
    of October and hid six days of PUBLISHED rota that the draft never
    replaced, so a perfectly planned month read 34 hours short.
    """
    rows = list(
        db.execute(
            select(Assignment)
            .where(Assignment.org_id == org_id)
            .where(Assignment.status.in_([PUBLISHED, DRAFT]))
            .where(Assignment.employee_id.in_(select(Employee.id).where(LIVE)))
            .where(Assignment.during.op("&&")(_range(year_start, year_end)))
        ).scalars()
    )

    # Which day a shift belongs to, on the business's own clock: a shift that
    # opens at 23:00 on a Saturday in Madrid is a Sunday shift in UTC, and
    # deciding "has this day been drafted over?" on the wrong side of midnight
    # would let a published shift survive underneath the draft that replaced
    # it -- or delete one the draft never touched.
    drafted_days = [
        _day_in(r.during.lower, zone) for r in rows if r.status == DRAFT
    ]
    if not drafted_days:
        return rows
    opened, closed = min(drafted_days), max(drafted_days)
    return [
        r
        for r in rows
        if r.status == DRAFT or not (opened <= _day_in(r.during.lower, zone) <= closed)
    ]


def _range(start: datetime, end: datetime):
    from psycopg.types.range import Range

    return Range(start, end, bounds="[)")


def _contract_terms(db: Session, org_id: UUID) -> Dict[UUID, ContractTerms]:
    """Each live employee's open contract, as the hours rules read it.

    The whole agreement rather than one number, because art. 35.1 measures an
    extra hour against the contracted day and art. 12.5 measures a
    complementary one against the pact -- and the pact lives on the contract
    too. Fetching only the hours is how the pact used to be invisible.
    """
    rows = db.execute(
        select(
            Contract.employee_id,
            Contract.min_hours_per_week,
            Contract.max_hours_per_week,
            Contract.complementary_pct,
        )
        .where(Contract.org_id == org_id)
        .where(Contract.valid_to.is_(None))
    ).all()
    out: Dict[UUID, ContractTerms] = {}
    for employee_id, minimum, maximum, pct in rows:
        # The maximum where the contract states one, else the minimum: a
        # contract that says "20 hours" and nothing else means twenty. The same
        # reading `contractedHours` makes on the client.
        hours = maximum if maximum is not None else minimum
        out[employee_id] = ContractTerms(
            weekly_hours=float(hours or 0),
            complementary_pct=float(pct) if pct is not None else None,
            # Every contract this product holds is open-ended: it has no field
            # for a term and no way to end one but closing it. Said out loud
            # because it is what lets the voluntary hours of art. 12.5.g be
            # offered, and the day a fixed-term contract exists here this is
            # the line that has to stop assuming.
            open_ended=True,
        )
    return out


def _contract_starts(db: Session, org_id: UUID) -> Dict[UUID, date]:
    """When each open contract began. Part of where a balance starts counting.

    Somebody hired in June does not owe the five months before they were
    employed, and counting from January said they did -- which is half of how
    a roster came to show four people 1,480 hours behind.
    """
    rows = db.execute(
        select(Contract.employee_id, Contract.valid_from)
        .where(Contract.org_id == org_id)
        .where(Contract.valid_to.is_(None))
    ).all()
    return {employee_id: valid_from for employee_id, valid_from in rows}


def _first_published_day(
    db: Session, org_id: UUID, zone: Optional[ZoneInfo] = None
) -> Optional[date]:
    """The first day this business ever published a rota for.

    The other half. A balance can only count what this product could see, and
    before the first published calendar there is no record to count -- so a
    business that started publishing in September must not be charged with
    January to August. It is also what makes the cycle a cycle: hours start
    accruing the day the first rota goes up and run to the 31st of December.

    Read from the published shifts rather than from a "we went live" flag
    because it is the same fact and nobody has to remember to set it.
    """
    row = db.execute(
        select(Assignment.during)
        .where(Assignment.org_id == org_id)
        .where(Assignment.status == PUBLISHED)
        .order_by(Assignment.during.asc())
        .limit(1)
    ).scalar_one_or_none()
    # In the business's own zone, like every other date this module produces:
    # a cycle that opens on the 1st of October everywhere else must not open
    # on the 30th of September here because the first shift was an evening one.
    return _day_in(row.lower, zone) if row is not None else None


def _excused_weeks(absences: List[AbsenceDay]) -> Dict[UUID, List[date]]:
    """Weeks each person was away, whatever the reason.

    Handed to `report` so a fortnight of annual leave is not read as rest given
    in exchange for August's extra hours. Art. 35.1 compensates an extra hour
    with time off granted FOR it; holiday was owed anyway, and letting it
    answer overtime would quietly empty the 80-hour cap every summer.

    Every kind of leave, recoverable or not -- this is about what a week's
    missing hours MEAN, and a day worked back is just as much not-a-reward as
    a day of holiday.
    """
    out: Dict[UUID, List[date]] = {}
    for absence in absences:
        out.setdefault(UUID(absence.employee_id), []).append(
            week_start(absence.day)
        )
    return out


def _absence_days(
    db: Session,
    org_id: UUID,
    year_start: datetime,
    year_end: datetime,
    zone: Optional[ZoneInfo] = None,
) -> List[AbsenceDay]:
    """Every approved day off, one row per calendar day, with its kind.

    ONE READ FOR BOTH THINGS THE HOURS RULES DO WITH AN ABSENCE. The working
    year needs to know which days are worked back (`_recoverable_days`), and
    the balance needs to know which days owe nothing at all -- and those are
    the same rows read twice. Fetching them twice is how the two answers would
    one day disagree about the same fortnight in August.

    EVERY CALENDAR DAY THE ABSENCE TOUCHES, which is not the same as the
    number of 24-hour periods it lasts. `during` is half-open, so leave
    recorded midnight-to-midnight from the 5th to the 10th is the 5th to the
    9th -- but leave recorded through the form, which is two `datetime-local`
    inputs, arrives as "5 October 09:00 to 9 October 17:00" and covers five
    days rather than four. Subtracting the ends drops the last one; see
    `_last_day_touched`. A zero-width row still counts as the day it opens on,
    because somebody recorded a day off and meant one.
    """
    rows = db.execute(
        select(Absence.employee_id, Absence.during, AbsenceType.is_recoverable)
        .join(AbsenceType, Absence.absence_type_id == AbsenceType.id)
        .where(Absence.org_id == org_id)
        .where(Absence.status == "approved")
        .where(Absence.during.op("&&")(_range(year_start, year_end)))
    ).all()

    out: List[AbsenceDay] = []
    for employee_id, during, is_recoverable in rows:
        first = _day_in(during.lower, zone)
        last = max(_last_day_touched(during.upper, zone), first)
        for offset in range((last - first).days + 1):
            out.append(
                AbsenceDay(
                    employee_id=str(employee_id),
                    day=first + timedelta(days=offset),
                    recoverable=bool(is_recoverable),
                )
            )
    return out


def _recoverable_days(
    absences: List[AbsenceDay], terms: Dict[UUID, ContractTerms]
) -> List[RecoverableDay]:
    """Approved days off of a kind whose hours are worked back, priced.

    ONE PRICE FOR A CALENDAR DAY, AND IT IS THE ONE THE OBLIGATION CHARGES:
    a seventh of the contracted week. The same figure `contract_pace_hours`
    takes off for a day of leave, and it has to be the same figure or the
    recovery circuit invents hours out of nothing.

    Spanish leave is counted in CALENDAR days -- the hospitality convenio
    grants thirty of them, not twenty-two working ones -- so the calendar day
    is the unit this product prices, and a week is seven of them however many
    the rota puts shifts on. Dividing by five instead, which is what this did
    until now, made one day off worth 8 hours of debt against 5.71 hours of
    obligation: recover the day and the employee has handed back 2.29 hours
    that were never owed, which turn up later as ordinary hours nobody can
    account for. Divide by seven and a recovered day returns exactly what it
    generated -- no more, and no fewer.

    Only a contract that states no week at all falls back to a standard day,
    because there is nothing left to guess with; nothing is judged against
    such a contract anyway (see ``judged`` in `services/workday.py`).
    """
    out: List[RecoverableDay] = []
    for absence in absences:
        if not absence.recoverable:
            continue
        contract = terms.get(UUID(absence.employee_id))
        per_day = (
            ((contract.weekly_hours / 7.0) if contract else 0.0)
            or _FALLBACK_DAY_HOURS
        )
        out.append(
            RecoverableDay(
                employee_id=absence.employee_id,
                day=absence.day,
                hours=per_day,
            )
        )
    return out


def _limits(floor: labour_floor.LabourFloor) -> WorkdayLimits:
    """Every figure the engine judges by, read out of the rules table once.

    One builder for both endpoints. Two of them drifting apart is how the
    roster and the working-year view would end up disagreeing about the same
    person on two screens of the same product.
    """
    return WorkdayLimits(
        weekly_average_hours=floor.weekly_average_hours,
        annual_hours=floor.annual_hours,
        irregular_pct=floor.irregular_pct,
        irregular_notice_days=floor.irregular_notice_days,
        max_daily_hours=floor.max_daily_hours,
        min_rest_hours=floor.min_rest_hours,
        annual_overtime_cap=floor.annual_overtime_cap,
        overtime_compensation_months=floor.overtime_compensation_months,
        part_time_overtime_allowed=floor.part_time_overtime_allowed,
        complementary_min_weekly=floor.complementary_min_weekly,
        complementary_pct_max=floor.complementary_pct_max,
        complementary_pct_max_by_agreement=(
            floor.complementary_pct_max_by_agreement
        ),
        voluntary_complementary_pct=floor.voluntary_complementary_pct,
        complementary_notice_days=floor.complementary_notice_days,
    )


# --- the working year, asked by `publish` ---------------------------------

#: The figure each cumulative finding is measured by. These findings are a
#: LEDGER: once somebody is past the 80-hour cap, `report` repeats it every
#: week after, and the first week it is asked about absorbs everything that
#: came before it. Neither is the publication's doing. So a cumulative finding
#: is the publication's only when publishing makes this figure WORSE than the
#: year as it stands -- somebody who went past the cap in September and works
#: their contract to the minute in October has not been given an extra hour
#: by October's rota, and a publish refused over it would refuse a lawful
#: month.
_MEASURED_BY: Dict[str, str] = {
    "overtime_cap_exceeded": "worked",
    "complementary_cap_exceeded": "worked",
    "complementary_without_pact": "hours",
    "complementary_contract_too_short": "hours",
    "irregular_share_exceeded": "moved",
}


def law_if_published(
    db: Session,
    org_id: UUID,
    shifts: Sequence[ShiftIn],
    *,
    period_start: datetime,
    period_end: datetime,
    zone: tzinfo,
    floor: labour_floor.LabourFloor,
    now: Optional[datetime] = None,
) -> Tuple[List[WorkdayError], Dict[str, Dict[date, float]]]:
    """What the working year would say about this rota, were it published.

    `rota_law` judges the shifts in front of it; the rules that live HERE --
    the 80-hour cap, the complementary hours of a part-timer, the 10 % the
    year may move around, the five days of notice -- can only be judged
    against the whole year, and they used to be judged only on the working-
    year tab, which nobody has to open in order to publish. This is the same
    engine that tab uses, asked the same question from the publish side.

    THE YEAR AS PUBLISHING WOULD LEAVE IT: the published rota
    minus every shift that starts inside the window being replaced (what
    `_replace_window` deletes), plus the payload. Not the saved draft: the
    payload IS what is being published, and the draft on the server may be a
    keystroke behind it. A payload shift identical to one already on the
    noticeboard keeps the day it was announced, exactly as `_replace_window`
    keeps it; anything new or changed is announced ``now``.

    Returns the findings this publish is responsible for, one per rule and
    person (the earliest) -- a cumulative one only where it is worse than it
    stood the week before the window -- and each person's overtime per week,
    which `rota_law` needs for a rule of its own: a night worker may do none.
    """
    limits = _limits(floor)
    if (
        limits.weekly_average_hours is None
        and limits.annual_overtime_cap is None
        and limits.irregular_notice_days is None
        and limits.complementary_pct_max is None
        and limits.complementary_pct_max_by_agreement is None
    ):
        # Nothing seeded that this engine judges by: say nothing, as
        # `rota_law` says nothing for a jurisdiction with an empty floor.
        return [], {}

    now = now or datetime.now(timezone.utc)
    today = _day_in(now, zone)
    first_day = _day_in(period_start, zone)
    last_day = _day_in(period_end - timedelta(microseconds=1), zone)
    wanted = {str(s.employee_id) for s in shifts}
    if not wanted or last_day < first_day:
        return [], {}

    live = {
        str(employee_id)
        for employee_id in db.execute(
            select(Employee.id).where(Employee.org_id == org_id).where(LIVE)
        ).scalars()
    }
    terms = _contract_terms(db, org_id)
    contract_starts = _contract_starts(db, org_id)
    first_published = _first_published_day(db, org_id, zone)

    def replaced(row: Assignment) -> bool:
        return period_start <= row.during.lower < period_end

    def worked(row: Assignment) -> WorkedShift:
        return WorkedShift(
            employee_id=str(row.employee_id),
            day=_day_in(row.during.lower, zone),
            hours=_paid_hours(row),
            published_at=row.published_at,
        )

    findings: Dict[Tuple[str, str], WorkdayError] = {}
    added_overtime: Dict[str, Dict[date, float]] = {}

    # A window across New Year is two reference periods, each judged whole.
    for year in range(first_day.year, last_day.year + 1):
        year_start = datetime.combine(date(year, 1, 1), time.min, tzinfo=zone)
        year_end = datetime.combine(date(year + 1, 1, 1), time.min, tzinfo=zone)

        published = list(
            db.execute(
                select(Assignment)
                .where(Assignment.org_id == org_id)
                .where(Assignment.status == PUBLISHED)
                .where(Assignment.employee_id.in_(select(Employee.id).where(LIVE)))
                .where(Assignment.during.op("&&")(_range(year_start, year_end)))
            ).scalars()
        )
        announced = {
            _shift_identity(r): r.published_at
            for r in published
            if replaced(r) and r.published_at is not None
        }
        as_it_stands = [worked(r) for r in published]
        as_published = [worked(r) for r in published if not replaced(r)]
        # Who already had this window on the noticeboard: for them the year as
        # it stands is a written year, and the honest baseline (see below).
        republished = {str(r.employee_id) for r in published if replaced(r)}
        # The days this publish ANNOUNCES something on -- new or changed
        # shifts. A shift carried over unchanged keeps the day it was first
        # announced, and whatever notice it was given then is not this
        # publish's doing.
        announced_now: Set[Tuple[str, date]] = set()
        for s in shifts:
            day = _day_in(s.start_at, zone)
            if day.year != year:
                continue
            minutes = (s.end_at - s.start_at).total_seconds() / 60.0
            told = announced.get(_shift_identity(s))
            if told is None:
                announced_now.add((str(s.employee_id), day))
            as_published.append(
                WorkedShift(
                    employee_id=str(s.employee_id),
                    day=day,
                    hours=max(minutes - (s.unpaid_break_minutes or 0), 0.0) / 60.0,
                    published_at=told or now,
                )
            )

        absences = _absence_days(db, org_id, year_start, year_end, zone)
        recoverable = _recoverable_days(absences, terms)
        excused = _excused_weeks(absences)

        opens = max(first_day, date(year, 1, 1))
        closes = min(last_day, date(year, 12, 31))
        weeks: List[date] = []
        cursor = week_start(opens)
        while cursor <= closes:
            weeks.append(cursor)
            cursor = cursor + timedelta(days=7)

        # THE BASELINE -- what each cumulative figure stood at before this
        # publish -- is read one of two ways, because "the year as it stands"
        # means two different things.
        #
        # Where the window is ALREADY PUBLISHED for this person, it is that
        # year, week by week: the same weeks run over the rota before and
        # after. That is the only reading that notices a republish removing
        # the short weeks that were compensating August's overtime (art.
        # 35.1) -- the week before the window cannot, because compensation is
        # counted from rest that comes AFTER the overtime.
        #
        # Where the window is NEW, the year as it stands has it EMPTY, and
        # `report` reads an unwritten month as a month of rest: a month worked
        # to contract would then look like it had taken somebody back over the
        # cap. So the baseline is the week BEFORE the window, from the same
        # run. It also absorbs the year so far, which the first week asked
        # about otherwise carries as if it had worked it all itself.
        prior = weeks[0] - timedelta(days=7) if weeks else None
        if prior is not None and prior < week_start(date(year, 1, 1)):
            prior = None
        asked = ([prior] if prior is not None else []) + weeks
        # Publishing a window that begins before anything else moves the
        # first published day back to it -- the reading `GET /workday` makes.
        cycle = (
            first_day if first_day < (first_published or date.max)
            else first_published
        )

        def measured(rows, week: date) -> Dict[str, float]:
            out: Dict[str, float] = {}
            for row in rows:
                if row.week_start != week:
                    continue
                for err in row.errors:
                    measure = _MEASURED_BY.get(err.rule)
                    if measure is not None:
                        out[err.rule] = max(
                            out.get(err.rule, 0.0), err.detail.get(measure, 0.0)
                        )
            return out

        for employee_id in sorted(wanted & live):
            key = UUID(employee_id)

            def run(year_shifts: List[WorkedShift], opened: Optional[date]):
                return report(
                    employee_id=employee_id,
                    contract=terms.get(key, ContractTerms(weekly_hours=0.0)),
                    shifts=year_shifts,
                    recoverable=recoverable,
                    limits=limits,
                    weeks=asked,
                    year_start=effective_start(
                        date(year, 1, 1), opened, contract_starts.get(key)
                    ),
                    excused_weeks=excused.get(key, ()),
                    year_end=date(year + 1, 1, 1),
                    unworked_days=excused_days(absences, employee_id),
                )

            rows = run(as_published, cycle)
            before = (
                run(as_it_stands, first_published)
                if employee_id in republished
                else None
            )
            from_prior = measured(rows, prior) if prior is not None else {}

            for row in rows:
                if row.week_start == prior:
                    continue
                if row.overtime_hours > 0:
                    added_overtime.setdefault(employee_id, {})[
                        row.week_start
                    ] = row.overtime_hours
                baseline = (
                    measured(before, row.week_start)
                    if before is not None
                    else from_prior
                )
                for err in row.errors:
                    if err.rule == "short_notice" and not (
                        (employee_id, err.day) in announced_now
                        and first_day <= err.day <= last_day
                        and err.day >= today
                    ):
                        # Notice is owed for a shift still to come, and only
                        # for what this publish ANNOUNCES. Correcting the
                        # record of a day already worked, or carrying over a
                        # shift that was announced before, springs nothing on
                        # anybody.
                        continue
                    if (
                        err.rule == "complementary_pact_above_statute"
                        and row.complementary_hours <= 0
                    ):
                        # A pact above the legal share is a flaw in the
                        # CONTRACT, reported on the working-year tab every
                        # week. A rota becomes party to it only when it
                        # actually hands this person complementary hours.
                        continue
                    measure = _MEASURED_BY.get(err.rule)
                    if measure is not None and err.detail.get(
                        measure, 0.0
                    ) <= baseline.get(err.rule, -1.0) + 0.005:
                        continue
                    seen = findings.get((err.rule, employee_id))
                    if seen is None or err.day < seen.day:
                        findings[(err.rule, employee_id)] = err

    ordered = sorted(findings.values(), key=lambda e: (e.day, e.rule, e.employee_id))
    return ordered, added_overtime


@router.get("", response_model=WorkdayOut)
def workday(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    tz: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> WorkdayOut:
    """The working year for the weeks on screen.

    ``tz`` is where the business is, as an IANA name, and it decides which DAY
    each shift and each day of leave belongs to. It is the SAME parameter
    `/workday/balances` takes, and it is here for the same reason the two
    endpoints share `_limits`: these two screens describe one person, and a
    shift that starts at 23:00 on a Saturday in Madrid is a Saturday shift on
    one of them and a Sunday shift on the other if only one of them is told
    where the business is. Two answers about the same Saturday is the bug this
    whole module keeps being rewritten to stop.

    Without it the day is the UTC one -- what this endpoint has always done,
    and what every caller that has not said where it is still gets.
    """
    zone = _zone(tz)
    window_start, window_end = parse_window(from_, to)

    floor = labour_floor.floor_for(db, _jurisdiction(db, current_user.org_id))
    limits = _limits(floor)

    # The calendar year the window opens in, opening at midnight on the
    # business's own clock. A convenio may set its own reference period, and
    # when one does this is where it will be read from -- until then the
    # statute's default is the year.
    span_tz = zone if zone is not None else timezone.utc
    window_from = _day_in(window_start, zone)
    year_start = datetime.combine(
        date(window_from.year, 1, 1), time.min, tzinfo=span_tz
    )
    year_end = datetime.combine(
        date(window_from.year + 1, 1, 1), time.min, tzinfo=span_tz
    )

    employees = list(
        db.execute(
            select(Employee)
            .where(Employee.org_id == current_user.org_id)
            .where(LIVE)
            .order_by(Employee.full_name)
        ).scalars()
    )
    terms = _contract_terms(db, current_user.org_id)
    contract_starts = _contract_starts(db, current_user.org_id)
    cycle_start = _first_published_day(db, current_user.org_id, zone)
    # The cycle as it WOULD start if the window on screen were published --
    # word for word what `/workday/balances` does, and it has to be word for
    # word or the two screens open the cycle on different days and disagree by
    # however many days lie between them. This view lays the DRAFT over the
    # rota, so it is answering the same "if you publish" question, and
    # publishing a window that begins before anything else moves the first
    # published day back to it.
    if window_from < (cycle_start or date.max):
        cycle_start = window_from
    rows = _shifts_for_year(
        db, current_user.org_id, year_start, year_end, zone
    )
    absences = _absence_days(
        db, current_user.org_id, year_start, year_end, zone
    )
    recoverable = _recoverable_days(absences, terms)
    excused = _excused_weeks(absences)

    shifts = [
        WorkedShift(
            employee_id=str(r.employee_id),
            day=_day_in(r.during.lower, zone),
            hours=_paid_hours(r),
            published_at=r.published_at,
        )
        for r in rows
    ]

    # Every Sunday the requested window touches.
    weeks: List[date] = []
    cursor = week_start(window_from)
    while cursor < _day_in(window_end, zone):
        weeks.append(cursor)
        cursor = cursor + timedelta(days=7)

    def _group(errors) -> List[FindingOut]:
        """One entry per rule: first date, latest numbers, how many weeks.

        Ungrouped, a part-timer over their contract every week filled a column
        with twenty-six copies of one sentence. The first date is what decides
        whether something has to be put right retroactively; the latest detail
        is the figure that matters, because these findings accumulate.
        """
        seen: Dict[str, FindingOut] = {}
        for err in errors:
            prev = seen.get(err.rule)
            if prev is None:
                seen[err.rule] = FindingOut(
                    rule=err.rule, day=err.day, detail=err.detail, count=1
                )
            else:
                seen[err.rule] = FindingOut(
                    rule=err.rule,
                    day=min(prev.day, err.day),
                    detail=err.detail if err.day >= prev.day else prev.detail,
                    count=prev.count + 1,
                )
        return sorted(seen.values(), key=lambda f: (f.day, f.rule))

    # The span the summary covers: WHOLE WEEKS, so that the hours and what the
    # contract asks for are measured over the same days. Measuring the hours by
    # week and the obligation by the requested window would disagree by however
    # much of a week the window cuts through -- and the window almost always
    # cuts through one, since a month rarely starts on a Sunday.
    period_from = min(weeks) if weeks else window_from
    period_to = (
        (max(weeks) + timedelta(days=7)) if weeks else _day_in(window_end, zone)
    )

    # AND HOW MUCH OF THOSE WEEKS ANYBODY HAS ACTUALLY WRITTEN. Rounding the
    # period out to whole weeks is right for the hours -- see above -- but it
    # is not right for the contract, because the week it rounds into is
    # usually a week nobody has planned yet. Asked about November, which is
    # five Sundays wide, this view measured to the 6th of December: 35 days of
    # contract, 200 hours, against a November of 171.43. The 28.57 hours of
    # "shortfall" were the five days of December nobody had written, and the
    # same person read 0 h in the balance column one click away.
    #
    # So the summary stops where the calendar stops, exactly as the balance
    # column does: the SAME `written_through`, anchored the same way -- on the
    # window being edited, which is written by definition -- and clamped to the
    # weeks on screen. What is left over is reported as `period_pending`, work
    # still to plan rather than hours somebody is short of.
    #
    # The rota read here has the DRAFT laid over it (`_shifts_for_year`), and
    # that is deliberate: this view answers "is the calendar I am about to
    # publish lawful?", so a drafted November is a November somebody has
    # written. The balance column, which must not see the draft, reaches the
    # same horizon from the published side.
    reach = min(max(_day_in(window_end, zone), period_from), period_to)
    period_measured_to = max(
        min(written_through(shifts, reach, period_to), period_to), period_from
    )

    summary: List[EmployeeWorkdayOut] = []
    out: List[WeekReportOut] = []
    for employee in employees:
        contract = terms.get(employee.id, ContractTerms(weekly_hours=0.0))
        # Where the reference period opens for THIS person. The same three
        # boundaries the balance column uses, and for the same reason: before
        # the first published rota there is no record to judge, and before the
        # contract there was no obligation. Counting from January regardless
        # reported everybody a thousand hours behind on hours that accrued
        # before this product had a calendar -- and made this view contradict
        # the balance beside it about the same person.
        person_year_start = effective_start(
            year_start.date(), cycle_start, contract_starts.get(employee.id)
        )
        # The days this person owes nothing for: approved leave that is not
        # worked back. The PACE is what they come off -- see
        # `contract_pace_hours` -- and they are the same set the balance
        # column subtracts, so the two screens cannot disagree about a
        # fortnight in August.
        unworked = excused_days(absences, str(employee.id))
        # Kept, not consumed: the same rows feed the weekly detail below and
        # the one-line summary after it, so the two cannot drift apart.
        person_rows = report(
            employee_id=str(employee.id),
            contract=contract,
            shifts=shifts,
            recoverable=recoverable,
            limits=limits,
            weeks=weeks,
            year_start=person_year_start,
            excused_weeks=excused.get(employee.id, ()),
            year_end=year_end.date(),
            unworked_days=unworked,
        )
        for row in person_rows:
            out.append(
                WeekReportOut(
                    employee_id=employee.id,
                    employee_name=employee.full_name,
                    week_start=row.week_start,
                    week_hours=row.week_hours,
                    annual_hours_to_date=row.annual_hours_to_date,
                    deviation_vs_average=row.deviation_vs_average,
                    contracted_weekly=contract.weekly_hours,
                    part_time=is_part_time(contract, limits),
                    overtime_cap=overtime_cap(
                        limits,
                        contract,
                        # The same proportion `report` judges by, so the cap on
                        # screen is the cap that fired.
                        min(
                            max((year_end.date() - person_year_start).days, 1)
                            / 365.0,
                            1.0,
                        ),
                    ),
                    recovery_hours=row.recovery_hours,
                    irregular_hours=row.irregular_hours,
                    overtime_hours=row.overtime_hours,
                    complementary_hours=row.complementary_hours,
                    compensated_hours=row.compensated_hours,
                    errors=[
                        WorkdayErrorOut(
                            rule=e.rule,
                            day=e.day,
                            employee_id=employee.id,
                            detail=e.detail,
                        )
                        for e in row.errors
                    ],
                    recovery_credits=[
                        RecoveryCreditOut(
                            week=c.week, day_off=c.day_off, hours=c.hours
                        )
                        for c in row.recovery_credits
                    ],
                )
            )

        # One line for what those weeks add up to. Built here, from the same
        # rows, so the summary and the detail can never disagree.
        person_from = max(period_from, person_year_start)
        # THE PACE, and the same call the planner's balance column makes. This
        # is the line "SI PUBLICAS" is read against on the other screen, and
        # the two used to be computed by different functions: the annual
        # figure here, prorated by days, said a 40-hour contract asked for
        # 151.4 hours in October while the generator planned it 177. Everybody
        # on the roster came out +15 to +46 hours over, having worked their
        # contract to the minute.
        person_to = max(person_from, period_measured_to)
        person_expected = contract_pace_hours(
            limits, contract.weekly_hours, person_from, person_to, unworked
        )
        # The rest of the weeks on screen, which nobody has written yet. Sent
        # beside the deviation and never inside it: "quedan 28,6 h por
        # planificar" and "le faltan 28,6 h" are different sentences, and only
        # one of them is about the person.
        person_pending = contract_pace_hours(
            limits, contract.weekly_hours, person_to, period_to, unworked
        )
        person_hours = sum(r.week_hours for r in person_rows)
        summary.append(
            EmployeeWorkdayOut(
                employee_id=employee.id,
                employee_name=employee.full_name,
                contracted_weekly=contract.weekly_hours,
                part_time=is_part_time(contract, limits),
                period_hours=round(person_hours, 2),
                period_expected=round(person_expected, 2),
                period_deviation=round(person_hours - person_expected, 2),
                period_pending=round(person_pending, 2),
                recovery_hours=round(sum(r.recovery_hours for r in person_rows), 2),
                irregular_hours=round(
                    sum(r.irregular_hours for r in person_rows), 2
                ),
                overtime_hours=round(sum(r.overtime_hours for r in person_rows), 2),
                complementary_hours=round(
                    sum(r.complementary_hours for r in person_rows), 2
                ),
                compensated_hours=round(
                    sum(r.compensated_hours for r in person_rows), 2
                ),
                overtime_cap=(
                    None
                    if is_part_time(contract, limits)
                    else overtime_cap(
                        limits,
                        contract,
                        min(
                            max((year_end.date() - person_year_start).days, 1)
                            / 365.0,
                            1.0,
                        ),
                    )
                ),
                findings=_group(
                    [e for r in person_rows for e in r.errors]
                ),
            )
        )

    return WorkdayOut(
        regime=(
            "annual_average"
            if limits.weekly_average_hours is not None
            else "weekly_ceiling"
        ),
        weekly_average_hours=limits.weekly_average_hours,
        annual_hours=limits.annual_hours,
        irregular_pct=limits.irregular_pct,
        irregular_notice_days=limits.irregular_notice_days,
        annual_overtime_cap=limits.annual_overtime_cap,
        overtime_compensation_months=limits.overtime_compensation_months,
        part_time_overtime_allowed=limits.part_time_overtime_allowed,
        cycle_start=cycle_start,
        year_start=year_start.date(),
        period_start=period_from,
        period_end=period_to,
        period_measured_to=period_measured_to,
        employees=summary,
        weeks=out,
    )


@router.get("/balances", response_model=BalancesOut)
def balances(
    on: Optional[str] = Query(None),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    tz: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> BalancesOut:
    """Where each person stands this month, this quarter and this year.

    What the roster shows beside a name, and what the planner projects a draft
    against. The same reading as the working-year view -- whole year loaded,
    hours owed counted up to today -- because two answers to "is Ana short of
    hours?" on two screens of the same product is worse than one answer on one.

    THE PUBLISHED ROTA AND NOTHING ELSE. A draft does not move this figure.
    The balance settles when the manager publishes, which is what makes it a
    number they can plan AGAINST: a balance that already included the draft
    would slide away from them as they worked, and the question "am I giving
    her enough hours?" would answer itself differently every time they dragged
    a shift.

    ``from``/``to`` name the window being edited, when there is one, and they
    do two things.

    THEY ANCHOR THE THREE STRETCHES. A manager planning October must be told
    about October -- their month, their quarter, their year -- and anchoring on
    TODAY instead told them about September. Worse than useless: a draft for
    October sits outside the July-September quarter entirely, so that quarter
    came back empty, its contracted total was zero, and the projection printed
    the draft's raw hours as though every one of them were above contract.
    "+159 h" for somebody who was exactly on track.

    Today still decides what counts as WORKED -- nobody has worked next month
    -- so `on` keeps that job. What the window moves is which month, quarter
    and year are being asked about.

    AND THEY ADD ``published_in_window``, so the client can project the draft
    honestly: publishing REPLACES the published rota for those dates, so a
    projection that only added the draft would count every shift that was
    already there twice.

    ``tz`` is where the business is, as an IANA name, and it decides which DAY
    each shift belongs to. Without it the day is the UTC one, which is what
    this endpoint has always done and what every existing caller still gets --
    but a 18:00-02:00 shift in Phoenix is 01:00-09:00 UTC, so its UTC day is
    the one AFTER the one everybody worked it on. The browser groups the draft
    by the local day; this endpoint grouped the published rota by the UTC one;
    and `planned - published_in_window + draft` subtracted two different
    calendars from each other. Naming the zone makes both sides cut the day in
    the same place.
    """
    zone = _zone(tz)

    today = datetime.now(zone).date() if zone is not None else date.today()
    if on:
        try:
            today = date.fromisoformat(on)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail("bad_date", "'on' must be a date as YYYY-MM-DD"),
            ) from None

    window: Optional[tuple] = None
    if from_ and to:
        w_start, w_end = parse_window(from_, to)
        window = (_day_in(w_start, zone), _day_in(w_end, zone))

    # Load from the earliest year either date touches to the latest: editing
    # next January from December has to reach both.
    anchor_year = (window[0] if window is not None else today).year
    first_year = min(today.year, anchor_year)
    last_year = max(today.year, anchor_year)
    # Midnight in the business's own zone, so that the rows fetched are the
    # ones whose LOCAL day falls in the years being asked about -- the same
    # calendar `_day_in` then cuts them by.
    span_tz = zone if zone is not None else timezone.utc
    year_start = datetime.combine(date(first_year, 1, 1), time.min, tzinfo=span_tz)
    year_end = datetime.combine(
        date(last_year + 1, 1, 1), time.min, tzinfo=span_tz
    )

    floor = labour_floor.floor_for(db, _jurisdiction(db, current_user.org_id))
    limits = _limits(floor)

    employees = list(
        db.execute(
            select(Employee)
            .where(Employee.org_id == current_user.org_id)
            .where(LIVE)
            .order_by(Employee.full_name)
        ).scalars()
    )
    terms = _contract_terms(db, current_user.org_id)
    contract_starts = _contract_starts(db, current_user.org_id)
    cycle_start = _first_published_day(db, current_user.org_id, zone)
    # The cycle as it WOULD start if this draft were published. The column this
    # feeds is "if you publish", and publishing a window before anything else
    # moves the first published day back to it. Before this, a business that
    # had published nothing counted the year from whenever its contracts were
    # typed in -- 19 September for one bar -- and charged every full-timer the
    # 58 hours of 19-30 September that an October draft could never cover.
    if window is not None and (cycle_start is None or window[0] < cycle_start):
        cycle_start = window[0]

    # Published only. `_shifts_for_year` lays the draft over the published rota,
    # which is right for the working-year view -- the manager is deciding
    # whether to publish -- and wrong here, for the reason in the docstring.
    shifts = [
        WorkedShift(
            employee_id=str(r.employee_id),
            day=_day_in(r.during.lower, zone),
            hours=_paid_hours(r),
            published_at=r.published_at,
        )
        for r in db.execute(
            select(Assignment)
            .where(Assignment.org_id == current_user.org_id)
            .where(Assignment.status == PUBLISHED)
            .where(Assignment.employee_id.in_(select(Employee.id).where(LIVE)))
            .where(Assignment.during.op("&&")(_range(year_start, year_end)))
        ).scalars()
    ]

    # The stretches are the ones the WINDOW falls in, not the ones today falls
    # in. See the docstring: a draft for October judged against September's
    # quarter is judged against nothing at all.
    anchor = window[0] if window is not None else today
    month_from, month_to = month_bounds(anchor.year, anchor.month)
    quarter_from, quarter_to = quarter_bounds(anchor.year, quarter_of(anchor))
    # To the 31st of December inclusive -- the end bound is exclusive, and a
    # shift belongs to the day it STARTS on, so the one that opens at 22:00 on
    # New Year's Eve and runs to 04:00 closes this year rather than opening the
    # next. One cycle, tidily shut.
    year_from, year_to = date(anchor.year, 1, 1), date(anchor.year + 1, 1, 1)

    # Approved leave, read in the same zone as the rota so that a day off and
    # a shift cannot land on two different dates. Leave that is not worked
    # back stops owing hours -- see `contract_pace_hours`.
    absences = _absence_days(db, current_user.org_id, year_start, year_end, zone)

    def over(employee, start: date, end: date) -> BalanceOut:
        contract = terms.get(employee.id)
        b = period_balance(
            shifts,
            str(employee.id),
            contract.weekly_hours if contract else 0.0,
            limits,
            start,
            end,
            today,
            cycle_start=cycle_start,
            contract_start=contract_starts.get(employee.id),
            window=window,
            absences=absences,
        )
        return BalanceOut(
            worked=b.worked,
            expected=b.expected,
            deviation=b.deviation,
            planned=b.planned,
            total=b.total,
            pending=b.pending,
            horizon=b.horizon,
            planned_stretch=b.planned_stretch,
            published_in_window=b.published_in_window,
            complete=b.complete,
            start=b.start,
        )

    return BalancesOut(
        on=today,
        month_start=month_from,
        quarter_start=quarter_from,
        year_start=year_from,
        cycle_start=cycle_start,
        employees=[
            EmployeeBalancesOut(
                employee_id=e.id,
                employee_name=e.full_name,
                contracted_weekly=(
                    terms[e.id].weekly_hours if e.id in terms else 0.0
                ),
                month=over(e, month_from, month_to),
                quarter=over(e, quarter_from, quarter_to),
                year=over(e, year_from, year_to),
            )
            for e in employees
        ],
    )
