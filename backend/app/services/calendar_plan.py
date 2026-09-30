from __future__ import annotations

"""Asking the model for the calendar itself, one month at a time.

``intake.py`` translates a brief; this asks for the rota. That is a bigger job
and a different risk, so three things are true here that are not true there:

**THE MODEL'S OUTPUT IS A PROPOSAL, NOT A CALENDAR.** Nothing it returns
reaches an employee unchecked. The client parses it, prices it, validates it
against the same rules the generator obeys, drops whatever breaks one, and lets
the deterministic greedy pass fill the holes. The worst case of a bad month
here is the calendar the product would have built on its own.

**FIVE FIELDS, NEVER FOURTEEN.** Who, which day, from when, to when, and which
template. Paid hours, overtime, cost and colour are computed client-side. Asking
a model for arithmetic buys nothing and risks a rota that is legal but whose
totals are wrong -- which publishes, pays people, and surfaces weeks later.

**ONE CALL PER MONTH.** A year is well past what a single response can carry,
and a schema describing a year of shifts is well past what the API accepts.
Months are independent enough to run concurrently, so the manager waits for the
slowest rather than for the sum -- the same trade ``interpret_brief`` makes.

**THE MONTH IS WRITTEN SHORT AND READ LONG.** Output is what this call costs:
measured in production a month is about 11.000 output tokens against 2.800 of
input, and output bills at five times the rate -- so writing the month costs
some twenty times more than reading the business. Most of that writing is
repetition, so the model states the repeating part once as a ``WeeklyPattern``
and ``expand_patterns`` turns it back into ordinary shifts here, before
anything else sees it. Nothing downstream learns a new shape, which is what
keeps the validator and the greedy pass the same safety net they were.

WHAT IS NOT SENT. No salaries, no pay rates, no absence reasons, no medical
data -- AND, since fix/names-stay-here, no names. Ids are sent, shortened to
``e1``/``t1`` by ``id_alias.py``, and that same alias is what every mention of
that person's NAME becomes: "Ana only works mornings" reaches the model as "e1
only works mornings", so the preference is as usable as it ever was and the
person it is about stays here. Nothing has to be undone afterwards, because
what the model writes back is an id and the manager's calendar has always
turned ids into names on the client.
"""

import calendar as _calendar
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from contextvars import copy_context
from typing import Callable, Dict, List, Optional

from pydantic import BaseModel, Field, ValidationError

from app.services import api_usage
from app.services.id_alias import IdAliases

log = logging.getLogger(__name__)

MODEL = "claude-opus-5"

# The call is STREAMED (see ``_plan_month``), so this is NOT a budget for the
# whole answer -- it is how long we wait for the NEXT event. That distinction is
# the whole fix. It was 180s of whole-answer budget, and on 14-sep-2026 all
# three months of a quarter failed together with APITimeoutError: a month takes
# minutes to write, 180s x 3 attempts is 9 minutes after the button, and the
# greedy pass filled the quarter. Streamed, the API sends events continuously,
# so two minutes of silence means the connection is gone, not that the model is
# thinking.
TIMEOUT_SECONDS = 120.0

# One retry, not two: each attempt can now run for minutes rather than seconds,
# and the two ceilings multiply. A month that fails is not a lost calendar --
# the client falls back to the deterministic generator for that block -- so the
# cost of giving up is quality, not an outage.
MAX_RETRIES = 1

# The whole-answer ceiling, kept by hand because streaming no longer has one.
#
# It exists to preserve the property the timeout used to give us: the SERVER
# gives up first and can say why. The browser allows 600s for this endpoint
# (`PLAN_TIMEOUT_MS` in frontend/src/api/schedule.ts).
#
# 270, NOT 360. This ceiling is per ATTEMPT, so the worst case is it twice,
# not once. It was set against a worst case of "one silent attempt plus one
# full one" (120 + 360 = 480) -- but nothing makes the first attempt the silent
# one, and two full attempts are 720s, which hands the decision back to the
# browser, and a browser can only report that it waited. 270 x 2 = 540 lands
# under 600. test_the_server_gives_up_before_the_browser_does asserts that
# arithmetic, because these numbers live in two languages and drifted once.
#
# The headroom is not tight: a month is written short now (see WeeklyPattern)
# and thought about at medium effort, so the reply that used to run for
# minutes is a fraction of its old length.
WHOLE_ANSWER_SECONDS = 270.0

# What the meter calls a month that arrived, and one that did not.
#
# A month that times out has still been WRITTEN: the provider bills what it
# generates, not what we managed to read, and on 14-sep-2026 nine attempts were
# generated and thrown away without leaving a single row here -- which is why
# `api_usage` showed a quiet afternoon while the account ran dry. Both purposes
# are priced the same and shown separately in the back office, because the
# second one is money with nothing to show for it.
PURPOSE = "plan.month"
PURPOSE_FAILED = "plan.month.failed"

# And the same pair for the second, dearer ask. Metering the retry apart is
# what makes the medium default defensible: without it nothing can answer how
# often the cheap answer had to be bought twice.
PURPOSE_RETRY = "plan.month.retry"
PURPOSE_RETRY_FAILED = "plan.month.retry.failed"

# Effort is MEDIUM by default, and high only on a second try.
#
# It was high on every month, justified by analogy with the intake rather than
# by a measurement of this call. The analogy does not hold: the intake fills a
# dozen fields nobody checks afterwards, while everything this call returns is
# validated, and whatever breaks a rule is thrown away and replaced by the
# deterministic pass. That verifier is a free failure signal -- nine hard rules
# and the coverage gaps -- and a free failure signal is what makes "answer
# cheaply, and pay for thinking only where the cheap answer failed" honest
# rather than a gamble. The client re-asks for the months it rejects with
# RETRY_EFFORT; see GenerateIn.effort in routers/schedule.py.
DEFAULT_EFFORT = "medium"
RETRY_EFFORT = "high"

# How many months are written at once. It was 4, capped against rate limits
# rather than cost or correctness, which made a year three waves and about
# three minutes. Eight halves that. The ceiling still exists because firing
# twelve at once is the fastest way to meet a rate limit.
MAX_CONCURRENT_MONTHS = 8

# PROMPT CACHING, AND WHY IT IS SMALL CHANGE.
#
# Every month of one generation reads the same business: the same system prompt
# (rules, plus this manager's preferences) and the same context. Only the last
# line -- "Plan the month of X." -- differs. So that shared prefix is marked
# cacheable, and the month line is sent AFTER the last breakpoint, as a text
# block of its own. A cached read bills at 0.1x input, a cache write at 1.25x
# (5-minute TTL; see api_usage.CACHE_WRITE_FACTOR).
#
# Be honest about the size of it: input is not what this call costs. Measured
# in production a month is ~2.800 tokens in and ~11.000 out, and out bills at
# five times the rate, so reading the business is ~5% of a month's bill. On
# 14-sep-2026 caching was set aside for saving under 2%; for a year it is
# closer to 4%, and for a single month it is nothing -- see below.
#
# ONE MONTH IS NOT CACHED. With nothing after it to read the entry, a write is
# a 25% surcharge on the input and nothing else. The default generation is one
# month (see "un mes es un mes"), so this is the common case, and the marker is
# only sent when the same call asks for two or more.
#
# THE FIRST MONTH GOES ALONE, BRIEFLY. A cache entry becomes readable only once
# the request that writes it has started streaming. Fired all at once, eight
# months would each write the same prefix -- eight 1.25x writes and no read,
# i.e. caching that costs MORE than not caching. So the first month is sent,
# and the rest wait until it has produced its first content event (prefill
# done, entry written) and then go together, reading it. That wait is the time
# to first token of one request -- a second or two against a generation that
# takes minutes -- and it is capped by FIRST_MONTH_HEAD_START_SECONDS, so a
# first month that stalls or dies delays the others by at most that.
#
# Pre-warming (a ``max_tokens=0`` request) was considered and rejected: the
# API refuses ``max_tokens=0`` together with structured output, and a warm-up
# without ``output_format`` would not share this request's prefix. The 1-hour
# TTL was rejected too: its write costs 2x, and every month of a generation
# starts within the 5 minutes that the reads keep refreshing.
CACHE_CONTROL = {"type": "ephemeral"}
FIRST_MONTH_HEAD_START_SECONDS = 10.0


def _purposes_for(effort: str) -> tuple:
    """What the ledger calls this call, and a failed one of these."""
    if effort == DEFAULT_EFFORT:
        return PURPOSE, PURPOSE_FAILED
    return PURPOSE_RETRY, PURPOSE_RETRY_FAILED

# Room for a month of shifts AND the thinking that precedes them: adaptive
# thinking spends from this same budget. With ids shortened (see id_alias.py)
# a busy month is on the order of 150 shifts at roughly 45 tokens each, so this
# leaves room for the reasoning on top. It was 16000 with full UUIDs, and a
# real month of 124 shifts -- 95 tokens each -- was cut off mid-JSON twice
# in three; the truncated reply did not parse and the month failed silently.
# It was 24000 while the call was not streamed, because a reply that long takes
# minutes to write and the 180s whole-response deadline gave up first -- so a
# bigger ceiling only bought a longer way to fail. Streaming removed that
# deadline, and the API's own guidance for a streamed reply is to leave room
# rather than to ration it: nothing here is billed unless the model writes it,
# and a month cut off mid-JSON fails the whole month for the price of the tokens
# that were already spent.
MAX_TOKENS = 64000

SYSTEM_PROMPT = """You build a staff rota. You are given a business's \
requirements, its team, and one calendar month. Return the shifts.

WHAT YOU RETURN
Each shift is exactly five things: which employee, which date, the time it \
starts, the time it ends, and optionally which shift template it follows.
- `employee_id` MUST be one of the ids you were given. Never invent a person, \
and never use a name where an id is asked for.
- `date` is "YYYY-MM-DD" and must fall inside the month you were given, on \
or after the first day of PERIOD.
- `start` and `end` are 24-hour "HH:MM". Write them as a person would speak \
them: a shift that runs from ten at night until two in the morning is `start` \
"22:00" and `end` "02:00". Never write an hour above "24:00", and never split \
one shift into two to avoid crossing midnight.
- `template_id` is one of the template ids you were given, or omitted.

Do NOT return hours worked, pay, cost, overtime, or colours. Those are computed \
from what you send and anything you write there is discarded.

MOST OF A ROTA REPEATS. SAY THAT ONCE.
A person who works the same hours on the same weekdays all month is ONE \
pattern, not twenty-one shifts. Write those as `patterns`, and keep `shifts` \
for what no pattern can say.
- A pattern is: which employee, which weekdays, the time it starts, the time \
it ends, and optionally which template.
- `weekdays` is a comma-separated list drawn from mon, tue, wed, thu, fri, \
sat, sun.
- `skip_dates` is a comma-separated list of dates inside this month where that \
pattern does NOT apply -- a closure, a day that person is away.
- A shift in `shifts` REPLACES the pattern for that person on that date. That \
is how you say "Ana works her usual week, but comes in at noon on the 14th".
Patterns are expanded into ordinary shifts before anything checks them, so a \
pattern that produces an illegal shift loses that shift exactly as if you had \
written it out by hand. Writing the repetition out is not safer -- only longer.

THE RULES YOU MUST KEEP
These are checked after you answer. A shift that breaks one is thrown away and \
replaced by a worse one chosen automatically, so keeping them is how your work \
survives.
- Nobody works on a day they are marked unavailable.
- The business is closed on the days listed as closed. No shifts on them.
- Every shift falls inside that day's opening hours.
- Between two shifts on DIFFERENT days, each person gets at least the stated \
minimum rest.
- Nobody exceeds their weekly hour ceiling. Weeks run Sunday to Saturday.
- Split shifts (two shifts for one person in one day) are only allowed if the \
requirements say so, and only for as many people as they permit.

WHAT A GOOD ROTA LOOKS LIKE
Meeting the coverage numbers is the floor, not the goal. Past that:
- Give people consistent patterns. Somebody who works mornings should keep \
working mornings; a rota that scatters a person across the clock is legal and \
horrible to live with.
- When the context quotes the manager's own words, every request in them \
that a rota can express is something to DELIVER, not a preference to weigh: \
who works when, with whom, how often, in what pattern. Those words are the \
reason the rota exists; the numbers above are what could be extracted from \
them. Where the two disagree, the words win, unless keeping to them would \
break a rule you must keep.
- Spread the unpopular shifts -- nights, weekends, closings -- rather than \
loading them onto whoever happens to fit.
- Give everyone THEIR contracted hours, no more and no less. Somebody far \
below theirs is a problem even when every hour of the shop is covered; \
somebody above theirs is working hours their contract does not cover, which \
is only acceptable when an hour cannot be covered any other way. A 20-hour \
person gets about 20 hours a week, not a full-timer's week.
- Prefer whole shifts to fragments.

WHEN THE PERIOD STARTS AFTER THE FIRST OF THE MONTH
The PERIOD line in the context is what you plan. A first calendar asked for \
on the 22nd covers only the 22nd onwards: the days before are already past. \
Plan only the days from PERIOD's first day on, and write no shifts in \
`shifts` before it. A pattern needs no `skip_dates` for those past days -- \
anything dated before PERIOD's first day is discarded -- so spend nothing on \
them.

Cover every open hour of the period. If the team cannot cover an hour, leave it \
uncovered rather than breaking a rule above -- the gap is reported to the \
manager, a broken rule is not."""


class ProposedShift(BaseModel):
    """One shift, as the model is allowed to state it.

    Field names are snake_case here and camelCase on the wire to the client;
    the router does that translation, because this is the shape the API sees
    and the schema-complexity ceiling is measured against it.
    """

    employee_id: str = Field(description="One of the employee ids you were given.")
    date: str = Field(description='The date, "YYYY-MM-DD".')
    start: str = Field(description='Start time, 24-hour "HH:MM".')
    end: str = Field(
        description='End time, 24-hour "HH:MM". Written as spoken: a shift '
        'ending at two in the morning is "02:00".'
    )
    template_id: Optional[str] = Field(
        default=None, description="One of the shift template ids, or omitted."
    )


class WeeklyPattern(BaseModel):
    """The repeating part of one person's month.

    This is the whole cost lever. Measured in production a month costs about
    twenty times more to WRITE than to read, and almost all of that writing is
    repetition: somebody on Monday-to-Friday nine-to-five is twenty-one
    near-identical lines that say one thing.

    EVERY FIELD IS A SCALAR, and ``weekdays``/``skip_dates`` are comma-joined
    strings rather than lists, for one reason: this product has twice shipped a
    schema the API answered with ``400 Schema is too complex``, and both times
    the failure was invisible because a working fallback caught it. A list of
    strings inside a nested model is exactly the shape that has cost us that
    before, so nothing here reaches for one. The parsing below is deliberately
    forgiving instead -- an unreadable weekday costs one pattern, not a month.
    """

    employee_id: str = Field(description="One of the employee ids you were given.")
    weekdays: str = Field(
        description='Comma-separated, from mon,tue,wed,thu,fri,sat,sun. '
        'For example "mon,tue,wed,thu,fri".'
    )
    start: str = Field(description='Start time, 24-hour "HH:MM".')
    end: str = Field(
        description='End time, 24-hour "HH:MM", written as spoken: a shift '
        'ending at two in the morning is "02:00".'
    )
    template_id: Optional[str] = Field(
        default=None, description="One of the shift template ids, or omitted."
    )
    skip_dates: str = Field(
        default="",
        description='Comma-separated "YYYY-MM-DD" dates in this month where '
        "this pattern does not apply. Empty if none.",
    )


class MonthPlan(BaseModel):
    """One month of shifts.

    Flat and single-field on purpose. ``refine_intake.py`` documents what the
    API does to a schema that reaches for nesting or unions, and this one is
    sent a dozen times for a year -- it has to be the boring shape.
    """

    shifts: List[ProposedShift] = Field(
        default_factory=list,
        description="Shifts no pattern covers, and shifts that replace a "
        "pattern on one date.",
    )
    patterns: List[WeeklyPattern] = Field(
        default_factory=list,
        description="The repeating part of the month, said once per person.",
    )


# date.weekday() is Monday=0..Sunday=6, the same numbering a week now starts
# with (see `services/workday.py:week_start`). This map is about NAMING a day,
# not about which shifts share a week, so the two never meet either way.
_WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def _weekday_numbers(spelled: str) -> set:
    """Weekday names to numbers, ignoring anything unreadable.

    Forgiving on purpose: "Mondays", "MON" and "monday" all mean the same day,
    and a pattern is worth keeping for the four days we understood rather than
    dropping for the one we did not. What we cannot read simply does not
    produce shifts -- the greedy pass covers whatever that leaves open.
    """
    found = set()
    for token in spelled.replace(";", ",").split(","):
        key = token.strip().lower()[:3]
        if key in _WEEKDAYS:
            found.add(_WEEKDAYS[key])
    return found


def _month_dates(month: str) -> List[date]:
    """Every date in "YYYY-MM", or nothing if that is not a month."""
    try:
        year, mon = (int(part) for part in month.split("-")[:2])
        last = _calendar.monthrange(year, mon)[1]
    except (ValueError, TypeError):
        return []
    return [date(year, mon, day) for day in range(1, last + 1)]


def expand_patterns(plan: MonthPlan, month: str) -> List[ProposedShift]:
    """Patterns into ordinary shifts, so nothing downstream learns a new shape.

    This is the point of the whole compression: the model writes the month
    short, and the client receives exactly the list of five-field shifts it has
    always received. ``fromProposal``, ``validate``, ``repair`` and the greedy
    pass are untouched, which is what keeps the safety net the same net.

    A shift written out longhand BEATS a pattern for that person on that date.
    That is the only way to say "her usual week, but noon on the 14th", and it
    also means a model that ignores patterns entirely still gets a correct
    month -- the old behaviour is the special case where ``patterns`` is empty.
    """
    dates = _month_dates(month)
    if not plan.patterns or not dates:
        return list(plan.shifts)

    # An explicit shift owns its (person, date) outright.
    spoken_for = {(shift.employee_id, shift.date) for shift in plan.shifts}
    out = list(plan.shifts)

    for pattern in plan.patterns:
        days = _weekday_numbers(pattern.weekdays)
        if not days:
            continue
        skipped = {
            token.strip() for token in pattern.skip_dates.split(",") if token.strip()
        }
        for day in dates:
            iso = day.isoformat()
            if day.weekday() not in days or iso in skipped:
                continue
            if (pattern.employee_id, iso) in spoken_for:
                continue
            spoken_for.add((pattern.employee_id, iso))
            out.append(
                ProposedShift(
                    employee_id=pattern.employee_id,
                    date=iso,
                    start=pattern.start,
                    end=pattern.end,
                    template_id=pattern.template_id,
                )
            )
    return out


def _note_what_the_attempt_cost_anyway(stream, purpose: str = PURPOSE_FAILED) -> None:
    """Meter a month that failed, for what it had already spent.

    Reads the running total the SDK keeps while the reply arrives. This is a
    FLOOR, not the bill: giving up on our side does not stop the model writing,
    so the provider's number for a month we abandoned is somewhere above this
    one. A floor in the back office beats the zero that was there before, which
    read as "this customer generated nothing" on an afternoon that emptied the
    account.

    Never raises. It runs on the failure path, where anything it threw would
    replace the real error with a metering one -- and it is normal for there to
    be nothing yet: a call that died before the first event has no snapshot,
    and the SDK's own retry spends a whole attempt that never reaches this code
    at all. What is metered here is the LAST attempt, not every attempt.
    """
    try:
        usage = stream.current_message_snapshot.usage
    except Exception:  # noqa: BLE001 - nothing arrived, nothing to meter
        return
    try:
        api_usage.note(purpose, MODEL, usage)
    except Exception:  # noqa: BLE001 - the meter must never mask the failure
        log.exception("api_usage: could not meter a failed month")


def _month_request(system: str, context: str, month: str, cache: bool) -> dict:
    """The ``system`` and ``messages`` of one month's call.

    The shared part first and the month last, in separate blocks, so the
    breakpoints sit on the boundary between what every month shares and what
    only this one says. See CACHE_CONTROL for when they are sent at all.
    """
    system_block = {"type": "text", "text": system}
    content = []
    if context.strip():
        # An empty text block is refused by the API, so no context means no
        # block -- and nothing shared to cache beyond the system prompt.
        content.append({"type": "text", "text": context})
    content.append({"type": "text", "text": "Plan the month of %s." % month})
    if cache:
        system_block["cache_control"] = CACHE_CONTROL
        if len(content) > 1:
            content[0]["cache_control"] = CACHE_CONTROL
    return {
        "system": [system_block],
        "messages": [{"role": "user", "content": content}],
    }


def _plan_month(
    client,
    system: str,
    context: str,
    month: str,
    effort: str = DEFAULT_EFFORT,
    cache: bool = False,
    streaming: Optional[threading.Event] = None,
) -> MonthPlan:
    """One month, one call.

    ``effort`` is MEDIUM on the first ask and high only for a month the client
    sent back. See DEFAULT_EFFORT above for why that trade is safe here and is
    not safe in the intake.

    ``streaming`` is set once this month has produced its first content event
    -- by then the prompt has been read and any cache entry it wrote is there
    for its siblings -- and set again on the way out whatever happened, so
    nobody waiting on it waits for a month that died. See CACHE_CONTROL.
    """
    try:
        return _ask_for_month(
            client, system, context, month, effort, cache, streaming
        )
    finally:
        if streaming is not None:
            streaming.set()


def _ask_for_month(
    client,
    system: str,
    context: str,
    month: str,
    effort: str,
    cache: bool,
    streaming: Optional[threading.Event],
) -> MonthPlan:
    """The call itself; ``_plan_month`` only guarantees ``streaming`` is set."""
    purpose, failed_purpose = _purposes_for(effort)
    started = time.monotonic()
    try:
        # Streamed, and not for anything on screen: nobody reads these events.
        # A month is tens of thousands of tokens and takes minutes to write,
        # which is exactly the shape of reply a non-streamed request is not
        # meant to carry -- the whole answer has to arrive inside one timeout,
        # and on 14-sep-2026 it did not. Streaming replaces that single deadline
        # with "has the connection gone quiet", which is the thing we actually
        # want to give up on. ``get_final_message`` hands back the same parsed
        # object ``parse`` returned, so nothing below this line changes.
        with client.messages.stream(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            thinking={"type": "adaptive"},
            output_config={"effort": effort},
            output_format=MonthPlan,
            **_month_request(system, context, month, cache),
        ) as stream:
            # The events are read only to keep a clock on them -- nothing here
            # renders a token. Iterating is what makes WHOLE_ANSWER_SECONDS
            # enforceable; `get_final_message` alone would block for as long as
            # the model kept talking.
            deadline = time.monotonic() + WHOLE_ANSWER_SECONDS
            try:
                for event in stream:
                    if (
                        streaming is not None
                        and not streaming.is_set()
                        and getattr(event, "type", None) != "message_start"
                    ):
                        streaming.set()
                    if time.monotonic() > deadline:
                        raise TimeoutError(
                            "the month was still being written after %ds"
                            % WHOLE_ANSWER_SECONDS
                        )
                response = stream.get_final_message()
            except BaseException:
                _note_what_the_attempt_cost_anyway(stream, failed_purpose)
                raise
    except ValidationError as exc:
        # The SDK parses the reply before handing it back, so a reply cut off
        # at MAX_TOKENS surfaces here as JSON that does not validate, not as
        # a stop reason we could read. Name the likely cause: a bare pydantic
        # traceback sent the last investigation to the wrong place.
        raise ValueError(
            "the month's JSON did not parse; a reply cut off at MAX_TOKENS "
            "(%d) is the usual cause" % MAX_TOKENS
        ) from exc
    api_usage.note(
        purpose, MODEL, response.usage, int((time.monotonic() - started) * 1000)
    )
    plan = response.parsed_output
    if plan is None:
        raise ValueError("model returned no structured output")
    return plan


def plan_calendar(
    context: str,
    months: List[str],
    api_key: Optional[str],
    preferences: str = "",
    employees: Optional[List[str]] = None,
    templates: Optional[List[str]] = None,
    employee_names: Optional[Dict[str, str]] = None,
    effort: str = DEFAULT_EFFORT,
    on_month: Optional[Callable[[str, Optional[List[ProposedShift]]], None]] = None,
) -> tuple[List[ProposedShift], List[str]]:
    """Plan every month, concurrently, and say which ones failed.

    ``employee_names`` maps an employee id to the name on their contract, read
    from our database by the CALLER -- never from the request. Every mention of
    one is replaced by that person's alias before the call, in BOTH texts that
    go out: the ``context`` the client wrote and the ``preferences`` paragraph
    we render ourselves. So the model plans for ``e1`` and never learns who e1
    is. Omitting it plans exactly as this function did before and sends
    whatever names those texts happen to carry, which is why both callers pass
    it.

    A name belonging to somebody the request did not declare in ``employees``
    is hidden too, but under an alias no shift can be restored from -- see
    ``id_alias.OFF_ROSTER``. Hiding a removed employee's name must not make
    them plannable again.

    ``on_month`` is called with each month AS IT ARRIVES -- its shifts, or None
    when that month could not be planned. It exists because a month that has
    come back has been BILLED: the queue writes it down before waiting for its
    siblings, so a manager who closes the tab loses nothing that was paid for.
    It is optional, and when it is absent this function behaves exactly as it
    did when the only caller was a request that held the answer in memory.

    Whatever the callback does must not raise: a store that fails is not a
    reason to throw away a month that arrived.

    Returns ``(shifts, failed_months)``. A month that raises is NOT fatal: its
    shifts are simply absent, and the client's greedy pass covers that block
    deterministically. Letting one bad month take the other eleven with it
    would turn a quality problem into an outage, and the manager would have
    nothing rather than a calendar with one ordinary-looking month in it.
    """
    import anthropic

    client = (
        anthropic.Anthropic(
            api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES
        )
        if api_key
        else anthropic.Anthropic(timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES)
    )

    # THE ALIAS TABLE IS BUILT BEFORE ANYTHING IS COMPOSED, because two
    # different texts go to the model and both of them carry names.
    #
    # The model reads and writes short ids; the real ones come back here.
    # The two lists say which id is a person and which is a template, so a
    # template's alias answered where a person belongs can be refused.
    #
    # AND THE NAMES GO THE SAME WAY. The alias an employee's id already has is
    # the alias their name gets, so a roster row, a sentence in the brief and
    # the shift that comes back all say e1 -- one person, consistently, and no
    # "Ana Garcia Perez" leaving the building. See id_alias.load_names.
    aliases = IdAliases()
    aliases.load(employees or [], templates or [])
    if employee_names:
        aliases.load_names(employee_names)
    context = aliases.shorten(context)

    system = SYSTEM_PROMPT
    if preferences.strip():
        # Appended, never interpolated into the rules above: what we have
        # learned about a manager may shape a rota, and may not quietly become
        # one of the constraints that decide whether a shift is legal.
        #
        # AND MASKED, WITH THE SAME TABLE AS THE CONTEXT. This paragraph is
        # ours -- `business_profile.planning_context` renders it out of our own
        # database -- and it is the one part of this request that names people
        # ON PURPOSE: a confirmed standing rule is extracted by `triage.py`,
        # whose prompt says in as many words that names of people are fine and
        # often necessary, with "Laura always opens" as its example. So an
        # organisation with one confirmed rule was sending that sentence,
        # verbatim, on every month of every generation, long after the context
        # beside it had been cleaned. Masked here it still reads as a rule
        # about the same person the team listing calls e1.
        system += "\n\nWHAT THIS MANAGER PREFERS\n" + aliases.shorten(
            preferences
        ).strip()

    # Wrapped once for all twelve months: every month shares a purpose here,
    # so one middleware serves them all. It counts the HTTP attempts the SDK
    # retries INSIDE a single call -- billed, and invisible to the code below,
    # which is a different hole from the one _note_what_the_attempt_cost_anyway
    # fills (that one meters the last attempt, this one the ones before it).
    client = client.with_middleware(
        api_usage.meter_attempts(_purposes_for(effort)[1], MODEL)
    )

    shifts: List[ProposedShift] = []
    failed: List[str] = []

    # Cached only when a sibling will read it. See CACHE_CONTROL.
    cache = len(months) > 1

    # One worker per month, capped: firing all twelve at once is the fastest
    # way to meet a rate limit. See MAX_CONCURRENT_MONTHS for why the cap moved.
    with ThreadPoolExecutor(
        max_workers=min(MAX_CONCURRENT_MONTHS, max(1, len(months)))
    ) as pool:

        def submit(month: str, streaming: Optional[threading.Event] = None):
            return pool.submit(
                copy_context().run,
                _plan_month,
                client,
                system,
                context,
                month,
                effort,
                cache,
                streaming,
            )

        futures = {}
        if cache:
            # The first month writes the cache; the rest read it. See
            # CACHE_CONTROL for why they wait, and for how little.
            first_streaming = threading.Event()
            futures[months[0]] = submit(months[0], first_streaming)
            first_streaming.wait(FIRST_MONTH_HEAD_START_SECONDS)
        for month in months:
            if month not in futures:
                futures[month] = submit(month)
        # Iterated in the order they FINISH, not the order they were asked, so
        # `on_month` fires the moment a month exists rather than when its
        # slowest sibling does. What this function RETURNS is still assembled
        # in the caller's order below -- the two were the same list once, and
        # keeping the answer byte-identical is what makes this change a change
        # of timing only.
        by_month: dict = {}
        month_of = {future: month for month, future in futures.items()}
        for future in as_completed(futures.values()):
            month = month_of[future]
            try:
                plan = future.result()
                # Expanded here, before the ids are restored, so the aliases in
                # a pattern are translated by exactly the same pass that
                # translates the ones in a shift.
                proposed = expand_patterns(plan, month)
                if plan.patterns:
                    log.info(
                        "plan.month %s: %d pattern(s) and %d written-out "
                        "shift(s) became %d shift(s)",
                        month,
                        len(plan.patterns),
                        len(plan.shifts),
                        len(proposed),
                    )
            except Exception as exc:  # noqa: BLE001 - one bad month is not an outage
                # Not fatal, but not silent either: without this line a month
                # that never came back is indistinguishable from one the model
                # arranged, and the only trace is a missing row in api_usage.
                log.warning(
                    "plan.month %s failed: %s: %s", month, type(exc).__name__, exc
                )
                failed.append(month)
                _tell(on_month, month, None)
                continue
            kept = _restore_ids(proposed, aliases, month)
            if proposed and not kept:
                # Every shift named somebody we could not place. One or two is
                # the model inventing a person; all of them means the aliases
                # and the ids stopped agreeing, and returning an empty month
                # as a success would hide that behind a calendar the greedy
                # pass quietly built instead.
                failed.append(month)
                _tell(on_month, month, None)
                continue
            by_month[month] = kept
            _tell(on_month, month, kept)

    for month in months:
        shifts.extend(by_month.get(month, []))

    return shifts, sorted(failed)


def _tell(
    on_month: Optional[Callable[[str, Optional[List[ProposedShift]]], None]],
    month: str,
    shifts: Optional[List[ProposedShift]],
) -> None:
    """Hand a finished month to whoever is storing it, and never let it throw.

    The callback writes to the database from inside a worker thread. If that
    write fails the month is still worth having in the answer -- the caller is
    the one that decides what a lost row costs, and here it costs nothing.
    """
    if on_month is None:
        return
    try:
        on_month(month, shifts)
    except Exception:  # noqa: BLE001 - a month that arrived is not lost to this
        log.exception("plan.month %s: on_month callback failed", month)


def _restore_ids(
    proposed: List[ProposedShift], aliases: IdAliases, month: str
) -> List[ProposedShift]:
    """Real ids back onto the model's shifts.

    A shift naming a person we never listed -- or naming a TEMPLATE where a
    person belongs -- is dropped here and said out loud: the client would drop
    it too, as an unknown employee, but silently. A template we never listed is
    merely forgotten; the shift still has its hours.
    """
    kept = [
        shift.model_copy(
            update={
                "employee_id": employee_id,
                "template_id": aliases.template(shift.template_id),
            }
        )
        for shift in proposed
        for employee_id in [aliases.employee(shift.employee_id)]
        if employee_id is not None
    ]
    if len(kept) < len(proposed):
        log.warning(
            "plan.month %s: dropped %d of %d shift(s) naming an unknown employee",
            month,
            len(proposed) - len(kept),
            len(proposed),
        )
    return kept
