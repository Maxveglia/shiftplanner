"""The business assistant's endpoints -- see services/assistant.py for what and why.

Managers only, and nothing but the status endpoint exists while the assistant
is switched off or not configured: every other route answers 404 before it
reads a row or makes a call, so an environment without the variables behaves
exactly as if this file had never been merged.

THE LONG REQUEST. Sending a message waits for the answer, which is seconds and
occasionally a minute. The request's database session is committed BEFORE the
wait (which gives its connection back to the pool) and re-armed after it: a
connection held idle in an open transaction for a minute per question is how
a chat takes the login page down with it. The tools the assistant calls open a
short session of their own each, like the planner's notebook does.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional, Tuple

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import settings
from app.db import AppSessionLocal, get_db, set_current_org
from app.deps import get_current_manager
from app.errors import detail
from app.models.assistant import AssistantMemoryStore, AssistantSession
from app.schemas.auth import UserOut
from app.services import api_usage
from app.services import assistant as svc
from app.services import assistant_tools as tools
from app.services import employees as employees_svc
from app.services.assistant_privacy import People

log = logging.getLogger(__name__)

router = APIRouter(prefix="/assistant", tags=["assistant"])

# What a manager may type in one message. A question, not a document; the
# planner's own brief is capped at the same order of magnitude.
MAX_MESSAGE_CHARS = 4_000


class AssistantStatus(BaseModel):
    enabled: bool


class ConversationOut(BaseModel):
    id: uuid.UUID
    created_at: datetime


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    # The browser's zone, so "Tuesday at nine" is the manager's nine. Shifts
    # are stored as instants; this is only how they are read out.
    tz: Optional[str] = Field(default=None, max_length=64)
    language: str = Field(default="es", max_length=8)


class MessageOut(BaseModel):
    reply: str
    # "end_turn" normally. "budget_reached" or "terminated" mean this
    # conversation can take no more questions and the client should start a
    # new one -- the memory carries over, the long history does not.
    stop: str
    conversation_open: bool


class MemoryLineOut(BaseModel):
    id: str
    text: str


class MemoriesOut(BaseModel):
    lines: List[MemoryLineOut]


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=detail("assistant_unavailable", "The assistant is not available"),
    )


def _require_enabled() -> None:
    if not svc.enabled():
        raise _not_found()


def _people(db: Session, org_id) -> People:
    return People(employees_svc.names_by_id(db, org_id))


def _budget(db: Session, org_id) -> None:
    """The monthly allowance, read before spending -- same rule as planning."""
    spent = api_usage.spent_usd_this_month(db, org_id)
    if spent < settings.api_budget_usd_per_month:
        return
    log.warning("assistant: org %s is over its monthly budget ($%.2f)", org_id, spent)
    if settings.api_budget_enforced:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail(
                "org_budget_spent",
                "This account has reached its monthly allowance for AI features.",
            ),
        )


def _api_error(code: str, message: str, http: int = status.HTTP_502_BAD_GATEWAY) -> HTTPException:
    return HTTPException(status_code=http, detail=detail(code, message))


@router.get("/status", response_model=AssistantStatus)
def get_status(current_user: UserOut = Depends(get_current_manager)) -> AssistantStatus:
    """Whether to show the assistant at all. Makes no call."""
    return AssistantStatus(enabled=svc.enabled())


@router.post("/conversations", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
def start_conversation(
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ConversationOut:
    """A fresh conversation with this business's memory attached.

    The caller's previous conversations are closed, and deleted at Anthropic
    after the response goes out: the memory is what is meant to last.
    """
    _require_enabled()
    _budget(db, current_user.org_id)
    org_id = current_user.org_id
    try:
        api = svc.client()
        # The store first, and COMMITTED on its own: it exists at Anthropic
        # from this moment, and a session that then fails to open would roll
        # the request back and leave a store nobody points at -- a memory
        # this business could never see, delete, or be asked to forget.
        svc.ensure_store(db, org_id, api)
        db.commit()
        set_current_org(db, org_id)
        row, previous = svc.start_conversation(db, org_id, current_user.id, api)
    except svc.AssistantError as exc:
        raise _api_error(exc.code, str(exc))
    except Exception:  # noqa: BLE001 - the API is down, or the ids are wrong
        log.exception("assistant: could not start a conversation for org %s", org_id)
        raise _api_error("assistant_unavailable", "Could not start a conversation")
    if previous:
        background.add_task(svc.delete_remote, None, previous)
    return ConversationOut(id=row.id, created_at=row.created_at or datetime.now(timezone.utc))


def _tool_runner(org_id, people: People, tz: Optional[str]) -> Callable[[str, object], Tuple[str, bool]]:
    """Each tool call in a short tenant session of its own, never the request's."""

    ctx = tools.ToolContext(org_id=org_id, people=people, tz=tz or tools.DEFAULT_TZ)

    def run(name: str, args: object) -> Tuple[str, bool]:
        db = AppSessionLocal()
        try:
            set_current_org(db, org_id)
            out = tools.run(db, ctx, name, args)
            db.rollback()  # read-only: nothing to keep, and nothing kept
            return out
        except Exception:  # noqa: BLE001 - our bug, reported to the model as an error
            db.rollback()
            log.exception("assistant: tool %s failed for org %s", name, org_id)
            return "The lookup failed on our side. Tell the manager you could not check it.", True
        finally:
            db.close()

    return run


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
def send_message(
    conversation_id: uuid.UUID,
    payload: MessageIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> MessageOut:
    _require_enabled()
    org_id = current_user.org_id
    row = svc.conversation_for(db, org_id, current_user.id, conversation_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("conversation_not_found", "Conversation not found"),
        )
    if row.closed_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail("conversation_closed", "This conversation is over; start a new one"),
        )
    _budget(db, org_id)
    timeout = float(settings.assistant_turn_timeout_seconds)
    if not svc.claim(db, row, timeout + svc.BUSY_GRACE_SECONDS):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail("assistant_busy", "The assistant is still answering the previous message"),
        )
    people = _people(db, org_id)
    store_id = svc.store_id_for(db, org_id)
    session_id, row_id, model = row.anthropic_session_id, row.id, row.model or settings.assistant_model
    text = "%s\n%s" % (
        svc.context_line(datetime.now(tools.zone(payload.tz)), tools.zone(payload.tz).key, payload.language),
        people.mask(payload.text.strip()),
    )
    # The claim is committed, and the connection goes back to the pool for
    # the wait. `set_current_org` is re-armed below: it is SET LOCAL.
    db.commit()

    api = svc.client()
    result: Optional[svc.TurnResult] = None
    failure: Optional[HTTPException] = None
    with api_usage.collect() as ledger:
        try:
            result = svc.run_turn(
                api,
                session_id,
                text,
                _tool_runner(org_id, people, payload.tz),
                timeout,
                model,
            )
        except svc.TurnTimeout as exc:
            result = exc.partial
            failure = HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=detail("assistant_timeout", "The assistant took too long to answer"),
            )
        except svc.AssistantError as exc:
            failure = _api_error(exc.code, str(exc))
        except Exception:  # noqa: BLE001
            log.exception("assistant: turn failed on %s", session_id)
            failure = _api_error("assistant_unavailable", "The assistant could not answer")
        finally:
            api_usage.record(org_id, ledger)

    if store_id:
        try:
            svc.scrub_store(api, store_id, people)
        except Exception:  # noqa: BLE001 - retried after the next answer
            log.exception("assistant: could not scrub the store of org %s", org_id)

    set_current_org(db, org_id)
    closed = result is not None and result.stop in ("budget_reached", "terminated", "retries_exhausted")
    values = {"busy_until": None, "last_used_at": datetime.now(timezone.utc)}
    if result is not None:
        values.update(
            turns=AssistantSession.turns + 1,
            input_tokens=AssistantSession.input_tokens + result.input_tokens,
            output_tokens=AssistantSession.output_tokens + result.output_tokens,
            cache_read_input_tokens=AssistantSession.cache_read_input_tokens + result.cache_read_input_tokens,
            cache_creation_input_tokens=AssistantSession.cache_creation_input_tokens
            + result.cache_creation_input_tokens,
        )
    if closed:
        values.update(closed_at=datetime.now(timezone.utc), closed_reason=result.stop)
    db.execute(
        update(AssistantSession)
        .where(AssistantSession.id == row_id)
        .where(AssistantSession.org_id == org_id)
        .values(**values)
    )
    # Committed here, not by the request: an error below is raised as an
    # HTTPException, which rolls the request's session back -- and a
    # conversation left marked busy after a timeout refuses the retry the
    # manager is told to make.
    db.commit()

    if failure is not None:
        raise failure
    if result.stop == "retries_exhausted" and not result.text:
        raise _api_error("assistant_unavailable", "The assistant could not answer")
    return MessageOut(reply=people.unmask(result.text), stop=result.stop or "end_turn", conversation_open=not closed)


@router.get("/memories", response_model=MemoriesOut)
def get_memories(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> MemoriesOut:
    """Everything the assistant remembers about this business, line by line,
    with people by their names. Empty until the first conversation."""
    _require_enabled()
    store_id = svc.store_id_for(db, current_user.org_id)
    if not store_id:
        return MemoriesOut(lines=[])
    people = _people(db, current_user.org_id)
    try:
        lines = svc.list_memories(svc.client(), store_id, people)
    except Exception:  # noqa: BLE001
        log.exception("assistant: could not list memories of org %s", current_user.org_id)
        raise _api_error("assistant_unavailable", "Could not read the assistant's memory")
    return MemoriesOut(lines=[MemoryLineOut(id=l["id"], text=l["text"]) for l in lines])


@router.delete("/memories/{line_id}", response_model=MemoriesOut)
def forget_memory_line(
    line_id: str,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> MemoriesOut:
    """Delete one remembered line, and redact the versions that held it.

    Only ever in THIS business's store: the store id comes from our row for
    the caller's org, never from the request, so a line id from somebody
    else's memory simply matches nothing.
    """
    _require_enabled()
    if len(line_id) > 200 or ":" not in line_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("memory_not_found", "Nothing to forget"),
        )
    store_id = svc.store_id_for(db, current_user.org_id)
    if store_id:
        api = svc.client()
        try:
            svc.forget_line(api, store_id, line_id)
        except Exception:  # noqa: BLE001
            log.exception("assistant: could not forget a line for org %s", current_user.org_id)
            raise _api_error("assistant_unavailable", "Could not change the assistant's memory")
    return get_memories(db, current_user)


@router.delete("/memories", response_model=MemoriesOut)
def forget_everything(
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> MemoriesOut:
    """Forget everything: the whole store goes, and so do the conversations
    that had it mounted. The next conversation starts with an empty memory."""
    _require_enabled()
    org_id = current_user.org_id
    store_id, sessions = svc.remote_ids(db, org_id)
    db.query(AssistantMemoryStore).filter(AssistantMemoryStore.org_id == org_id).delete()
    now = datetime.now(timezone.utc)
    db.execute(
        update(AssistantSession)
        .where(AssistantSession.org_id == org_id)
        .where(AssistantSession.closed_at.is_(None))
        .values(closed_at=now, closed_reason="forgotten")
    )
    db.flush()
    if store_id or sessions:
        background.add_task(svc.delete_remote, store_id, sessions)
    return MemoriesOut(lines=[])
