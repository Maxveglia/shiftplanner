"""The business assistant: a chat about one business that remembers it.

WHAT IT IS. A manager asks questions about their business and their calendar
-- "who worked most weekends in August?", "why is Tuesday so thin?" -- and the
assistant answers from the published calendar, the team, the business profile
and the planner's notes, and REMEMBERS what it learns about the business from
one conversation to the next. It is read-only: it explains, analyses and
suggests, and when the manager wants something changed it tells them what to
type in the brief box. Max chose it on 2026-09-22.

HOW IT IS BUILT: CLAUDE MANAGED AGENTS (beta). Three kinds of object live at
Anthropic, and this file never creates the first two:

* ONE AGENT for every business -- model, system prompt, tools -- defined in
  ``backend/assistant/agent.yaml`` and created once, by hand, outside the
  request path. Its id is ``ASSISTANT_AGENT_ID``.
* ONE ENVIRONMENT -- the container the agent's file tools run in, with no
  network at all -- in ``backend/assistant/environment.yaml``, id
  ``ASSISTANT_ENVIRONMENT_ID``.
* ONE MEMORY STORE PER ORGANISATION, created here, lazily, on the first
  conversation (``ensure_store``), and pointed at from our database
  (``assistant_memory_store``). It is mounted into every session of that
  business as a directory, read-write, and it is the assistant's memory: a few
  short files of facts about the business. Nobody else's session ever mounts
  it, because the only place a store id comes from is our row for the caller's
  org.

Every conversation is a SESSION (``start_conversation``), bound in our database
to the org and the user who opened it (``assistant_session``).

THE LOOP (``run_turn``). Follows the platform's documented client patterns,
because each of them is a way to hang or to lose an answer:

* STREAM FIRST, THEN SEND. The event stream is opened before the manager's
  message is sent; opened after, the first events can be gone.
* CUSTOM TOOLS ARE OURS. The agent's lookups are custom tools
  (``services/assistant_tools.py``): it emits ``agent.custom_tool_use``, the
  session goes idle waiting, we run the query in our own short database
  session and send ``user.custom_tool_result``. Answered the moment the call
  is seen, once per call id.
* THE IDLE GATE. ``session.status_idle`` with ``requires_action`` means "your
  turn to answer a tool", not "done", and breaking on it would drop the answer
  on the floor. Done is idle with any other reason, or terminated.
* A HARD WALL CLOCK. The SDK's timeouts are per read and a stream with
  heartbeats never trips them, so a watchdog thread closes the stream at the
  deadline, and the session is sent ``user.interrupt`` so it stops spending.
* RECONNECT WITHOUT LOSS. The stream has no replay: if it drops, it is opened
  again and the history since our message is read and de-duplicated by event
  id, so a tool call that arrived in the gap is still answered rather than
  leaving the session waiting forever.

PRIVACY. Nothing that names a person reaches Anthropic -- the manager's
message, every tool result and every memory carry stable aliases
(``services/assistant_privacy.py``), and the answer is turned back into names
in our process. After every answer the memory store is re-read and scrubbed
(``scrub_store``): a line about pay, contracts, absences, health or family is
removed, a name that slipped through in the manager's own sentence is masked,
and the versions that held either are redacted. The system prompt asks for the
same thing; this is what holds when a request is not enough.

METERING. Every model request the session makes ends with
``span.model_request_end`` carrying its token usage; each one becomes a row in
``api_usage`` under ``assistant.turn``, so the monthly budget and the back
office see the assistant like every other call. The platform also bills
session running time ($0.08/hour of activity), which no event itemises per
turn and which is therefore NOT in the ledger; the per-session budget
(``ASSISTANT_SESSION_BUDGET_CENTS``) is what caps it.
"""

from __future__ import annotations

import hashlib
import itertools
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, Iterator, List, Mapping, Optional, Tuple

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models.assistant import AssistantMemoryStore, AssistantSession
from app.services import api_usage
from app.services import planner_notes as pn
from app.services.assistant_privacy import People

log = logging.getLogger(__name__)

# What the ledger calls the model requests of a turn.
PURPOSE = "assistant.turn"

# The store's name is its directory inside the container: /mnt/memory/negocio/.
# The same for every business on purpose -- a name is sent to Anthropic, and
# the business's own name has no reason to travel. Which business a store
# belongs to is in OUR table, and in metadata as our opaque org id.
STORE_NAME = "negocio"
STORE_DESCRIPTION = (
    "Short facts about ONE business that uses a shift-planning product, kept "
    "by its assistant for future conversations with the manager. People "
    "appear only as aliases such as P-7c3f9a."
)
MEMORY_INSTRUCTIONS = (
    "This is what you remember about this business from earlier conversations. "
    "Read it before you answer. Keep it to short facts about how the business "
    "runs and how the manager likes rotas, one per line, in negocio.md. Never "
    "write pay, contracts, contracted hours, absences, leave, health, family, "
    "personal reasons or names; people only by their alias. Remove a line that "
    "turned out to be wrong."
)

# How long a conversation is considered busy answering. Longer than any turn
# can take (the turn timeout plus the time to write what it cost), so a live
# answer is never mistaken for a dead one; short enough that a container that
# died mid-answer frees the conversation within minutes.
BUSY_GRACE_SECONDS = 60

# Reconnects per turn after a dropped stream. One is the case the pattern is
# for; three is the network misbehaving and the manager is better told so.
MAX_RECONNECTS = 3

# Calls to the API that are NOT the turn -- create a store, a session, list a
# store -- get a short timeout of their own and the SDK's retries.
CONTROL_TIMEOUT_SECONDS = 30.0
MAX_RETRIES = 2

_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class AssistantError(Exception):
    """Something the manager is told about with a code, not a crash."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class TurnTimeout(AssistantError):
    def __init__(self, partial: "TurnResult"):
        super().__init__("assistant_timeout", "The assistant took too long to answer.")
        self.partial = partial


def enabled() -> bool:
    """Whether the assistant exists at all. Every endpoint asks this first."""
    return bool(
        settings.assistant_enabled
        and settings.assistant_agent_id
        and settings.assistant_environment_id
        and settings.anthropic_api_key
    )


def client():
    """The SDK client. A function so tests can replace it with a fake."""
    import anthropic

    return anthropic.Anthropic(
        api_key=settings.anthropic_api_key,
        timeout=CONTROL_TIMEOUT_SECONDS,
        max_retries=MAX_RETRIES,
    )


def _get(obj, key, default=None):
    """Read a field from an SDK model or a plain dict alike."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


# --- the memory store: one per organisation, created on first use ---------------


def store_id_for(db: Session, org_id: uuid.UUID) -> Optional[str]:
    # The org is in the WHERE as well as in RLS: two locks on one door.
    return db.execute(
        select(AssistantMemoryStore.store_id).where(AssistantMemoryStore.org_id == org_id)
    ).scalar_one_or_none()


def ensure_store(db: Session, org_id: uuid.UUID, api) -> str:
    """This organisation's store id, creating the store the first time.

    THE RACE. Two first conversations at once both find no row and both
    create a store at Anthropic. The org is the table's primary key, so only
    one insert lands; the loser reads the winner's id and deletes the store it
    made, so no business ever has two memories that disagree -- or one that
    nobody points at.
    """
    existing = store_id_for(db, org_id)
    if existing:
        return existing
    store = api.beta.memory_stores.create(
        name=STORE_NAME,
        description=STORE_DESCRIPTION,
        metadata={"shiftplanner_org": str(org_id)},
    )
    created = str(_get(store, "id"))
    inserted = db.execute(
        insert(AssistantMemoryStore)
        .values(org_id=org_id, store_id=created)
        .on_conflict_do_nothing(index_elements=["org_id"])
        .returning(AssistantMemoryStore.store_id)
    ).scalar_one_or_none()
    db.flush()
    if inserted:
        return created
    winner = store_id_for(db, org_id)
    try:
        api.beta.memory_stores.delete(created)
    except Exception:  # noqa: BLE001 - an orphan is logged, not a failed chat
        log.exception("assistant: could not delete duplicate store %s for org %s", created, org_id)
    return winner or created


# --- conversations -----------------------------------------------------------------


def _model_of(session) -> Optional[str]:
    agent = _get(session, "agent")
    model = _get(agent, "model") if agent is not None else None
    if isinstance(model, str):
        return model
    return _get(model, "id") if model is not None else None


def start_conversation(
    db: Session, org_id: uuid.UUID, user_id: uuid.UUID, api
) -> Tuple[AssistantSession, List[str]]:
    """A new session with this business's memory mounted, bound to its user.

    Returns the row and the Anthropic ids of the user's previous
    conversations, which are closed here and should be DELETED at Anthropic by
    the caller once the response is out (see ``delete_remote``): the memory
    is what carries over, and a transcript nobody will read again is data we
    would be keeping at a third party for nothing.
    """
    store_id = ensure_store(db, org_id, api)
    session = api.beta.sessions.create(
        agent=settings.assistant_agent_id,
        environment_id=settings.assistant_environment_id,
        title="ShiftPlanner assistant",
        metadata={"shiftplanner_org": str(org_id)},
        resources=[
            {
                "type": "memory_store",
                "memory_store_id": store_id,
                "access": "read_write",
                "instructions": MEMORY_INSTRUCTIONS,
            }
        ],
        budget={
            "type": "limit",
            "max_list_cost": {
                "amount": str(max(1, int(settings.assistant_session_budget_cents))),
                "currency": "USD",
            },
        },
    )
    previous = list(
        db.execute(
            select(AssistantSession)
            .where(AssistantSession.org_id == org_id)
            .where(AssistantSession.user_id == user_id)
            .where(AssistantSession.closed_at.is_(None))
        ).scalars()
    )
    now = datetime.now(timezone.utc)
    for old in previous:
        old.closed_at = now
        old.closed_reason = "replaced"
    row = AssistantSession(
        org_id=org_id,
        user_id=user_id,
        anthropic_session_id=str(_get(session, "id")),
        model=_model_of(session) or settings.assistant_model,
    )
    db.add(row)
    db.flush()
    return row, [o.anthropic_session_id for o in previous]


def conversation_for(
    db: Session, org_id: uuid.UUID, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> Optional[AssistantSession]:
    """The caller's own conversation, or None. Org AND user in the WHERE:
    another business's conversation does not exist for this caller, and
    neither does a colleague's."""
    return db.execute(
        select(AssistantSession)
        .where(AssistantSession.id == conversation_id)
        .where(AssistantSession.org_id == org_id)
        .where(AssistantSession.user_id == user_id)
    ).scalar_one_or_none()


def claim(db: Session, row: AssistantSession, seconds: float) -> bool:
    """Mark a conversation busy, atomically. False if it already is.

    One UPDATE with the condition in its WHERE, so two requests racing for the
    same conversation cannot both see it free.
    """
    now = datetime.now(timezone.utc)
    until = now + timedelta(seconds=seconds)
    claimed = db.execute(
        update(AssistantSession)
        .where(AssistantSession.id == row.id)
        .where(AssistantSession.org_id == row.org_id)
        .where((AssistantSession.busy_until.is_(None)) | (AssistantSession.busy_until < now))
        .values(busy_until=until)
        .returning(AssistantSession.id)
    ).scalar_one_or_none()
    db.flush()
    return claimed is not None


# --- one answer ----------------------------------------------------------------------


@dataclass
class TurnResult:
    texts: List[str] = field(default_factory=list)
    stop: Optional[str] = None
    tool_calls: List[Tuple[str, bool]] = field(default_factory=list)
    model_requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_input_tokens: int = 0
    cache_creation_input_tokens: int = 0
    errors: List[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(t for t in self.texts if t.strip()).strip()


ToolRunner = Callable[[str, object], Tuple[str, bool]]


def context_line(today: datetime, tz: str, language: str) -> str:
    """What the app tells the assistant about the moment, above each message.

    Without it "next month" is a guess about a date the model cannot see. It
    is marked as the app's so the model does not read it as the manager.
    """
    return "[App: today is %s (%s), time zone %s, interface language %s]" % (
        today.date().isoformat(),
        _WEEKDAYS[today.weekday()],
        tz,
        language,
    )


def _close_quietly(stream) -> None:
    try:
        stream.close()
    except Exception:  # noqa: BLE001 - closing is the watchdog's last resort
        pass


def _history_since(api, session_id: str, sent_id: Optional[str], since: datetime) -> List:
    """The events after our message, for a reconnect. Oldest first.

    Asked from a minute before the turn started, so a clock that disagrees
    with the server's by less than that loses nothing, and then cut at our own
    message so an earlier turn's events are never replayed as this one's.
    """
    events = list(
        api.beta.sessions.events.list(
            session_id=session_id,
            order="asc",
            created_at_gte=(since - timedelta(minutes=1)).isoformat(),
        )
    )
    anchor = None
    for i, ev in enumerate(events):
        if _get(ev, "type") == "user.message" and (sent_id is None or _get(ev, "id") == sent_id):
            anchor = i
    return events[anchor + 1 :] if anchor is not None else events


_USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)


def _usage(result: TurnResult, usage, model: str) -> None:
    """One model request's tokens: onto the turn, and into the ledger.

    Read field by field into plain integers: the ledger reads attributes, and
    an event decoded as a dict (a newer event shape the SDK does not model
    yet, or a test) must count the same as one decoded as a model."""
    counts = SimpleNamespace(**{f: int(_get(usage, f, 0) or 0) for f in _USAGE_FIELDS})
    result.model_requests += 1
    for f in _USAGE_FIELDS:
        setattr(result, f, getattr(result, f) + getattr(counts, f))
    api_usage.note(PURPOSE, model, counts)


def run_turn(
    api,
    session_id: str,
    text: str,
    run_tool: ToolRunner,
    timeout_seconds: float,
    model: str,
    clock: Callable[[], float] = time.monotonic,
) -> TurnResult:
    """Send one message and collect the answer, running our tools on the way.

    ``text`` is already masked. ``run_tool(name, input)`` returns
    ``(text, is_error)`` and is ours to make safe. Raises ``TurnTimeout`` past
    the deadline (after interrupting the session) and ``AssistantError`` when
    the stream cannot be kept.
    """
    deadline = clock() + timeout_seconds
    started = datetime.now(timezone.utc)
    result = TurnResult()
    seen: set = set()
    answered: set = set()
    sent_id: Optional[str] = None
    sent = False
    reconnects = 0

    def handle(event) -> bool:
        """One event. True when the turn is over."""
        kind = _get(event, "type")
        eid = _get(event, "id")
        fresh = not eid or eid not in seen
        if eid:
            seen.add(eid)
        if fresh:
            if kind == "agent.message":
                for block in _get(event, "content") or []:
                    if _get(block, "type") == "text" and _get(block, "text"):
                        result.texts.append(str(_get(block, "text")))
            elif kind == "agent.custom_tool_use" and eid not in answered:
                answered.add(eid)
                name = str(_get(event, "name") or "")
                out, is_error = run_tool(name, _get(event, "input") or {})
                result.tool_calls.append((name, not is_error))
                reply = {
                    "type": "user.custom_tool_result",
                    "custom_tool_use_id": eid,
                    "content": [{"type": "text", "text": out}],
                }
                if is_error:
                    reply["is_error"] = True
                api.beta.sessions.events.send(session_id=session_id, events=[reply])
            elif kind in ("agent.tool_use", "agent.mcp_tool_use") and _get(event, "evaluated_permission") == "ask":
                # Our built-in tools are always_allow and there are no MCP
                # servers, so this is configuration drift. Denied rather than
                # left waiting: a question with nobody to answer it would hold
                # the session until the deadline.
                api.beta.sessions.events.send(
                    session_id=session_id,
                    events=[
                        {
                            "type": "user.tool_confirmation",
                            "tool_use_id": eid,
                            "result": "deny",
                            "deny_message": "Not available in this product.",
                        }
                    ],
                )
            elif kind == "span.model_request_end":
                _usage(result, _get(event, "model_usage") or {}, model)
            elif kind == "session.error":
                err = _get(event, "error")
                result.errors.append(str(_get(err, "message") or _get(err, "type") or "error"))
        # Terminal checks run even for an event already seen: an idle that
        # arrived in the history AND on the stream still ends the turn.
        if kind == "session.status_terminated":
            result.stop = "terminated"
            return True
        if kind == "session.status_idle":
            reason = _get(_get(event, "stop_reason"), "type")
            if reason == "requires_action":
                return False
            result.stop = str(reason or "end_turn")
            return True
        return False

    while True:
        stream = api.beta.sessions.events.stream(session_id=session_id)
        watchdog = threading.Timer(max(0.0, deadline - clock()), _close_quietly, args=(stream,))
        watchdog.daemon = True
        watchdog.start()
        try:
            backlog: Iterable = ()
            if not sent:
                response = api.beta.sessions.events.send(
                    session_id=session_id,
                    events=[{"type": "user.message", "content": [{"type": "text", "text": text}]}],
                )
                sent = True
                data = _get(response, "data") or []
                sent_id = _get(data[0], "id") if data else None
            else:
                backlog = _history_since(api, session_id, sent_id, started)
            for event in itertools.chain(backlog, stream):
                if handle(event):
                    return result
                if clock() >= deadline:
                    raise TurnTimeout(result)
            # The stream ended with no terminal event: dropped, or closed by
            # the watchdog.
            if clock() >= deadline:
                raise TurnTimeout(result)
            raise ConnectionError("event stream ended early")
        except TurnTimeout:
            _interrupt(api, session_id)
            raise
        except AssistantError:
            raise
        except Exception as exc:  # noqa: BLE001 - network, or a closed stream
            if clock() >= deadline:
                _interrupt(api, session_id)
                raise TurnTimeout(result)
            if not sent:
                raise AssistantError("assistant_unavailable", "Could not reach the assistant: %s" % exc)
            reconnects += 1
            if reconnects > MAX_RECONNECTS:
                _interrupt(api, session_id)
                raise AssistantError("assistant_unavailable", "Lost the assistant's answer: %s" % exc)
            log.warning("assistant: stream dropped on %s (%s); reconnecting", session_id, exc)
        finally:
            watchdog.cancel()
            _close_quietly(stream)


def _interrupt(api, session_id: str) -> None:
    """Stop a session that is still working. Best effort: it is what keeps a
    timed-out answer from spending in the background."""
    try:
        api.beta.sessions.events.send(session_id=session_id, events=[{"type": "user.interrupt"}])
    except Exception:  # noqa: BLE001
        log.warning("assistant: could not interrupt %s", session_id)


# --- the memory, as the manager sees it -------------------------------------------------


def _line_id(memory_id: str, line: str) -> str:
    digest = hashlib.sha256(("%s\n%s" % (memory_id, " ".join(line.split()))).encode("utf-8")).hexdigest()[:12]
    return "%s:%s" % (memory_id, digest)


def _lines(content: str) -> List[str]:
    out = []
    for raw in (content or "").split("\n"):
        text = pn._clean_line(raw)
        if text and not text.startswith("#"):
            out.append(text)
    return out


def _memories(api, store_id: str) -> Iterator:
    for item in api.beta.memory_stores.memories.list(store_id, path_prefix="/", view="full"):
        if _get(item, "type", "memory") == "memory":
            yield item


def list_memories(api, store_id: str, people: People) -> List[dict]:
    """Every line the assistant remembers, with people by their real names."""
    out: List[dict] = []
    for mem in _memories(api, store_id):
        mid = str(_get(mem, "id"))
        for line in _lines(str(_get(mem, "content") or "")):
            out.append(
                {
                    "id": _line_id(mid, line),
                    "path": str(_get(mem, "path") or ""),
                    "text": people.unmask(line),
                }
            )
    return out


def _redact_history(api, store_id: str, memory_id: str, keep_latest: bool) -> int:
    """Scrub the earlier versions of one memory. Deleting a memory, or
    rewriting it, leaves every earlier version readable in the audit trail --
    and "deleted" has to mean the words are gone, not that the head moved."""
    redacted = 0
    try:
        versions = list(api.beta.memory_stores.memory_versions.list(store_id, memory_id=memory_id))
    except Exception:  # noqa: BLE001
        log.exception("assistant: could not list versions of %s", memory_id)
        return 0
    for i, version in enumerate(versions):  # newest first
        if keep_latest and i == 0:
            continue
        if _get(version, "redacted_at"):
            continue
        try:
            api.beta.memory_stores.memory_versions.redact(str(_get(version, "id")), memory_store_id=store_id)
            redacted += 1
        except Exception:  # noqa: BLE001
            log.exception("assistant: could not redact a version of %s", memory_id)
    return redacted


def _rewrite(api, store_id: str, mem, content: str) -> None:
    """Replace a memory's content (or delete it when nothing is left), and
    redact what it used to say."""
    mid = str(_get(mem, "id"))
    if content.strip():
        api.beta.memory_stores.memories.update(
            mid,
            memory_store_id=store_id,
            content=content,
            precondition={"type": "content_sha256", "content_sha256": _get(mem, "content_sha256")},
        )
        _redact_history(api, store_id, mid, keep_latest=True)
    else:
        api.beta.memory_stores.memories.delete(mid, memory_store_id=store_id)
        _redact_history(api, store_id, mid, keep_latest=False)


def forget_line(api, store_id: str, line_id: str) -> bool:
    """Remove one remembered line. False when it is already gone -- the list
    on screen may be older than the store, and gone is what was asked for."""
    memory_id = line_id.split(":", 1)[0]
    for mem in _memories(api, store_id):
        if str(_get(mem, "id")) != memory_id:
            continue
        content = str(_get(mem, "content") or "")
        kept, found = [], False
        for raw in content.split("\n"):
            text = pn._clean_line(raw)
            if not found and text and _line_id(memory_id, text) == line_id:
                found = True
                continue
            kept.append(raw)
        if not found:
            return False
        _rewrite(api, store_id, mem, "\n".join(kept))
        return True
    return False


def scrub_store(api, store_id: str, people: People) -> int:
    """After every answer: what the assistant wrote, made safe to keep.

    Drops any line about pay, contracts, absences, health, family or personal
    reasons (the planner's own list, ``planner_notes.SENSITIVE``), and masks
    any name that reached a line -- a name typed in lower case survives the
    mask on the way in, the model may copy it, and this is where it is caught
    before the next conversation reads it. Returns the memories rewritten.
    """
    changed = 0
    for mem in _memories(api, store_id):
        content = str(_get(mem, "content") or "")
        kept = []
        for raw in content.split("\n"):
            if pn.SENSITIVE.search(pn._clean_line(raw)):
                continue
            kept.append(people.mask(raw))
        clean = "\n".join(kept)
        if clean == content:
            continue
        try:
            _rewrite(api, store_id, mem, clean)
            changed += 1
        except Exception:  # noqa: BLE001 - a scrub that failed is retried next turn
            log.exception("assistant: could not scrub memory %s", _get(mem, "id"))
    return changed


def delete_remote(store_id: Optional[str], session_ids: Iterable[str]) -> None:
    """Delete sessions and, if given, a whole store at Anthropic. NEVER RAISES.

    For after the response: replaced conversations, "forget everything", and
    the end of an account. A failure is logged with the ids, which name
    nobody, so it can be finished by hand.
    """
    if not settings.anthropic_api_key:
        return
    try:
        api = client()
    except Exception:  # noqa: BLE001
        log.exception("assistant: no client to delete %s / %s", store_id, list(session_ids))
        return
    for sid in session_ids:
        try:
            api.beta.sessions.delete(sid)
        except Exception:  # noqa: BLE001
            log.warning("assistant: could not delete session %s", sid)
    if store_id:
        try:
            api.beta.memory_stores.delete(store_id)
        except Exception:  # noqa: BLE001
            log.exception("assistant: could not delete memory store %s", store_id)


def remote_ids(db: Session, org_id: uuid.UUID) -> Tuple[Optional[str], List[str]]:
    """What this organisation has at Anthropic: its store and its open
    conversations. Read before an account is deleted, while the rows exist."""
    sessions = list(
        db.execute(
            select(AssistantSession.anthropic_session_id).where(AssistantSession.org_id == org_id)
        ).scalars()
    )
    return store_id_for(db, org_id), sessions
