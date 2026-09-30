"""The manager's notes of each day, and who they are shared with.

One note per business per day, written by a manager. The readers are one list
of addresses with two uses: every address is emailed when the manager sends a
note, and an address that is also a login in this business can read the notes
in the app (`GET /day-notes/feed`). An employee who is not on the list reads
nothing -- the feed says so rather than failing, so the employee screen can
simply leave the section out.

Each saved note is also READ, in the background, for what it says about the
business (`services/day_insights.py`): the manager's screens carry that reading
as `insight`, and `GET /day-notes/insights` adds twelve weeks of them up. The
employees' feed never does -- it is the note, not what we made of it.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import get_current_manager, get_current_user
from app.errors import detail
from app.models.day_note import DayNote, DayNoteReader
from app.models.organization import Organization
from app.models.user_account import UserAccount
from app.schemas.auth import UserOut
from app.schemas.day_note import (
    DayInsightOut,
    DayNoteFeed,
    DayNoteIn,
    DayNoteOut,
    DayNoteReaderOut,
    DayNoteReadersIn,
    DayNoteReadersOut,
    DayNoteSaved,
    InsightSummary,
)
from app.services import day_insights, day_note_email
from app.services.mailer import Mailer, Message, mailer

log = logging.getLogger(__name__)

router = APIRouter(prefix="/day-notes", tags=["day-notes"])

#: The history a screen is sent. More than a year of daily notes.
LIST_LIMIT = 500


def _out(note: DayNote, insight: Optional[DayInsightOut] = None) -> DayNoteOut:
    return DayNoteOut(
        note_date=note.note_date,
        body=note.body,
        updated_at=note.updated_at,
        sent_at=note.sent_at,
        insight=insight,
    )


def _insights(db: Session, org_id, notes: List[DayNote]) -> Dict[object, Optional[DayInsightOut]]:
    """The `insight` of each note, for the manager's screens."""
    if not notes:
        return {}
    expected = day_insights.reading_expected(db, org_id)
    rows = day_insights.rows_for(db, org_id, [n.id for n in notes])
    now = datetime.now(timezone.utc)
    out: Dict[object, Optional[DayInsightOut]] = {}
    for note in notes:
        insight = day_insights.insight_for(
            note.body, note.updated_at, rows.get(note.id), expected, now
        )
        out[note.id] = None if insight is None else DayInsightOut(**insight)
    return out


def _readers(db: Session, org_id) -> List[str]:
    return list(
        db.execute(
            select(DayNoteReader.email)
            .where(DayNoteReader.org_id == org_id)
            .order_by(DayNoteReader.email.asc())
        ).scalars()
    )


def _deliver(post: Mailer, messages: List[Message]) -> None:
    """Send after the response, and never raise: the note is saved either way."""
    try:
        result = post.send(messages)
    except Exception:  # noqa: BLE001 - a courtesy must not become an incident
        log.exception("day notes: the email failed for %d message(s)", len(messages))
        return
    log.info(
        "day notes: delivered %d of %d message(s)", result.delivered, result.attempted
    )


# --- Who reads them ---------------------------------------------------------
# Declared before `/{note_date}` so "readers", "feed" and "insights" are never
# read as a date.


@router.get("/readers", response_model=DayNoteReadersOut)
def get_readers(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> DayNoteReadersOut:
    return _readers_out(db, current_user.org_id)


def _readers_out(db: Session, org_id) -> DayNoteReadersOut:
    emails = _readers(db, org_id)
    logins = set(
        db.execute(
            select(func.lower(UserAccount.email))
            .where(UserAccount.org_id == org_id)
            .where(UserAccount.is_active.is_(True))
        ).scalars()
    )
    return DayNoteReadersOut(
        readers=[DayNoteReaderOut(email=e, has_login=e in logins) for e in emails],
        mail_configured=mailer().configured,
    )


@router.put("/readers", response_model=DayNoteReadersOut)
def put_readers(
    payload: DayNoteReadersIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> DayNoteReadersOut:
    """Replace the whole list. The screen edits it as one list, so it is sent as one."""
    db.execute(delete(DayNoteReader).where(DayNoteReader.org_id == current_user.org_id))
    db.add_all(
        DayNoteReader(org_id=current_user.org_id, email=email) for email in payload.emails
    )
    db.flush()
    return _readers_out(db, current_user.org_id)


@router.get("/feed", response_model=DayNoteFeed)
def feed(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> DayNoteFeed:
    """The notes, for anyone allowed to read them: a manager, or a login on the list."""
    allowed = current_user.role == "manager" or (
        db.execute(
            select(DayNoteReader.id)
            .where(DayNoteReader.org_id == current_user.org_id)
            .where(DayNoteReader.email == current_user.email.strip().lower())
        ).first()
        is not None
    )
    if not allowed:
        return DayNoteFeed(can_read=False, notes=[])
    return DayNoteFeed(
        can_read=True, notes=_list(db, current_user.org_id, with_insight=False)
    )


@router.get("/insights", response_model=InsightSummary)
def insights(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> InsightSummary:
    """What the notes of the last twelve weeks add up to. Counted, not written."""
    return InsightSummary(**day_insights.summary(db, current_user.org_id))


# --- The notes --------------------------------------------------------------


def _list(db: Session, org_id, with_insight: bool = True) -> List[DayNoteOut]:
    notes = list(
        db.execute(
            select(DayNote)
            .where(DayNote.org_id == org_id)
            .order_by(DayNote.note_date.desc())
            .limit(LIST_LIMIT)
        ).scalars()
    )
    insights = _insights(db, org_id, notes) if with_insight else {}
    return [_out(n, insights.get(n.id)) for n in notes]


def _find(db: Session, org_id, note_date: date):
    return db.execute(
        select(DayNote)
        .where(DayNote.org_id == org_id)
        .where(DayNote.note_date == note_date)
    ).scalar_one_or_none()


@router.get("", response_model=List[DayNoteOut])
def list_notes(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> List[DayNoteOut]:
    return _list(db, current_user.org_id)


@router.get("/{note_date}", response_model=DayNoteOut)
def get_note(
    note_date: date,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> DayNoteOut:
    note = _find(db, current_user.org_id, note_date)
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("day_note_not_found", "There is no note for that day"),
        )
    return _out(note, _insights(db, current_user.org_id, [note]).get(note.id))


@router.put("/{note_date}", response_model=DayNoteSaved)
def put_note(
    note_date: date,
    payload: DayNoteIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> DayNoteSaved:
    now = datetime.now(timezone.utc)
    note = _find(db, current_user.org_id, note_date)
    if note is None:
        note = DayNote(
            org_id=current_user.org_id,
            note_date=note_date,
            body=payload.body,
            updated_by=current_user.id,
            created_at=now,
            updated_at=now,
        )
        db.add(note)
    else:
        note.body = payload.body
        note.updated_by = current_user.id
        note.updated_at = now

    post = mailer()
    messages: List[Message] = []
    if payload.send:
        recipients = _readers(db, current_user.org_id)
        org_name = (
            db.execute(
                select(Organization.name).where(Organization.id == current_user.org_id)
            ).scalar_one_or_none()
            or ""
        )
        messages = day_note_email.compose(
            note_date, payload.body, recipients, org_name, settings.app_base_url
        )
        if messages and post.configured:
            note.sent_at = now

    db.flush()
    db.refresh(note)
    # Read before the commit: the tenant setting is per transaction, so a row
    # reloaded after it would be read with no business at all.
    insight = _insights(db, current_user.org_id, [note]).get(note.id)
    out = _out(note, insight)
    # After the commit, and never in a way that can undo it: the note is what
    # the manager wrote; the email is a courtesy on top.
    db.commit()
    if messages and post.configured:
        background.add_task(_deliver, post, messages)
    # So is the reading, and it is only armed when there is something to read:
    # `pending` already says a reading is expected and the stored one is of
    # another text. Saving the same words again costs nothing, and saving in
    # bursts (the screen autosaves) re-arms one timer rather than buying one
    # reading per save -- see `day_insights.schedule`.
    if insight is not None and insight.pending:
        day_insights.schedule(current_user.org_id, note_date)

    return DayNoteSaved(
        **out.model_dump(),
        emailed=len(messages) if post.configured else 0,
        mail_configured=post.configured,
    )


@router.delete("/{note_date}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_date: date,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> Response:
    note = _find(db, current_user.org_id, note_date)
    if note is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("day_note_not_found", "There is no note for that day"),
        )
    db.delete(note)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
