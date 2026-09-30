"""The business assistant: what it may send, whose it is, and how a turn ends.

What this file defends, in the order it could go wrong:

1. A name leaks. The manager's message, every tool result and every memory
   carry stable aliases, never a name; the answer comes back with names.
   The alias of a person is the same in every conversation.
2. One business reaches another's. A conversation belongs to its org and its
   user; a memory store is found only through the caller's org.
3. It exists when it should not. Switched off or unconfigured, every endpoint
   is a 404 (status says "off") and not one call is made.
4. A turn hangs or loses its answer. Custom tool -> result -> idle; the idle
   that means "your turn" is not the end; a dropped stream is resumed without
   answering a tool twice; the wall clock interrupts the session.
5. Memory keeps what it must not. Sensitive lines are scrubbed after a turn,
   deleted lines have their history redacted, forgetting everything deletes
   the store, and ending the account deletes what is at Anthropic.

Nothing here reaches the network: the API is a scripted fake. The second half
needs Postgres and skips itself when there is none.
"""

from __future__ import annotations

import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Dict, List

import pytest

from app.config import settings
from app.services import assistant as svc
from app.services import assistant_tools as tools
from app.services.assistant_privacy import ALIAS_RE, People, stable_aliases

ANA = "11111111-1111-1111-1111-111111111111"
BEA = "22222222-2222-2222-2222-222222222222"
NAMES = {ANA: "Ana García Pérez", BEA: "Bea Pons"}


# --- a fake Managed Agents API ------------------------------------------------------


class FakeStream:
    """An SSE stream: yields its events, then either ends, drops, or hangs
    until the watchdog closes it."""

    def __init__(self, events, then="end"):
        self.events = list(events)
        self.then = then
        self.closed = threading.Event()

    def __iter__(self):
        for e in self.events:
            if self.closed.is_set():
                raise ConnectionError("stream closed")
            yield e
        if self.then == "drop":
            raise ConnectionError("connection reset")
        if self.then == "hang":
            self.closed.wait(10)
            raise ConnectionError("stream closed")

    def close(self):
        self.closed.set()


class FakeAPI:
    def __init__(self):
        self.calls: List[tuple] = []
        self.sent: List[dict] = []
        self.streams: List[FakeStream] = []
        self.history: List = []
        self.stores: Dict[str, Dict[str, dict]] = {}
        self.versions: Dict[str, List[dict]] = {}
        self.redacted: List[str] = []
        self.deleted_sessions: List[str] = []
        self.deleted_stores: List[str] = []
        self.sessions_created: List[dict] = []
        self.session_ids: List[str] = []
        api = self

        class Events:
            def stream(self, session_id, **kw):
                api.calls.append(("stream", session_id))
                return api.streams.pop(0) if api.streams else FakeStream([idle("end_turn")])

            def send(self, session_id, events, **kw):
                api.calls.append(("send", session_id))
                for e in events:
                    api.sent.append(dict(e, _session=session_id))
                if events and events[0]["type"] == "user.message":
                    return {"data": [{"id": "sevt_msg", "type": "user.message"}]}
                return {"data": []}

            def list(self, session_id, **kw):
                api.calls.append(("history", session_id))
                return list(api.history)

        class Sessions:
            events = Events()

            def create(self, **kw):
                api.calls.append(("session.create", kw.get("agent")))
                # Unique across the whole run: the column is UNIQUE and every
                # test writes to the same database.
                sid = "sesn_%s" % uuid.uuid4().hex
                api.session_ids.append(sid)
                api.sessions_created.append(kw)
                return {"id": sid, "agent": {"model": {"id": "claude-sonnet-5"}}}

            def delete(self, session_id, **kw):
                api.calls.append(("session.delete", session_id))
                api.deleted_sessions.append(session_id)

        class Memories:
            def list(self, store_id, **kw):
                api.calls.append(("memories.list", store_id))
                return [
                    {"type": "memory", "id": mid, **m}
                    for mid, m in api.stores.get(store_id, {}).items()
                ]

            def update(self, memory_id, memory_store_id, content, precondition=None, **kw):
                api.calls.append(("memories.update", memory_id))
                mem = api.stores[memory_store_id][memory_id]
                assert precondition["content_sha256"] == mem["content_sha256"]
                mem["content"] = content
                mem["content_sha256"] = "sha-%d" % len(content)
                api.versions.setdefault(memory_id, []).insert(0, {"id": "memver_new_%s" % memory_id})

            def delete(self, memory_id, memory_store_id, **kw):
                api.calls.append(("memories.delete", memory_id))
                api.stores[memory_store_id].pop(memory_id)

        class Versions:
            def list(self, store_id, memory_id=None, **kw):
                return list(api.versions.get(memory_id, []))

            def redact(self, version_id, memory_store_id, **kw):
                api.redacted.append(version_id)

        class Stores:
            memories = Memories()
            memory_versions = Versions()

            def create(self, **kw):
                api.calls.append(("store.create", kw.get("name")))
                sid = "memstore_%s" % uuid.uuid4().hex
                api.stores[sid] = {}
                return {"id": sid}

            def delete(self, store_id, **kw):
                api.calls.append(("store.delete", store_id))
                api.deleted_stores.append(store_id)

        self.beta = SimpleNamespace(sessions=Sessions(), memory_stores=Stores())

    def put_memory(self, store_id, memory_id, content, path="/negocio.md"):
        self.stores.setdefault(store_id, {})[memory_id] = {
            "path": path,
            "content": content,
            "content_sha256": "sha-%d" % len(content),
        }
        self.versions[memory_id] = [{"id": "memver_old_%s" % memory_id}]


def idle(reason):
    return {"type": "session.status_idle", "id": "sevt_idle_%s_%s" % (reason, uuid.uuid4().hex[:6]),
            "stop_reason": {"type": reason}}


def tool_use(eid, name, args=None):
    return {"type": "agent.custom_tool_use", "id": eid, "name": name, "input": args or {}}


def message(text, eid=None):
    return {"type": "agent.message", "id": eid or "sevt_m_%s" % uuid.uuid4().hex[:6],
            "content": [{"type": "text", "text": text}]}


def usage(inp=100, out=20):
    return {"type": "span.model_request_end", "id": "sevt_u_%s" % uuid.uuid4().hex[:6],
            "model_usage": {"input_tokens": inp, "output_tokens": out,
                            "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}}


# --- 1. aliases -------------------------------------------------------------------------


def test_an_alias_is_the_same_in_every_conversation():
    first = People(NAMES)
    second = People(dict(reversed(list(NAMES.items()))))
    assert first.alias(ANA) == second.alias(ANA)
    assert first.alias(ANA) != first.alias(BEA)
    assert ALIAS_RE.fullmatch(first.alias(ANA))


def test_an_alias_does_not_depend_on_the_name():
    """Renaming somebody must not turn them into a stranger the memory has notes about."""
    assert People({ANA: "Ana"}).alias(ANA) == People({ANA: "Anabel Soto"}).alias(ANA)


def test_two_short_aliases_that_collide_both_grow(monkeypatch):
    from app.services import assistant_privacy as ap

    monkeypatch.setattr(ap, "_digest", lambda i: ("abcdef" + i.replace("-", ""))[:64])
    out = stable_aliases([ANA, BEA])
    assert out[ANA] != out[BEA]
    assert all(len(a) == len("P-") + ap.LONG for a in out.values())


def test_names_are_masked_out_and_restored_in():
    people = People(NAMES)
    masked = people.mask("¿Puede Ana cubrir el turno de Bea Pons? Y Ana García Pérez el lunes.")
    assert "Ana" not in masked and "Bea" not in masked and "García" not in masked
    assert people.alias(ANA) in masked and people.alias(BEA) in masked
    assert people.unmask(masked) == "¿Puede Ana García Pérez cubrir el turno de Bea Pons? Y Ana García Pérez el lunes."


def test_an_alias_nobody_has_is_left_as_it_is():
    assert People(NAMES).unmask("P-000000 trabaja") == "P-000000 trabaja"


# --- the agent definition and the backend agree -----------------------------------------


def _agent_yaml() -> dict:
    yaml = pytest.importorskip("yaml")
    path = Path(__file__).resolve().parent.parent / "assistant" / "agent.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def test_every_custom_tool_the_agent_declares_is_one_we_run():
    agent = _agent_yaml()
    declared = {t["name"] for t in agent["tools"] if t["type"] == "custom"}
    assert declared == set(tools.TOOLS)


def test_the_agent_has_no_shell_and_no_web():
    agent = _agent_yaml()
    toolset = next(t for t in agent["tools"] if t["type"] == "agent_toolset_20260401")
    assert toolset["default_config"]["enabled"] is False
    enabled = {c["name"] for c in toolset["configs"] if c.get("enabled")}
    assert enabled == {"read", "write", "edit", "glob"}
    assert not agent.get("mcp_servers")


def test_the_environment_has_no_network():
    yaml = pytest.importorskip("yaml")
    path = Path(__file__).resolve().parent.parent / "assistant" / "environment.yaml"
    env = yaml.safe_load(path.read_text(encoding="utf-8"))
    net = env["config"]["networking"]
    assert net["type"] == "limited"
    assert not net.get("allowed_hosts") and not net.get("allow_package_managers")
    assert not net.get("allow_mcp_servers")


# --- 4. the turn --------------------------------------------------------------------------


def _runner(log):
    def run(name, args):
        log.append((name, args))
        return "P-aaaaaa works Mondays.", False

    return run


def test_a_custom_tool_is_answered_and_the_turn_ends_at_idle():
    api = FakeAPI()
    api.streams = [FakeStream([
        {"type": "session.status_running", "id": "sevt_r"},
        tool_use("sevt_t1", "get_team"),
        idle("requires_action"),     # waiting on us: NOT the end
        usage(),
        message("P-aaaaaa trabaja los lunes."),
        usage(50, 10),
        idle("end_turn"),
    ])]
    ran = []
    result = svc.run_turn(api, "sesn_1", "hola", _runner(ran), 5, "claude-sonnet-5")
    assert result.stop == "end_turn"
    assert result.text == "P-aaaaaa trabaja los lunes."
    assert ran == [("get_team", {})]
    replies = [e for e in api.sent if e["type"] == "user.custom_tool_result"]
    assert len(replies) == 1 and replies[0]["custom_tool_use_id"] == "sevt_t1"
    assert result.model_requests == 2 and result.input_tokens == 150 and result.output_tokens == 30
    # Stream first, then send.
    assert api.calls[0][0] == "stream" and api.calls[1][0] == "send"


def test_the_usage_of_each_model_request_reaches_the_ledger():
    from app.services import api_usage

    api = FakeAPI()
    api.streams = [FakeStream([usage(10, 1), message("ok"), usage(20, 2), idle("end_turn")])]
    with api_usage.collect() as ledger:
        svc.run_turn(api, "sesn_1", "hola", _runner([]), 5, "claude-sonnet-5")
    assert [(e.purpose, e.input_tokens, e.output_tokens) for e in ledger.entries] == [
        ("assistant.turn", 10, 1),
        ("assistant.turn", 20, 2),
    ]


def test_a_tool_error_is_sent_as_an_error_the_model_can_read():
    api = FakeAPI()
    api.streams = [FakeStream([tool_use("sevt_t1", "get_published_schedule", {"start_date": "x"}),
                               idle("requires_action"), message("no"), idle("end_turn")])]
    people = People(NAMES)
    ctx = tools.ToolContext(org_id=uuid.uuid4(), people=people)
    svc.run_turn(api, "sesn_1", "hola", lambda n, a: tools.run(None, ctx, n, a), 5, "m")
    reply = next(e for e in api.sent if e["type"] == "user.custom_tool_result")
    assert reply["is_error"] is True and "YYYY-MM-DD" in reply["content"][0]["text"]


def test_a_dropped_stream_is_resumed_from_history_without_answering_twice():
    api = FakeAPI()
    api.streams = [
        FakeStream([tool_use("sevt_t1", "get_team")], then="drop"),
        FakeStream([]),  # the reconnect finds the end in history
    ]
    api.history = [
        {"type": "user.message", "id": "sevt_old"},
        message("an answer from an EARLIER turn", "sevt_old_answer"),
        {"type": "user.message", "id": "sevt_msg"},
        tool_use("sevt_t1", "get_team"),
        tool_use("sevt_t2", "get_business_profile"),  # arrived in the gap
        idle("requires_action"),
        message("hecho"),
        idle("end_turn"),
    ]
    ran = []
    result = svc.run_turn(api, "sesn_1", "hola", _runner(ran), 5, "m")
    assert result.stop == "end_turn"
    assert [n for n, _ in ran] == ["get_team", "get_business_profile"]
    assert result.text == "hecho"  # nothing from the earlier turn


def test_the_wall_clock_interrupts_a_session_that_never_answers():
    api = FakeAPI()
    api.streams = [FakeStream([{"type": "session.status_running", "id": "sevt_r"}], then="hang")]
    started = time.monotonic()
    with pytest.raises(svc.TurnTimeout):
        svc.run_turn(api, "sesn_1", "hola", _runner([]), 0.3, "m")
    assert time.monotonic() - started < 5
    assert any(e["type"] == "user.interrupt" for e in api.sent)


def test_a_budget_pause_ends_the_turn():
    api = FakeAPI()
    api.streams = [FakeStream([message("parcial"), idle("budget_reached")])]
    result = svc.run_turn(api, "sesn_1", "hola", _runner([]), 5, "m")
    assert result.stop == "budget_reached" and result.text == "parcial"


# --- 5. memory, without a database -----------------------------------------------------


def test_a_sensitive_line_is_scrubbed_and_its_history_redacted():
    api = FakeAPI()
    people = People(NAMES)
    alias = people.alias(ANA)
    api.put_memory("memstore_x", "mem_1", "Abre a las 8.\n%s cobra 1200 euros al mes.\nLos viernes hay dos más.\n" % alias)
    assert svc.scrub_store(api, "memstore_x", people) == 1
    content = api.stores["memstore_x"]["mem_1"]["content"]
    assert "cobra" not in content and "Abre a las 8." in content and "viernes" in content
    assert "memver_old_mem_1" in api.redacted


def test_a_name_that_reached_memory_is_masked():
    api = FakeAPI()
    people = People(NAMES)
    api.put_memory("memstore_x", "mem_1", "Bea Pons prefiere mañanas.\n")
    svc.scrub_store(api, "memstore_x", people)
    content = api.stores["memstore_x"]["mem_1"]["content"]
    assert "Bea" not in content and people.alias(BEA) in content


def test_a_clean_store_is_left_alone():
    api = FakeAPI()
    api.put_memory("memstore_x", "mem_1", "Abre a las 8.\n")
    assert svc.scrub_store(api, "memstore_x", People(NAMES)) == 0
    assert not any(c[0] == "memories.update" for c in api.calls)


def test_the_manager_reads_names_and_deletes_one_line():
    api = FakeAPI()
    people = People(NAMES)
    api.put_memory("memstore_x", "mem_1", "Abre a las 8.\n- %s prefiere mañanas.\n" % people.alias(ANA))
    lines = svc.list_memories(api, "memstore_x", people)
    assert [l["text"] for l in lines] == ["Abre a las 8.", "Ana García Pérez prefiere mañanas."]
    assert svc.forget_line(api, "memstore_x", lines[1]["id"]) is True
    assert "prefiere" not in api.stores["memstore_x"]["mem_1"]["content"]
    assert "memver_old_mem_1" in api.redacted
    assert svc.forget_line(api, "memstore_x", lines[1]["id"]) is False


def test_deleting_the_last_line_deletes_the_memory_and_all_its_versions():
    api = FakeAPI()
    api.put_memory("memstore_x", "mem_1", "Abre a las 8.\n")
    line = svc.list_memories(api, "memstore_x", People(NAMES))[0]
    svc.forget_line(api, "memstore_x", line["id"])
    assert "mem_1" not in api.stores["memstore_x"]
    assert "memver_old_mem_1" in api.redacted


# --- the database half ----------------------------------------------------------------

from tests.test_business_profile import (  # noqa: E402,F401 - fixtures by name
    _auth,
    _org_session,
    _signup,
    client,
    skip_no_db,
)


@pytest.fixture
def api(monkeypatch):
    fake = FakeAPI()
    monkeypatch.setattr(svc, "client", lambda: fake)
    monkeypatch.setattr(settings, "assistant_enabled", True)
    monkeypatch.setattr(settings, "assistant_agent_id", "agent_test")
    monkeypatch.setattr(settings, "assistant_environment_id", "env_test")
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test-not-real")
    return fake


def _employee(client, token, name):
    res = client.post(
        "/api/v1/employees",
        json={"external_id": None, "full_name": name, "email": None,
              "employment_status": "active", "hire_date": "2026-01-01"},
        headers=_auth(token),
    )
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def _publish(token, employee_id, day: date, start_h=9, end_h=17):
    from sqlalchemy.dialects.postgresql import Range

    from app.models.assignment import Assignment
    from zoneinfo import ZoneInfo

    tz = ZoneInfo("Europe/Madrid")
    db, org_id = _org_session(token)
    try:
        s = datetime(day.year, day.month, day.day, start_h, tzinfo=tz)
        e = datetime(day.year, day.month, day.day, end_h, tzinfo=tz)
        db.add(Assignment(org_id=org_id, employee_id=uuid.UUID(employee_id),
                          during=Range(s, e, bounds="[)"), status="published",
                          source="manual", unpaid_break_minutes=0))
        db.commit()
    finally:
        db.close()


def _start(client, token):
    res = client.post("/api/v1/assistant/conversations", headers=_auth(token))
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _say(client, token, conversation, text):
    return client.post(
        "/api/v1/assistant/conversations/%s/messages" % conversation,
        json={"text": text, "tz": "Europe/Madrid", "language": "es"},
        headers=_auth(token),
    )


@skip_no_db
def test_switched_off_it_does_not_exist_and_calls_nothing(client, monkeypatch):
    fake = FakeAPI()
    monkeypatch.setattr(svc, "client", lambda: fake)
    monkeypatch.setattr(settings, "assistant_enabled", False)
    monkeypatch.setattr(settings, "assistant_agent_id", "agent_test")
    monkeypatch.setattr(settings, "assistant_environment_id", "env_test")
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test-not-real")
    token = _signup(client)
    assert client.get("/api/v1/assistant/status", headers=_auth(token)).json() == {"enabled": False}
    fid = str(uuid.uuid4())
    for method, path in (
        ("POST", "/api/v1/assistant/conversations"),
        ("POST", "/api/v1/assistant/conversations/%s/messages" % fid),
        ("GET", "/api/v1/assistant/memories"),
        ("DELETE", "/api/v1/assistant/memories/mem_1:abc"),
        ("DELETE", "/api/v1/assistant/memories"),
    ):
        res = client.request(method, path, json={"text": "hola"}, headers=_auth(token))
        assert res.status_code == 404, (method, path, res.text)
    assert fake.calls == []


@skip_no_db
def test_on_without_ids_is_off(client, api, monkeypatch):
    monkeypatch.setattr(settings, "assistant_agent_id", "")
    token = _signup(client)
    assert client.get("/api/v1/assistant/status", headers=_auth(token)).json() == {"enabled": False}
    assert client.post("/api/v1/assistant/conversations", headers=_auth(token)).status_code == 404
    assert api.calls == []


@skip_no_db
def test_the_store_is_created_on_first_use_and_reused(client, api):
    token = _signup(client)
    assert client.get("/api/v1/assistant/status", headers=_auth(token)).json() == {"enabled": True}
    assert client.get("/api/v1/assistant/memories", headers=_auth(token)).json() == {"lines": []}
    assert not any(c[0] == "store.create" for c in api.calls)  # looking creates nothing

    first = _start(client, token)
    second = _start(client, token)
    assert [c for c in api.calls if c[0] == "store.create"] == [("store.create", "negocio")]
    mounted = [kw["resources"][0] for kw in api.sessions_created]
    assert mounted[0] == mounted[1]
    assert mounted[0]["type"] == "memory_store" and mounted[0]["access"] == "read_write"
    assert mounted[0]["instructions"]
    assert api.sessions_created[0]["agent"] == "agent_test"
    assert api.sessions_created[0]["environment_id"] == "env_test"
    assert api.sessions_created[0]["budget"]["max_list_cost"]["currency"] == "USD"
    # Starting again closed the first conversation, and deleted it at Anthropic.
    assert api.session_ids[0] in api.deleted_sessions
    res = _say(client, token, first, "hola")
    assert res.status_code == 409 and res.json()["detail"]["code"] == "conversation_closed"
    assert second != first


@skip_no_db
def test_two_businesses_never_share_a_store_or_a_conversation(client, api):
    a, b = _signup(client), _signup(client)
    conv_a = _start(client, a)
    _start(client, b)
    stores = {kw["resources"][0]["memory_store_id"] for kw in api.sessions_created}
    assert len(stores) == 2

    api.streams = [FakeStream([message("no"), idle("end_turn")])]
    res = _say(client, b, conv_a, "¿qué recuerdas?")
    assert res.status_code == 404
    assert not any(e["type"] == "user.message" for e in api.sent)

    store_a = api.sessions_created[0]["resources"][0]["memory_store_id"]
    api.put_memory(store_a, "mem_a", "Secreto de A.\n")
    assert client.get("/api/v1/assistant/memories", headers=_auth(b)).json()["lines"] == []
    line = client.get("/api/v1/assistant/memories", headers=_auth(a)).json()["lines"][0]
    # B deleting A's line id touches B's store, not A's.
    client.delete("/api/v1/assistant/memories/%s" % line["id"], headers=_auth(b))
    assert "mem_a" in api.stores[store_a]


@skip_no_db
def test_no_real_name_reaches_the_api_and_the_answer_has_names(client, api):
    token = _signup(client)
    ana = _employee(client, token, "Ana García Pérez")
    bea = _employee(client, token, "Bea Pons")
    today = date.today()
    _publish(token, ana, today)
    _publish(token, bea, today + timedelta(days=1), 17, 23)
    conv = _start(client, token)

    people = People({ana: "Ana García Pérez", bea: "Bea Pons"})
    api.streams = [FakeStream([
        tool_use("sevt_t1", "get_published_schedule",
                 {"start_date": today.isoformat(), "end_date": (today + timedelta(days=6)).isoformat()}),
        tool_use("sevt_t2", "get_team"),
        tool_use("sevt_t3", "get_business_profile"),
        tool_use("sevt_t4", "get_planner_notes"),
        idle("requires_action"),
        usage(),
        message("%s trabaja hoy y %s mañana por la tarde." % (people.alias(ana), people.alias(bea))),
        usage(),
        idle("end_turn"),
    ])]
    res = _say(client, token, conv, "¿Cuándo trabajan Ana y Bea Pons esta semana?")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["reply"] == "Ana García Pérez trabaja hoy y Bea Pons mañana por la tarde."
    assert body["conversation_open"] is True

    outgoing = " ".join(
        str(e.get("content")) for e in api.sent if e["type"] in ("user.message", "user.custom_tool_result")
    )
    for word in ("Ana", "García", "Garcia", "Bea", "Pons"):
        assert word not in outgoing, word
    assert people.alias(ana) in outgoing and people.alias(bea) in outgoing
    schedule = next(e for e in api.sent if e.get("custom_tool_use_id") == "sevt_t1")
    assert "09:00-17:00" in str(schedule["content"]) and "17:00-23:00" in str(schedule["content"])
    assert not any(e.get("is_error") for e in api.sent if e["type"] == "user.custom_tool_result")


@skip_no_db
def test_a_turn_is_metered_and_counted(client, api):
    from sqlalchemy import text as sql

    token = _signup(client)
    conv = _start(client, token)
    api.streams = [FakeStream([usage(1000, 200), message("hola"), idle("end_turn")])]
    assert _say(client, token, conv, "hola").status_code == 200
    db, org_id = _org_session(token)
    try:
        rows = db.execute(sql("SELECT purpose, input_tokens, output_tokens FROM api_usage "
                              "WHERE org_id = :o"), {"o": str(org_id)}).all()
        assert [tuple(r) for r in rows] == [("assistant.turn", 1000, 200)]
        turns = db.execute(sql("SELECT turns, input_tokens, busy_until FROM assistant_session "
                               "WHERE id = :i"), {"i": conv}).one()
        assert turns[0] == 1 and turns[1] == 1000 and turns[2] is None
    finally:
        db.close()


@skip_no_db
def test_a_timeout_frees_the_conversation(client, api, monkeypatch):
    monkeypatch.setattr(settings, "assistant_turn_timeout_seconds", 0.3)
    token = _signup(client)
    conv = _start(client, token)
    api.streams = [FakeStream([], then="hang")]
    res = _say(client, token, conv, "hola")
    assert res.status_code == 504 and res.json()["detail"]["code"] == "assistant_timeout"
    api.streams = [FakeStream([message("ya"), idle("end_turn")])]
    assert _say(client, token, conv, "otra vez").status_code == 200


@skip_no_db
def test_a_busy_conversation_refuses_a_second_message(client, api):
    token = _signup(client)
    conv = _start(client, token)
    db, org_id = _org_session(token)
    try:
        from sqlalchemy import text as sql

        db.execute(sql("UPDATE assistant_session SET busy_until = now() + interval '1 minute' "
                       "WHERE id = :i"), {"i": conv})
        db.commit()
    finally:
        db.close()
    res = _say(client, token, conv, "hola")
    assert res.status_code == 409 and res.json()["detail"]["code"] == "assistant_busy"


@skip_no_db
def test_what_it_wrote_is_scrubbed_after_the_answer(client, api):
    token = _signup(client)
    conv = _start(client, token)
    store = api.sessions_created[0]["resources"][0]["memory_store_id"]
    api.put_memory(store, "mem_1", "Cierra los lunes.\nP-abcdef está de baja por enfermedad.\n")
    api.streams = [FakeStream([message("apuntado"), idle("end_turn")])]
    assert _say(client, token, conv, "apunta esto").status_code == 200
    assert api.stores[store]["mem_1"]["content"].strip() == "Cierra los lunes."
    lines = client.get("/api/v1/assistant/memories", headers=_auth(token)).json()["lines"]
    assert [l["text"] for l in lines] == ["Cierra los lunes."]


@skip_no_db
def test_forgetting_everything_deletes_the_store_and_the_next_one_is_new(client, api):
    token = _signup(client)
    conv = _start(client, token)
    store = api.sessions_created[0]["resources"][0]["memory_store_id"]
    res = client.delete("/api/v1/assistant/memories", headers=_auth(token))
    assert res.status_code == 200 and res.json() == {"lines": []}
    assert store in api.deleted_stores
    assert _say(client, token, conv, "hola").status_code == 409
    _start(client, token)
    assert api.sessions_created[-1]["resources"][0]["memory_store_id"] != store


@skip_no_db
def test_ending_the_account_deletes_what_is_at_anthropic(client, api):
    token = _signup(client)
    _start(client, token)
    store = api.sessions_created[0]["resources"][0]["memory_store_id"]
    name = client.get("/api/v1/auth/me", headers=_auth(token)).json()["org_name"]
    res = client.request("DELETE", "/api/v1/org", json={"confirm": name}, headers=_auth(token))
    assert res.status_code == 204, res.text
    assert store in api.deleted_stores
    assert api.session_ids[0] in api.deleted_sessions


@skip_no_db
def test_employees_cannot_use_it(client, api):
    token = _signup(client)
    emp = _employee(client, token, "Carla Soler")
    email = "carla+%s@example.com" % uuid.uuid4().hex[:8]
    res = client.post(
        "/api/v1/employees/%s/account" % emp,
        json={"email": email, "password": "s3cret-pass"},
        headers=_auth(token),
    )
    assert res.status_code in (200, 201), res.text
    login = client.post("/api/v1/auth/login", json={"email": email, "password": "s3cret-pass"})
    assert login.status_code == 200, login.text
    staff = login.json()["access_token"]
    assert client.get("/api/v1/assistant/status", headers=_auth(staff)).status_code == 403
    assert client.post("/api/v1/assistant/conversations", headers=_auth(staff)).status_code == 403
    assert api.calls == []


@skip_no_db
def test_a_session_that_fails_to_open_does_not_orphan_the_store(client, api, monkeypatch):
    token = _signup(client)

    def broken(**kw):
        raise RuntimeError("API down")

    monkeypatch.setattr(api.beta.sessions, "create", broken)
    res = client.post("/api/v1/assistant/conversations", headers=_auth(token))
    assert res.status_code == 502 and res.json()["detail"]["code"] == "assistant_unavailable"
    created = [c for c in api.calls if c[0] == "store.create"]
    assert len(created) == 1
    # The store was kept on our side, so it can be listed, forgotten, or
    # deleted with the account -- and the next attempt reuses it.
    monkeypatch.undo()
    fake = FakeAPI()
    monkeypatch.setattr(svc, "client", lambda: fake)
    monkeypatch.setattr(settings, "assistant_enabled", True)
    monkeypatch.setattr(settings, "assistant_agent_id", "agent_test")
    monkeypatch.setattr(settings, "assistant_environment_id", "env_test")
    monkeypatch.setattr(settings, "anthropic_api_key", "sk-test-not-real")
    _start(client, token)
    assert not any(c[0] == "store.create" for c in fake.calls)
