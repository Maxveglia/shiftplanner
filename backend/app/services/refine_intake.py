from __future__ import annotations

"""Natural-language intake for ADJUSTING a calendar that already exists.

The first prompt builds a schedule (see ``intake.py``); every prompt after it
adjusts the one on screen. The model's only job here is to turn a sentence into
OPERATIONS from a closed list. It never writes a shift: the frontend applies
each operation deterministically, refusing any that would break availability or
an employee's onboarding limits.

The schema is deliberately FLAT — one object shape with nullable fields and an
``op`` discriminator — rather than a tagged union. Models pick the right member
of a flat enum far more reliably than they satisfy a nested ``oneOf``, and the
caller narrows the fields anyway.
"""

import logging
import time
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from app.config import settings
from app.services import api_usage, jev, triage

log = logging.getLogger(__name__)

MODEL = "claude-opus-5"

# How long one attempt may run before the manager is left staring at a spinner.
#
# The intake has had a deadline since the day it shipped; this call never did,
# and the SDK's own default is TEN MINUTES. So an adjustment that went slow --
# a hiccup at the API, a long calendar in the context -- did not fail, it hung,
# and the manager watched a spinner with no way to tell a slow answer from a
# dead one. Shorter than the intake's 90s on purpose: the brief is written once
# and worth waiting for, an adjustment is typed mid-conversation and a fast
# refusal beats a slow success.
TIMEOUT_SECONDS = 45.0

# One retry, not four. Same reasoning: the transient failures worth retrying
# resolve on the first retry, and every further attempt is another 45 seconds
# the manager spends not knowing.
MAX_RETRIES = 1

# Two prompts, because there are two calls.
#
# ONE SCHEMA COULD NOT HOLD BOTH HALVES. `EditOp` described sixteen operations
# over nineteen optional fields -- eleven about a calendar, five about who works
# there -- and the API answered `400 Schema is too complex`. Every refinement
# then fell through to the local regex parser, quietly: the manager said "en la
# hora punta quiero cuatro" and got whatever a regular expression made of it.
#
# So the CALL is split and the vocabulary is not, which is the same trade
# `intake.py` made when `ScheduleFields` filled up. The two run concurrently, so
# the manager waits for the slower one rather than for the sum.

_HEADER = """You turn a manager's request into operations that adjust an \
existing staff schedule.

You are given the current requirements, the team, and the shifts already
planned. Emit ONLY operations from the list below. You never write a shift
yourself and you never invent an employee: use exactly the names given to you.
"""

_COMMON_RULES = """
Rules:
- A time in the calendar you were given may carry "(+1)", meaning it falls on
  the following day: "6:00 PM-4:00 AM (+1)" is ONE shift, ten hours long,
  belonging to the date it starts on. Businesses that work through midnight are
  normal here. To keep such a shift, or to make one, write the end time as the
  clock shows it ("04:00") -- the caller rolls it into the next day.
- Times are 24-hour "HH:MM". Dates are "YYYY-MM-DD" and must come from the
  period you were given.
- weekday is 0=Sunday .. 6=Saturday. Use weekday when the manager says "every
  Friday"; use date when they mean one specific day.
- A STRETCH OF DAYS IS ONE OPERATION, NOT ONE PER DAY. "Juanito cannot work
  from the 15th to the 22nd" is a single day_off with date "2026-10-15" and
  date_to "2026-10-22" -- both ends included. Writing eight operations for it
  is how a week off becomes seven days off and a forgotten one. "The week of
  the 15th" is that same range, Monday to Sunday.
- date_to only ever goes with date. A range plus a weekday means that weekday
  INSIDE the range ("Fridays in October"), which is the only time the two are
  used together.
- Prefer the smallest edit that satisfies the request. Only use a requirement
  operation when the manager is changing a standing rule, not patching one day.
- If the request needs several operations, emit them all in order.
- You are not deciding who is available; the caller checks that and will refuse
  operations it cannot honour.
- `employee` is a name, or "#N" for the roster number shown next to each person.
  Use "#N" whenever the manager refers to someone by position ("the third one",
  "el segundo"). Never invent a name for a placeholder -- rename it instead.

- THIS CALL SEES HALF THE VOCABULARY. Another call, running beside you, handles
  the operations you do not have. A request that belongs entirely to the other
  half is NOT unsupported: return an empty list and leave `unsupported` null.
  Saying a request cannot be expressed, when the other half is expressing it, is
  the one answer that turns a working edit into a refusal.
- Use `unsupported` only for a request that neither half can express -- and then
  return an empty list and explain why. Never approximate with an operation that
  does something different."""

CALENDAR_SYSTEM_PROMPT = _HEADER + """
Operations that edit specific shifts:
- day_off        employee + (date or weekday), optionally + date_to. Clear
                 their shifts and keep them clear.
- remove_shifts  (employee optional) + (date or weekday), optionally + date_to.
                 Empty shifts matching the filter.
- add_shift      employee + date + start + end.
- move_shift     employee + date + start (+ end). Re-time an existing shift.
- swap           employee + employee_b + date. Exchange the two people's shifts.
- add_coverage   (date or weekday) + start + end + staff. MORE people in a
                 window without naming anyone -- "one more person on Saturday
                 evening". Use this whenever the manager asks for extra cover
                 but does not say who should work it.

Operations that change the requirements (these rebuild the whole calendar):
- set_min_staff        staff
- set_peak             start + end + staff
- set_hours            start + end          (opening hours)
- set_closed_day       weekday + closed
- set_max_weekly_hours hours

Hiring, renaming, contracts and employment status are the OTHER call's job.
"Hire Ana and give her Fridays off" is a day_off here, and nothing else.
A person's own premiums (night, weekend, what their extra hours are paid)
belong to a third call: emit nothing for them and do not call them
unsupported.
""" + _COMMON_RULES

ROSTER_SYSTEM_PROMPT = _HEADER + """
Operations that change WHO is on the team (the roster is saved, then the
calendar is rebuilt over the new team):
- add_employee         name (or null) + count. "Add Ana", "hire two more
                       cashiers", "we are three people" when only one exists.
                       Use name=null and count=N for an unnamed headcount; the
                       caller creates numbered placeholders the manager renames
                       later.
- rename_employee      employee + name. The manager naming a placeholder:
                       "employee 2 is called Ana", "the new one is Marcus".
- set_employee_terms   employee + any of employment_type, min_hours_per_week,
                       max_hours_per_week, hourly_rate, annual_salary. Opens a
                       new contract version.
- set_employee_status  employee + status ("active", "onboarding", "on_leave",
                       "resigned"). "Ana is on leave", "Marcus left" -> resigned.
                       Reactivating a resigned person -> status "active".
- add_absence          employee + date (+ date_to) + absence_kind. Time off
                       that has a REASON: illness, a holiday, a day somebody
                       asked for. It is recorded against the person, so it
                       outlives any rebuild of the calendar and the business
                       knows whether those hours are paid.

WHICH ONE IS A DAY OFF AND WHICH ONE IS AN ABSENCE. The other call has a
`day_off`, and the difference is the reason, not the calendar:
- A REASON somebody is away -- "Juanito is ill", "Ana is on holiday that week",
  "Pedro asked for the 18th off", "Marta cannot work from the 15th to the 22nd"
  -- is an add_absence HERE. Do not also emit a day_off for it: recording the
  absence empties those days by itself.
- A PREFERENCE about the rota -- "give Ana her Fridays", "nobody works Sundays",
  "Luis should not close" -- is the other call's day_off, and never an absence.
  Nothing is wrong with that person; it is how the manager wants the week built.
- absence_kind is "sick", "vacation", "personal", "unpaid", or "unknown" when
  the manager did not say. NEVER GUESS IT. Whether those hours are paid, and
  whether they come out of a holiday balance, is a fact about somebody's
  contract and their country's law -- the caller asks the manager when this is
  "unknown", and an invented answer is a wrong payslip nobody sees for a month.
  "Cannot work", "is away", "asked me for the week" say nothing about which.

A PERSON'S OWN PREMIUMS -- their night premium, weekend premium or what their
extra hours are paid ("a Juan no le pago la nocturnidad", "pay Pedro's
overtime at 1.75x") -- belong to a THIRD call. Emit nothing for them here and
do not call them unsupported: if that is all the request says, return no
operations. The rest of the same sentence ("súbele a 12 €") is still yours.

Shifts, days off, opening hours and staffing levels are the OTHER call's job.
"Hire Ana and give her Fridays off" is an add_employee here, and nothing else.

- Only add people the manager actually asks for. If they state a team size and
  the roster is already that size, emit nothing.
""" + _COMMON_RULES


PAY_SYSTEM_PROMPT = _HEADER + """
This call handles ONE thing: a person's OWN premiums. The business has a night
premium, a weekend premium and a price for an extra hour that apply to
everyone; the manager can give one person different ones. Emit one operation
per person whose premiums the request changes, with `employee` exactly as in
the team list (or as the manager names somebody being hired in the same
request), and ONLY the fields the manager stated. Never copy the business's
figure onto a person. Everything else in the request -- hiring, pay rates,
hours, shifts, days off -- belongs to the other two calls: ignore it, and if
the request says nothing about premiums, return no operations.

- night_premium_pct / weekend_premium_pct: percent over the ordinary hour.
  0 means the manager says this person is NOT paid it.
- overtime_multiplier: what their extra hour is paid as a multiple of an
  ordinary one (1.75 = 75% more).
- night_included_in_salary: true only when the manager says night work is
  included / priced into this person's salary.
- premiums_follow_business: true when this person goes back to the business's
  premiums, like everyone else. No figures with it.

Examples:
- "a Juan no le pago la nocturnidad" / "Juan gets no night premium"
  -> employee Juan, night_premium_pct 0.
- "Marta cobra la noche al 30%" -> employee Marta, night_premium_pct 30.
- "Luis tiene la nocturnidad incluida en el sueldo" / "night work is built into
  Luis's salary" -> night_included_in_salary true. Add night_premium_pct 0
  only if the manager ALSO says he is not paid one.
- "a Pedro págale los extras a 1,75" / "pay Pedro's overtime at 1.75x"
  -> employee Pedro, overtime_multiplier 1.75.
- "Ana vuelve a cobrar los pluses como todos" / "Ana is back on the standard
  premiums" -> employee Ana, premiums_follow_business true.
- "súbele a Juan a 12 € y quítale la nocturnidad" -> employee Juan,
  night_premium_pct 0 (the 12 € is the roster call's).
""" + _COMMON_RULES


# Which of the three halves a sentence needs, asked of Jev (`services/jev.py`).
#
# One yes-or-no per half, in ONE call, and each worded from the prompt of the
# half it stands for -- the calendar and roster ones from what `triage` already
# asks as `touches_calendar` / `touches_roster`, the pay one from
# PAY_SYSTEM_PROMPT. What Jev reads is the manager's sentence with every name
# masked (people arrive as e1, e2...), never the context: it is judging what
# the sentence ASKS FOR, and needs no rota for that.
#
# Every `false` ends the same way, and on purpose. The two mistakes do not cost
# the same: a half asked for nothing costs a few cents, a half skipped wrongly
# is a request the manager made and nobody carried out.
_ROUTE_PREAMBLE = (
    "This is one sentence a manager typed to adjust the staff rota of their "
    "business. People in it appear as e1, e2 and so on. "
)
_WHEN_IN_DOUBT = (
    " When in any doubt, answer true: a wrong false loses something the "
    "manager asked for."
)
ROUTE_QUESTIONS: Dict[str, jev.Noul] = {
    "calendar": jev.Noul(
        instructions=_ROUTE_PREAMBLE
        + "Does any part of it ask to change the schedule itself: shifts, days "
        "off, who works when, opening hours, a day the business is closed, how "
        "many people are needed at a time, or a cap on weekly hours for "
        "everyone?",
        true="At least part of the sentence is about shifts, days off, who "
        "works when, opening hours, closed days or how many people are needed "
        "-- even if the rest of it is about something else.",
        false="No part of it is about the schedule: it only changes who is on "
        "the team, somebody's contract or pay, time off with a reason, or "
        "somebody's premiums." + _WHEN_IN_DOUBT,
    ),
    "roster": jev.Noul(
        instructions=_ROUTE_PREAMBLE
        + "Does any part of it change WHO is on the team or on what terms: "
        "hiring or adding people (or stating how many the team is), somebody "
        "leaving or coming back, naming or renaming someone, a contract, "
        "contracted hours, an hourly rate or a salary, an employment status, "
        "or time off that has a reason (illness, holidays, a day somebody "
        "asked for)?",
        true="At least part of the sentence hires, removes, names or re-terms "
        "somebody, changes their status, or records time off with a reason -- "
        "even if the rest of it is about shifts.",
        false="No part of it is about who is on the team, their contract, "
        "their rate or time off with a reason: it only moves shifts, days off, "
        "opening hours or staffing levels, or only touches premiums."
        + _WHEN_IN_DOUBT,
    ),
    "pay": jev.Noul(
        instructions=_ROUTE_PREAMBLE
        + "Does any part of it change one person's OWN premiums: their night "
        "premium (nocturnidad), their weekend premium, what their overtime or "
        "extra hours are paid (a multiplier such as 1.75x), night work being "
        "included in their salary, or putting them back on the business's "
        "standard premiums like everyone else?",
        true="At least part of the sentence sets, removes or restores "
        "somebody's night or weekend premium, their overtime rate, or night "
        "work included in their salary -- even if the rest of it is about "
        "something else.",
        false="Nothing in it is about premiums, night or weekend bonuses or "
        "what overtime is paid; a plain hourly rate or salary is not a "
        "premium." + _WHEN_IN_DOUBT,
    ),
}

# Below this, and only when `jev_route_enforced` is on, a half is not asked.
#
# Deliberately far from a coin toss. Skipping is the one move here that can
# lose a request, so it is reserved for sentences Jev is nearly certain a half
# has nothing to do with -- "sube el plus de noche de Ana" and the calendar.
# Anything in between is asked, which is what happened before Jev existed.
# The `jev: route check` lines are the evidence for moving it: they say, for
# every sentence, the probability each half got and how many operations that
# half actually returned. A half with operations below this line is the number
# that says it is too high.
SKIP_BELOW = 0.05

_HALVES = ("calendar", "roster", "pay")


class EditOp(BaseModel):
    """One edit, in the vocabulary the rest of the app speaks.

    Still one type, and deliberately: the caller applies a plan, and a plan that
    arrived as two lists is no different once it is one. What is split is the
    CALL -- see the two schemas below, and the note on the prompts.
    """

    op: Literal[
        "day_off",
        "remove_shifts",
        "add_shift",
        "move_shift",
        "swap",
        "add_coverage",
        "set_min_staff",
        "set_peak",
        "set_hours",
        "set_closed_day",
        "set_max_weekly_hours",
        "add_employee",
        "rename_employee",
        "set_employee_terms",
        "set_employee_status",
        "add_absence",
    ] = Field(description="Which operation to perform.")
    employee: Optional[str] = Field(
        default=None, description="Employee name exactly as given in the team list."
    )
    employee_b: Optional[str] = Field(
        default=None, description="The second employee, for `swap` only."
    )
    absence_kind: Optional[str] = Field(
        default=None, description="For add_absence: the kind of leave, or unknown."
    )
    date: Optional[str] = Field(
        default=None, description='A single day, "YYYY-MM-DD".'
    )
    date_to: Optional[str] = Field(
        default=None,
        description='The last day of a stretch, "YYYY-MM-DD", included. Set it '
        "with `date` to say a range in one operation: a week off, a holiday. "
        "Null for a single day.",
    )
    weekday: Optional[int] = Field(
        default=None, description="0=Sunday .. 6=Saturday, for every occurrence."
    )
    start: Optional[str] = Field(default=None, description='Start time "HH:MM".')
    end: Optional[str] = Field(default=None, description='End time "HH:MM".')
    staff: Optional[int] = Field(
        default=None, description="Number of employees required."
    )
    hours: Optional[int] = Field(default=None, description="A number of hours.")
    closed: Optional[bool] = Field(
        default=None, description="For set_closed_day: true closes, false opens."
    )
    name: Optional[str] = Field(default=None)
    count: Optional[int] = Field(default=None)
    employment_type: Optional[str] = Field(default=None)
    min_hours_per_week: Optional[float] = Field(default=None)
    max_hours_per_week: Optional[float] = Field(default=None)
    hourly_rate: Optional[float] = Field(default=None)
    annual_salary: Optional[float] = Field(default=None)
    # Carried because the roster half is converted INTO this type before it
    # leaves the server (see `plan_edits`): a field missing here is dropped
    # silently, however well the model filled it in.
    night_premium_pct: Optional[float] = Field(default=None)
    weekend_premium_pct: Optional[float] = Field(default=None)
    overtime_multiplier: Optional[float] = Field(default=None)
    night_included_in_salary: Optional[bool] = Field(default=None)
    premiums_follow_business: Optional[bool] = Field(default=None)
    status: Optional[str] = Field(default=None)
    starts_on: Optional[str] = Field(default=None)


class CalendarOp(BaseModel):
    """An edit to the schedule or to the standing requirements.

    Eleven operations over nine fields. The nine roster fields are not here, and
    that absence is the entire fix: with all nineteen in one model the API
    refused the request outright.
    """

    op: Literal[
        "day_off",
        "remove_shifts",
        "add_shift",
        "move_shift",
        "swap",
        "add_coverage",
        "set_min_staff",
        "set_peak",
        "set_hours",
        "set_closed_day",
        "set_max_weekly_hours",
    ] = Field(description="Which operation to perform.")
    employee: Optional[str] = Field(
        default=None, description="Employee name exactly as given in the team list."
    )
    employee_b: Optional[str] = Field(
        default=None, description="The second employee, for `swap` only."
    )
    date: Optional[str] = Field(
        default=None, description='A single day, "YYYY-MM-DD".'
    )
    date_to: Optional[str] = Field(
        default=None,
        description='The last day of a stretch, "YYYY-MM-DD", included. Set it '
        "with `date` to say a range in one operation: a week off, a holiday. "
        "Null for a single day.",
    )
    weekday: Optional[int] = Field(
        default=None, description="0=Sunday .. 6=Saturday, for every occurrence."
    )
    start: Optional[str] = Field(default=None, description='Start time "HH:MM".')
    end: Optional[str] = Field(default=None, description='End time "HH:MM".')
    staff: Optional[int] = Field(
        default=None, description="Number of employees required."
    )
    hours: Optional[int] = Field(default=None, description="A number of hours.")
    closed: Optional[bool] = Field(
        default=None, description="For set_closed_day: true closes, false opens."
    )


class RosterOp(BaseModel):
    """A change to WHO is on the team."""

    op: Literal[
        "add_employee",
        "rename_employee",
        "set_employee_terms",
        "set_employee_status",
        "add_absence",
    ] = Field(description="Which operation to perform.")
    employee: Optional[str] = Field(
        default=None, description="Employee name exactly as given in the team list."
    )
    date: Optional[str] = Field(
        default=None,
        description='For add_absence: the first day off, "YYYY-MM-DD".',
    )
    date_to: Optional[str] = Field(
        default=None,
        description='For add_absence: the last day off, "YYYY-MM-DD", included. '
        "Null when it is a single day.",
    )
    absence_kind: Optional[str] = Field(
        default=None,
        description='For add_absence: "sick", "vacation", "personal", "unpaid", '
        'or "unknown" when the manager did not say which. Never guess it.',
    )
    name: Optional[str] = Field(
        default=None,
        description="For add_employee, the new person's name if the manager "
        "gives one, else null. For rename_employee, the name to give them.",
    )
    count: Optional[int] = Field(
        default=None,
        description="For add_employee: how many people to add. 1 for a named "
        "person, N for an unnamed headcount.",
    )
    employment_type: Optional[str] = Field(
        default=None,
        description='One of "exempt_salaried", "non_exempt_hourly", '
        '"non_exempt_salaried" if stated; null otherwise.',
    )
    min_hours_per_week: Optional[float] = Field(
        default=None,
        description="Contracted minimum weekly hours. Full-time -> 40, "
        "part-time -> 20 unless a number is given.",
    )
    max_hours_per_week: Optional[float] = Field(
        default=None, description="Maximum weekly hours for this person, if stated."
    )
    hourly_rate: Optional[float] = Field(
        default=None, description="Hourly pay rate in dollars, if stated."
    )
    annual_salary: Optional[float] = Field(
        default=None, description="Annual salary in dollars, if stated."
    )
    status: Optional[str] = Field(
        default=None,
        description='"active", "onboarding" (new hire / in training), "on_leave" '
        '(medical leave / sabbatical) or "resigned" (they left).',
    )
    starts_on: Optional[str] = Field(
        default=None, description='Hire/start date "YYYY-MM-DD" if the brief gives one.'
    )


class PayOp(BaseModel):
    """One person's own premiums.

    A third call rather than five more fields on `RosterOp`: the roster schema
    sits near the API's structured-output complexity limit, and every attempt
    to fit the premiums into it came back `400 Schema is too complex`. Flat,
    and merged into the roster half by `merge_pay` before anything leaves the
    server.
    """

    employee: Optional[str] = Field(
        default=None, description="Employee name exactly as given in the team list."
    )
    night_premium_pct: Optional[float] = Field(
        default=None,
        description="This person's own night premium in percent. 0 when the "
        "manager says they are NOT paid a night premium. Null when unstated -- "
        "never copy the business's.",
    )
    weekend_premium_pct: Optional[float] = Field(
        default=None,
        description="This person's own weekend premium in percent. 0 when the "
        "manager says they are NOT paid one. Null when unstated.",
    )
    overtime_multiplier: Optional[float] = Field(
        default=None,
        description="What this person's extra hour is paid as a multiple of an "
        "ordinary one (1.75 = 75% more). Null when unstated.",
    )
    night_included_in_salary: Optional[bool] = Field(
        default=None,
        description="True only when the manager says this person's night work "
        "is included / priced into their salary.",
    )
    premiums_follow_business: Optional[bool] = Field(
        default=None,
        description="True when the manager says this person goes back to the "
        "business's premiums, like everyone else.",
    )


class PayPlan(BaseModel):
    ops: List[PayOp] = Field(
        default_factory=list, description="Operations to apply, in order."
    )


class CalendarPlan(BaseModel):
    ops: List[CalendarOp] = Field(
        default_factory=list, description="Operations to apply, in order."
    )
    unsupported: Optional[str] = Field(
        default=None,
        description="Set only when the request cannot be expressed as operations "
        "by EITHER call. A request that belongs to the roster call is not "
        "unsupported: return no operations and leave this null.",
    )


class RosterPlan(BaseModel):
    ops: List[RosterOp] = Field(
        default_factory=list, description="Operations to apply, in order."
    )
    unsupported: Optional[str] = Field(
        default=None,
        description="Set only when the request cannot be expressed as operations "
        "by EITHER call. A request that belongs to the calendar call is not "
        "unsupported: return no operations and leave this null.",
    )


class EditPlan(BaseModel):
    ops: List[EditOp] = Field(
        default_factory=list, description="Operations to apply, in order."
    )
    unsupported: Optional[str] = Field(
        default=None,
        description="Set only when the request cannot be expressed as operations.",
    )
    standing_rule: Optional[str] = Field(
        default=None,
        description="A rule about how this business always runs, if the "
        "request stated one. Read by the triage desk, not by either planner, "
        "and recorded as a proposal the manager confirms.",
    )


#: The ranges the contract API accepts. A figure outside them is dropped here,
#: so a misread number costs the manager nothing rather than failing the save.
_PAY_RANGES = {
    "night_premium_pct": (0.0, 200.0),
    "weekend_premium_pct": (0.0, 200.0),
    # Never below 1: an extra hour is not paid under an ordinary one
    # (art. 35.1 ET).
    "overtime_multiplier": (1.0, 5.0),
}
_PAY_FLAGS = ("night_included_in_salary", "premiums_follow_business")


def _pay_fields(op: PayOp) -> dict:
    """What one pay operation actually says, in `EditOp`'s field names.

    Only what the manager stated: a null stays out, a false flag stays out
    (false is "not said", the same as null), and a figure outside the API's
    range stays out.
    """
    out: dict = {}
    for field, (low, high) in _PAY_RANGES.items():
        value = getattr(op, field)
        if value is not None and low <= value <= high:
            out[field] = float(value)
    for flag in _PAY_FLAGS:
        if getattr(op, flag) is True:
            out[flag] = True
    return out


def _person_key(name: Optional[str]) -> Optional[str]:
    return name.strip().casefold() if name and name.strip() else None


def merge_pay(roster_ops: List[EditOp], pay_ops: List[PayOp]) -> List[EditOp]:
    """The pay half folded into the roster half, in the order the client applies.

    ONE CONTRACT VERSION PER PERSON PER REQUEST. "Súbele a 12 € y quítale la
    nocturnidad" reaches the roster call as a set_employee_terms (the rate) and
    the pay call as a premium. Two operations would open two contract versions
    on the same valid_from, and `create_contract` closes the previous one the
    day BEFORE the new one starts -- so the first would end before it began.
    So a pay operation for somebody the roster half already hires
    (add_employee, by `name`) or re-terms (set_employee_terms, by `employee`)
    is folded into that operation. Matching is on the name, trimmed and
    case-insensitive; the first such operation wins.

    Anyone else gets a set_employee_terms of their own carrying only the
    premium fields, placed after the roster operations: a premium for somebody
    hired in the same sentence must come after the hire.
    """
    merged = [op.model_copy() for op in roster_ops]
    targets: dict = {}
    for i, op in enumerate(merged):
        if op.op == "add_employee":
            key = _person_key(op.name)
        elif op.op == "set_employee_terms":
            key = _person_key(op.employee)
        else:
            continue
        if key is not None and key not in targets:
            targets[key] = i

    extra: List[EditOp] = []
    for pay in pay_ops:
        fields = _pay_fields(pay)
        key = _person_key(pay.employee)
        if not fields or key is None:
            continue
        if key in targets:
            i = targets[key]
            merged[i] = merged[i].model_copy(update=fields)
        else:
            extra.append(
                EditOp(
                    op="set_employee_terms", employee=pay.employee.strip(), **fields
                )
            )
    return merged + extra


def _route_from(pending) -> Optional[Dict[str, float]]:
    """P(this half is needed) for each of the three, or None.

    None unless ALL THREE came back: a route with a hole in it is not one to
    act on, and the caller then asks every half, as it did before Jev.
    """
    if pending is None:
        return None
    try:
        answers = pending.result()
    except Exception:  # noqa: BLE001 - `jev.ask` never raises; this is the belt
        log.exception("jev: the route question failed")
        return None
    route = {}
    for half in _HALVES:
        answer = (answers or {}).get(half)
        if answer is None or answer.yes is None:
            log.info("jev: no route (asked every half)")
            return None
        route[half] = answer.yes
    return route


def plan_edits(
    text: str,
    context: str,
    api_key: Optional[str],
    route_state: Optional[str] = None,
) -> EditPlan:
    """Ask Claude for an edit plan. Raises on failure; the caller falls back.

    THREE CALLS, ONE PLAN. The calendar, the roster and the pay premiums, a
    share of the vocabulary each, running at the same time, so the manager
    waits for the slowest rather than for their sum. The premiums are a call of
    their own because the roster schema is at the API's complexity ceiling --
    adding them to it was refused outright. The result is recombined here
    (`merge_pay`) and the caller sees what it always saw.

    ROSTER OPERATIONS COME FIRST in the merged list, and the order is not
    cosmetic: "hire Ana and give her Fridays off" only works if Ana exists
    before anything tries to clear her Fridays. One model used to decide that
    order; now the merge does, and it makes the same choice every time.

    A THIRD, CHEAP CALL RUNS FIRST. `triage` reads the sentence on a small
    model and resolves its dates and its names before either planner sees it --
    see that module for why that is worth a call. Every half is still asked,
    every time, whatever it says about which one the sentence touches: that
    part is written to the log and acted on by nobody, until there is evidence
    it is never wrong. And if it fails for any reason at all, this function
    behaves exactly as it did before it existed.

    JEV MAY SAY WHICH HALVES TO ASK, AND BY DEFAULT IT ONLY SAYS SO. With
    ``route_state`` -- the manager's sentence, names masked, from the router;
    None when Jev is off -- one closed question per half goes to Jev
    (`ROUTE_QUESTIONS`). It is sent BEFORE the desk and read AFTER it: Jev
    answers in about a quarter of a second, the desk in about two, so the
    manager waits for nothing new. Then:

    - In the shadow (``jev_route_enforced`` off, the default) all three halves
      are asked exactly as before, and two lines go to the log -- what Jev
      said, and next to it how many operations each half actually returned.
      Grep `jev: route check`: that line is the evidence for switching it on.
    - Enforced, a half Jev gives less than `SKIP_BELOW` is not asked and its
      plan is the empty one. Never the calendar and the roster together --
      a sentence that needs neither is a sign the answer is wrong, not a
      saving -- and never on a partial answer: if Jev did not answer for all
      three, all three are asked.
    """
    import anthropic
    from concurrent.futures import ThreadPoolExecutor
    from contextvars import copy_context

    client = (
        anthropic.Anthropic(
            api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES
        )
        if api_key
        else anthropic.Anthropic(timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES)
    )
    message = "%s\n\nMANAGER'S REQUEST:\n%s" % (context, text)

    # Jev is asked first and read after the desk, so its quarter of a second
    # hides behind the desk's two. Under a copy of this context, like the
    # halves below, so its row reaches the router's ledger. The pool is shut
    # at once: that stops it taking more work, not the question already in it.
    route_pending = None
    if route_state:
        route_pool = ThreadPoolExecutor(max_workers=1)
        route_pending = route_pool.submit(
            copy_context().run, jev.ask, route_state, ROUTE_QUESTIONS, "route"
        )
        route_pool.shutdown(wait=False)

    # The desk reads it first. What comes back is an AID, never a replacement:
    # the manager's own sentence is still the request above, and the resolved
    # version is appended under a heading that says which is which. A desk that
    # misreads the sentence therefore costs the planner nothing it had before.
    desk = triage.read_the_request(text, context, api_key)
    if desk is not None:
        if desk.request.strip() != text.strip():
            message += (
                "\n\nWHAT ITS DATES AND NAMES RESOLVE TO (a fast pre-pass over "
                "the same request -- the manager's words above are what counts, "
                "and where the two disagree, THEY win):\n%s" % desk.request.strip()
            )
        if desk.unresolved:
            message += (
                "\n\nThe pre-pass could not resolve this, so it is left as the "
                "manager wrote it: %s" % desk.unresolved.strip()
            )
        # Written down, obeyed by nobody. When these lines show months of
        # agreement with what the two halves actually returned, skipping the
        # half it calls untouched becomes a saving with evidence behind it
        # rather than a guess. Grep: `triage: routed`.
        log.info(
            "triage: routed calendar=%s roster=%s (both asked anyway)"
            " unresolved=%s",
            desk.touches_calendar,
            desk.touches_roster,
            bool(desk.unresolved),
        )

    # Which halves to ask. `skip` is empty unless Jev is enforced, answered
    # for all three, and is nearly sure of one of them -- every other path
    # asks everything, which is what this function did before Jev.
    enforced = settings.jev_route_enforced
    route = _route_from(route_pending)
    skip: set = set()
    if route is not None:
        log.info(
            "jev: routed calendar=%.2f roster=%.2f pay=%.2f enforced=%s",
            route["calendar"],
            route["roster"],
            route["pay"],
            enforced,
        )
        if enforced:
            skip = {half for half in _HALVES if route[half] < SKIP_BELOW}
            # Every request is about the schedule or the team, or both. Jev
            # saying neither is the answer being wrong, not a sentence that
            # needs nothing -- so none of it is trusted.
            if {"calendar", "roster"} <= skip:
                log.warning(
                    "jev: calendar and roster both below %.2f; asked every half",
                    SKIP_BELOW,
                )
                skip = set()
            if skip:
                log.info("jev: skipped %s", ",".join(sorted(skip)))

    def ask(system: str, schema):
        purpose = "refine." + schema.__name__.replace("Plan", "").lower()
        # The SDK retries inside `parse`, so an attempt that generated tokens
        # and then timed out was billed and, until this middleware, noted
        # nowhere. `api_usage.meter_attempts` explains why the fix is a hook
        # and not a retry loop of our own; `with_middleware` is a cheap client
        # copy over the same connection pool, one per call, so each of the two
        # concurrent calls carries its own purpose.
        metered = client.with_middleware(api_usage.meter_attempts(purpose, MODEL))
        started = time.monotonic()
        response = metered.messages.parse(
            model=MODEL,
            max_tokens=4096,
            system=system,
            thinking={"type": "adaptive"},
            output_config={"effort": "low"},
            messages=[{"role": "user", "content": message}],
            output_format=schema,
        )
        # Timed around the call itself: an adjustment is typed mid-conversation
        # and "why did that take so long" is a question the meter should be
        # able to answer without the application log.
        api_usage.note(
            purpose,
            MODEL,
            response.usage,
            int((time.monotonic() - started) * 1000),
        )
        parsed = response.parsed_output
        if parsed is None:
            raise ValueError("Claude did not return a valid %s" % schema.__name__)
        return parsed

    # Under a copy of this context so the router's usage ledger sees both.
    with ThreadPoolExecutor(max_workers=3) as pool:

        def submit(half: str, system: str, schema):
            if half in skip:
                return None
            return pool.submit(copy_context().run, ask, system, schema)

        calendar = submit("calendar", CALENDAR_SYSTEM_PROMPT, CalendarPlan)
        roster = submit("roster", ROSTER_SYSTEM_PROMPT, RosterPlan)
        pay = submit("pay", PAY_SYSTEM_PROMPT, PayPlan)
        # Neither is optional. A refusal from either one is a refusal of the
        # whole request: the caller falls back to its local parser, and doing
        # that with half a plan applied would be worse than not trying. A half
        # Jev ruled out is not a refusal: it is the empty plan it would have
        # returned.
        calendar_plan = calendar.result() if calendar is not None else CalendarPlan()
        roster_plan = roster.result() if roster is not None else RosterPlan()
        # The pay call is the exception, and on purpose. It is the newest and
        # the narrowest -- most sentences say nothing about premiums -- and
        # letting it fail a request about Friday's shifts would make every
        # refinement only as reliable as the one nobody asked. So its failure
        # is logged and the other two halves stand. Only when they brought
        # back nothing is it re-raised: then the premiums may well have been
        # the whole request, and the caller falls back exactly as it does
        # when either of the other halves fails.
        pay_failed = False
        try:
            pay_plan = pay.result() if pay is not None else PayPlan()
        except Exception:
            if not roster_plan.ops and not calendar_plan.ops:
                raise
            log.exception("refine: the pay call failed; kept the other two halves")
            pay_plan = PayPlan()
            pay_failed = True

    # What Jev said next to what each half actually did, and the line that
    # decides whether `jev_route_enforced` can go on: a half with operations
    # and a probability under SKIP_BELOW is a request enforcing would have
    # lost. Written only when all three halves really answered -- a skipped
    # half or a failed pay call returns no operations, and counting that as
    # agreement would be evidence we manufactured. Grep: `jev: route check`.
    if route is not None and not skip and not pay_failed:
        log.info(
            "jev: route check calendar=%.2f/%d roster=%.2f/%d pay=%.2f/%d",
            route["calendar"],
            len(calendar_plan.ops),
            route["roster"],
            len(roster_plan.ops),
            route["pay"],
            len(pay_plan.ops),
        )

    ops = merge_pay(
        [EditOp(**op.model_dump()) for op in roster_plan.ops], pay_plan.ops
    )
    ops += [EditOp(**op.model_dump()) for op in calendar_plan.ops]

    # The desk's reading of the sentence as a standing rule, carried out to the
    # router, which is where a database session exists to record it. Null on
    # nearly every request, which is correct: most sentences are about a week.
    standing_rule = desk.standing_rule if desk is not None else None

    # "Cannot be expressed" is only true when NOTHING was expressed. Each call
    # sees half the vocabulary, so one of them saying so while the other is
    # busy answering is the expected case, not a refusal.
    unsupported = None
    if not ops:
        unsupported = calendar_plan.unsupported or roster_plan.unsupported

    return EditPlan(ops=ops, unsupported=unsupported, standing_rule=standing_rule)
