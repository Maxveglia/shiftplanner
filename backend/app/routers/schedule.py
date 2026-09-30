from __future__ import annotations

import calendar
import logging

from datetime import date, datetime, timedelta
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, StringConstraints

from app.schemas import limits
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db, set_current_org
from app.models.organization import Organization
from app.deps import get_current_manager, get_current_user
from app.errors import ai_failure, detail
from app.schemas.assignment import (
    AssignmentOut,
    DraftOut,
    PublishIn,
    PublishOut,
    ShiftMarkOut,
    TeammateShiftOut,
)
from app.schemas.auth import UserOut
from app.services import api_usage
from app.services.absences import drop_shifts_on_leave
from app.services import day_insights
from app.services import generation_queue
from app.services import hand_edits
from app.services import planner_notes
from app.services import business_profile as bp
from app.services import employees as employees_svc
from app.services import jev
from app.services import labour_floor
from app.services import rota_email
from app.services import rota_law
from app.services import research as research_svc
from app.services.intake import (
    bound_horizon,
    brief_to_spec,
    brief_to_team,
    hour_questions,
    interpret_brief,
    ranked_signals,
    unclear_weekdays,
    unstated_fields,
)
from app.services.calendar_plan import DEFAULT_EFFORT, RETRY_EFFORT, plan_calendar
from app.services.mailer import Mailer, Message, mailer
from app.services.refine_intake import plan_edits
from app.services.schedule import (
    parse_window,
    list_draft,
    day_team,
    list_marks,
    list_published,
    parse_aware_datetime,
    publish,
    save_draft,
    to_assignment_out,
    validate_shifts,
)

log = logging.getLogger(__name__)

#: The widest window `/schedule/day-team` will answer. A local day is 23, 24 or
#: 25 hours long depending on the clocks; 26 leaves room for the longest of
#: them and for a client that rounds, and is still unmistakably one day.
MAX_DAY_TEAM_WINDOW = timedelta(hours=26)

router = APIRouter(prefix="/schedule", tags=["schedule"])


# WHY THE THREE MODELS BELOW COUNT THEIR CHARACTERS.
#
# Every one of these fields is forwarded to Anthropic verbatim, and nothing
# truncates on the way. So the length of a string a stranger can post is the
# size of a bill we pay: `text` was a plain `str`, which is to say a megabyte
# was a legal brief and a megabyte of tokens was the invoice. The budget guard
# (`_within_budget`) only notices AFTER the money is spent, and it is off by
# default.
#
# The numbers are what the writing actually is, times about five. A manager's
# brief is a paragraph or two; a month of draft as `context` is a few thousand
# characters. Nothing legitimate comes close, and what does not come close is
# what a ceiling should be.


class InterpretIn(BaseModel):
    # The brief, in the manager's own words. Prose a person typed: long for
    # one is a screenful.
    #
    # NAMES IN HERE ARE NOT MASKED, and that is a decision rather than an
    # oversight. This text is what the manager typed, in the box that says it
    # will be read and acted on; the team the brief describes is HOW the roster
    # gets created in the first place (`brief_to_team` reads the names off it
    # and the client offers them for confirmation). Take the names out and the
    # feature has nothing to propose. The planning path is different and is
    # masked -- see `GenerateIn.context` -- because there the names are rows we
    # ADD to what the manager sent, and the model answers with ids either way.
    text: str = Field(max_length=8_000)


class RefineIn(BaseModel):
    # One adjustment asked for in a sentence -- "give Ana Fridays off". Shorter
    # than a brief because it is a correction, not a description.
    #
    # ALSO NOT MASKED, for a harder reason than the brief's. The model answers
    # an adjustment with `employee: "Ana"` -- a NAME -- which `resolveEmployee`
    # on the client matches against the roster; that is the whole protocol of
    # this endpoint. Masking the roster in `context` while the manager's own
    # sentence still says "Ana" would leave the model with a name it cannot
    # place and an adjustment that silently does nothing, and masking the
    # sentence too would need the alias restored in every returned operation
    # for a text whose spellings ("Ana", "la Ana", a nickname) we do not
    # control. Half of it is theatre and the other half breaks the feature, so
    # neither is done here and the gap is written down instead: /refine still
    # sends first names, and the roster's full names with them.
    text: str = Field(max_length=limits.ADJUSTMENT)
    # Compact snapshot of the draft, built by the client. It deliberately
    # carries no pay rates and no absence reasons — the model needs to know
    # WHO is unavailable, never WHY. Smaller than the ceiling a fresh plan
    # gets: a refine lists 160 shifts where a replan lists 400.
    context: str = Field(max_length=limits.PROSE)


def _within_budget(db: Session, org_id) -> None:
    """Stop, or say so, before the money is spent.

    Enforcement is off by default (see ``api_budget_enforced``): the warning
    runs everywhere so the ledger can be read for a fortnight before anybody
    is refused, because a ceiling that starts refusing on the day it ships
    turns our estimate into somebody else's outage.
    """
    spent = api_usage.spent_usd_this_month(db, org_id)
    if spent < settings.api_budget_usd_per_month:
        return
    log.warning(
        "org %s has spent $%.2f of its $%.2f monthly model budget (%s)",
        org_id,
        spent,
        settings.api_budget_usd_per_month,
        "refusing" if settings.api_budget_enforced else "allowing, not enforced",
    )
    if settings.api_budget_enforced:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail(
                "org_budget_spent",
                "This account has reached its monthly allowance for AI "
                "planning. It resets as earlier usage ages past 30 days, and "
                "everything else in the calendar keeps working meanwhile.",
            ),
        )


def _deliver(post: Mailer, messages: List[Message]) -> None:
    """Send, after the response has gone out, and never raise.

    This runs in FastAPI's background task, which means two things. The request
    is over, so nobody is waiting on a slow provider; and there is no longer an
    HTTP response to turn an exception into, so an escape here would surface
    only as a traceback in the log with a manager none the wiser. The result is
    logged either way, because "how many of these actually land" is the one
    question this channel will be judged on.
    """
    try:
        result = post.send(messages)
    except Exception:  # noqa: BLE001 - a courtesy must not become an incident
        log.exception("publish: the rota email failed for %d message(s)", len(messages))
        return
    if result.failed:
        log.warning(
            "publish: rota email delivered %d of %d (%d refused)",
            result.delivered,
            result.attempted,
            result.failed,
        )
    else:
        log.info("publish: rota email delivered %d message(s)", result.delivered)


class GenerateIn(BaseModel):
    # Same shape of snapshot `/refine` takes, and under the same rule: it
    # carries the requirements, the roster and who is unavailable, and it
    # carries no pay rates and no absence reasons. It may also quote the
    # manager's brief, which `/interpret` above already receives verbatim --
    # the rule is about rows from the database, not about their own words.
    #
    # AND NO NAMES REACH THE MODEL FROM HERE. The client stopped writing them
    # into this text (`frontend/src/lib/schedule/planContext.ts`), and whatever
    # one still carries -- the quoted brief, a note, the adjustment the manager
    # typed -- is replaced with that person's alias by `id_alias.py` before the
    # call. This field is untrusted input, so the names to mask are read from
    # our own roster and never from the request.
    #
    # The ceiling is measured rather than guessed, by running `buildPlanContext`:
    # a 14-person month already spent 38k characters, 20 people with a long
    # brief 41k, and the 50-person roster this product plans for 41.6k. A 40.000
    # ceiling would have refused a replan for every customer above about fifteen
    # people -- and refused it in pydantic's English, which `getErrorMessage`
    # cannot translate. This is three times the worst case measured, and the
    # real ceiling on what a replan costs is MAX_LISTED_SHIFTS on the client,
    # not this.
    context: str = Field(max_length=limits.PLAN_CONTEXT)
    # The blocks to plan, as "YYYY-MM". One call each, so a year is twelve
    # requests rather than one impossible response.
    #
    # No `max_length` on the LIST on purpose: more than twelve is already
    # refused in the route below with `too_many_months`, which is a code the
    # browser has a sentence for. A ceiling on the field would refuse the same
    # request in pydantic's words instead, and the manager would read the
    # English fallback.
    #
    # The ELEMENTS are another matter. Each one is interpolated into the prompt
    # ("Plan the month of %s", calendar_plan.py) and each one is its own call to
    # the model, so an unbounded string here walks straight past the ceiling on
    # `context` above: twelve of them fill the 1 MB envelope with arbitrary text
    # and buy twelve expensive calls with it. The pattern is what the client
    # sends -- `date.slice(0, 7)` -- so anything else was never a real request,
    # and refusing it here means nothing is paid for before finding that out.
    months: List[
        Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
    ]
    # The ids in `context`, said plainly, so the server can shorten them for
    # the model and tell a person from a template on the way back. Optional:
    # without them the ids still shorten, they just answer to either kind.
    #
    # 250 is five times the 50-person roster this product plans for, and 100
    # templates is more shift patterns than a day has hours.
    # A tope per element as well as per list: a name is a name, and these are
    # free text arriving from the browser.
    employees: List[Annotated[str, StringConstraints(max_length=200)]] = Field(
        default=[], max_length=250
    )
    templates: List[Annotated[str, StringConstraints(max_length=200)]] = Field(
        default=[], max_length=100
    )
    # How hard to think. Absent means the default, which is medium: the client
    # asks again with "high" for the months its own validator rejected, and
    # paying for the deeper answer only there is the whole point. Anything else
    # is refused rather than passed on -- this field decides what a request
    # costs, so it is not a place to forward whatever arrives.
    effort: Optional[str] = None


class GenerateOut(BaseModel):
    # Proposed shifts, camelCase for the client. NOT a calendar: the client
    # validates every one of these against the same rules the generator obeys
    # and drops what breaks them.
    shifts: list
    # Months the model could not plan. The client covers these with its own
    # deterministic pass, so this is a note about quality, not a failure.
    failed: List[str] = []
    source: str
    model: Optional[str] = None


class RefineOut(BaseModel):
    ops: list
    unsupported: Optional[str] = None
    source: str
    model: Optional[str] = None


class InterpretOut(BaseModel):
    spec: dict
    # The team the brief described, if any. The client reconciles it against the
    # real roster and asks the manager to confirm before anything is written.
    team: list = []
    source: str
    model: Optional[str] = None
    # What this org's own past corrections added to the spec, and on what
    # evidence. Every entry corresponds to a rule tagged `origin: "profile"`.
    applied: list = []
    # Requirements the brief never stated and nothing learned could fill, so a
    # generic default decided them. Shown, not applied silently.
    gaps: list = []
    # Industry-typical proposals for this vertical. NEVER applied — the manager
    # accepts one by saying so in the brief, where it becomes a stated rule.
    suggestions: list = []
    # What this manager told us directly -- an answer to a question, or a
    # correction that stated a rule. Applied at once and shown with a way to
    # take it back.
    declared: list = []
    # Requirements the manager DID state that need exactly one number from them
    # before they can be enforced ("Saturdays are our busiest" — how many?).
    # Neither a gap nor a note: a question, and the manager answers it.
    questions: list = []


def _period_dates(spec: dict) -> set:
    """Every date the plan will cover, as "YYYY-MM-DD".

    Only the holidays that fall INSIDE the period may close a day: a rota for
    October has no business acting on Sant Joan. The period is derived from the
    horizon the brief set rather than passed in, because `interpret` is where
    the spec is built and no caller has picked a window yet.

    A brief with no start named plans from this month, which is the same
    reading `daysFor` makes on the client when nobody dated the calendar.
    """
    months = int(spec.get("horizonMonths") or 1)
    start_raw = spec.get("horizonStart")
    today = date.today()
    if isinstance(start_raw, str) and len(start_raw) >= 7:
        try:
            year, month = int(start_raw[0:4]), int(start_raw[5:7])
        except ValueError:
            year, month = today.year, today.month
    else:
        year, month = today.year, today.month

    out = set()
    for _ in range(max(months, 1)):
        days = calendar.monthrange(year, month)[1]
        for day in range(1, days + 1):
            out.add("%04d-%02d-%02d" % (year, month, day))
        month += 1
        if month > 12:
            month, year = 1, year + 1
    return out


@router.post("/interpret", response_model=InterpretOut)
def interpret(
    payload: InterpretIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> InterpretOut:
    """Translate the manager's free-text brief into a validated scheduling spec.

    Only translation happens here: the returned spec is shown to the manager for
    confirmation, and the scheduler builds the calendar from it. No employee
    names, salaries or medical data are sent to the model.

    What this org has taught us joins in at two points, both of them narrow.
    Before the call, as BACKGROUND on the system prompt -- context that helps
    read a vague sentence and is explicitly not permission to invent a
    requirement. After the call, to fill fields the brief left silent, and only
    those: `unstated_fields` is computed from the brief itself, so a
    requirement the manager stated is never touched by anything we think we
    know. Whatever is still undecided comes back as `gaps` instead of being
    quietly defaulted.
    """
    text = payload.text.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("text_empty", "text must not be empty"),
        )

    if not settings.anthropic_api_key:
        # The frontend falls back to its local parser on 503.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail(
                "anthropic_key_missing",
                "ANTHROPIC_API_KEY is not configured on the server",
            ),
        )

    from datetime import date

    profile = bp.get_or_create(db, current_user.org_id)
    hints = bp.hints_for(db, current_user.org_id)
    background = bp.model_context(
        profile, hints, day_insights.context_lines(db, current_user.org_id)
    )

    # Metered in its own transaction, and in a ``finally``: a brief that fails
    # on its third call still paid for two, and the 502 below rolls this
    # request's session back. See services/api_usage.py.
    with api_usage.collect() as ledger:
        try:
            brief = interpret_brief(
                text, settings.anthropic_api_key, date.today().isoformat(), background
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as 502
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=ai_failure(
                    exc, "intake_failed", "Could not interpret the brief: %s" % exc
                ),
            ) from exc
        finally:
            api_usage.record(current_user.org_id, ledger)

    from app.services.intake import MODEL

    # The rota is built to the law where the business is, not to the constants
    # this file was written with. A jurisdiction with nothing seeded comes back
    # empty and every default below is the one it always was.
    jurisdiction = db.execute(
        select(Organization.jurisdiction_code).where(
            Organization.id == current_user.org_id
        )
    ).scalar_one_or_none()
    # The sentence, not the model, has the last word on how many months: see
    # `bound_horizon` -- "hazlo para octubre" was planned as three.
    brief.horizon = bound_horizon(brief.horizon, text)
    spec = brief_to_spec(brief, labour_floor.floor_for(db, jurisdiction or ""))
    silent = unstated_fields(brief)

    # Assume before learning, and learn before defaulting.
    #
    # The order is the precedence, and it reads downwards in authority. What the
    # manager SAID is already in the spec. What this call assumes rests on
    # something they said in this same brief ("busier on Mondays" -> one more
    # than the floor), so it outranks a hint inferred from corrections made on
    # other days -- and it takes those fields out of `silent`, which is the one
    # line that stops a hint from overwriting it, since `apply_hints` only ever
    # writes a field it is told nobody spoke about.
    # What this manager ANSWERED, before anything is assumed or learned.
    #
    # The brief still wins: `apply_declarations` writes only the days this brief
    # said nothing about. It sits above the learning layer because a hint is our
    # inference from three days of corrections and this is the manager replying
    # to a question -- treating a direct answer as weak evidence, and making
    # them repeat it for three days, is the behaviour that made asking anything
    # feel pointless.
    declared = bp.apply_declarations(spec, profile, silent, unclear_weekdays(brief))
    # A field the manager has decided is not one to assume about afterwards.
    silent = [
        f
        for f in silent
        if f not in {d.get("gapField") for d in declared if d.get("gapField")}
    ]

    # What the research inferred about this trade in this city, joined to what
    # the brief itself ranked. It only ever speaks where the brief is silent
    # (see `merge_signals`), and what it produces is announced as an assumption
    # like any other -- the manager never had to type it, and can still argue
    # with it in one sentence.
    signals = research_svc.ResearchSignals.from_json(profile.research_signals)
    assumed = bp.assume(
        spec,
        silent,
        bp.merge_signals(
            ranked_signals(brief), signals, spec, _period_dates(spec)
        ),
    )
    silent = [f for f in silent if f not in {a["field"] for a in assumed}]

    applied = (
        bp.apply_hints(spec, silent, hints) if profile.learning_enabled else []
    )

    # The shape of this business's day, from the profile the manager filled in.
    #
    # Deliberately NOT part of the four-source precedence, and not a learned
    # hint: nobody infers these from a calendar and no vertical writes them.
    # They are settings a human typed, so they ride along whenever they exist
    # and are simply absent when they do not -- at which point every reader
    # falls back to midnight and to Saturday and Sunday. `learning_enabled` does
    # not gate them either: switching the adaptive layer off means "stop
    # deducing things about me", not "forget the hours I told you".
    if profile.day_boundary_min is not None:
        spec["dayBoundaryMin"] = profile.day_boundary_min
    if profile.weekend_days is not None:
        spec["weekendDays"] = profile.weekend_days

    # get_or_create may have inserted a profile row for an org created after
    # the migration ran; nothing else here writes. get_db commits the request
    # transaction -- committing here would drop the org context RLS reads.
    db.flush()

    return InterpretOut(
        spec=spec,
        team=brief_to_team(brief),
        source="claude",
        model=MODEL,
        applied=applied,
        gaps=bp.gaps(silent, applied, assumed, spec),
        # What is in force because the manager said so -- answering a question
        # or correcting a calendar. Its own list rather than a row in `applied`:
        # that one is what we INFERRED and carries days of evidence, and this
        # carries none because it needs none.
        declared=declared,
        suggestions=bp.suggestions_for(profile, silent),
        # The one thing a rota cannot show: hours a brief mentions without
        # giving ("sabados casi todo el dia"). What used to live here -- "which
        # days are busiest?" -- is an assumption now, for the reason written on
        # `ranked_signals`.
        #
        # A day this manager has already answered for is never asked again,
        # and no line here does that: their answer went into `dayHours` above,
        # and a day with hours is one `hour_questions` drops. Filtering here as
        # well would be a second copy of the same promise, free to drift from
        # the first.
        questions=hour_questions(brief, spec),
    )


class DeclareIn(BaseModel):
    """One answer to one question this product asked."""

    weekday: int
    open_min: int
    close_min: int


class DeclareOut(BaseModel):
    weekday: int
    open_min: int
    close_min: int


# The longest a working day can be before the number is a typo rather than a
# night: a close at 04:00 arrives as 1680, and nobody's Saturday runs 30 hours.
MAX_CLOSE_MIN = bp.LATEST_CLOSE_MIN


@router.post("/declare", response_model=DeclareOut)
def declare(
    payload: DeclareIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> DeclareOut:
    """Record the hours a manager gave us for one weekday, for good.

    This is what makes a question worth answering. The reply applies to the
    calendar on screen immediately -- the client already has it, and does not
    wait for this call to redraw -- and it is written here so the SAME question
    is never asked again: the next brief that goes quiet about that day gets
    these hours instead of a coin flip.

    It does not touch the brief and does not ask the manager to rewrite it. A
    later brief that states hours for that day overrules this, which is the
    precedence working as written: the brief is the most explicit thing they
    have said, and this is only what they told us when it stayed silent.
    """
    if not 0 <= payload.weekday <= 6:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "weekday_out_of_range", "weekday must be 0 (Sunday) to 6 (Saturday)"
            ),
        )
    # A close BEFORE the open is a night and arrives already rolled past 1440,
    # so what is rejected here is a day with no length at all, not a late one.
    if not 0 <= payload.open_min < payload.close_min <= MAX_CLOSE_MIN:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "day_has_no_length",
                "open_min and close_min must describe a day that has a length",
            ),
        )

    bp.declare_day_hours(
        db,
        current_user.org_id,
        payload.weekday,
        payload.open_min,
        payload.close_min,
    )
    db.flush()
    return DeclareOut(
        weekday=payload.weekday,
        open_min=payload.open_min,
        close_min=payload.close_min,
    )


@router.post("/refine", response_model=RefineOut)
def refine(
    payload: RefineIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> RefineOut:
    """Turn a request to adjust the current calendar into edit operations.

    The operations come back to the client, which validates each one against
    availability and applies it deterministically. Nothing here mutates a
    schedule: the draft lives in the manager's browser until it is published.
    """
    text = payload.text.strip()
    if not text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("text_empty", "text must not be empty"),
        )

    if not settings.anthropic_api_key:
        # The frontend falls back to its local parser on 503.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail(
                "anthropic_key_missing",
                "ANTHROPIC_API_KEY is not configured on the server",
            ),
        )

    # What Jev reads to say which halves of the planner this sentence needs
    # (see `plan_edits`): the manager's SENTENCE and nothing else -- never
    # `context`, which carries the team and the shifts -- with every name this
    # org has on file masked, read here because this is where the database
    # is. Jev is hosted outside the EU; "e1 libra el viernes" is what crosses.
    # A failure here costs the question, never the adjustment.
    route_state = None
    if jev.enabled():
        try:
            route_state = jev.mask(
                text, employees_svc.names_by_id(db, current_user.org_id)
            )
        except Exception:  # noqa: BLE001 - every half gets asked without it
            log.exception("jev: could not mask the sentence; not asked")

    with api_usage.collect() as ledger:
        try:
            plan = plan_edits(
                text,
                payload.context,
                settings.anthropic_api_key,
                route_state=route_state,
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as 502
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=ai_failure(
                    exc, "refine_failed", "Could not plan the adjustment: %s" % exc
                ),
            ) from exc
        finally:
            api_usage.record(current_user.org_id, ledger)

    from app.services.refine_intake import MODEL as REFINE_MODEL

    # A rule the manager stated in passing, kept as a PROPOSAL. It changes no
    # calendar until they confirm it on the rules screen -- see
    # `business_profile.is_active`. Recorded after the plan rather than before
    # it, and never allowed to cost the adjustment: a sentence this failed to
    # file is a rule the manager can state again, while an adjustment lost to a
    # bookkeeping error is work they cannot get back.
    if plan.standing_rule:
        try:
            bp.note_stated_rule(db, current_user.org_id, plan.standing_rule)
        except Exception:  # noqa: BLE001 - the adjustment is what matters here
            log.exception("could not record a stated rule")

    return RefineOut(
        ops=[o.model_dump(exclude_none=True) for o in plan.ops],
        unsupported=plan.unsupported,
        source="claude",
        model=REFINE_MODEL,
    )


@router.post("/generate", response_model=GenerateOut)
def generate(
    payload: GenerateIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> GenerateOut:
    """Ask the model to draft the calendar itself, one month per call.

    This endpoint PROPOSES. It does not decide: everything it returns is
    checked client-side against availability, rest, contracts, opening hours
    and the split-shift rules, and whatever breaks one is dropped and refilled
    by the deterministic generator. Nothing here touches the database, and no
    draft is persisted -- the calendar lives in the manager's browser until it
    is published, exactly as it did before.

    A month that fails comes back in ``failed`` rather than as an error. The
    client already knows how to build that month on its own, and taking eleven
    good months down with one bad one would be the worst trade available.
    """
    months = [m.strip() for m in payload.months if m and m.strip()]
    if not months:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("months_empty", "months must not be empty"),
        )
    if not payload.context.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("context_empty", "context must not be empty"),
        )
    # A year is twelve. Anything past that is a client bug or an attempt to
    # spend somebody else's money, and both are better refused than served.
    if len(months) > 12:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("too_many_months", "months must not exceed 12"),
        )

    if not settings.anthropic_api_key:
        # No key, no proposal. The client builds the calendar its own way.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail(
                "anthropic_key_missing",
                "ANTHROPIC_API_KEY is not configured on the server",
            ),
        )

    effort = payload.effort or DEFAULT_EFFORT
    if effort not in (DEFAULT_EFFORT, RETRY_EFFORT):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "unknown_effort",
                "effort must be %r or %r" % (DEFAULT_EFFORT, RETRY_EFFORT),
            ),
        )

    # What this business prefers, read from its own profile rather than taken
    # from the request. It is the product's belief about the account -- what
    # the manager declared, what they have corrected us towards on previous
    # calendars, what they want a rota to optimise for -- and a client that
    # could fill this field could put words in the model's mouth about a
    # business it does not own. Empty for an account nobody has told us
    # anything about, which is every account on its first day.
    profile = bp.get_or_create(db, current_user.org_id)
    preferences = bp.planning_context(
        profile,
        bp.hints_for(db, current_user.org_id),
        planner_notes.business_notes(db, current_user.org_id, profile),
        day_insights.context_lines(db, current_user.org_id),
    )

    # Who this org's people are CALLED, so that their names can be taken out of
    # the context before it leaves. Read here and not taken from the request:
    # the client composed that context and cannot also be the authority on
    # whose name may travel. Read from `db` too -- so it has to happen above
    # the commit below, with everything else that needs a connection.
    names = employees_svc.names_by_id(db, current_user.org_id)

    _within_budget(db, current_user.org_id)

    # Let go of the database BEFORE the model starts writing.
    #
    # Everything above this line is the last thing this request needs a
    # connection for, and everything below it takes MINUTES. Without the
    # commit the request holds its session -- and with it one pooled
    # connection, and a Postgres transaction left `idle in transaction` --
    # for the whole time the calendar is being written. The pool is fifteen
    # connections (SQLAlchemy's 5 + 10 overflow), so a dozen managers
    # generating at once is enough to make LOGIN wait thirty seconds and then
    # fail: the thing that stops answering is not generation.
    #
    # `get_current_user` opened the transaction before this function was even
    # entered (it stamps `last_seen_at`), so committing here is what ends it.
    # NOTHING BELOW MAY TOUCH `db`: the commit ends the transaction, and the
    # org context RLS reads is `SET LOCAL`, so it is gone with it. The meter
    # is fine -- `api_usage.record` opens its own session and sets the org
    # itself, which is exactly why it was written that way.
    db.commit()

    with api_usage.collect() as ledger:
        try:
            shifts, failed = plan_calendar(
                payload.context,
                months,
                settings.anthropic_api_key,
                preferences,
                payload.employees,
                payload.templates,
                names,
                effort,
            )
        except Exception as exc:  # noqa: BLE001 - surfaced to the client as 502
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=ai_failure(
                    exc, "plan_failed", "Could not plan the calendar: %s" % exc
                ),
            ) from exc
        finally:
            api_usage.record(current_user.org_id, ledger)

    from app.services.calendar_plan import MODEL as PLAN_MODEL

    return GenerateOut(
        shifts=[
            {
                "employeeId": s.employee_id,
                "date": s.date,
                "start": s.start,
                "end": s.end,
                **({"templateId": s.template_id} if s.template_id else {}),
            }
            for s in shifts
        ],
        failed=failed,
        source="claude",
        model=PLAN_MODEL,
    )


class PlanJobOut(BaseModel):
    """A job, and whatever of it has arrived.

    Shaped so the client can build the SAME thing the synchronous endpoint
    returned: `shifts` are the proposals of every month that came back, and
    `failed` the months the model could not do, which the client covers with
    its own deterministic pass. Nothing new had to be parsed for this.
    """

    job_id: str
    status: str
    months: List[str]
    # Months with an answer on disk. What a progress panel counts.
    done: List[str]
    failed: List[str]
    shifts: list
    error_code: Optional[str] = None
    source: str = "claude"
    model: Optional[str] = None
    # How many times a worker has taken this job. Above one, the worker that
    # had it died -- a deploy restarts the container the workers live in -- and
    # another picked it up where it stopped.
    attempts: int = 1
    # Running, and no heartbeat for a while: nobody is working on it right now.
    # The queue hands it to another worker once it is stale, which takes
    # minutes, and a panel that says nothing meanwhile reads as a hang.
    stalled: bool = False


# A worker beats once a minute (generation_worker.HEARTBEAT_SECONDS). Half a
# beat of slack before calling it silence.
STALLED_AFTER_SECONDS = 90


def _job_out(job, months, *, with_shifts: bool = True) -> PlanJobOut:
    """The job as the client reads it.

    ``with_shifts`` is false while POLLING, and that is not a micro-optimisation:
    a year is on the order of 1.500 shifts, a poll happens every few seconds for
    as long as the model is writing, and sending the whole calendar back each
    time would move megabytes to answer "how is it going?". The months are
    counted either way, so the progress panel loses nothing; the shifts are read
    once, at the end.
    """
    from app.models.generation_job import PLANNED
    from app.services.calendar_plan import MODEL as PLAN_MODEL

    shifts: list = []
    done: List[str] = []
    failed: List[str] = []
    for row in months:
        if row.status == PLANNED:
            done.append(row.month)
            if with_shifts:
                shifts.extend(row.shifts or [])
        else:
            failed.append(row.month)
    from datetime import datetime, timedelta, timezone

    from app.models.generation_job import RUNNING

    beat = getattr(job, "heartbeat_at", None)
    stalled = bool(
        job.status == RUNNING
        and beat is not None
        and datetime.now(timezone.utc) - beat > timedelta(seconds=STALLED_AFTER_SECONDS)
    )
    return PlanJobOut(
        attempts=int(getattr(job, "attempts", None) or 1),
        stalled=stalled,
        job_id=str(job.id),
        status=job.status,
        months=list(job.months or []),
        done=done,
        failed=failed,
        shifts=shifts,
        error_code=job.error_code,
        model=PLAN_MODEL,
    )


@router.post(
    "/generate/jobs",
    response_model=PlanJobOut,
    status_code=status.HTTP_202_ACCEPTED,
)
def enqueue_generation(
    payload: GenerateIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> PlanJobOut:
    """Ask for a calendar and hang up. The answer is collected, not awaited.

    THE SAME QUESTION as `/generate` above, asked in a way that cannot be lost
    by closing a window. That endpoint holds the request open for the minutes
    the model takes; a manager who walks away pays for months nobody will ever
    see. Here the request writes a row and returns, a worker in this container
    plans it, and each month is stored the moment it arrives.

    `/generate` is deliberately still here: a browser with the previous bundle
    open is mid-calendar, and taking its endpoint away would break the tab it
    is in. It goes when the tabs have turned over.
    """
    months = [m.strip() for m in payload.months if m and m.strip()]
    if not months:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("months_empty", "months must not be empty"),
        )
    if not payload.context.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("context_empty", "context must not be empty"),
        )
    if len(months) > 12:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("too_many_months", "months must not exceed 12"),
        )

    effort = payload.effort or DEFAULT_EFFORT
    if effort not in (DEFAULT_EFFORT, RETRY_EFFORT):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "unknown_effort",
                "effort must be %r or %r" % (DEFAULT_EFFORT, RETRY_EFFORT),
            ),
        )

    if not settings.anthropic_api_key:
        # Refused rather than queued: a job nobody can do is worse than a 503,
        # which the client already answers by building the calendar itself.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail(
                "anthropic_key_missing",
                "ANTHROPIC_API_KEY is not configured on the server",
            ),
        )

    # Checked here AND in the worker. Both, because minutes pass between them.
    _within_budget(db, current_user.org_id)

    # One calendar at a time per organisation. The browser used to refuse a
    # second run with a React ref, which does not survive a reload and does not
    # know about the other tab; the cost of getting it wrong is paying twice for
    # the same months.
    #
    # Asked first so the answer can name the job in flight -- the client joins
    # it rather than showing an error -- and enforced by the database
    # underneath: two requests a few milliseconds apart both read "none" here,
    # and only one of them gets past `uq_generation_job_one_per_org`.
    try:
        job = generation_queue.enqueue(
            db,
            current_user.org_id,
            months=months,
            context=payload.context,
            employees=payload.employees,
            templates=payload.templates,
            effort=effort,
        )
    except generation_queue.AlreadyPlanning as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail(
                "generation_already_running",
                "This account is already planning a calendar",
                **({"job_id": str(exc.job_id)} if exc.job_id else {}),
            ),
        ) from exc
    return _job_out(job, [])


@router.get("/generate/jobs/latest", response_model=Optional[PlanJobOut])
def latest_generation(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> Optional[PlanJobOut]:
    """The last calendar this account asked for, whatever became of it.

    What a reopened tab reads. A manager who shut the laptop mid-plan comes
    back to the months that were written while it was closed, instead of to an
    empty calendar and a line on the bill.

    Declared BEFORE the route below: "latest" is not a UUID, and a path
    parameter typed as one would reject it rather than fall through.
    """
    found = generation_queue.latest_job(db, current_user.org_id)
    if found is None:
        return None
    job, months = found
    return _job_out(job, months)


@router.get("/generate/jobs/{job_id}", response_model=PlanJobOut)
def read_generation(
    job_id: UUID,
    shifts: bool = Query(
        True,
        description=(
            "Include the proposed shifts. False while polling: the counts are "
            "what a progress panel needs, and a year of shifts is not."
        ),
    ),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> PlanJobOut:
    """How the calendar is going, and what of it exists so far."""
    found = generation_queue.read_job(db, current_user.org_id, job_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("generation_not_found", "No such generation"),
        )
    job, months = found
    return _job_out(job, months, with_shifts=shifts)


@router.post("/publish", response_model=PublishOut)
def publish_schedule(
    payload: PublishIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> PublishOut:
    """Hand the draft over to the team.

    Manager-only, and deliberately the only way a shift becomes visible to an
    employee: a human approves the draft before anyone is told to show up.
    """
    error = validate_shifts(
        db,
        current_user.org_id,
        payload.shifts,
        payload.period_start,
        payload.period_end,
    )
    if error is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error
        )

    # And then what the LAW says, which until now nothing on this side checked.
    #
    # `validate_shifts` above is about integrity -- this person exists, this
    # instant has an offset, this shift starts inside the window. It would
    # happily publish fourteen hours straight, or two shifts four hours apart.
    # The rules that stop that lived only in `frontend/src/lib/schedule/
    # validate.ts`, which means the product's central promise -- "you will not
    # break the working time rules" -- rested on the one component a client can
    # replace. `rota_law` reads the same figures from the same jurisdiction
    # tables the planner reads, and reports the same codes the browser uses.
    #
    # OBSERVE FIRST. Enforcement is off by default (`publish_law_enforced`),
    # exactly as the spend ceiling was: the browser judges with the brief's
    # numbers and this judges with the statute's, so the two can disagree on a
    # rota a manager deliberately asked for. Watch the log for a fortnight,
    # then turn it on -- it is an environment variable, not a deploy.
    #
    # After `validate_shifts`, never before: that is what guarantees the people
    # exist and the timestamps carry an offset.
    try:
        broken = rota_law.judge(
            db,
            current_user.org_id,
            payload.shifts,
            period_start=payload.period_start,
            period_end=payload.period_end,
        )
    except Exception:  # noqa: BLE001 - see below; this must not lose a rota
        # ROLL BACK FIRST. `judge` reads five tables, and a failure at the
        # database level -- a missing grant, a statement timeout, schema drift --
        # leaves the transaction aborted, so every statement after it is refused
        # too. Swallowing the exception without this turned "the check could not
        # run" into a 500 and an unpublished rota: exactly what the paragraph
        # below promises cannot happen. Nothing has been written yet, so there is
        # nothing to lose, but the org context goes with the rollback and has to
        # be put back.
        db.rollback()
        set_current_org(db, current_user.org_id)
        # A judge that cannot answer does not get to stop the publish, in
        # either mode. While observing it is obvious: nobody asked it to be
        # here. Enforcing, it is the lesser of two bad outcomes -- refusing
        # would mean a manager with a legal rota cannot give their team its
        # shifts because of a bug of ours, and there is no version of that
        # which is safer than publishing. Loudly logged, because a check that
        # is silently not running is the thing this whole change was about.
        log.exception(
            "publish: the working-time check failed for org %s; publishing "
            "anyway (%s mode)",
            current_user.org_id,
            rota_law.mode(),
        )
        broken = []
    if broken and rota_law.enforced():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=rota_law.as_detail(broken),
        )

    try:
        # ``changes`` is who has to be told what: the per-person difference
        # between the noticeboard before this call and after it. Nothing reads
        # it yet -- the channels that will (email, then a push notification)
        # are the next thing built, and computing it here is what lets them be
        # about "your Tuesday moved to 12:00" instead of "the rota changed".
        # Nobody is put on a rota they have signed-off leave for. The shifts
        # were already taken off the calendar when the absence was approved;
        # this catches the copy that was sitting in a browser at the time.
        # See `services/absences.drop_shifts_on_leave`.
        wanted, on_leave = drop_shifts_on_leave(
            db, current_user.org_id, payload.shifts
        )
        count, replaced, at, changes = publish(
            db,
            current_user.org_id,
            payload.period_start,
            payload.period_end,
            wanted,
        )
    except IntegrityError as exc:
        # The overlap EXCLUDE constraint fired: a shift collides with one that
        # sits outside the published window (typically an overnight shift from
        # the period before).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail(
                "published_shift_overlap",
                "A shift overlaps one already published outside this period. "
                "Publish the neighbouring period too, or shorten the shift.",
            ),
        ) from exc

    # Who the team is, before the session closes. Read here rather than in the
    # background task: that runs after the response and after `get_db` has
    # closed this session, so anything it needs has to be plain data by then.
    audience = rota_email.audience_for(
        db,
        current_user.org_id,
        [e.employee_id for e in changes.employees],
    )
    org_name = (
        db.execute(
            select(Organization.name).where(Organization.id == current_user.org_id)
        ).scalar_one_or_none()
        or ""
    )

    # Same reason as PUT /draft: the client invalidates both the published
    # and the draft queries on 200, and must not read the rows of before.
    db.commit()

    # AFTER THE COMMIT, and never in a way that can undo it. The rota is the
    # product; the email is a courtesy on top of it. A provider having a bad
    # day must not turn a published month into a 500 and a manager who believes
    # nothing happened -- so this is scheduled, not awaited, and `_deliver`
    # swallows what it cannot fix.
    messages = rota_email.compose(
        changes,
        audience.recipients,
        period_start=payload.period_start,
        org_name=org_name,
        app_base_url=settings.app_base_url,
    )
    post = mailer()
    if messages and post.configured:
        background.add_task(_deliver, post, messages)

    # What the manager changed in the planner's proposal before publishing it,
    # read for patterns worth PROPOSING as standing rules -- see
    # `services/hand_edits.py`. Scheduled, never awaited, and after the commit
    # for the same reason as the email: a publish is not allowed to wait on
    # this, and `after_publish` swallows whatever goes wrong in it. What the
    # manager SENT is what is compared, not `wanted`: a shift the leave guard
    # dropped was not their edit, and the task subtracts absences itself.
    background.add_task(
        hand_edits.after_publish,
        current_user.org_id,
        payload.period_start,
        payload.period_end,
        [(str(s.employee_id), s.start_at, s.end_at) for s in payload.shifts],
    )
    # And the planner's own notebook, right after it and on the same terms:
    # scheduled, never awaited, unable to raise, and a no-op unless
    # `planner_notes_enabled` -- see `services/planner_notes.py`. Background
    # tasks run in order, so the notes are taken after the counting is done.
    background.add_task(
        planner_notes.after_publish,
        current_user.org_id,
        payload.period_start,
        payload.period_end,
        [(str(s.employee_id), s.start_at, s.end_at) for s in payload.shifts],
    )

    # What the manager is told. `notified` counts messages HANDED OVER, not
    # messages read: the send happens after this response and the provider is
    # the only one who knows the rest. `unreachable` is the number that changes
    # what a manager does next -- somebody whose shifts moved and who will not
    # hear about it from us.
    notified = len(messages) if post.configured else 0
    unreachable = audience.unreachable + (0 if post.configured else len(messages))
    if unreachable:
        log.info(
            "publish: org %s changed %d people, %d could not be told",
            current_user.org_id,
            len(changes.employees),
            unreachable,
        )
    return PublishOut(
        published=count,
        replaced=replaced,
        published_at=at,
        notified=notified,
        unreachable=unreachable,
        mail_configured=post.configured,
        skipped_on_leave=len(on_leave),
    )


@router.get("/assignments", response_model=List[AssignmentOut])
def get_assignments(
    from_: str = Query(alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> List[AssignmentOut]:
    """Published shifts starting in a window.

    Managers see the whole team; an employee sees only their own row. The
    narrowing happens here, on the server, and not by asking the client nicely.
    """
    window_start, window_end = parse_window(from_, to)

    scope = None
    if current_user.role != "manager":
        if current_user.employee_id is None:
            return []
        scope = current_user.employee_id

    rows = list_published(db, current_user.org_id, window_start, window_end, scope)
    return [to_assignment_out(a) for a in rows]


@router.get("/marks", response_model=List[ShiftMarkOut])
def get_marks(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> List[ShiftMarkOut]:
    """Which shifts exist in a span, and whether the team has seen them.

    The year grid's whole data source. Manager-only, like the draft it
    reports on: an employee must never learn that a draft exists for a month,
    not even as a colour.
    """
    window_start, window_end = parse_window(from_, to)
    return [
        ShiftMarkOut(start_at=start_at, status=status)
        for start_at, status in list_marks(
            db, current_user.org_id, window_start, window_end
        )
    ]


@router.get("/draft", response_model=List[AssignmentOut])
def get_draft(
    from_: str = Query(alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> List[AssignmentOut]:
    """The manager's unpublished shifts starting in a window.

    Manager-only, and a separate path from ``/assignments`` rather than a
    ``?status=`` switch on it: the employee read must not have a knob that,
    turned the wrong way, shows them a rota nobody has approved.
    """
    window_start, window_end = parse_window(from_, to)
    rows = list_draft(db, current_user.org_id, window_start, window_end)
    return [to_assignment_out(a) for a in rows]


@router.put("/draft", response_model=DraftOut)
def put_draft(
    payload: PublishIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> DraftOut:
    """Keep the draft for a window on the server, replacing the previous one.

    The client sends the whole window every time, debounced, so that the same
    unfinished week appears on the manager's other browser. Same validation as
    publish, so what is saved is always something that COULD be published;
    nothing here reaches an employee.
    """
    error = validate_shifts(
        db,
        current_user.org_id,
        payload.shifts,
        payload.period_start,
        payload.period_end,
    )
    if error is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=error
        )

    try:
        saved, replaced, at = save_draft(db, current_user.org_id, payload)
    except IntegrityError as exc:
        # The overlap EXCLUDE constraint fired between two DRAFT rows: either
        # the payload double-books somebody, or it collides with a draft shift
        # that starts outside this window (an overnight one from the period
        # before). Published rows cannot be the cause -- the constraint lets a
        # draft sit on top of them.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail(
                "draft_shift_overlap",
                "Two draft shifts overlap for the same employee. "
                "Shorten one of them, or save the neighbouring period too.",
            ),
        ) from exc

    # Committed before the response leaves. `get_db` commits when the request
    # closes, which FastAPI does AFTER sending the body; the client refetches
    # the draft the moment it hears 200 and would read the rows of before.
    db.commit()
    return DraftOut(saved=saved, replaced=replaced, saved_at=at)


@router.get("/day-team", response_model=List[TeammateShiftOut])
def get_day_team(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> List[TeammateShiftOut]:
    """Who the reader is on with, on a day the reader works.

    The one place an employee sees past their own row, and it is deliberately
    narrow: a window they have a published shift in, published shifts only,
    and a payload with no cost, contract, employee code or absence in it (see
    ``TeammateShiftOut``).

    A manager asking gets the same answer. They can already see all of it and
    more, so there is nothing to widen -- and one code path means the employee
    view cannot quietly diverge from what is true.
    """
    window_start, window_end = parse_window(from_, to)

    # ONE DAY, AND THE SERVER DECIDES WHAT ONE DAY IS.
    #
    # The permission above is "does the asker work in this window", which is
    # the right question and a useless one if the window can be a year. An
    # employee with a single published shift in March asked for
    # 2026-01-01 -> 2027-01-01 and was handed twenty-five shifts of their
    # colleagues, by name, across the whole year: who is off when, who does
    # the nights, who has not appeared in a fortnight. Nothing was hacked --
    # two dates were changed in a URL.
    #
    # The screen asks for a local day (`TeamDay.tsx`), which is 23, 24 or 25
    # hours depending on the clocks. The cap is a little above the longest of
    # those and nowhere near two days, so the honest request always fits and
    # the scrape never does.
    if window_end - window_start > MAX_DAY_TEAM_WINDOW:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "window_too_wide",
                "'from' and 'to' must be at most one day apart",
            ),
        )

    if current_user.employee_id is None:
        # A manager with no employee record of their own has no shift to share
        # -- the honest answer is that there is nothing to show them here.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail("not_on_that_day", "You are not scheduled that day"),
        )

    rows = day_team(
        db, current_user.org_id, current_user.employee_id, window_start, window_end
    )
    if rows is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail("not_on_that_day", "You are not scheduled that day"),
        )

    return [
        TeammateShiftOut(
            employee_id=emp_id,
            employee_name=name,
            start_at=start_at,
            end_at=end_at,
            unpaid_break_minutes=break_min,
            is_self=emp_id == current_user.employee_id,
        )
        for emp_id, name, start_at, end_at, break_min in rows
    ]
