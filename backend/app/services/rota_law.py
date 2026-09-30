"""The law on a published rota, judged by the server instead of the browser.

WHY THIS EXISTS. Until now Spanish labour law was enforced in ONE place, and it
was a JavaScript file: `frontend/src/lib/schedule/validate.ts` judges the
calendar and the manager never gets to publish what it refuses. Everything
`POST /schedule/publish` checked was structural -- the employee is on the
roster, the timestamps carry an offset, the shift starts inside the window, the
break is not negative (`services/schedule.py::validate_shifts`). So the server
accepted a fourteen-hour day, and accepted two shifts with no rest between
them, from anything that was not that browser: curl, a stale bundle, a script,
the iOS app, a model writing the payload itself.

This module is the second reader of the same rules, on the side that cannot be
bypassed. It ports the part of `validate.ts` that depends on the LAW and on
data the server already holds, and nothing else.

TWO RULES GOVERN IT, and they are `validate.ts`'s own (lines 13-22 there), kept
here because they are what makes a second judge safe rather than dangerous:

1. IT NEVER RE-DERIVES A LIMIT. Not one number in this file says how much rest
   a person needs, how long a day may be, how much weekly rest is owed, or what
   counts as night. Every one of them is read from the organization's
   jurisdiction through `services/labour_floor.py`, which reads the
   ``compliance_rule`` rows -- the same figures the generator and the browser
   are handed in the spec. A validator with its own copy of the rest rule is
   two answers to "was this person given enough rest?", and the day they
   disagree is the day somebody finishes at four and is called back at six.
   The one constant that IS here is ``SPLIT_MIN_GAP_MIN``, and it is here only
   because it has no Python home yet; see its comment.

2. IT REPORTS, IT DOES NOT REPAIR, AND IT DOES NOT REFUSE. `judge` returns
   findings. Whether a finding refuses the publish is the caller's decision,
   and today it should not -- see OBSERVE BEFORE REJECT below.

WHAT IT JUDGES. Six rules about the shifts themselves, ported from `validate.ts` (the source of truth) and
`availability.ts`:

* ``rest``            -- less than the statutory break between two shifts.
* ``daily_hours``     -- more paid hours in one day than the law allows.
* ``weekly_rest``     -- no unbroken day and a half off in a whole week.
* ``night_average``   -- a night worker's days averaging past the cap.
* ``unavailable``     -- the person could not work that day at all.
* ``too_many_shifts`` -- more than two shifts for one person in one day.

Two more that are about the person the rota puts to work:

* ``night_worker_overtime`` -- overtime in a week a night worker worked
  nights (art. 36.1 ET). Which hours are overtime is the working year's
  classification, handed in; whether the week was nights is judged here.
* ``below_minimum_wage``    -- an hourly contract paid under the minimum wage.

AND THE WORKING YEAR'S. The 80-hour cap, the complementary hours of a
part-timer and their pact, the share of the year that may be moved around and
the five days of notice can only be judged against the whole year, and they
used to be judged only on the working-year tab -- a tab nobody has to open in
order to publish. `judge` now asks `law_if_published` (routers/workday.py),
which runs THE SAME ENGINE over the year as publishing would leave it, and
passes its findings through under the codes that tab already uses:
``overtime_cap_exceeded``, ``complementary_cap_exceeded``,
``complementary_without_pact``, ``complementary_contract_too_short``,
``complementary_pact_above_statute``, ``irregular_share_exceeded`` and
``short_notice``.

WHAT IS SEEDED AND STILL NOT JUDGED HERE, because a rota cannot answer it:
the thirty days of annual leave (a ledger of entitlement, not of shifts), the
four years a time record is kept (there is no time record yet), and the three
days of notice before a complementary hour (nothing marks which shift IS one).

WHAT IT DELIBERATELY DOES NOT JUDGE, and why. ``closed_day``,
``outside_hours``, ``split_not_allowed``, ``split_cap``, ``blackout``,
``weekly_ceiling`` and the coverage gaps all need the ``SchedulingSpec``: the
opening hours, the closed weekdays, how many people may work a split day, the
manager's blackouts, the staffing floor per hour. `publish` receives a period
and a list of shifts and no spec -- the brief lives in the browser -- so the
server cannot check any of them, and it should not want to: they are rules of
the BUSINESS, not of the law. A shop that opens on a bank holiday breaks
nothing; a manager who knowingly exceeds a weekly ceiling and pays for it
breaks nothing either (and in Spain the week is an annual average anyway,
art. 34.1 ET -- `validate.ts` stops judging the week outright where
``weeklyAverageHours`` is set, and `services/workday.py` judges the year
instead). Those checks stay in the client, which is the only place that knows
what the business asked for.

``overlap`` IS NOT CHECKED HERE EITHER, and that is not a gap: POSTGRES
forbids it. ``assignment`` carries an exclusion constraint
``assignment_no_overlap`` -- ``EXCLUDE USING gist (employee_id WITH =, status
WITH =, during WITH &&) WHERE (status <> 'archived')`` -- written in
``0001_initial.py`` and widened to include ``status`` in
``0016_draft_no_overlap.py`` so a draft may disagree with the rota it is about
to replace. ``publish`` deletes the window and inserts every shift as
``published`` inside one transaction, so two overlapping shifts for one person
cannot both land: the insert raises and the router already turns it into a 409
(``published_shift_overlap``). Re-checking it in Python would add a second
answer to a question the database answers definitively, and the Python one
would be the weaker of the two -- it cannot see the shifts of the NEIGHBOURING
period, which is exactly the overlap the 409 catches. There is a test that
demonstrates this rather than a comment asserting it.

THE DAY GRID, which is the one genuinely hard part. The browser holds a shift
as a local date key plus minutes from that day's midnight; the server holds two
instants. Three of the six rules need the browser's reading and not the
server's: "the same day" decides whether a gap is a split or a night's rest,
the nine-hour day is a sum over a local day, and the night window is a WALL
CLOCK (22:00-06:00 where the staff live, not where the server is). Judging in
UTC would price a 17:00-03:00 Barcelona shift as three night hours instead of
five, and would report the wrong day for anything starting before 02:00.

This organization has no timezone column -- see ``ShiftMarkOut`` in
``schemas/assignment.py``, which refuses to group shifts into days for exactly
that reason -- so the grid is RECOVERED from the request instead of invented:
``period_start`` is local midnight (`monthWindow` builds it with the local
``Date`` constructor and ``toISOString`` sends the instant), so the offset it
sits at is this client's offset, and `local_zone` reads it back. A period that
starts at 2026-09-30T22:00Z is October in Madrid, and every day boundary and
every clock-hour comparison below is made in +02:00. Nothing is guessed: if a
caller sends UTC midnight it gets UTC days, which is what the tests do and what
a UTC business means.

Its one limit, stated so nobody debugs it twice: the offset is FIXED for the
whole period, so a daylight-saving change inside the period leaves the day
boundaries an hour away from the browser's. The consequence is bounded to a
shift starting within that hour of midnight, and the real fix is a timezone on
the organization -- not a second convention here. Note also that
`routers/workday.py` reads a shift's day as ``during.lower.date()``, i.e. in
whatever zone the row comes back in; that is good enough for counting hours
into a year and is not good enough for a wall-clock rule, which is why this
module does not copy it.

OBSERVE BEFORE REJECT. `enforced()` answers whether a finding should refuse the
publish, and it is FALSE until somebody sets ``PUBLISH_LAW_ENFORCED``. The
pattern is ``api_budget_enforced`` in `config.py`, and the reason is the one
written beside it: a control that starts refusing on the day it is deployed
turns an estimate into somebody else's outage. Here it would be worse than a
spend ceiling. Every rota already published was published past these checks,
and every rota published tomorrow is built by a browser whose spec may carry a
figure the manager asked for rather than the statute (`brief_to_spec` lets the
brief outrank the law on purpose, and `test_spanish_labour.py` pins that). Turn
this on before reading a fortnight of warnings and the first thing it does is
refuse a manager the calendar they have been publishing all year, at the moment
they press the button, with no way for them to tell whether the rota or the
server is wrong. So: log, watch, then enforce with an environment variable and
no deploy.

``publish_law_enforced`` lives in `config.py` beside `api_budget_enforced`, for
the same reason and with the same default. It is still read through
``getattr`` so this module can be imported by anything that does not carry the
setting -- a script, an older configuration -- without turning a missing
variable into an import error.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import detail
from app.models.absence import Absence
from app.models.contract import Contract
from app.models.employee import Employee
from app.models.organization import Organization
from app.schemas.assignment import ShiftIn
from app.services.employees import LIVE
from app.services.labour_floor import LabourFloor, floor_for

# The Sunday-anchored week, imported rather than rewritten. `validate.ts` keys
# weeks on the Sunday before a date (`weekKey`, generate.ts:308-313) and
# `services/workday.py` already says so in Python. A second anchor would put
# two different "weekly rest" verdicts on one screen -- and Monday is the
# intuitive answer here, which is precisely why it has to be imported: the
# figure that matters is the one the rest of the product uses.
from app.services.workday import week_start

log = logging.getLogger(__name__)


# --- the codes -------------------------------------------------------------
#
# Deliberately the same strings as `ViolationKind` in `validate.ts`. The client
# already has a rendering for each of these, and a server that invented
# ``insufficient_rest`` for the thing the browser calls ``rest`` would need a
# second dictionary entry saying the same sentence twice.

REST = "rest"
DAILY_HOURS = "daily_hours"
WEEKLY_REST = "weekly_rest"
NIGHT_AVERAGE = "night_average"
UNAVAILABLE = "unavailable"
TOO_MANY_SHIFTS = "too_many_shifts"
NIGHT_WORKER_OVERTIME = "night_worker_overtime"
BELOW_MINIMUM_WAGE = "below_minimum_wage"

# The working year's own codes, judged by `services/workday.py` and passed
# through untouched: the working-year tab already reports them under these
# names, and a finding must read the same on both screens.
OVERTIME_CAP_EXCEEDED = "overtime_cap_exceeded"
COMPLEMENTARY_CAP_EXCEEDED = "complementary_cap_exceeded"
COMPLEMENTARY_WITHOUT_PACT = "complementary_without_pact"
COMPLEMENTARY_CONTRACT_TOO_SHORT = "complementary_contract_too_short"
COMPLEMENTARY_PACT_ABOVE_STATUTE = "complementary_pact_above_statute"
IRREGULAR_SHARE_EXCEEDED = "irregular_share_exceeded"
SHORT_NOTICE = "short_notice"

#: The code for the error as a whole, when a caller refuses a publish over it.
BREAKS_THE_LAW = "schedule_breaks_the_law"

# The English a developer reading a trace wants, per `errors.py`: the code is
# what a manager's screen is composed from, and this is the log line, the curl
# output, and the answer for anything that is not this client. It is never
# interpolated -- the numbers travel in ``params``.
_MESSAGES = {
    REST: "Too little rest between two shifts (art. 34.3 ET)",
    DAILY_HOURS: "More hours in one day than the law allows (art. 34.3 ET)",
    WEEKLY_REST: "No unbroken day and a half off in the week (art. 37.1 ET)",
    NIGHT_AVERAGE: "A night worker's days average past the cap (art. 36.1 ET)",
    UNAVAILABLE: "A shift on a day this person cannot work",
    TOO_MANY_SHIFTS: "More than two shifts for one person in one day",
    NIGHT_WORKER_OVERTIME: "Overtime for a night worker (art. 36.1 ET)",
    BELOW_MINIMUM_WAGE: "An hourly rate below the minimum wage (art. 27 ET)",
    OVERTIME_CAP_EXCEEDED: "Past the annual cap on overtime (art. 35.2 ET)",
    COMPLEMENTARY_CAP_EXCEEDED: "Past the agreed complementary hours (art. 12.5 ET)",
    COMPLEMENTARY_WITHOUT_PACT: "Complementary hours with no written pact (art. 12.5 ET)",
    COMPLEMENTARY_CONTRACT_TOO_SHORT: "Complementary hours on a contract under the minimum week (art. 12.5.a ET)",
    COMPLEMENTARY_PACT_ABOVE_STATUTE: "A complementary-hours pact above the legal share (art. 12.5.c ET)",
    IRREGULAR_SHARE_EXCEEDED: "More of the year moved around than the law allows (art. 34.2 ET)",
    SHORT_NOTICE: "A shift announced with less notice than the law requires (art. 34.2 ET)",
}

# The shortest break between the two halves of ONE split day, in minutes.
#
# The only figure in this file that is not read from the rules table, and the
# only one that cannot be: it is not a statutory limit but the product's own
# reading of what a split day is, and it lives in `generate.ts` as
# ``SPLIT_MIN_GAP`` (line 323) with nothing on the server holding it. Sixty
# minutes, matching that file to the minute, because the alternative -- reading
# the long rest as if it applied inside a day -- would report a perfectly legal
# 09:00-13:00 / 14:30-19:00 Tuesday as a twelve-hour rest breach.
#
# If it ever moves into `compliance_rule` or the spec, delete it here and read
# it from there. Two copies of it is the failure this module exists to avoid.
SPLIT_MIN_GAP_MIN = 60

# Night hours in a day past which art. 36.1 ET calls somebody a night worker.
# ``NIGHT_WORKER_MIN_HOURS`` in `frontend/src/lib/schedule/night.ts`. Not a
# jurisdiction figure in the rules table today; when it becomes one, read it.
NIGHT_WORKER_MIN_HOURS = 3.0

#: The statutory reference period for the night-work average (art. 36.1 ET).
NIGHT_AVERAGE_WINDOW_DAYS = 15


def enforced() -> bool:
    """Whether a finding should REFUSE a publish, or only be logged.

    False until the environment says otherwise. ``publish_law_enforced`` is not
    a field of `Settings` yet, so this reads it defensively and keeps working
    either way -- see OBSERVE BEFORE REJECT in the module docstring, and
    ``api_budget_enforced`` for the pattern and the reasoning.

    Read per call, never captured at import, so that turning it on is a restart
    rather than a deploy and so a test can monkeypatch it.
    """
    return bool(getattr(settings, "publish_law_enforced", False))


def mode() -> str:
    """"enforce" or "observe" -- for the log line that says which happened."""
    return "enforce" if enforced() else "observe"


# --- what comes out --------------------------------------------------------


@dataclass(frozen=True)
class Violation:
    """One rule broken, as a code and numbers.

    NEVER prose, in either language. The reason is `errors.py`'s: the server
    has no dictionary, the client composes every sentence from a code, and a
    validator that emitted English would either ship untranslated text to a
    Spanish manager or tempt somebody into branching on it. ``on`` is the day
    the offending shift STARTS on, or -- for a weekly rule -- the Sunday of the
    week that was measured, exactly as `validate.ts` reports it.
    """

    code: str
    employee_id: Optional[str]
    on: date
    params: Dict[str, Any] = field(default_factory=dict)

    def as_params(self) -> Dict[str, Any]:
        """One finding, flat, for the ``params`` of an error body.

        The employee and the day are in here because they are part of the
        sentence a manager reads ("Ana, 5 Oct: 8 h of rest, 12 required"), and
        a date in ISO is a value rather than prose.
        """
        body = {
            "rule": self.code,
            "employee": self.employee_id,
            "day": self.on.isoformat(),
        }
        body.update(self.params)
        return body

    def as_detail(self) -> Dict[str, Any]:
        """This one finding as the ``detail`` body of an HTTPException."""
        message = _MESSAGES.get(self.code, self.code)
        return detail(self.code, message, **self.as_params())


def as_detail(violations: Sequence[Violation]) -> Dict[str, Any]:
    """Every finding as ONE error body, for a caller that refuses the publish.

    One body rather than one per violation because a rota breaks the law in
    batches -- a rule that is wrong for one person is usually wrong for six --
    and a manager needs the list, not the first one. ``count`` is there so the
    client can say "and 11 more" without walking the array.
    """
    return detail(
        BREAKS_THE_LAW,
        "%d shift rule(s) broken: %s"
        % (len(violations), ", ".join(sorted({v.code for v in violations}))),
        count=len(violations),
        violations=[v.as_params() for v in violations],
    )


# --- what goes in ----------------------------------------------------------


@dataclass(frozen=True)
class PlacedShift:
    """One shift in the BROWSER's terms, recovered from two instants.

    ``day`` and ``start_min`` are what `validate.ts` works in: the local date
    the shift starts on, and minutes from that day's midnight. ``end_min`` may
    pass 1440 -- a shift that ends at 03:00 is 1620, not 180 -- because that is
    what lets an overnight shift keep the day it belongs to, and what makes the
    night window arithmetic work at both ends of midnight.

    The instants are kept too: every gap between two shifts is measured on
    them, so no day arithmetic can put a rest breach an hour out.
    """

    employee_id: str
    day: date
    start_min: float
    end_min: float
    paid_hours: float
    start: datetime
    end: datetime


@dataclass(frozen=True)
class Person:
    """What the database knows about whether somebody can work a day.

    A value rather than a row, so the ORDER of the decisions below can be
    tested without a database -- the argument `services/workday.py` makes in
    its own docstring, and it applies twice over here: without Postgres this
    repository skips 93 tests and still reports green, so a rule that can only
    be exercised through a Session is a rule that quietly stops being checked.

    ``contract_from`` / ``contract_to`` are the OPEN contract's dates, because
    that is the one the client sees: `EmployeeOut.current_contract` is filled
    by `get_current_contract`, which selects ``valid_to IS NULL``.
    """

    employee_id: str
    employment_status: str
    hire_date: Optional[date] = None
    has_contract: bool = True
    contract_from: Optional[date] = None
    contract_to: Optional[date] = None
    #: APPROVED absences only, as instants. A request nobody has answered is a
    #: warning on the manager's row, never a block -- `availability.ts` line
    #: 168, and the reason is that a pending holiday must not silently vanish
    #: from the rota before anybody decided anything.
    approved_absences: Tuple[Tuple[datetime, datetime], ...] = ()
    #: The open contract's hourly rate, where it states one. A salaried
    #: contract has none and is not compared: its hourly figure depends on the
    #: year the contract is read against, which is `workday.py`'s question.
    hourly_rate: Optional[float] = None


# --- the day grid ----------------------------------------------------------


def local_zone(period_start: datetime) -> timezone:
    """The offset the client's local midnight sits at.

    ``period_start`` is midnight of the first day of the period, expressed as
    an instant (`monthWindow` + ``toISOString``). So the time of day it lands
    at in UTC is exactly the negation of the client's offset: 22:00Z is
    +02:00, 05:00Z is -05:00, 00:00Z is UTC.

    Normalised into (-12h, +12h]: the two readings of, say, 22:00Z are +02:00
    and -22:00, and only one of them is a timezone anybody lives in. A period
    that does not start at a local midnight at all (nothing in this product
    sends one) lands on whatever offset makes it midnight, which is still the
    reading that keeps the day boundaries where the caller put them.
    """
    utc = period_start.astimezone(timezone.utc)
    since_midnight = timedelta(
        hours=utc.hour,
        minutes=utc.minute,
        seconds=utc.second,
        microseconds=utc.microsecond,
    )
    offset = -since_midnight
    if offset <= timedelta(hours=-12):
        offset += timedelta(hours=24)
    return timezone(offset)


def days_of(
    period_start: datetime, period_end: datetime, zone: timezone
) -> List[date]:
    """The local days the published period covers -- the client's ``DayRef[]``.

    COUNTED, not walked instant by instant, and that is the whole subtlety. The
    period is a whole number of the client's civil days (`monthWindow`), but the
    zone here is a FIXED offset read off ``period_start``, so it cannot know
    about a clock change inside the period. Comparing local midnights against
    ``period_end`` therefore gave October 32 days instead of 31: the hour Spain
    gives back on the last Sunday makes "midnight on 1 November" land an hour
    before the end of the period, so 1 November was counted as being inside it.

    That extra day was not cosmetic. When it fell on a Saturday it COMPLETED the
    last week, so `whole_weeks` judged a week the browser does not judge, and a
    rota whose day and a half of rest falls just after the period was reported
    as breaking article 37.1 -- a refusal, once enforcement is on, of something
    the app showed as perfectly legal. It is deterministic: October 2025 and
    2031, and any multi-month horizon that crosses October and ends on a Friday.

    So the length comes from the DURATION instead: real hours divided by 24 and
    rounded, which is 31 for a 745-hour October and 30 for a 720-hour November.
    The rounding is what absorbs the clock change, in both directions.
    """
    first = period_start.astimezone(zone).date()
    span = round((period_end - period_start) / timedelta(hours=24))
    return [first + timedelta(days=n) for n in range(max(0, span))]


def place(shifts: Iterable[ShiftIn], zone: timezone) -> List[PlacedShift]:
    """Turn the payload into the browser's shape, in the client's own zone."""
    out: List[PlacedShift] = []
    for shift in shifts:
        start = shift.start_at.astimezone(zone)
        end = shift.end_at.astimezone(zone)
        day = start.date()
        midnight = datetime.combine(day, time.min, tzinfo=zone)
        start_min = (start - midnight).total_seconds() / 60.0
        span_min = (end - start).total_seconds() / 60.0
        # Paid hours the way every other reader computes them: the span less
        # the unpaid break, never below zero. `_paid_hours` in
        # `routers/workday.py` for the stored row, `breakMinutes` /
        # `paidHours` in `lib/schedule/persist.ts` for the browser's.
        paid = max(span_min - (shift.unpaid_break_minutes or 0), 0.0) / 60.0
        out.append(
            PlacedShift(
                employee_id=str(shift.employee_id),
                day=day,
                start_min=start_min,
                end_min=start_min + span_min,
                paid_hours=paid,
                start=start,
                end=end,
            )
        )
    return out


def night_hours_in(
    start_min: float, end_min: float, window: Tuple[float, float]
) -> float:
    """Night hours inside ``[start_min, end_min)``, minutes from the shift's day.

    A straight port of ``nightHoursIn`` in `frontend/src/lib/schedule/night.ts`,
    including its day-sized slices: one for the night that began yesterday, one
    for tonight's, one for tomorrow's. That is what makes an overnight shift
    count at BOTH ends of midnight -- a bar open 18:00-04:00 earns night from
    22:00 to midnight and from midnight to 04:00, six of its ten hours, which
    is the reason art. 36.1 bites at all.

    ``window`` is ``LabourFloor.night_window``: (start hour, end hour), read
    from ``night_work_window_start`` / ``_end`` for the jurisdiction. Nothing
    here assumes 22:00-06:00.
    """
    from_min = window[0] * 60.0
    to_min = window[1] * 60.0
    minutes = 0.0
    for offset in (-1440.0, 0.0, 1440.0):
        night_start = offset + from_min
        night_end = offset + 1440.0 + to_min
        minutes += max(0.0, min(end_min, night_end) - max(start_min, night_start))
    return minutes / 60.0


def whole_weeks(days: Sequence[date]) -> Set[date]:
    """The weeks every one of whose seven days is inside the period.

    ``wholeWeeks`` in validate.ts:264-282, and the reason is worth repeating
    because the temptation to drop it is real: a weekly rest is measured across
    a whole week and a published period almost never starts on a Monday, so the
    first week's rest is partly in the week before -- which this call cannot
    see and the manager cannot fix from here. Judging it anyway would report a
    breach on every rota whose period does not begin on a Monday.
    """
    present = set(days)
    out: Set[date] = set()
    for day in days:
        key = week_start(day)
        if key in out:
            continue
        if all(key + timedelta(days=i) in present for i in range(7)):
            out.add(key)
    return out


def blocked_on(person: Person, day: date, zone: timezone) -> Optional[str]:
    """Why this person cannot work this day, or None. A value, not a sentence.

    Ported from `frontend/src/lib/schedule/availability.ts` lines 85-175, in
    the SAME ORDER, because the order is the answer: a resigned employee with
    an approved holiday reads as ``resigned``, not as ``absence``, and a new
    hire whose contract starts on their first day reads as ``not_started``
    rather than ``contract``. The kinds are that file's ``BlockedKind``, so the
    client's existing rendering fits a finding from here unchanged.

    What is NOT ported: the ``reason`` sentence beside each kind (this module
    emits no prose), the onboarding ramp-up (a cap on hours and a bar on
    nights, both of which are the generator's business and neither of which
    makes a day unworkable), and the pending-request warning (a warning is not
    a violation).

    The absence type is not read either, which is more than tidiness: a type
    may be marked ``is_health_data``, and what is never sent cannot leak out of
    an error body.
    """
    # 1. Employment status recorded on the employee.
    if person.employment_status == "resigned":
        return "resigned"
    if person.employment_status == "on_leave":
        return "on_leave"

    # 2. Not yet started. The client compares against the END of the day, so a
    #    hire date of this very day is fine and tomorrow's is not.
    if person.hire_date is not None and person.hire_date > day:
        return "not_started"

    # 3. A contract must exist and cover this day.
    if not person.has_contract:
        return "contract"
    if person.contract_from is not None and person.contract_from > day:
        return "contract"
    # Unreachable while the open contract is the one being read (``valid_to IS
    # NULL`` by definition), and ported anyway: it is one line, and the
    # alternative -- picking whichever contract covers the day -- is a change
    # of meaning the client has not made and this module must not make alone.
    if person.contract_to is not None and person.contract_to < day:
        return "contract"

    # 4. An APPROVED absence that overlaps the day. Requested ones do not
    #    block; they are not even in ``approved_absences``.
    #
    #    The bounds are the client's: midnight to 23:59:59 local, compared
    #    inclusively at both ends (availability.ts:171). That carries one quirk
    #    over with it -- an absence whose end lands exactly on midnight touches
    #    the following day as well -- and it is carried over ON PURPOSE. The
    #    browser reads it that way, the browser is what created the row
    #    (23:59, in practice), and a server that read one day differently would
    #    refuse a rota the manager was shown as legal.
    day_start = datetime.combine(day, time.min, tzinfo=zone)
    day_end = day_start + timedelta(days=1) - timedelta(seconds=1)
    for start, end in person.approved_absences:
        if start > day_end or end < day_start:
            continue
        return "absence"

    return None


def _round(value: float, places: int) -> float:
    """Round half UP, like JavaScript's ``Math.round``.

    Python's built-in rounds half to EVEN, so ``round(0.125, 2)`` is 0.12 where
    the browser says 0.13. Every rounded figure in this file is compared
    against a legal limit or shown beside one, and two products disagreeing in
    the second decimal about whether a day was nine hours or nine hours and a
    bit is the kind of difference that gets explained to an inspector.
    """
    factor = 10.0 ** places
    return math.floor(value * factor + 0.5) / factor


# --- the judgement ---------------------------------------------------------


def judge_shifts(
    shifts: Sequence[PlacedShift],
    roster: Mapping[str, Person],
    floor: LabourFloor,
    *,
    days: Sequence[date],
    zone: timezone,
    overtime_weeks: Optional[Mapping[str, Mapping[date, float]]] = None,
) -> List[Violation]:
    """Judge already-placed shifts against an already-read floor. No Session.

    ``overtime_weeks`` is each person's overtime per week, as the working
    year classifies it (`law_if_published`): which hours are overtime is an
    annual question this function cannot answer from one month, but whether
    the person doing them is a night worker is a question only it can.

    Split out from `judge` so the rules can be exercised from values -- see
    `Person` for why that matters in this repository -- and so a caller that
    has already read the floor does not read it twice.

    Every statutory check runs ONLY when the floor carries the figure. A
    jurisdiction nobody has seeded therefore behaves exactly as it did before
    this module existed, which is the same contract `labour_floor.py` and
    `workday.py` both make. It also means that where the browser would still
    apply the brief's own default -- `brief_to_spec` hands an unseeded
    jurisdiction eleven hours of rest from the intake, not from any statute --
    the server says nothing at all. That asymmetry is deliberate: a figure the
    manager typed is not law, and a server refusing a publish over it would be
    enforcing the brief against the person who wrote it.
    """
    out: List[Violation] = []
    # Assignments outside the period are IGNORED rather than flagged, exactly
    # as `validateSchedule` ignores them: a month being republished must not be
    # told off for the neighbouring month's shifts, which it can neither see
    # nor fix. `validate_shifts` refuses them outright before this runs, so in
    # practice this filter is a belt on top of a brace.
    judged_days = set(days)
    in_period = [s for s in shifts if s.day in judged_days]

    # ---- per shift --------------------------------------------------------

    for shift in in_period:
        person = roster.get(shift.employee_id)
        if person is None:
            # Nothing to say about a shift given to somebody who is not on the
            # roster: `validate_shifts` has already refused the publish by
            # name (``unknown_employee``), and every rule below reads the
            # contract of a person this one does not have.
            continue
        kind = blocked_on(person, shift.day, zone)
        if kind is not None:
            out.append(
                Violation(UNAVAILABLE, shift.employee_id, shift.day, {"reason": kind})
            )

    # ---- per person, across the period ------------------------------------

    by_employee: Dict[str, List[PlacedShift]] = {}
    for shift in in_period:
        if shift.employee_id not in roster:
            continue
        by_employee.setdefault(shift.employee_id, []).append(shift)

    judged_weeks = whole_weeks(days)

    for employee_id, mine in by_employee.items():
        # Sorted by the INSTANT, so "the previous shift" means what it says
        # even when one of them runs past midnight into the next date.
        ordered = sorted(mine, key=lambda s: s.start)

        per_day: Dict[date, List[PlacedShift]] = {}
        for shift in ordered:
            per_day.setdefault(shift.day, []).append(shift)

        # More than two shifts in a day is never a split and always an error
        # (validate.ts:300-306). Two IS a split, and whether splits are allowed
        # at all is the brief's business -- see the docstring.
        for day, same_day in per_day.items():
            if len(same_day) > 2:
                out.append(
                    Violation(
                        TOO_MANY_SHIFTS,
                        employee_id,
                        day,
                        {"count": len(same_day)},
                    )
                )

        # -- rest between two consecutive shifts (art. 34.3 ET) -------------
        if floor.min_rest_hours is not None:
            required_long = floor.min_rest_hours * 60.0
            for i in range(1, len(ordered)):
                previous = ordered[i - 1]
                current = ordered[i]
                gap_min = (current.start - previous.end).total_seconds() / 60.0
                if gap_min < 0:
                    # An overlap, which the database refuses outright. Skipping
                    # it here matches `validate.ts`, which reports the overlap
                    # and calls the rest question moot -- telling somebody they
                    # had -90 minutes of rest explains nothing the 409 has not
                    # already said.
                    continue

                # The same question the generator asks, asked the same way: is
                # this the SECOND HALF of one day, or the first shift of a new
                # one? Keyed on the date a shift STARTS, never on the clock. A
                # night that ends at 04:00 begins after the new day did, and
                # reading that as a split would buy twelve hours of rest down
                # to sixty minutes.
                #
                # The exception is applied unconditionally, where the client
                # applies it only when the brief permits splits. The server
                # cannot know whether they are permitted, and of the two ways
                # to be wrong, refusing a legal split day is the one that stops
                # a manager working; a split day where splits were forbidden is
                # ``split_not_allowed``, which is the client's finding and
                # stays the client's finding.
                second_half = current.day == previous.day
                required = float(SPLIT_MIN_GAP_MIN) if second_half else required_long
                if gap_min < required:
                    out.append(
                        Violation(
                            REST,
                            employee_id,
                            current.day,
                            {
                                "gap_min": _round(gap_min, 2),
                                "required_min": _round(required, 2),
                            },
                        )
                    )

        # -- the nine-hour day (art. 34.3 ET) ------------------------------
        #
        # Summed per DAY, not per shift: the two halves of a split are one
        # day's work and the limit is on the day.
        if floor.max_daily_hours is not None:
            for day, same_day in per_day.items():
                hours = _round(sum(s.paid_hours for s in same_day), 2)
                # Rounded BEFORE comparing, like the original: a shift priced
                # at 9.000000000000002 hours is nine hours, and reporting it
                # would be arithmetic noise dressed as a legal finding.
                if hours > floor.max_daily_hours:
                    out.append(
                        Violation(
                            DAILY_HOURS,
                            employee_id,
                            day,
                            {"hours": hours, "allowed": floor.max_daily_hours},
                        )
                    )

        # -- a day and a half off, unbroken (art. 37.1 ET) ------------------
        #
        # Measured as the longest gap between two shifts around the week, and
        # NOT cropped at the week's own edges. `validate.ts` carries the long
        # version of why; the short one is that a rest lying across a week
        # boundary used to be cut in half and the smaller half judged, so a
        # Monday-to-Friday week -- 64 hours of rest -- was read as 33 and
        # reported as a breach that does not exist.
        #
        # The two ends are measured to the NEIGHBOURING SHIFT. Where there is
        # none, the rest runs past everything this call was given and an
        # unbounded rest is not a breach: the same caution `whole_weeks` takes.
        if floor.weekly_rest_hours is not None:
            required_rest = floor.weekly_rest_hours * 60.0
            per_week: Dict[date, List[PlacedShift]] = {}
            for shift in ordered:
                per_week.setdefault(week_start(shift.day), []).append(shift)
            for week in per_week:
                if week not in judged_weeks:
                    continue
                opened = datetime.combine(week, time.min, tzinfo=zone)
                closed = opened + timedelta(days=7)
                # The run of shifts that START inside this week, as positions
                # in the person's whole timeline, so the shift before and the
                # shift after are both in reach.
                inside = [
                    i for i, s in enumerate(ordered) if opened <= s.start < closed
                ]
                if not inside:
                    continue
                first, last = inside[0], inside[-1]
                longest = (
                    (ordered[first].start - ordered[first - 1].end).total_seconds()
                    / 60.0
                    if first > 0
                    else math.inf
                )
                previous_end = ordered[first].end
                for shift in ordered[first + 1 : last + 1]:
                    longest = max(
                        longest, (shift.start - previous_end).total_seconds() / 60.0
                    )
                    previous_end = max(previous_end, shift.end)
                if last + 1 < len(ordered):
                    longest = max(
                        longest,
                        (ordered[last + 1].start - previous_end).total_seconds() / 60.0,
                    )
                else:
                    longest = math.inf
                if longest < required_rest:
                    out.append(
                        Violation(
                            WEEKLY_REST,
                            employee_id,
                            week,
                            {
                                "hours": _round(longest / 60.0, 1),
                                "required": floor.weekly_rest_hours,
                            },
                        )
                    )

        # -- a night worker's day, averaged over fifteen (art. 36.1 ET) -----
        #
        # Only for the people the statute calls night workers -- three hours or
        # more of the daily shift inside the night window -- and only over
        # their NIGHT days: a barman who does a day shift on Tuesday has not
        # bought himself a longer Friday. Every fifteen-day window that fits is
        # checked, because the article says "a reference period of 15 days" and
        # a rota can hide a bad fortnight inside a good month.
        night_days = (
            _night_days(per_day, floor.night_window)
            if floor.night_window is not None
            else []
        )
        if floor.night_average_max is not None and floor.night_window is not None:
            for i in range(len(night_days)):
                first = night_days[i][0]
                last = first + timedelta(days=NIGHT_AVERAGE_WINDOW_DAYS)
                window = [d for d in night_days if first <= d[0] < last]
                average = sum(h for _, h in window) / len(window)
                if _round(average, 2) > floor.night_average_max:
                    out.append(
                        Violation(
                            NIGHT_AVERAGE,
                            employee_id,
                            first,
                            {
                                "average": _round(average, 1),
                                "allowed": floor.night_average_max,
                                "days": len(window),
                            },
                        )
                    )
                    # ONE finding per person: the fortnight, not every day in
                    # it. A habit reported fifteen times reads as fifteen
                    # problems and gets dismissed as noise.
                    break

        # -- no overtime for a night worker (art. 36.1 ET) ------------------
        #
        # "Los trabajadores nocturnos no podrán realizar horas extraordinarias."
        # A week counts when the person worked a night day in it AND the
        # working year classifies some of that week's hours as overtime --
        # the same classification the 80-hour cap is measured with, so the two
        # can never disagree about which hours were extra.
        if not floor.night_worker_overtime_allowed and night_days and overtime_weeks:
            extra = overtime_weeks.get(employee_id, {})
            for week in sorted({week_start(d) for d, _ in night_days}):
                hours = extra.get(week, 0.0)
                if hours > 0:
                    out.append(
                        Violation(
                            NIGHT_WORKER_OVERTIME,
                            employee_id,
                            week,
                            {"hours": _round(hours, 2)},
                        )
                    )
                    break  # one per person, as for the night average

        # -- the minimum wage (art. 27 ET) ------------------------------------
        #
        # Judged on the contract of somebody this rota puts to work, because
        # that is when an hour at the wrong rate is actually paid. Once per
        # person, on their first day: the rate is the same on every shift.
        person = roster[employee_id]
        if (
            floor.minimum_wage is not None
            and person.hourly_rate is not None
            and person.hourly_rate > 0
            and _round(person.hourly_rate, 2) < floor.minimum_wage
        ):
            out.append(
                Violation(
                    BELOW_MINIMUM_WAGE,
                    employee_id,
                    ordered[0].day,
                    {"rate": person.hourly_rate, "minimum": floor.minimum_wage},
                )
            )

    return out


def _night_days(
    per_day: Mapping[date, Sequence[PlacedShift]], window: tuple
) -> List[Tuple[date, float]]:
    """The days somebody works as a night worker, with their paid hours.

    Three hours or more of the day inside the night window (art. 36.1 ET),
    summed across the day's shifts. One helper for the two rules that ask.
    """
    out: List[Tuple[date, float]] = []
    for day in sorted(per_day):
        same_day = per_day[day]
        night = sum(night_hours_in(s.start_min, s.end_min, window) for s in same_day)
        if night >= NIGHT_WORKER_MIN_HOURS:
            out.append((day, sum(s.paid_hours for s in same_day)))
    return out


def roster_facts(
    db: Session,
    org_id: UUID,
    employee_ids: Set[str],
    period_start: datetime,
    period_end: datetime,
) -> Dict[str, Person]:
    """What the tables say about the people in this payload.

    Three queries whatever the size of the rota, rather than the per-employee
    reads the client's shape invites: `get_current_contract` asked once per
    person is N round trips inside a publish that already holds an advisory
    lock on the organization.

    Only people still on the roster (`LIVE`). Somebody who was removed has no
    facts worth judging and `validate_shifts` refuses the publish anyway.
    """
    wanted = {UUID(i) for i in employee_ids}
    if not wanted:
        return {}

    employees = list(
        db.execute(
            select(Employee)
            .where(Employee.org_id == org_id)
            .where(LIVE)
            .where(Employee.id.in_(wanted))
        ).scalars()
    )

    # The OPEN contract, which is what `current_contract` means to the client
    # (`get_current_contract`: ``valid_to IS NULL``). Same predicate, asked for
    # everybody at once.
    open_contracts = {
        c.employee_id: c
        for c in db.execute(
            select(Contract)
            .where(Contract.org_id == org_id)
            .where(Contract.employee_id.in_(wanted))
            .where(Contract.valid_to.is_(None))
        ).scalars()
    }

    # Approved absences that could touch the period. The range test here is
    # COARSE on purpose -- a day either side of the window costs nothing and
    # the exact per-day comparison stays in `blocked_on`, where it is the
    # client's comparison rather than a second one written in SQL.
    absences: Dict[UUID, List[Tuple[datetime, datetime]]] = {}
    rows = db.execute(
        select(Absence.employee_id, Absence.during)
        .where(Absence.org_id == org_id)
        .where(Absence.employee_id.in_(wanted))
        .where(Absence.status == "approved")
        .where(func.upper(Absence.during) >= period_start - timedelta(days=1))
        .where(func.lower(Absence.during) < period_end + timedelta(days=1))
    ).all()
    for employee_id, during in rows:
        if during.lower is None or during.upper is None:
            continue
        absences.setdefault(employee_id, []).append((during.lower, during.upper))

    out: Dict[str, Person] = {}
    for employee in employees:
        contract = open_contracts.get(employee.id)
        out[str(employee.id)] = Person(
            employee_id=str(employee.id),
            employment_status=employee.employment_status,
            hire_date=employee.hire_date,
            has_contract=contract is not None,
            contract_from=contract.valid_from if contract is not None else None,
            contract_to=contract.valid_to if contract is not None else None,
            approved_absences=tuple(absences.get(employee.id, ())),
            hourly_rate=(
                float(contract.hourly_rate)
                if contract is not None and contract.hourly_rate is not None
                else None
            ),
        )
    return out


def jurisdiction_of(db: Session, org_id: UUID) -> str:
    """The jurisdiction code this organization is judged under.

    A column on ``organization``, defaulting to ``ES-CT-HOSTELERIA`` since
    signup started filing businesses under the law of the city they are in.
    An organization that cannot be read -- which RLS makes impossible for the
    org whose session this is -- leaves an empty code, and `floor_for` answers
    an empty floor for it: nothing is judged rather than something guessed.
    """
    code = db.execute(
        select(Organization.jurisdiction_code).where(Organization.id == org_id)
    ).scalar_one_or_none()
    return code or ""


def judge(
    db: Session,
    org_id: UUID,
    shifts: Sequence[ShiftIn],
    *,
    period_start: datetime,
    period_end: datetime,
) -> List[Violation]:
    """What the law says about this rota. A list of findings, possibly empty.

    The signature is the one `publish` can call with what it already has:
    ``shifts`` are the ``ShiftIn`` off the request, and the period is the
    window being replaced. Nothing else is needed and nothing else is taken --
    in particular no ``SchedulingSpec``, because the rules that need one are
    not the law's (see the module docstring).

    Callers: run this AFTER `validate_shifts`. The structural check is what
    guarantees the timestamps carry an offset and the employees exist, and both
    of those are assumptions underneath every rule here. Then, while
    `enforced()` is False, LOG the findings and publish anyway.
    """
    zone = local_zone(period_start)
    placed = place(shifts, zone)
    floor = floor_for(db, jurisdiction_of(db, org_id))
    roster = roster_facts(
        db,
        org_id,
        {s.employee_id for s in placed},
        period_start,
        period_end,
    )
    # The rules that need the whole year: the same engine the working-year
    # tab runs, asked what the year would look like with this rota published.
    # Imported here rather than at the top because it lives beside the
    # queries that feed that tab, and those import this module's neighbours.
    from app.routers.workday import law_if_published

    # KNOWN LIMIT, the same one every rule in this file lives with: ``zone``
    # is the fixed offset the period starts at, not the business's timezone,
    # which `publish` is never told. A winter shift read from a summer window
    # can land an hour off -- at 00:30 that is the day before, and on a
    # Monday the week before. The real fix is a timezone column on
    # ``organization``; until then this reads the year the way the rest of
    # the judge reads the month.

    year_errors, overtime_weeks = law_if_published(
        db,
        org_id,
        shifts,
        period_start=period_start,
        period_end=period_end,
        zone=zone,
        floor=floor,
    )
    violations = judge_shifts(
        placed,
        roster,
        floor,
        days=days_of(period_start, period_end, zone),
        zone=zone,
        overtime_weeks=overtime_weeks,
    )
    violations.extend(
        Violation(e.rule, e.employee_id, e.day, dict(e.detail))
        for e in year_errors
    )

    if violations:
        # One line per publish, not per finding, and it names the mode: the
        # fortnight of watching this module asks for is only possible if the
        # warnings are readable. Codes and counts, no names.
        counted: Dict[str, int] = {}
        for violation in violations:
            counted[violation.code] = counted.get(violation.code, 0) + 1
        log.warning(
            "rota_law: org %s published %s..%s breaking %s (%s)",
            org_id,
            period_start.isoformat(),
            period_end.isoformat(),
            ", ".join("%s x%d" % (c, n) for c, n in sorted(counted.items())),
            mode(),
        )
    return violations
