from __future__ import annotations

from decimal import Decimal
from typing import Optional, Sequence

"""What we know about the business behind an account, and who may change it.

Manager-only, all of it. This is the customer's own record of what the product
believes about them, so they can read every belief, see the evidence, and
switch off any of it -- including the whole adaptive layer.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_manager
from app.errors import detail
from app.models.labor_profile import LaborProfile
from app.models.learned_hint import LearnedHint
from app.models.organization import Organization
from app.schemas.auth import UserOut
from app.schemas.business_profile import (
    HintOut,
    HintUpdate,
    ObservationsIn,
    ObservationsOut,
    PlannerNoteOut,
    PlannerNotesOut,
    ProfileOut,
    ProfileUpdate,
    VerticalOut,
)
from app.config import settings
from app.services import business_profile as bp
from app.services import employees as employees_svc
from app.services import jev
from app.services import labour_floor
from app.services import planner_notes

router = APIRouter(prefix="/profile", tags=["profile"])


def _jurisdiction(db: Session, org_id) -> str:
    """The labour jurisdiction on the organization row.

    Defaulted rather than assumed present: an org created before the column had
    a default reads NULL, and a business with no jurisdiction is a business
    whose rota is scored against no rules at all.
    """
    code = db.execute(
        select(Organization.jurisdiction_code).where(Organization.id == org_id)
    ).scalar_one_or_none()
    return code or "US-FED"


def _to_out(profile, hints, jurisdiction: str = "US-FED") -> ProfileOut:
    return ProfileOut(
        vertical=profile.vertical,
        vertical_source=profile.vertical_source,
        house_notes=profile.house_notes,
        interview_notes=profile.interview_notes,
        interviewed_at=profile.interviewed_at,
        location=profile.location,
        jurisdiction_code=jurisdiction,
        research_notes=profile.research_notes,
        research_signals=profile.research_signals,
        researched_at=profile.researched_at,
        learning_enabled=profile.learning_enabled,
        day_boundary_min=profile.day_boundary_min,
        weekend_days=profile.weekend_days,
        objective=profile.objective,
        first_run_pending=profile.first_run_pending,
        hints=[
            HintOut(
                key=h.key,
                value=h.value or {},
                claim=bp.hint_label(h),
                evidence=h.evidence_days,
                needed=bp.MIN_EVIDENCE,
                contradictions=h.contradictions,
                active=bp.is_active(h),
                rejected=h.rejected,
                stated=bp.is_stated(h),
                accepted=bool((h.value or {}).get("accepted")),
            )
            for h in hints
        ],
        verticals=[
            VerticalOut(code=v.code, label=v.label) for v in bp.VERTICALS.values()
        ],
    )


@router.get("", response_model=ProfileOut)
def get_profile(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ProfileOut:
    profile = bp.get_or_create(db, current_user.org_id)
    return _to_out(
        profile,
        bp.hints_for(db, current_user.org_id),
        _jurisdiction(db, current_user.org_id),
    )


@router.put("", response_model=ProfileOut)
def update_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ProfileOut:
    profile = bp.get_or_create(db, current_user.org_id)

    if payload.vertical is not None:
        if payload.vertical not in bp.VERTICALS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail(
                    "unknown_vertical",
                    "Unknown vertical: %s" % payload.vertical,
                    vertical=payload.vertical,
                ),
            )
        profile.vertical = payload.vertical
        # A human typed it, so it stops being a guess. Only a declared vertical
        # reaches the model or produces suggestions.
        profile.vertical_source = "declared"
    if payload.house_notes is not None:
        profile.house_notes = payload.house_notes.strip()[:2000] or None
    if payload.interview_notes is not None:
        profile.interview_notes = payload.interview_notes.strip()[:4000] or None
    if payload.research_notes is not None:
        profile.research_notes = payload.research_notes.strip()[:4000] or None
    if payload.location is not None:
        # Kept as written. Nothing parses this into a place: it is what a
        # research pass searches from and what a planner is told about seasons
        # and mealtimes, and both are better served by "a beach town near
        # Alicante" than by anything we could normalise it into.
        profile.location = payload.location.strip()[:200] or None
    if payload.jurisdiction_code is not None:
        code = payload.jurisdiction_code.strip()
        known = db.execute(
            select(LaborProfile.jurisdiction_code).where(
                LaborProfile.jurisdiction_code == code
            )
        ).scalar_one_or_none()
        if known is None:
            # Named rather than a bare 422: there are three of these today and
            # they are all American, so a manager in Spain hits this and
            # deserves to be told it is our gap and not their typo.
            available = sorted(
                db.execute(select(LaborProfile.jurisdiction_code)).scalars()
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail(
                    "unknown_jurisdiction",
                    "No labour rules for %s. Known jurisdictions: %s"
                    % (code, ", ".join(available) or "none"),
                    jurisdiction=code,
                    known=", ".join(available) or "none",
                ),
            )
        # Written to the ORGANIZATION, not here: it is the same fact for every
        # manager of this business and it is what pay policy and the back
        # office already read.
        org = db.execute(
            select(Organization).where(Organization.id == current_user.org_id)
        ).scalar_one()
        org.jurisdiction_code = code
        # The premiums follow the country, because they are facts ABOUT the
        # country. The three this org carries were seeded American -- 15% at
        # night, 10% at weekends, time and a half past forty -- and none of
        # them is true in Spain: the night differential is whatever the
        # convenio says (25% in Catalan hospitality), there is no weekend
        # premium in law, and an overtime hour is paid as an ordinary one
        # (art. 35.1 ET) unless something else says otherwise.
        #
        # Moved on the jurisdiction CHANGE, which is a deliberate act by a
        # manager, and never afterwards: whatever they type into Settings
        # after this is theirs and survives.
        floor = labour_floor.floor_for(db, code)
        if floor.known:
            org.night_differential_pct = Decimal(str(floor.night_premium_pct or 0))
            org.weekend_premium_pct = Decimal("0")
            org.overtime_multiplier = Decimal(str(floor.overtime_multiplier or 1))
    if payload.learning_enabled is not None:
        profile.learning_enabled = payload.learning_enabled
    if payload.day_boundary_min is not None:
        # A boundary of 1440 is midnight said the long way, and anything beyond
        # it is a different day. Refuse rather than wrap: a manager who typed
        # 25:00 meant something we cannot guess.
        if not 0 <= payload.day_boundary_min < 24 * 60:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail(
                    "day_boundary_out_of_range",
                    "day_boundary_min must be between 0 and 1439",
                ),
            )
        profile.day_boundary_min = payload.day_boundary_min
    if payload.weekend_days is not None:
        if any(not 0 <= d <= 6 for d in payload.weekend_days):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail(
                    "weekend_days_invalid",
                    "weekend_days must be weekday indexes, 0 = Sunday",
                ),
            )
        # Sorted and de-duplicated so the stored value has one shape. Two
        # profiles meaning the same thing must not compare unequal, or the next
        # step cannot tell a manager's confirmation from a vertical's proposal.
        profile.weekend_days = sorted(set(payload.weekend_days))
    if payload.objective is not None:
        # "" is how the manager goes back to having chosen nothing, which the
        # column stores as NULL and the client reads as "leave the spec's
        # objective unset". Anything else has to be a code we know: the weights
        # live in the frontend, so an unrecognised string stored here would
        # produce a business that believes it picked something and a calendar
        # built on the default, with nothing anywhere to say which was true.
        if payload.objective and payload.objective not in bp.OBJECTIVES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=detail(
                    "unknown_objective",
                    "Unknown objective: %s" % payload.objective,
                    objective=payload.objective,
                ),
            )
        profile.objective = payload.objective or None
    if payload.first_run_pending is not None:
        # Only ever sent as False, by a client closing the first-run questions.
        # True is accepted rather than rejected because the field is the same
        # one that is read back, and a manager asking to be taken through the
        # questions again is a reasonable thing for a later screen to offer --
        # it costs nothing here and refusing it would be a rule with no reason
        # behind it.
        profile.first_run_pending = payload.first_run_pending

    # flush, not commit: the org context that RLS reads is scoped to this
    # transaction (SET LOCAL), so committing here would leave every later query
    # in the request running with no tenant at all. get_db commits at the end.
    db.flush()
    db.refresh(profile)
    return _to_out(
        profile,
        bp.hints_for(db, current_user.org_id),
        _jurisdiction(db, current_user.org_id),
    )


@router.put("/hints/{key:path}", response_model=ProfileOut)
def update_hint(
    key: str,
    payload: HintUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ProfileOut:
    """Accept or reject one belief.

    Rejection does not delete the row. The evidence stays where it is so the
    manager can see what we had thought and why; it simply stops counting.
    """
    hint = db.execute(
        select(LearnedHint).where(
            LearnedHint.org_id == current_user.org_id, LearnedHint.key == key
        )
    ).scalar_one_or_none()
    if hint is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("hint_not_found", "No such hint"),
        )
    hint.rejected = payload.rejected
    if payload.accepted is not None and bp.is_stated(hint):
        # Confirming is what makes a stated rule real. Written into the value
        # rather than into a column of its own: nothing else in the table needs
        # the field, and a column that is null for every inferred row is a
        # column somebody later has to explain.
        hint.value = {**(hint.value or {}), "accepted": bool(payload.accepted)}
        # Confirming also un-rejects, so the two controls cannot leave a rule
        # both accepted and rejected -- a state no screen could describe.
        if payload.accepted:
            hint.rejected = False
    db.flush()
    profile = bp.get_or_create(db, current_user.org_id)
    return _to_out(
        profile,
        bp.hints_for(db, current_user.org_id),
        _jurisdiction(db, current_user.org_id),
    )


@router.delete("/declared/{key:path}", status_code=status.HTTP_204_NO_CONTENT)
def undeclare(
    key: str,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> None:
    """Take back one thing the manager told us.

    Unlike a belief, this is deleted rather than kept and ignored. A hint is our
    inference and its evidence is worth showing even after it is rejected --
    "here is what we thought and why". A declaration has no evidence to show: it
    is a sentence they said, and taking it back means they no longer say it.

    Silent on a key that is not there. The button that calls this sits next to a
    calendar the manager may have regenerated since, and "that rule is already
    gone" is the outcome they asked for, not an error to show them.
    """
    bp.undeclare(db, current_user.org_id, key)
    db.flush()


# What Jev is asked about the sentence behind a correction before the
# correction becomes a standing rule. `bp.declare_from_ops` says why the
# operation cannot answer it, and `bp.DECLARE_FROM` where the line is.
#
# The examples are the documented way to tell Jev what each answer MEANS, and
# every pair is one operation on both sides: "four at the peak" is the same
# `set_peak` whether it is every day or this Saturday. The person is written as
# an alias because that is how Jev will read one -- the sentence is masked.
STANDING_RULE = jev.Noul(
    "A manager typed this sentence, in any language, to correct their staff "
    "rota. Does it state how the business runs every week from now on, or "
    "only this one time?",
    true=(
        "It describes how the business always works, every week: 'always four "
        "at the peak', 'we close on Mondays', 'nobody works over 38 h'."
    ),
    false=(
        "It is for this once only -- a date, a week, an event, or one person's "
        "situation: 'this Saturday four people', 'close on the 24th', "
        "'e1 is ill'."
    ),
)


def _p_standing(
    db: Session, org_id, text: Optional[str], ops: Sequence[dict]
) -> Optional[float]:
    """How likely the manager's sentence states a standing rule, or None.

    None is no opinion, and every way of getting it leaves the operations to
    decide alone, as they always did: Jev switched off, no sentence (the
    correction did not come from one), or nothing among the operations that
    could be declared anyway -- where the answer would change nothing, so the
    call is not made. Jev failing is None too; ``jev.ask`` never raises.
    """
    if not jev.enabled() or not (text or "").strip():
        return None
    if not bp.declarable(ops):
        return None
    state = jev.mask(text, employees_svc.names_by_id(db, org_id))
    answers = jev.ask(state, {"standing": STANDING_RULE}, purpose="standing_rule")
    answer = (answers or {}).get("standing")
    return None if answer is None else answer.yes


@router.post("/observations", response_model=ObservationsOut)
def record_observations(
    payload: ObservationsIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ObservationsOut:
    """Record the corrections the manager just made to a generated calendar.

    Called by the client after it has APPLIED a refine plan, with only the
    operations that survived its own validation, and the sentence they came
    from. Operations about people are dropped here rather than stored and
    ignored -- the cheapest place to keep a promise is before the write.
    """
    profile = bp.get_or_create(db, current_user.org_id)
    if not profile.learning_enabled:
        return ObservationsOut(recorded=0, learned=[])

    # A correction that states a rule becomes a declaration, and applies to the
    # next brief instead of waiting three days for a belief to form.
    #
    # It stays INSIDE the learning switch, and that is a deliberate answer to a
    # question this could have gone either way on. A declaration made by
    # ANSWERING a question is written whatever the switch says -- the manager
    # was asked and replied. This one is different: nobody asked. They fixed a
    # calendar, and a product told to stop adapting to them must not read that
    # as permission to change every future calendar. The switch means what its
    # label says.
    #
    # And only when the SENTENCE states a rule, which the operation cannot say:
    # "este sábado mínimo cuatro" and "siempre mínimo cuatro" are one
    # `set_min_staff`. A one-off is still observed below, as evidence.
    p_standing = _p_standing(db, current_user.org_id, payload.text, payload.ops)
    bp.declare_from_ops(db, current_user.org_id, payload.ops, p_standing=p_standing)

    learned = bp.observe(db, current_user.org_id, payload.ops)
    db.flush()
    return ObservationsOut(recorded=len(payload.ops), learned=learned)


# --- The planner's own notes -------------------------------------------------
#
# What the model wrote down about this business after earlier publications
# (`services/planner_notes.py`). The product's rule for anything learned is
# that it can be SEEN and TAKEN AWAY, and these are no exception: every line is
# listed, and any of them can be deleted -- after which the planner cannot
# write that same sentence back.


def _notes_out(db: Session, org_id) -> PlannerNotesOut:
    profile = bp.get_or_create(db, org_id)
    names = employees_svc.names_by_id(db, org_id)
    return PlannerNotesOut(
        enabled=bool(settings.planner_notes_enabled and profile.learning_enabled),
        notes=[PlannerNoteOut(**n) for n in planner_notes.list_notes(db, org_id, names)],
    )


@router.get("/notes", response_model=PlannerNotesOut)
def get_notes(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> PlannerNotesOut:
    return _notes_out(db, current_user.org_id)


@router.delete("/notes/{note_id}", response_model=PlannerNotesOut)
def forget_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> PlannerNotesOut:
    """Delete one line. Silent on one that is already gone, like `undeclare`:
    the list on screen may be older than the notebook, and "that note is
    gone" is what the manager asked for."""
    planner_notes.forget(db, current_user.org_id, note_id)
    return _notes_out(db, current_user.org_id)


@router.delete("/notes", response_model=PlannerNotesOut)
def forget_all_notes(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> PlannerNotesOut:
    planner_notes.forget_all(db, current_user.org_id)
    return _notes_out(db, current_user.org_id)
