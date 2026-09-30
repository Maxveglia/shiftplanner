from __future__ import annotations

"""Natural-language intake: manager brief -> validated scheduling spec.

The LLM's ONLY job here is translation. It fills a closed, validated schema;
it never assigns a shift and never sees salaries or medical reasons. The
generated spec is shown to the manager for confirmation, and the scheduler
(greedy today, CP-SAT in Phase 5) is what actually builds the calendar.
"""

import re
import time
from typing import List, Optional, Tuple

from pydantic import BaseModel, Field

from app.services import api_usage

MODEL = "claude-opus-5"

# How long we let a call run before the manager is left staring at a spinner.
# Past this the local parser is the better experience, and the UI says which
# one ran. Without an explicit timeout the SDK waits ten minutes.
TIMEOUT_SECONDS = 90.0

# Attempts per call before giving up. Transient failures (rate limit, 5xx,
# timeout) are retried with backoff by the SDK; a 400 for a malformed schema is
# not retryable and fails immediately, which is what the schema contract test
# exists to catch before it ever reaches a manager.
#
# THREE, NOT FIVE, AND THE ARITHMETIC IS THE REASON. The rule this file shares
# with calendar_plan.py is that the SERVER gives up first, so that what the
# manager sees is our explanation rather than the browser's shrug. But the
# ceiling is TIMEOUT_SECONDS times attempts, not TIMEOUT_SECONDS: at five
# attempts that is 450s against the 300s the browser allows for /interpret
# (INTERPRET_TIMEOUT_MS in frontend/src/api/schedule.ts), so the browser gave
# up first and could only report that it had waited. Three attempts is 270s
# and lands under it. Raising either number means checking that one again.
MAX_RETRIES = 2

WEEKDAY_INDEX = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
}

SYSTEM_PROMPT = """You translate a manager's staffing brief into a structured \
scheduling specification.

Rules:
- Extract ONLY what the brief states or clearly implies. Do not invent staffing \
levels, opening hours, closures, or people that were not mentioned.
- Leave a field null when the brief does not cover it; the caller applies its \
own defaults.
- Times use 24-hour "HH:MM" strings. A business open until midnight closes at \
"24:00".
- A business that works PAST midnight is written the way it is spoken: a bar \
open from nine in the morning until four the next morning is `open_time` \
"09:00" and `close_time` "04:00", and a busy stretch from eleven at night \
until four is a coverage window "23:00" to "04:00". Do not clip either one at \
midnight and do not split it into two, and never write an hour above "24:00". \
The caller understands a close that comes before its open and rolls it into \
the next day.
- The brief may be in any language (commonly Spanish or English).
- Capture EVERY staffing requirement the brief makes. `notes` is the last \
resort, not the first: before you put something there, check whether \
`coverage`, `day_hours`, `closed_dates` or `shift_length_hours` can hold it.
- Days the brief RANKS as busier without giving a number ("Mondays and \
Saturdays are our busiest") get read separately and are not your job. Never \
put them in `notes`, and never turn one into coverage by inventing a number: \
"four on Saturdays" IS coverage, "Saturdays are busiest" is not.
- WHO the team is gets read separately and is not your job. Never describe the \
roster in `notes` -- not their hours, pay, contract type, start date or status. \
"Marcus works 80 hours a week" is the roster's to record, so it is NOT a note, \
even though you cannot see where it went. Only a rule about a named person \
that no roster field could hold -- "Ana only works mornings", a shift \
PREFERENCE rather than a contract term -- belongs in `notes`.

Coverage (`coverage`): every requirement of the form "N people at such a time".
- `min_staff` is the flat floor that applies whenever the business is open. \
Anything narrower than that is a coverage rule.
- Scope a rule with `weekdays` ("four on Saturdays"), with `dates` ("six on \
2026-12-24"), with a window ("three from 12:00 to 15:00"), or any combination \
("three on Friday and Saturday evenings").
- Leave `weekdays` and `dates` empty for a rule that applies every open day, \
and leave `start_time`/`end_time` null for one that applies all day.
- Emit as MANY rules as the brief describes. Two busy windows are two rules; \
a different number on each weekday is one rule per weekday.
- A DIP needs `exact` true. "Two all day but only one over lunch" is a \
min_staff of 2 plus a 13:00-15:00 rule of 1 with exact=true, and the result at \
lunch is one. Never send a dip to `notes` -- coverage holds it.
- A FLOOR keeps `exact` false: "at least one person at closing", "siempre \
alguien en el cierre". These may only raise cover, never lower it. Marking a \
floor as exact would CUT staff where the brief asked for a guarantee, so when \
the wording is "at least"/"al menos"/"siempre", exact is false.
- Rules of the same breadth stack by maximum, never by sum: "at least 2, and 4 \
at lunch" is a min_staff of 2 plus one lunch rule of 4 -- not 6.

Opening hours: `open_time`/`close_time` are the standing hours. When one \
weekday differs ("Sundays we only open 10:00-14:00"), keep the standing hours \
and add a `day_hours` entry for that weekday.

Closures: a recurring closure is a weekday in `closed_weekdays`; a one-off \
("closed on 2026-01-01") is a date in `closed_dates`.

Shift length: set `shift_length_hours` when the brief asks for shifts of a \
given length ("turnos de 6 horas", "eight-hour shifts").

Split shifts: set `split_shifts_allowed` true when the brief lets one person \
work two separate shifts in one day ("turnos partidos", "cuatro horas por la \
manana y otras cuatro por la tarde"). Without it nobody gets more than one \
shift a day, which caps a week well below what a full-time contract needs. \
Answer only WHETHER they are allowed: HOW MANY people may work a split day \
("dos personas pueden hacer turno partido") is read separately and is not your \
job, so never put that number in `notes` either.

How far ahead: WHICH PERIOD the calendar covers goes in `horizon`, never in \
`notes`. It is a short string with exactly three shapes, and today's date is \
given to you so a named month resolves to a real one:
- a number, for months forward: "the next five months" -> "5", "el trimestre" \
-> "3", "todo el ano" -> "12".
- "YYYY-MM", for one named month: "solo el mes de octubre" -> "2026-10", \
"hazlo para octubre" -> "2026-10", "the rota for October" -> "2026-10".
- "YYYY-MM:N", for N months from a named one: "octubre y noviembre" -> \
"2026-10:2".
A single month named with no length is THAT month and nothing more. Never \
lengthen it from the business background, the season, or what a bar usually \
plans: the manager pays for every month planned, and only the brief says how \
many.
A brief counting in WEEKS ("las proximas tres semanas") rounds to the whole \
months it fits inside. Leave `horizon` null when the brief does not say.

Weekly hours: `max_hours_per_week` is a ceiling, not a target, and it is NOT \
capped by any legal limit -- if the brief says eighty hours, write eighty. \
Whether that is wise is the manager's call, not yours to soften.

You are not scheduling anyone. You are only structuring the request."""


TEAM_SYSTEM_PROMPT = """You read a manager's staffing brief and write down WHO \
the team is.

Team roster (`team`): if the brief describes WHO is on the team, capture it.
- A named person ("Marcus", "Ana la cajera") is one entry with `name` set and \
`count` = 1.
- An anonymous headcount ("5 employees", "3 part-time cooks") is one entry with \
`name` = null and `count` = the number.
- A CONTRACT of N hours binds in both directions: set min_hours_per_week AND \
max_hours_per_week to N. "un contrato de 20 horas" is twenty hours, not "at \
least twenty" -- leaving the maximum null lets the scheduler hand a 20-hour \
contract thirty hours of work. Same for "trabaja 40 horas", "works 80 hours a \
week", "jornada completa" (40) and "media jornada" (20) when no number is \
given. Only leave max_hours_per_week null when the brief states a floor and \
nothing else ("at least 15 hours", "un minimo de 15 horas").
- A salaried manager is "exempt_salaried"; an hourly worker is \
"non_exempt_hourly". Leave employment_type null if unclear.
- Use status "onboarding" for a new hire / someone starting soon / in training, \
"on_leave" for medical leave or a sabbatical, otherwise leave it null.
- A person's OWN premiums, only when the brief states them for that person: \
"a Juan no le pago la nocturnidad" -> night_premium_pct 0; "Marta cobra la \
noche al 30%" -> night_premium_pct 30; "Pedro cobra las horas extra a 1,75" -> \
overtime_multiplier 1.75; "Luis tiene la nocturnidad incluida en el sueldo" -> \
night_included_in_salary true (night_premium_pct stays null unless a figure or \
"no le pago" is also said). Premiums stated for the whole business are not a \
person's: leave these null and never copy the business's figure onto anyone.
- Only populate `team` when the brief actually talks about staff. A brief that \
only states hours and coverage has an empty team.

You never invent a person, a salary or a medical reason, and you never assign \
anyone to a shift. If the brief only talks about hours and coverage, the team \
is empty."""


EMPHASIS_SYSTEM_PROMPT = """You read a manager's staffing brief and write down \
four things: which weekdays they call BUSIER than the rest, which HOURS OF THE \
DAY they call busier, HOW MANY people may work a split day, and which days they \
give their OWN hours to without saying what those hours are.

BUSY WEEKDAYS (`busy_weekdays`) -- only the ranking, and only when NO number \
is attached to it.

- "Mondays, Thursdays, Fridays and Saturdays are our busiest days" -> those \
four weekdays.
- "Saturdays are mad" / "los viernes hay mas jaleo" -> that weekday.
- "Four people on Saturdays" -> NOTHING. That states a number, so it is a \
coverage requirement and it is read elsewhere. Putting it here too would make \
the manager answer a question they already answered.
- A brief that never ranks its days -> an empty list.

ALWAYS answer with LOWERCASE ENGLISH weekday names -- "monday", "tuesday",
"wednesday", "thursday", "friday", "saturday", "sunday" -- whatever language
the brief is written in. "los viernes" is "friday". A name in any other
language is discarded by the caller, silently, and the manager is never asked
the question at all.

You are not deciding how many people work those days, and you must not \
suggest a number. Someone asks the manager for it. Ranking a day is a question \
worth asking, never a staffing level you may invent.

BUSY WINDOWS (`busy_windows`) -- the same idea, for hours instead of days.

A stretch of the day the brief calls busier, heavier or in need of more \
people, WITHOUT saying how many. Write each one as "HH:MM-HH:MM" on a \
24-hour clock.

- "a mediodia hace falta mas gente" -> ["13:00-16:00"]
- "las tardes son las mas fuertes" -> ["17:00-21:00"]
- "we need more hands over lunch and again at dinner" -> two entries.
- "three people from 1pm to 4pm" -> NOTHING. That states a number, so it is a \
coverage requirement and it is read elsewhere.
- A brief that never singles out an hour -> an empty list.

You may put a clock time on a vague phrase -- that is reading a language, not \
inventing a requirement, and "mediodia" is a time of day in every kitchen. \
What you must NOT do is put a number of PEOPLE on it. If the brief gives no \
hours at all and no way to place the stretch, leave it out entirely rather \
than guessing at both ends.

A window that runs past midnight is written as it is spoken: \
"23:00-04:00". The caller understands a close that comes before its open.

DAYS WITH THEIR OWN HOURS, UNSAID (`unclear_hours`) -- a day the brief treats \
as having a different timetable, without giving one.

- "los sabados abrimos casi todo el dia" -> saturday, quoting those words.
- "el viernes cerramos mas tarde" -> friday, quoting those words.
- "on Sundays we open late" -> sunday.
- "los viernes cerramos a las cuatro" -> NOTHING. That gives the hours, so it \
is a day_hours rule and it is read elsewhere.
- "los sabados hay mas jaleo" -> NOTHING here. That ranks the day as busier \
without touching its timetable, and it belongs in busy_weekdays.
- A brief whose days all come with times, or which singles out no day -> an \
empty list.

`quote` is the manager's OWN WORDS, copied from the brief exactly as they \
wrote them. It is read back to them when we ask, so a paraphrase makes the \
product look like it misheard. Never invent the hours: the whole point of this \
field is that nobody knows them yet.

SPLIT SHIFTS (`split_shift_people`) -- HOW MANY people, PER DAY, the brief \
lets work two separate shifts in one day ("turnos partidos": a stretch in the \
morning and another in the evening, same person, same day).

Fill it ONLY with a number the brief actually states:
- "dos personas pueden hacer turno partido" -> 2
- "uno puede venir por la manana y por la tarde" -> 1
- "one person can work a split day" -> 1
- "up to three people can do split shifts" -> 3

This number is NOT scoped to particular days -- it is how many people may work
a split on any open day. So do not read a day-scoped sentence as if it were
this field: "tres empleados haran jornada partida los sabados" states three
people ON SATURDAYS, and the caller has nowhere to put the Saturday. Answer
null there rather than turning it into an every-day allowance the manager never
granted; they would see "three people a day" confirmed back and have no way to
tell it lost the day it was about.

Answer null in EVERY other case:
- "se permiten turnos partidos" / "split shifts are allowed" -> null. That \
permits them without saying for how many people, and the caller has its own \
rule for what that means.
- "turnos partidos si hace falta" / "we can do splits if needed" -> null.
- A brief that never mentions split shifts -> null.

Never invent this number and never derive it from something else. The size of \
the team is not it: "tenemos cinco empleados y se permiten turnos partidos" is \
null, NOT 5. A staffing level is not it either: "cuatro personas los sabados" \
is coverage, read elsewhere, and it is null here. Guessing hands double days \
to people the manager never offered them to, so when in doubt, null."""


class CoverageRule(BaseModel):
    """One "N people at such a time" requirement.

    Replaces the old single `peak` field, which could hold exactly one busy
    window for the whole week -- so "four on Saturdays" or a second rush at
    dinner had nowhere to go and ended up as an unenforceable note.
    """

    exact: bool = Field(
        default=False,
        description="True when this number REPLACES the staffing level in its "
        "window, including downward -- a lunchtime dip to one person. False "
        "(the default) when it is a floor that may only raise cover, such as "
        '"at least one person at closing". Get this wrong downward and the '
        "shop is left understaffed.",
    )
    weekdays: List[str] = Field(
        default_factory=list,
        description="Lowercase English weekday names this applies to, e.g. "
        '["saturday"]. Empty means every open day.',
    )
    dates: List[str] = Field(
        default_factory=list,
        description='Specific dates "YYYY-MM-DD" this applies to. Empty means '
        "the rule is not tied to particular dates.",
    )
    start_time: Optional[str] = Field(
        default=None,
        description='Start of the window, "HH:MM". Null (with end_time null) '
        "means the rule covers the whole open day.",
    )
    end_time: Optional[str] = Field(
        default=None,
        description='End of the window, "HH:MM". May be EARLIER than '
        "start_time when the busy stretch runs past midnight "
        '("23:00" to "04:00"); write it as spoken rather than splitting it.',
    )
    staff: int = Field(description="Employees required while this rule applies.")


class DayHours(BaseModel):
    """Opening hours for weekdays that differ from the standing ones."""

    weekdays: List[str] = Field(
        description='Lowercase English weekday names, e.g. ["sunday"].'
    )
    open_time: str = Field(description='Opening time that day, "HH:MM".')
    close_time: str = Field(description='Closing time that day, "HH:MM".')


class TeamMember(BaseModel):
    """One line of the team the brief describes: a named person, or an
    anonymous headcount group. Every attribute is optional — an unstated one
    must come back null, never a guess."""

    name: Optional[str] = Field(
        default=None,
        description="The person's name if the brief names them; null for an "
        "anonymous headcount group like '3 cashiers'.",
    )
    count: int = Field(
        default=1,
        description="How many people this line describes: 1 for a named person, "
        "N for an anonymous group.",
    )
    employment_type: Optional[str] = Field(
        default=None,
        description='One of "exempt_salaried", "non_exempt_hourly", '
        '"non_exempt_salaried" if stated or clearly implied; null otherwise.',
    )
    min_hours_per_week: Optional[float] = Field(
        default=None,
        description="Contracted minimum weekly hours. Full-time -> 40, "
        "part-time -> 20 unless a number is given.",
    )
    max_hours_per_week: Optional[float] = Field(
        default=None,
        description="Maximum weekly hours. A contract of N hours sets this to N "
        "as well as the minimum; null only when the brief states a floor and "
        "nothing else.",
    )
    hourly_rate: Optional[float] = Field(
        default=None, description="Hourly pay rate in dollars, if the brief states it."
    )
    annual_salary: Optional[float] = Field(
        default=None, description="Annual salary in dollars, if the brief states it."
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
        "manager says they are NOT paid one. Null when unstated -- never copy "
        "the business's.",
    )
    overtime_multiplier: Optional[float] = Field(
        default=None,
        description="What this person's extra hour is paid as a multiple of an "
        "ordinary one (1.75 = 75% more). Null when unstated.",
    )
    night_included_in_salary: Optional[bool] = Field(
        default=None,
        description="True only when the brief says this person's night work is "
        "included / priced into their salary. Null otherwise.",
    )
    status: Optional[str] = Field(
        default=None,
        description='"active", "onboarding" (new hire / starting soon), or '
        '"on_leave" (medical leave / sabbatical). Null defaults to active.',
    )
    starts_on: Optional[str] = Field(
        default=None,
        description='Hire/start date as "YYYY-MM-DD" if the brief gives one.',
    )


class ScheduleFields(BaseModel):
    """The scheduling half of the brief -- the schema Claude fills in.

    Every field is optional on purpose: an unstated requirement must come back
    as null, not as a guess.

    The roster lives in its own schema and its own call (`TeamFields`). Asking
    for both at once put the combined schema at the API's structured-output
    complexity limit, where it was accepted or rejected depending on how much
    else was in it -- and a rejected intake silently became the local regex
    parser, which is what made the app look like it ignored the brief.
    """

    open_time: Optional[str] = Field(
        default=None, description='Opening time "HH:MM", or "00:00" if open 24h.'
    )
    close_time: Optional[str] = Field(
        default=None,
        description='Closing time "HH:MM": "24:00" for midnight, or an hour '
        'EARLIER than open_time for a business that works into the next day '
        '("04:00" for a bar that closes at four in the morning).',
    )
    min_staff: Optional[int] = Field(
        default=None, description="Minimum employees on shift during every open hour."
    )
    coverage: List[CoverageRule] = Field(
        default_factory=list,
        description="Every staffing requirement narrower than min_staff: busy "
        "windows, per-weekday numbers, per-date numbers. Empty when the brief "
        "only states a flat minimum.",
    )
    closed_weekdays: List[str] = Field(
        default_factory=list,
        description='Lowercase English weekday names the business is closed, e.g. ["sunday"].',
    )
    closed_dates: List[str] = Field(
        default_factory=list,
        description='One-off closures as "YYYY-MM-DD", e.g. a public holiday.',
    )
    day_hours: List[DayHours] = Field(
        default_factory=list,
        description="Opening hours for weekdays that differ from open_time/close_time.",
    )
    shift_length_hours: Optional[float] = Field(
        default=None,
        description="Preferred shift length in hours, if the brief asks for one "
        '("six-hour shifts"). Null otherwise.',
    )
    max_hours_per_week: Optional[int] = Field(
        default=None, description="Maximum hours any one employee may work per week."
    )
    min_rest_hours: Optional[int] = Field(
        default=None, description="Minimum rest hours required between two shifts."
    )
    split_shifts_allowed: Optional[bool] = Field(
        default=None,
        description="True when the brief allows one person to work TWO "
        'separate shifts in the same day ("turnos partidos", "split shifts", '
        '"cuatro horas por la manana y otras cuatro por la tarde"). Null when '
        "the brief does not mention it.",
    )
    horizon: Optional[str] = Field(
        default=None,
        description='Period to cover: "3" = the next 3 months, "2026-10" = only '
        'that month, "2026-10:2" = 2 months from it. Null if unsaid.',
    )
    notes: List[str] = Field(
        default_factory=list,
        description="Requirements understood but not expressible in this schema.",
    )


class TeamFields(BaseModel):
    """The roster half of the brief, asked for in its own call."""

    team: List[TeamMember] = Field(
        default_factory=list,
        description="The staff the brief describes, if any. Empty when the brief "
        "only covers hours and coverage.",
    )


class UnclearHours(BaseModel):
    """A day the brief singles out for its own hours, without giving them."""

    weekday: str = Field(
        description='Lowercase English weekday name, e.g. "saturday".'
    )
    quote: str = Field(
        description="The manager's own words that said so, copied verbatim "
        'from the brief ("sabados casi todo el dia"). Never a paraphrase: it '
        "is read back to them, so anything else looks like we misread it.",
    )


class EmphasisFields(BaseModel):
    """The days a brief ranks as busier, asked for in their own call.

    One field, and its own request, for a reason measured rather than guessed:
    adding this to ``ScheduleFields`` made the API answer
    ``400 Schema is too complex`` -- ``tests/test_intake_schema_contract.py``
    caught it against the real API before it ever reached a manager. That
    schema is at its ceiling, and even a flat array of strings is now too much
    for it.

    So this follows the precedent ``TeamFields`` already set: when the schema
    is full, split the CALL rather than trim what the intake can understand.
    The three run concurrently, so the manager waits for the slowest, not the
    sum.
    """

    busy_weekdays: List[str] = Field(
        default_factory=list,
        description="Lowercase English weekday names the brief calls BUSIER "
        'than the rest WITHOUT saying how many people ("Mondays and Saturdays '
        'are our busiest"). Empty when the brief gives a number, which is a '
        "coverage rule read elsewhere, or when it does not rank its days.",
    )
    busy_windows: List[str] = Field(
        default_factory=list,
        description='Stretches of the day the brief calls busier WITHOUT '
        'saying how many people, as "HH:MM-HH:MM" on a 24-hour clock '
        '("a mediodia hace falta mas gente" -> ["13:00-16:00"]). Empty when '
        "the brief gives a number, which is a coverage rule read elsewhere, or "
        "when it singles out no hours. Never put a number of people here.",
    )
    unclear_hours: List[UnclearHours] = Field(
        default_factory=list,
        description="Days the brief gives their OWN hours to WITHOUT saying "
        'what those hours are ("los sabados abrimos casi todo el dia", "el '
        'viernes cerramos mas tarde"). Empty when every day it singles out '
        "comes with times, and empty for a day it merely calls busy -- that is "
        "busy_weekdays. Never guess the hours here.",
    )
    split_shift_people: Optional[int] = Field(
        default=None,
        description="How many people PER DAY the brief lets work two separate "
        'shifts in one day ("dos personas pueden hacer turno partido" -> 2, '
        '"uno puede venir por la manana y por la tarde" -> 1). Null whenever '
        "the brief states no number, INCLUDING when it allows split shifts "
        'without saying for how many ("se permiten turnos partidos"). Never '
        "infer it from the size of the team or from a coverage number.",
    )


class ScheduleBrief(ScheduleFields):
    """All three parts recombined, so callers see one brief as they always have."""

    team: List[TeamMember] = Field(default_factory=list)
    busy_weekdays: List[str] = Field(default_factory=list)
    busy_windows: List[str] = Field(default_factory=list)
    split_shift_people: Optional[int] = Field(default=None)
    unclear_hours: List[UnclearHours] = Field(default_factory=list)


def _fmt12(hhmm: Optional[str]) -> str:
    """Render an "HH:MM" string on a 12-hour clock, e.g. "9:00 AM"."""
    minutes = _to_minutes(hhmm)
    if minutes is None:
        return hhmm or ""
    total = minutes % (24 * 60)
    h24, m = divmod(total, 60)
    h12 = 12 if h24 % 12 == 0 else h24 % 12
    return "%d:%02d %s" % (h12, m, "AM" if h24 < 12 else "PM")


def _to_minutes(hhmm: Optional[str]) -> Optional[int]:
    if not hhmm:
        return None
    try:
        h, m = hhmm.strip().split(":")
        total = int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None
    if total < 0 or total > 24 * 60:
        return None
    return total


WEEKDAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]


def _weekday_indexes(names: List[str]) -> List[int]:
    """Weekday names -> sorted indexes (0 = Sunday), unknown names dropped."""
    out: List[int] = []
    for name in names or []:
        idx = WEEKDAY_INDEX.get(str(name).strip().lower())
        if idx is not None and idx not in out:
            out.append(idx)
    return sorted(out)


def _scope_label(req: "CoverageRule", weekdays: List[int], dates: List[str]) -> str:
    """Human phrase for a coverage rule, e.g. "on Saturday 12:00 PM-3:00 PM"."""
    parts: List[str] = []
    if weekdays:
        parts.append("on " + ", ".join(WEEKDAY_NAMES[i] for i in weekdays))
    if dates:
        parts.append("on " + ", ".join(dates))
    if req.start_time and req.end_time:
        parts.append("%s-%s" % (_fmt12(req.start_time), _fmt12(req.end_time)))
    return " ".join(parts) if parts else "every open hour"


# Ceiling on how many people may work a split day, matching the bound
# `coverage` already puts on a headcount (`staff` 1-50). Past that the number
# is not a staffing decision, it is a typo or a bad extraction, and a schedule
# built from it would hand doubles to the entire payroll.
MAX_SPLIT_SHIFT_PEOPLE = 50


def _split_shift_people(brief: "ScheduleBrief") -> int:
    """How many people, per day, may work two separate shifts.

    Zero when the brief does not allow split shifts at all. The case worth
    naming is permission WITHOUT a number: the product owner's rule is that
    "se permiten turnos partidos" means ONE person may work a double, not that
    everyone may. Before this the spec carried a bare boolean and the generator
    read it as "anybody, no limit", which is not what a manager means when they
    mention the possibility once.
    """
    stated = brief.split_shift_people
    try:
        n = int(stated) if stated is not None else None
    except (TypeError, ValueError):
        n = None
    if n is not None and n >= 1:
        # A stated count IS permission, whatever `split_shifts_allowed` says.
        # The count arrives from a different model call than the flag, so a
        # false/null flag is at least as likely to be that call not having seen
        # the sentence as it is a real refusal -- and a brief that bothers to
        # say how many people work a split day is allowing split days.
        return min(n, MAX_SPLIT_SHIFT_PEOPLE)
    # A count below one is not a smaller permission, it is garbage: the model
    # is told to answer null when the brief gives no number, so a 0 or a -3 is
    # a bad extraction and must not be read as "nobody". Fall back to the
    # yes/no answer, which is what a brief without a number gives us anyway.
    return 1 if brief.split_shifts_allowed else 0


def brief_to_spec(brief: ScheduleBrief, floor: "LabourFloor" = None) -> dict:
    """Convert the validated brief into the spec the scheduler consumes.

    Defaults mirror the frontend's DEFAULT_SPEC so both intake paths (Claude
    and the local fallback parser) produce the same shape.

    ``floor`` is what the law where this business is requires, read from the
    rules table (see services/labour_floor). It fills the fields the BRIEF did
    not speak about, and never overrides one it did: a manager who says "diez
    horas de descanso" gets ten and a warning from the validator, because the
    product's job is to show them the rule, not to quietly rewrite what they
    asked for. Omitted -- in tests, and in the local fallback parser -- it
    behaves exactly as before.
    """
    from app.services.labour_floor import LabourFloor

    floor = floor or LabourFloor()
    rules: List[dict] = []

    def rule(kind: str, label: str, origin: str = "parsed") -> None:
        rules.append(
            {
                "id": "r%d" % (len(rules) + 1),
                "kind": kind,
                "label": label,
                "sourceText": None,
                "origin": origin,
            }
        )

    open_min = _to_minutes(brief.open_time)
    close_min = _to_minutes(brief.close_time)
    # A close BEFORE the open is a night, not a mistake. A bar saying "de seis
    # de la tarde a cuatro" used to land here as 1080 and 240, fail this test,
    # and be replaced -- silently -- by 8:00-22:00. The manager typed their real
    # hours and got a bakery's. So it rolls into the next day, which is the
    # reading the frontend has always given a shift template that ends before it
    # starts, and `closeMin` above 1440 is a shape the schedule types already
    # document. Equal open and close still means nothing was said.
    if open_min is None or close_min is None or close_min == open_min:
        open_min, close_min = 8 * 60, 22 * 60
    else:
        # Rolled INSIDE this branch, not beside it. As an `elif` it stole the
        # rule below: a business that works through midnight got the right
        # minutes and no `opening_hours` rule at all, so the one requirement it
        # had stated most plainly was missing from the panel where the manager
        # reads back what we understood.
        if close_min < open_min:
            close_min += 24 * 60
        label = (
            "Open 24 hours"
            if open_min == 0 and close_min >= 24 * 60
            else "Open %s-%s" % (_fmt12(brief.open_time), _fmt12(brief.close_time))
        )
        rule("opening_hours", label)

    min_staff = brief.min_staff if brief.min_staff and brief.min_staff > 0 else 2
    if brief.min_staff:
        rule("min_staff", "At least %d on shift every open hour" % brief.min_staff)


    # Coverage rules: each one keeps its own scope, so "four on Saturdays" and
    # "three at lunch" survive as separate requirements the scheduler enforces
    # instead of collapsing into one global peak.
    coverage: List[dict] = []
    for req in brief.coverage:
        staff = int(req.staff or 0)
        if staff < 1 or staff > 50:
            continue
        start = _to_minutes(req.start_time)
        end = _to_minutes(req.end_time)
        if start is not None and end is not None and end < start:
            # A window that runs past midnight is written the way it is spoken
            # -- "23:00-04:00" -- so its close lands before its open. The
            # opening hours a few lines above have rolled over for exactly this
            # since a bar first tried to describe itself; a coverage rule never
            # did, and the cost was not that the rule was dropped. It was
            # INVERTED: the window was erased, and a rule with no window and no
            # weekday falls through to `min_staff` below, so "three people from
            # 23:00 to 04:00" became three people at ten in the morning and one
            # at two in the morning. The manager's busiest stretch turned into
            # the one hour left short, which is the opposite of what they said.
            end += 24 * 60
        if start is None or end is None or end == start:
            start, end = None, None  # applies to the whole open day
        weekdays = _weekday_indexes(req.weekdays)
        dates = [d for d in (_valid_date(x) for x in req.dates) if d]
        # A rule with no scope at all is just the flat minimum restated.
        if start is None and not weekdays and not dates:
            min_staff = max(min_staff, staff)
            continue
        coverage.append(
            {
                "weekdays": weekdays,
                "dates": dates,
                "startMin": start,
                "endMin": end,
                "staff": staff,
                "exact": bool(req.exact),
            }
        )
        rule(
            "peak_cover",
            "%s%d on shift %s"
            % ("only " if req.exact else "", staff, _scope_label(req, weekdays, dates)),
        )

    closed: List[int] = []
    for name in brief.closed_weekdays:
        idx = WEEKDAY_INDEX.get(str(name).strip().lower())
        if idx is not None and idx not in closed:
            closed.append(idx)
            rule("closed_day", "Closed on %s" % str(name).strip().capitalize())

    closed_dates: List[str] = []
    for value in brief.closed_dates:
        iso = _valid_date(value)
        if iso and iso not in closed_dates:
            closed_dates.append(iso)
            rule("closed_date", "Closed on %s" % iso)

    day_hours: List[dict] = []
    seen_days = set()
    for entry in brief.day_hours:
        o = _to_minutes(entry.open_time)
        c = _to_minutes(entry.close_time)
        # Same night rule as the standing hours above. Without it "los viernes
        # hasta las cuatro" was dropped on the floor: the entry vanished and the
        # day quietly kept the standing hours, which is the failure mode that
        # looks most like the product ignoring what was typed.
        if o is None or c is None or c == o:
            continue
        if c < o:
            c += 24 * 60
        for idx in _weekday_indexes(entry.weekdays):
            if idx in seen_days:
                continue
            seen_days.add(idx)
            day_hours.append({"weekday": idx, "openMin": o, "closeMin": c})
            rule(
                "day_hours",
                "%s open %s-%s"
                % (WEEKDAY_NAMES[idx], _fmt12(entry.open_time), _fmt12(entry.close_time)),
            )

    split_people = _split_shift_people(brief)
    if split_people:
        # The count belongs in the label: "split shifts allowed" told the
        # manager nothing about how many of their people it applied to, and
        # the answer used to be "all of them".
        rule(
            "split_shifts",
            "Split shifts allowed for %d %s a day"
            % (split_people, "person" if split_people == 1 else "people"),
        )

    shift_len = None
    if brief.shift_length_hours:
        try:
            hours = float(brief.shift_length_hours)
        except (TypeError, ValueError):
            hours = 0.0
        if 3 <= hours <= 12:
            shift_len = hours
            rule("shift_length", "%g-hour shifts" % hours)

    max_week = brief.max_hours_per_week if brief.max_hours_per_week else 40
    if brief.max_hours_per_week:
        rule("max_weekly_hours", "Max %d h/week per employee" % brief.max_hours_per_week)

    # WHICH PERIOD the calendar covers. Two fields rather than one, because a
    # manager says it two ways that matter -- how long, and which one -- and
    # only the first had anywhere to go.
    #
    # A THIRD, `horizon_weeks`, was written and then removed: with it the schema
    # came back from the API as "Schema is too complex" and the intake stopped
    # working entirely. This model sits on that ceiling -- 13 top-level fields
    # was accepted, 15 was not -- so weeks wait until something else earns its
    # way out of the schema. Until then a brief counting in weeks rounds to
    # months, which is wrong by days rather than by a month. "El horario debe cubrir
    # solamente el mes de octubre" was understood, found no field, and landed in
    # `notes` -- which the planner now reads, with the brief, in the manager's
    # own words; it is honoured in the arrangement, but it is still not a rule
    # the validator enforces.
    #
    # Both counts are capped at two years. Past that the roster the plan assumes
    # has certainly changed, so the calendar would be fiction, not a schedule.
    horizon, horizon_start = _parse_horizon(brief.horizon)
    if horizon is not None:
        horizon = min(horizon, 24) if horizon > 0 else None

    if horizon_start and horizon == 1:
        rule("horizon", "Covers %s" % _month_label(horizon_start))
    elif horizon_start and horizon:
        rule("horizon", "Covers %d months from %s" % (horizon, horizon_start))
    elif horizon_start:
        rule("horizon", "Starts on %s" % horizon_start)
    elif horizon:
        rule("horizon", "Covers the next %d months" % horizon)

    # The brief first, then the law, then the old constant. Eleven hours is
    # the EU directive and was written here as if it were universal; Spain
    # requires twelve, and a jurisdiction we have not seeded still gets the
    # figure it has always had.
    statutory_rest = floor.min_rest_hours
    min_rest = brief.min_rest_hours or statutory_rest or 11
    rule(
        "min_rest",
        "%g h minimum rest between shifts" % min_rest,
        "parsed"
        if brief.min_rest_hours
        else ("statute" if statutory_rest else "default"),
    )
    if floor.overtime_multiplier:
        rule(
            "max_weekly_hours",
            "Overtime above %g h/week (%gx)" % (max_week, floor.overtime_multiplier),
            "default",
        )
    elif not floor.known:
        rule("max_weekly_hours", "Overtime above 40 h/week (FLSA, 1.5x)", "default")
    else:
        # Spain: an overtime hour is paid at least as an ordinary one, or
        # given back as time off. Saying "1.5x" here would put a premium that
        # does not exist into the rules a manager reads.
        rule(
            "max_weekly_hours",
            "Overtime above %g h/week, paid as ordinary or given back as time off"
            % max_week,
            "statute",
        )
    if floor.max_daily_hours:
        rule("max_daily_hours", "At most %g h in one day" % floor.max_daily_hours, "statute")
    if floor.weekly_rest_hours:
        rule(
            "weekly_rest",
            "%g h of unbroken rest every week" % floor.weekly_rest_hours,
            "statute",
        )
    if floor.night_average_max:
        rule(
            "night_average",
            "Night shifts average at most %g h" % floor.night_average_max,
            "statute",
        )

    return {
        "openMin": open_min,
        "closeMin": close_min,
        "minStaff": min_staff,
        # `peak` stays in the shape for the refine op `set_peak`; the brief
        # itself now expresses busy windows as coverage rules.
        "peak": None,
        "coverage": coverage,
        "closedWeekdays": closed,
        "closedDates": closed_dates,
        "dayHours": day_hours,
        "shiftLengthHours": shift_len,
        # What the law where this business is requires. Absent for a
        # jurisdiction with no rules seeded, and every reader keeps its own
        # default then -- which is exactly how every existing customer behaves.
        "maxDailyHours": floor.max_daily_hours,
        "weeklyRestHours": floor.weekly_rest_hours,
        "nightAverageMax": floor.night_average_max,
        "nightWindow": (
            {"startHour": floor.night_window[0], "endHour": floor.night_window[1]}
            if floor.night_window
            else None
        ),
        "annualOvertimeCap": floor.annual_overtime_cap,
        "overtimeMultiplier": floor.overtime_multiplier,
        # The contracted week read as an ANNUAL AVERAGE rather than a ceiling
        # (art. 34.1 ET), and what art. 34.2 charges for the privilege: how
        # much of the year may be moved around, and how much notice is owed
        # before a shift. Present only where a jurisdiction states them, and
        # `weeklyAverageHours` is the field that tells the validator a week
        # above the contract is not by itself a breach.
        "weeklyAverageHours": floor.weekly_average_hours,
        "annualHours": floor.annual_hours,
        "irregularPct": floor.irregular_pct,
        "irregularNoticeDays": floor.irregular_notice_days,
        # How many people may work two shifts on the same day. Zero means
        # nobody; permission with no number stated means one.
        "splitShiftPeople": split_people,
        # A bridge, not a second source of truth: the old boolean, kept only so
        # a client that has not migrated to `splitShiftPeople` keeps working.
        # It is exactly "is anyone allowed a split day" and carries no count,
        # so drop it once the frontend reads the number.
        "allowSplitShifts": split_people > 0,
        "maxHoursPerWeek": max_week,
        "minRestHours": min_rest,
        "horizonMonths": horizon,
        "horizonStart": horizon_start,
        # Days the brief ranked as busier WITHOUT a number. Deliberately not a
        # rule and not coverage: nothing is enforced from it, because enforcing
        # it would mean inventing the number the manager did not give. It
        # travels in the spec so the client can ask for that number once.
        "busyWeekdays": _weekday_indexes(brief.busy_weekdays),
        "rules": rules,
        "notes": brief.notes,
    }


_VALID_TYPES = {"exempt_salaried", "non_exempt_hourly", "non_exempt_salaried"}
_VALID_STATUS = {"active", "onboarding", "on_leave"}


def _non_neg(value: Optional[float]) -> Optional[float]:
    """Keep zero or a positive number; negative/garbage becomes null.

    For a premium, where 0 is an answer ("no le pago la nocturnidad") and must
    not collapse into null, which means "the same as the business".
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def _premium_pct(value: Optional[float]) -> Optional[float]:
    """A premium in percent, 0 to 200 -- the range the contract API accepts,
    so a figure the model read wrong never becomes a save that fails."""
    n = _non_neg(value)
    return n if n is not None and n <= 200 else None


def _multiplier(value: Optional[float]) -> Optional[float]:
    """An overtime multiplier, 1 to 5, or null. Below 1 is not one: an extra
    hour is never paid under an ordinary one (art. 35.1 ET)."""
    n = _non_neg(value)
    return n if n is not None and 1 <= n <= 5 else None


def _pos(value: Optional[float]) -> Optional[float]:
    """Keep a positive number, drop zero/negative/garbage to null."""
    if value is None:
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


# "3" | "2026-10" | "2026-10:2" -- the whole grammar of `horizon`.
_HORIZON_COUNT = re.compile(r"^(\d{1,3})$")
_HORIZON_MONTH = re.compile(r"^(\d{4})-(\d{2})(?:-\d{2})?(?::(\d{1,3}))?$")


def _parse_horizon(value: Optional[str]) -> tuple[Optional[int], Optional[str]]:
    """`horizon` -> (months, first day), either of which may be None.

    One field carries both because the schema has room for exactly thirteen and
    every one is spoken for -- adding a fourteenth came back from the API as
    "Schema is too complex", which takes the intake down entirely. So the field
    that already owned "when" learned to say WHICH as well as HOW LONG.

    A day-of-month is accepted and snapped to its month: the calendar spans
    whole months, so "from the 15th" and "that month" build the same thing, and
    refusing the first would be pedantry the manager pays for.

    Anything outside the grammar returns nothing at all rather than a guess. A
    period invented here is a calendar for the wrong weeks, which is harder to
    notice than no calendar.
    """
    if not value:
        return None, None
    raw = str(value).strip()

    count = _HORIZON_COUNT.match(raw)
    if count:
        return int(count.group(1)), None

    named = _HORIZON_MONTH.match(raw)
    if not named:
        return None, None
    year, month, span = named.group(1), named.group(2), named.group(3)
    if not 1 <= int(month) <= 12:
        return None, None
    return int(span) if span else 1, "%s-%s-01" % (year, month)


# "Hazlo para octubre" came back as three months (19-sep-2026): October,
# November and December planned and paid for, from a sentence that names one
# month and no length. The prompt now says so, but a prompt is a request, not
# a rule -- so the sentence itself is read here, and a span it cannot account
# for is cut back to the month it named.
#
# Deliberately one-directional and narrow. It only ever SHORTENS, and only when
# the brief names exactly one month and says nothing that could mean a length.
# Anything that might ("meses", "trimestre", "hasta", a season, a second
# month...) leaves the model's reading alone: a missed cut costs what it cost
# before this existed, a wrong cut drops months the manager asked for.
_MONTH_NAMES = {
    # es
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
    # ca
    "gener": 1, "febrer": 2, "marc": 3, "maig": 5, "juny": 6, "juliol": 7,
    "agost": 8, "setembre": 9, "novembre": 11, "desembre": 12,
    # en -- "may" included on purpose: a false month only ever PREVENTS a cut.
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}

# Words that could carry a length: plural months and weeks, spans, years,
# seasons. Over-inclusive by design, for the same reason.
_SPAN_WORDS = re.compile(
    r"\b("
    r"meses|mesos|months|semanas|setmanes|weeks|"
    r"trimestre|semestre|quarter|bimestre|"
    r"ano|anos|anual|anys|year|years|yearly|annual|"
    r"proximos|proximas|propers|siguientes|seguents|"
    r"temporada|season|otono|invierno|verano|primavera|tardor|hivern|estiu|"
    r"autumn|winter|summer|navidad|nadal|christmas"
    r")\b"
)

# "Desde las 17:00" is in every brief, so a range word only counts when a month
# follows it: "a partir de octubre", "from October", "hasta diciembre".
_RANGE_WORDS = r"(?:desde|a partir de|des de|from|starting|hasta|fins a|fins|until|till|through)"


def _plain(text: str) -> str:
    import unicodedata

    decomposed = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def bound_horizon(horizon: Optional[str], text: str) -> Optional[str]:
    """The model's `horizon`, cut to one month unless the brief asks for more.

    ONE MONTH IS THE DEFAULT, AND MORE HAS TO BE SAID. The first version of this
    cut only when the sentence named exactly one month and it was the one the
    model started from, which left every other brief to the model's taste: "haz
    el calendario" -- no month at all -- could still come back as a quarter,
    and every month of it was planned and saved as a draft the manager then
    found while looking at another month. Whatever is planned is written, so a
    month nobody asked for is a month of shifts nobody asked for.

    So the question is turned round. A span survives only when the sentence
    carries a length: two months named, a plural or a span word ("meses",
    "trimestre", "temporada"), or a range that ends in a month ("hasta
    diciembre"). Anything else plans one month -- the one the model started
    from, or "1" when it gave a bare count. A wrong cut costs a click on the
    next month; a wrong span costs months of drafts to find and undo.
    """
    months, start = _parse_horizon(horizon)
    if not months or months <= 1:
        return horizon
    said = _plain(text or "")
    named = {m for word, m in _MONTH_NAMES.items() if re.search(r"\b%s\b" % word, said)}
    if len(named) > 1 or _SPAN_WORDS.search(said):
        return horizon
    month_words = "|".join(_MONTH_NAMES)
    if re.search(
        r"\b%s\s+(?:(?:el|the)\s+)?(?:(?:mes|month)\s+(?:de\s+|of\s+)?)?(?:%s)\b"
        % (_RANGE_WORDS, month_words),
        said,
    ):
        return horizon
    return start[0:7] if start else "1"


def _month_label(date_key: str) -> str:
    """"2026-10-01" -> "October 2026".

    English, like every other rule label this module writes. The panel that
    shows them translates what it can from the rule KIND, and these strings are
    the part it cannot -- a debt the whole rules list carries, not one this
    field adds. Named here so the next person can find them all at once.
    """
    from datetime import date as _date

    d = _date.fromisoformat(date_key)
    return "%s %d" % (d.strftime("%B"), d.year)


def _valid_date(value: Optional[str]) -> Optional[str]:
    from datetime import date as _date

    if not value:
        return None
    try:
        return _date.fromisoformat(str(value).strip()).isoformat()
    except ValueError:
        return None


def brief_to_team(brief: ScheduleBrief) -> List[dict]:
    """Normalise the extracted team into the shape the client reconciles.

    Keys are camelCase to match the frontend spec convention. The existing
    roster is NEVER sent to the model: reconciliation against real employees
    happens in the manager's browser.
    """
    out: List[dict] = []
    for m in brief.team:
        name = m.name.strip() if m.name and m.name.strip() else None
        # A named person is always a single row; only anonymous groups count > 1.
        count = 1 if name else max(1, min(int(m.count or 1), 100))
        out.append(
            {
                "name": name,
                "count": count,
                "employmentType": (
                    m.employment_type if m.employment_type in _VALID_TYPES else None
                ),
                "minHoursPerWeek": _pos(m.min_hours_per_week),
                "maxHoursPerWeek": _pos(m.max_hours_per_week),
                "hourlyRate": _pos(m.hourly_rate),
                "annualSalary": _pos(m.annual_salary),
                "nightPremiumPct": _premium_pct(m.night_premium_pct),
                "weekendPremiumPct": _premium_pct(m.weekend_premium_pct),
                "overtimeMultiplier": _multiplier(m.overtime_multiplier),
                "nightIncludedInSalary": (
                    m.night_included_in_salary
                    if isinstance(m.night_included_in_salary, bool)
                    else None
                ),
                "status": m.status if m.status in _VALID_STATUS else None,
                "startsOn": _valid_date(m.starts_on),
            }
        )
    return out


def _extract(client, system: str, text: str, schema):
    """One structured-output call. Raises if the model returns nothing usable."""
    purpose = "intake." + schema.__name__.replace("Fields", "").lower()
    # Every HTTP attempt this call makes, including the ones the SDK retries
    # away inside `parse`, is counted by this middleware -- see
    # `api_usage.meter_attempts` for why the hook lives there and not in a
    # retry loop of our own. `with_middleware` returns a cheap copy of the
    # client that shares the same connection pool, so the three concurrent
    # calls below still speak through one pool and each one carries its own
    # purpose.
    client = client.with_middleware(api_usage.meter_attempts(purpose, MODEL))
    started = time.monotonic()
    response = client.messages.parse(
        model=MODEL,
        max_tokens=4096,
        system=system,
        thinking={"type": "adaptive"},
        # Effort has been raised twice, both times for the same reason: this
        # schema keeps growing and a lower setting reads the brief less
        # carefully than the manager wrote it. "low" was tuned for a flat
        # seven-field extraction. "medium" then missed detail in briefs that
        # cross midnight, scope coverage to weekdays and state a relative
        # minimum ("the busy stretch needs two more") -- all of which are one
        # dictated sentence for a manager and several linked fields here.
        #
        # "high" is the API default, so this is not an unusual setting: it is
        # the ordinary one, and we were below it. The brief is read once per
        # calendar and the manager is watching a spinner while it happens, so
        # the extra tokens buy the thing the whole product rests on -- an
        # interpretation faithful enough to build a rota from.
        output_config={"effort": "high"},
        messages=[{"role": "user", "content": text}],
        output_format=schema,
    )
    # Metered before it is validated: a reply we cannot use was paid for too.
    # The clock stops at the reply, not at the end of this function: what is
    # being measured is how long the provider took, and everything below is
    # ours.
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


def ranked_signals(brief: ScheduleBrief) -> dict:
    """The stretches a brief singles out as busier, without a number.

    "Mondays are our busiest" and "a mediodia hace falta mas gente" are the same
    statement about two different axes: a manager saying WHERE the pressure is
    and leaving HOW MANY to us. Both used to become a question. Neither does
    now, and the reason is worth writing down, because it reverses a decision
    this file made deliberately.

    Asking "how many people at the peak?" makes somebody answer in the abstract,
    about a calendar they cannot see. Showing them the peak staffed with one
    more person than the floor makes them answer about a rota in front of them,
    where a wrong guess is obvious and a spoken correction costs a sentence. The
    number we choose is defensible -- they said MORE than the minimum, and one
    more is the smallest thing "more" can mean -- and it is labelled as ours.
    A visible assumption beats a question.

    What survives from the question era is the pruning, and every line of it
    still earns its place:

    * A day the shop is SHUT cannot be busy. Staffing it would put people on a
      day nobody works.
    * A day the brief ALREADY staffed with a number is answered. Adding a
      second rule would have the manager's own figure competing with ours.
    * When EVERY open day is ranked, nothing is ranked. The rule would cover the
      whole week, which is the flat minimum said twice and a cost increase
      nobody asked for.
    """
    closed = set(_weekday_indexes(brief.closed_weekdays))
    busy = [d for d in _weekday_indexes(brief.busy_weekdays) if d not in closed]

    already: set = set()
    for req in brief.coverage:
        already.update(_weekday_indexes(req.weekdays))
    busy = [d for d in busy if d not in already]

    open_days = 7 - len(closed)
    if len(busy) >= open_days:
        busy = []

    windows: List[Tuple[int, int]] = []
    for raw in brief.busy_windows:
        parts = str(raw).split("-")
        if len(parts) != 2:
            continue
        start = _to_minutes(parts[0].strip())
        end = _to_minutes(parts[1].strip())
        if start is None or end is None or start == end:
            continue
        # A window that ends before it starts runs through midnight, the same
        # reading the opening hours are given a few functions up.
        if end < start:
            end += 24 * 60
        windows.append((start, end))

    return {"weekdays": busy, "windows": windows}


def unstated_fields(brief: ScheduleBrief) -> List[str]:
    """Which requirements the brief never spoke about.

    Everything ``brief_to_spec`` fills with a constant when the corresponding
    field comes back null. Naming them is what lets the adaptive layer fill a
    hole without ever overwriting an answer, and what lets the manager see the
    decisions that were made on their behalf.
    """
    silent: List[str] = []
    if _to_minutes(brief.open_time) is None or _to_minutes(brief.close_time) is None:
        silent.append("opening_hours")
    if not brief.min_staff:
        silent.append("min_staff")
    if not brief.coverage:
        silent.append("coverage")
    if not brief.closed_weekdays and not brief.closed_dates:
        silent.append("closures")
    if not brief.shift_length_hours:
        silent.append("shift_length")
    if not brief.max_hours_per_week:
        silent.append("max_weekly_hours")
    if not brief.min_rest_hours:
        silent.append("min_rest")
    # A period the brief did not state, or stated in a form the grammar does not
    # accept -- both are silences, and both leave the toolbar deciding.
    if _parse_horizon(brief.horizon) == (None, None):
        silent.append("horizon")
    return silent


def interpret_brief(
    text: str,
    api_key: Optional[str],
    today: Optional[str] = None,
    background: str = "",
) -> ScheduleBrief:
    """Ask Claude to read the brief. Raises on failure.

    ``background`` is what we know about this business (see
    ``app/services/business_profile.py``). It is appended to the SCHEDULE
    system prompt only -- never to the team one. Telling the model what kind of
    business this is must not be able to influence who it thinks works there:
    the roster call reads the brief and nothing else, so no amount of context
    can conjure a person.

    THREE calls, not one, and concurrent so the manager waits for the slowest
    rather than for their sum. Splitting them is not an optimisation: one
    combined schema sat at the API's structured-output complexity limit and was
    rejected depending on what else it carried. ``ScheduleFields`` is still at
    that ceiling today -- adding a single flat array of strings to it earns a
    ``400 Schema is too complex`` -- so anything new gets its own call, and
    ``tests/test_intake_schema_contract.py`` is what proves it against the real
    API rather than against our assumptions.
    """
    import anthropic
    from concurrent.futures import ThreadPoolExecutor
    from contextvars import copy_context

    # The SDK retries 429s, 5xx and timeouts on its own; the default is two
    # attempts. Raised here because the cost of giving up is no longer a
    # slightly worse calendar -- the manager now gets nothing at all, so a rate
    # limit that would have cleared on the next try is worth waiting through.
    client = (
        anthropic.Anthropic(
            api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES
        )
        if api_key
        else anthropic.Anthropic(timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES)
    )

    # Lets the model resolve "starts next Monday" or "the 12th" to a real date.
    date_line = "\n\nToday's date is %s." % today if today else ""

    # Each worker runs under a copy of this thread's context so the usage
    # ledger opened by the router (see services/api_usage.py) sees the calls.
    with ThreadPoolExecutor(max_workers=3) as pool:
        schedule = pool.submit(
            copy_context().run,
            _extract,
            client,
            SYSTEM_PROMPT + date_line + (background or ""),
            text,
            ScheduleFields,
        )
        team = pool.submit(
            copy_context().run,
            _extract,
            client,
            TEAM_SYSTEM_PROMPT + date_line,
            text,
            TeamFields,
        )
        # No background on this one. What we think we know about the business
        # must not colour which days it calls busy -- that would let a belief
        # about Fridays produce a question about Fridays, and the manager's
        # answer would then look like evidence for the belief that raised it.
        emphasis = pool.submit(
            copy_context().run,
            _extract,
            client,
            EMPHASIS_SYSTEM_PROMPT,
            text,
            EmphasisFields,
        )
        fields = schedule.result()
        roster = team.result()
        # This call is the only OPTIONAL one, so it is the only one allowed to
        # fail quietly. The other two carry the calendar and the roster: losing
        # either has to be an error the manager sees. This one produces a
        # question they may well ignore, and the router turns any exception
        # into a 502 on a path that deliberately does not fall back to the
        # local parser -- so letting a rate limit here cost somebody their
        # whole calendar would be the worst trade in the file.
        # It also carries how many people may work a split day, which degrades
        # just as softly: without it a brief that allows split shifts still
        # gets one person, which is what a brief without a number gets anyway.
        try:
            nuance = emphasis.result()
            ranked = nuance.busy_weekdays
            windows = nuance.busy_windows
            split_people = nuance.split_shift_people
            unclear = nuance.unclear_hours
        except Exception:  # noqa: BLE001 - an unasked question is not an outage
            ranked = []
            windows = []
            split_people = None
            unclear = []

    return ScheduleBrief(
        **fields.model_dump(),
        team=roster.team,
        busy_weekdays=ranked,
        busy_windows=windows,
        split_shift_people=split_people,
        unclear_hours=unclear,
    )


def unclear_weekdays(brief: ScheduleBrief) -> List[int]:
    """The weekdays the brief singles out for their own hours without giving them."""
    out = []
    for item in brief.unclear_hours or []:
        weekday = WEEKDAY_INDEX.get(str(item.weekday).strip().lower())
        if weekday is not None and weekday not in out:
            out.append(weekday)
    return out


def hour_questions(brief: ScheduleBrief, spec: dict) -> List[dict]:
    """The one thing a rota cannot show, turned into a question worth asking.

    Everything else the brief leaves open is an ASSUMPTION now: staff a Monday
    with one more than the floor, draw it, and a wrong guess is obvious on the
    screen the manager is already looking at. "Los sabados abrimos casi todo el
    dia" is the case that survives that test and is the reason this function
    exists. Open at eight, at ten, at twelve? The whole day's cover hangs off
    it, every choice is a coin flip, and -- this is the part that matters -- a
    manager looking at a Saturday drawn nine-to-ten CANNOT SEE that it is wrong,
    because it looks exactly like a Saturday that is right.

    Three things are dropped rather than asked, and each one would be a question
    the manager has already answered:

    - a weekday the brief gave hours for, which arrives as `day_hours`;
    - a weekday the brief says is CLOSED, which has no hours to give;
    - a name in no language we index, which is the model answering badly.

    The quote travels with the question. Asking "what hours do you keep on
    Saturdays?" of somebody who just wrote about Saturdays reads as not having
    listened; asking it back with their own words does not.
    """
    stated = {
        int(d.get("weekday"))
        for d in (spec.get("dayHours") or [])
        if isinstance(d, dict) and d.get("weekday") is not None
    }
    closed = set(spec.get("closedWeekdays") or [])

    out: List[dict] = []
    seen: set = set()
    for item in brief.unclear_hours or []:
        weekday = WEEKDAY_INDEX.get(str(item.weekday).strip().lower())
        if weekday is None or weekday in stated or weekday in closed:
            continue
        if weekday in seen:
            continue
        seen.add(weekday)
        quote = (item.quote or "").strip()
        out.append(
            {
                "id": "hours-%d" % weekday,
                "kind": "day_hours",
                "weekday": weekday,
                # Empty rather than absent when the model returns no quote: the
                # client shows the bare question instead of quoting silence.
                "quote": quote,
            }
        )
    return out
