"""The opening interview -- see services/interview.py for what and why.

Stateless on purpose: the client sends the whole transcript every turn, so
nothing about a conversation is stored anywhere, and a page reload simply
starts again. A transcript is a handful of short lines; sending it is cheaper
than remembering it.

The one thing kept is the ending. ``/complete`` takes the paragraph the
manager approved and writes it to their business profile, where every brief
they send afterwards picks it up as background -- so the interview is done
once and the planner knows the business from then on. It also closes the
first run, whether or not anything was said: a manager who skipped has been
asked, and must not be asked again on the next reload.

Two of its questions are answered with a form rather than with words. The
week's opening hours are asked before the conversation starts; who works here
is asked by the model itself, which flags the turn (``form="roster"``) so the
client can put a table under it. Both come back as an ordinary manager
message in the transcript.

It also takes the week's opening hours, which the client asks with a form
rather than a question (dragging a bar across a day is faster than typing
seven times, and a form cannot mishear "de nueve a ocho"). They are stored as
DECLARATIONS -- the same place a spoken "los lunes cerramos" ends up -- so the
next brief starts from a week the planner already knows, and Settings can
take any day of it back.

``/research`` is the step after: with what the interview kept, Gemini
searches the web for how a business like this one usually runs where it is,
and the summary is stored as OURS (``research_notes``), never as the
manager's. A separate call and not part of ``/complete`` because it is
slower, it may fail, and neither of those must cost the manager the
paragraph they just approved.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import get_current_manager
from app.errors import detail
from app.schemas.auth import UserOut
from app.services import api_usage
from app.services import business_profile as bp
from app.services import interview as svc
from app.services import research as research_svc

router = APIRouter(prefix="/interview", tags=["interview"])


class InterviewStatus(BaseModel):
    available: bool
    model: Optional[str] = None


class TurnIn(BaseModel):
    messages: List[svc.InterviewMessage] = Field(default_factory=list, max_length=60)
    language: str = "en"
    finish: bool = False


class TurnOut(BaseModel):
    reply: str
    done: bool
    brief: Optional[str] = None
    # Which of the client's forms answers this question, when one does. Today
    # only "roster": who works here and on what contract hours, which is a
    # table rather than a sentence. Null on every other turn.
    form: Optional[str] = None
    # With the roster form: how many rows to open it with, from the headcount
    # the manager already gave. Null when they never gave one.
    form_people: Optional[int] = None


class CompleteIn(BaseModel):
    # What the manager approved, after editing. Empty means they skipped.
    notes: str = Field(default="", max_length=4000)
    # The week as the form had it: weekday (0 = Sunday) -> [open, close] in
    # minutes from that day's midnight (a close past 1440 is the small hours
    # of the next day), or null for a day the business is closed. Absent or
    # empty when the form was skipped: nothing is declared then.
    open_hours: Optional[Dict[int, Optional[Tuple[int, int]]]] = None


class CompleteOut(BaseModel):
    remembered: bool
    # How many weekdays were declared, closed days included.
    hours_declared: int = 0


class SourceOut(BaseModel):
    title: str
    url: str


class ResearchIn(BaseModel):
    # The language the summary is written in: the one the manager is using.
    language: str = "en"


class ResearchOut(BaseModel):
    summary: str
    sources: List[SourceOut] = Field(default_factory=list)
    researched_at: datetime


@router.get("/status", response_model=InterviewStatus)
def interview_status(
    current_user: UserOut = Depends(get_current_manager),
) -> InterviewStatus:
    """Whether the interview is on offer. The frontend hides it otherwise."""
    del current_user
    if not settings.gemini_api_key:
        return InterviewStatus(available=False)
    return InterviewStatus(available=True, model=settings.gemini_model)


@router.post("/turn", response_model=TurnOut)
def interview_turn(
    payload: TurnIn,
    current_user: UserOut = Depends(get_current_manager),
) -> TurnOut:
    """The next question, or the brief once there is nothing more to ask."""
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail(
                "gemini_key_missing",
                "GEMINI_API_KEY is not configured on the server",
            ),
        )
    language = "es" if payload.language.lower().startswith("es") else "en"
    # Metered like every other Claude call: only the fallback spends anything
    # here, and it is recorded against the business it asked for.
    try:
        with api_usage.collect() as ledger:
            try:
                turn = svc.next_turn(
                    payload.messages,
                    language,
                    settings.gemini_api_key,
                    settings.gemini_model,
                    finish=payload.finish,
                    fallback_key=settings.anthropic_api_key,
                )
            finally:
                api_usage.record(current_user.org_id, ledger)
    except svc.QuotaSpent as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail(
                "interview_quota_spent",
                "The interview has used up its allowance for now. "
                "You can write the brief yourself, or come back later.",
            ),
        ) from exc
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as 502
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail(
                "interview_failed", "The interview could not continue: %s" % exc
            ),
        ) from exc
    return TurnOut(
        reply=turn.reply,
        done=turn.done,
        brief=turn.brief,
        form=turn.form,
        form_people=turn.form_people,
    )


@router.post("/complete", response_model=CompleteOut)
def interview_complete(
    payload: CompleteIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> CompleteOut:
    """Keep what the interview found out, and never ask this account again.

    A SECOND INTERVIEW REPLACES THE FIRST, WHOLE. The notes already did:
    somebody who talks it through again means the new answers, not both, and
    the form's week overwrites the days it names. What used to survive it was
    the research -- what we went and read about a business like theirs -- and
    that is the one thing most likely to be about the business they no longer
    have. A bar that became a shop kept a paragraph about bars, filed as
    something we knew rather than something they said, and every brief after
    it was read with that paragraph in mind.

    So the research goes with the rest. It is not lost work: `/research`
    re-reads it from the new notes on request, and doing that from the old
    ones was the actual bug.

    The same goes for the vertical we GUESSED from the old paragraph: it is
    cleared and guessed again from the new one, and stays unknown if that
    guess cannot be made. A vertical the manager DECLARED is theirs, not the
    interview's, and no interview touches it.

    ``interviewed_at`` is stamped only when something was actually kept, so an
    empty completion (a skip) closes the first run and says nothing about when
    they were last interviewed.
    """
    profile = bp.get_or_create(db, current_user.org_id)
    notes = payload.notes.strip()
    if notes:
        profile.interview_notes = notes
        profile.interviewed_at = datetime.now(timezone.utc)
        # Ours, about what they told us BEFORE. Cleared rather than kept,
        # and cleared only on a real answer: a skip changes nothing.
        profile.research_notes = None
        # The inferences went with the paragraph they were drawn from: a second
        # interview describes a different business, and figures inferred from
        # the first would keep staffing it.
        profile.research_signals = None
        profile.researched_at = None
    profile.first_run_pending = False
    db.add(profile)
    declared = 0
    if payload.open_hours:
        try:
            bp.declare_week_hours(db, current_user.org_id, payload.open_hours)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail("open_hours_invalid", str(exc)),
            ) from exc
        declared = len(payload.open_hours)
    if notes:
        # What kind of business the paragraph describes, as a GUESS the
        # manager has yet to confirm (see `bp.infer_vertical_from_interview`
        # for what is sent and what is not). After the week, so a 422 above
        # never spends a call; metered to this org like every other model
        # call; and it never raises, so it cannot cost the manager the
        # paragraph they just approved.
        with api_usage.collect() as ledger:
            try:
                bp.infer_vertical_from_interview(db, profile, notes)
            finally:
                api_usage.record(current_user.org_id, ledger)
    return CompleteOut(remembered=bool(notes), hours_declared=declared)


@router.post("/research", response_model=ResearchOut)
def interview_research(
    payload: ResearchIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ResearchOut:
    """Look up how a business like this usually runs where it is, and keep it.

    Built from what the profile already holds -- the interview paragraph, the
    location, the declared vertical -- and nothing the manager typed anywhere
    that was not promised to stay off a free tier. Runs again on every call:
    Settings offers it as "look again", and what was true of a neighbourhood
    last year is the kind of thing worth looking at twice.
    """
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=detail(
                "gemini_key_missing",
                "GEMINI_API_KEY is not configured on the server",
            ),
        )
    profile = bp.get_or_create(db, current_user.org_id)
    vertical = (
        bp.VERTICALS.get(profile.vertical)
        if profile.vertical and profile.vertical_source == "declared"
        else None
    )
    inp = research_svc.ResearchInput(
        notes=profile.interview_notes or "",
        location=profile.location,
        vertical_label=vertical.label if vertical else None,
        language="es" if payload.language.lower().startswith("es") else "en",
    )
    if not inp.has_anything():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail(
                "nothing_known_yet",
                "Nothing is known about this business yet; do the interview first",
            ),
        )
    try:
        result = research_svc.research(
            inp, settings.gemini_api_key, settings.gemini_research_model
        )
    except svc.QuotaSpent as exc:
        # Nothing is broken: the day's free searches are spent. 429 and not
        # 502, so the client can say "try again tomorrow" rather than "the
        # search failed", and so this never reads as an outage in a log.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail(
                "research_quota_spent",
                "The web search has used up its allowance for now. "
                "It can be tried again later; nothing else is affected.",
            ),
        ) from exc
    except Exception as exc:  # noqa: BLE001 - surfaced to the client as 502
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail("research_failed", "The research could not be done: %s" % exc),
        ) from exc
    now = datetime.now(timezone.utc)
    profile.research_notes = research_svc.notes_with_sources(result)

    # And what it MEANS, as figures the planner can act on.
    #
    # Deliberately not allowed to fail the request. The search is the expensive
    # half and it has already succeeded; losing its paragraph because a second
    # call timed out would cost the manager the thing they were waiting for, to
    # protect an inference that is optional by construction. A null column here
    # simply means nothing was inferred, which every reader already handles --
    # it is the state every business was in before this existed.
    try:
        signals = research_svc.derive_signals(
            inp,
            result.summary,
            settings.gemini_api_key,
            settings.gemini_research_model,
        )
        profile.research_signals = signals.to_json() if signals.has_anything else None
    except Exception:  # noqa: BLE001 - an inference is never worth the request
        profile.research_signals = None

    profile.researched_at = now
    db.add(profile)
    # Committed before answering, not after: the client refetches the profile
    # the moment this returns, and get_db's commit lands after the response
    # (see PUT /schedule/draft for the same pattern and why).
    db.commit()
    return ResearchOut(
        summary=result.summary,
        sources=[SourceOut(title=s.title, url=s.url) for s in result.sources],
        researched_at=now,
    )
