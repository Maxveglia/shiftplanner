"""The planner's notebook: the memory tool's backend, and what it may do.

What this file defends, in the order it could go wrong:

1. The notebook leaks: a path that leaves /memories, a file past the limits,
   one business reading or writing another's notes.
2. A person leaks: a real name reaches the model, or reaches the planner's
   context through a note; an alias from one request is stored and later means
   somebody else.
3. A note governs on its own: anything about a person must become a proposal,
   never a rule, and only lines about the business reach a calendar -- labelled
   as unconfirmed, below the manager, above the internet.
4. It costs the rota or the money: a failure must never touch `/publish`, the
   switch off means no call, and learning off means neither writing nor reading.

The first half needs nothing -- the model is a scripted fake, there is no
network anywhere in this file -- and the second half needs Postgres and skips
itself when there is none.
"""

import json
import re
import uuid
from datetime import date, datetime, time, timedelta
from types import SimpleNamespace

import pytest

from app.config import settings
from app.models.business_profile import BusinessProfile
from app.services import api_usage
from app.services import business_profile as bp
from app.services import hand_edits as he
from app.services import planner_notes as pn
from app.services.planner_notes import Notebook, NotebookError, People

pytestmark = pytest.mark.filterwarnings("ignore")

ANA = "11111111-1111-1111-1111-111111111111"
BEA = "22222222-2222-2222-2222-222222222222"
GONE = "33333333-3333-3333-3333-333333333333"
NAMES = {ANA: "Ana Ruiz", BEA: "Bea Pons", GONE: "Carla Soler"}


def _people(active=(ANA, BEA)):
    return People(active, NAMES)


def _run(nb: Notebook, people: People = None, **command):
    return nb.execute(command, people or _people())


# --- 1. the backend: every command, the limits, the paths ---------------------


@pytest.mark.parametrize(
    "path",
    [
        "/memories/../etc/passwd",
        "/memories/a/../../x",
        "/memories/./a.md",
        "/memories//a.md",
        "/memories/%2e%2e/a.md",
        "/memories\\..\\a.md",
        "/etc/passwd",
        "memories/a.md",
        "/memoriesX/a.md",
        "/memories/.hidden",
        "/memories/a/b/c.md",
        "/memories/a\x00.md",
        "",
        None,
        42,
    ],
)
def test_a_path_that_leaves_the_notebook_is_refused(path):
    with pytest.raises(NotebookError):
        pn.normalize_path(path)


def test_a_plain_path_is_kept_as_written():
    assert pn.normalize_path("/memories/negocio.md") == "/memories/negocio.md"
    assert pn.normalize_path("/memories/") == "/memories"
    assert pn.normalize_path("/memories/sub/x.md/") == "/memories/sub/x.md"


def test_traversal_is_refused_by_every_command_that_takes_a_path():
    nb = Notebook({"/memories/a.md": "uno\n"})
    for cmd in (
        {"command": "view", "path": "/memories/../x"},
        {"command": "create", "path": "/x.md", "file_text": "x"},
        {"command": "str_replace", "path": "/memories/../a.md", "old_str": "uno", "new_str": "x"},
        {"command": "insert", "path": "/.forgotten", "insert_line": 0, "insert_text": "x"},
        {"command": "delete", "path": "/memories/.."},
        {"command": "rename", "old_path": "/memories/a.md", "new_path": "/tmp/a.md"},
    ):
        with pytest.raises(NotebookError):
            nb.execute(cmd, _people())
    assert nb.files == {"/memories/a.md": "uno\n"}


def test_create_then_view_shows_numbered_lines():
    nb = Notebook()
    assert "created" in _run(nb, command="create", path="/memories/negocio.md", file_text="uno\ndos\n")
    out = _run(nb, command="view", path="/memories/negocio.md")
    assert "     1\tuno" in out and "     2\tdos" in out
    ranged = _run(nb, command="view", path="/memories/negocio.md", view_range=[2, 2])
    assert "     2\tdos" in ranged and "uno" not in ranged


def test_view_of_the_root_lists_the_files_and_a_missing_path_is_an_error():
    nb = Notebook({"/memories/a.md": "x", "/memories/sub/b.md": "yy"})
    out = _run(nb, command="view", path="/memories")
    assert "/memories/a.md" in out and "/memories/sub/b.md" in out
    assert "/memories/sub/b.md" in _run(nb, command="view", path="/memories/sub")
    with pytest.raises(NotebookError):
        _run(nb, command="view", path="/memories/nope.md")


def test_str_replace_wants_exactly_one_occurrence():
    nb = Notebook({"/memories/a.md": "lunes\nlunes\nmartes\n"})
    with pytest.raises(NotebookError, match="2 times"):
        _run(nb, command="str_replace", path="/memories/a.md", old_str="lunes", new_str="x")
    with pytest.raises(NotebookError, match="did not appear"):
        _run(nb, command="str_replace", path="/memories/a.md", old_str="jueves", new_str="x")
    _run(nb, command="str_replace", path="/memories/a.md", old_str="martes", new_str="miércoles")
    assert nb.files["/memories/a.md"] == "lunes\nlunes\nmiércoles\n"


def test_insert_puts_a_line_where_it_is_asked_and_checks_the_range():
    nb = Notebook({"/memories/a.md": "uno\ntres\n"})
    _run(nb, command="insert", path="/memories/a.md", insert_line=1, insert_text="dos")
    assert nb.files["/memories/a.md"] == "uno\ndos\ntres\n"
    _run(nb, command="insert", path="/memories/a.md", insert_line=0, insert_text="cero")
    assert nb.files["/memories/a.md"].startswith("cero\n")
    with pytest.raises(NotebookError, match="insert_line"):
        _run(nb, command="insert", path="/memories/a.md", insert_line=99, insert_text="x")


def test_delete_a_file_a_directory_but_never_the_root():
    nb = Notebook({"/memories/a.md": "x", "/memories/sub/b.md": "y", "/memories/sub/c.md": "z"})
    _run(nb, command="delete", path="/memories/sub")
    assert set(nb.files) == {"/memories/a.md"}
    _run(nb, command="delete", path="/memories/a.md")
    assert nb.files == {}
    with pytest.raises(NotebookError):
        _run(nb, command="delete", path="/memories")
    with pytest.raises(NotebookError):
        _run(nb, command="delete", path="/memories/a.md")


def test_rename_moves_a_file_or_a_directory_and_will_not_overwrite():
    nb = Notebook({"/memories/a.md": "x", "/memories/b.md": "y", "/memories/d/c.md": "z"})
    with pytest.raises(NotebookError, match="already exists"):
        _run(nb, command="rename", old_path="/memories/a.md", new_path="/memories/b.md")
    _run(nb, command="rename", old_path="/memories/a.md", new_path="/memories/nuevo.md")
    _run(nb, command="rename", old_path="/memories/d", new_path="/memories/e")
    assert set(nb.files) == {"/memories/nuevo.md", "/memories/b.md", "/memories/e/c.md"}
    with pytest.raises(NotebookError):
        _run(nb, command="rename", old_path="/memories/nope.md", new_path="/memories/z.md")


def test_an_unknown_command_is_an_error_not_a_crash():
    with pytest.raises(NotebookError, match="Unknown command"):
        _run(Notebook(), command="format_disk", path="/memories")


def test_a_file_past_its_size_is_refused_and_nothing_changes():
    nb = Notebook({"/memories/a.md": "uno\n"})
    with pytest.raises(NotebookError, match="at most"):
        _run(nb, command="create", path="/memories/a.md", file_text="x" * (pn.MAX_FILE_BYTES + 1))
    with pytest.raises(NotebookError):
        _run(nb, command="insert", path="/memories/a.md", insert_line=0,
             insert_text="x" * pn.MAX_FILE_BYTES)
    assert nb.files == {"/memories/a.md": "uno\n"}


def test_the_number_of_files_and_the_total_are_capped():
    nb = Notebook({"/memories/f%d.md" % i: "x" for i in range(pn.MAX_FILES)})
    with pytest.raises(NotebookError, match="files"):
        _run(nb, command="create", path="/memories/extra.md", file_text="x")

    big = "y" * (pn.MAX_FILE_BYTES - 10)
    nb = Notebook({"/memories/f%d.md" % i: big for i in range(4)})
    with pytest.raises(NotebookError, match="bytes"):
        _run(nb, command="create", path="/memories/f4.md", file_text=big)
    assert len(nb.files) == 4


# --- 2. people: stable markers in, fresh aliases out --------------------------


def test_what_the_model_writes_with_an_alias_is_stored_with_the_person_id():
    people = _people()
    e_ana = people.alias(ANA)
    nb = Notebook()
    _run(nb, people, command="create", path="/memories/negocio.md",
         file_text="%s abre los lunes.\n" % e_ana)
    stored = nb.files["/memories/negocio.md"]
    assert pn.marker(ANA) in stored
    assert e_ana not in stored


def test_the_same_note_reads_back_under_a_different_request_alias():
    first = People([ANA, BEA], NAMES)
    second = People([BEA, ANA, "00000000-0000-0000-0000-000000000000"], NAMES)
    stored = first.incoming("%s abre los lunes." % first.alias(BEA))
    # A later request coins its aliases in another order; the note must still
    # be about Bea, whatever she is called this time.
    assert second.outgoing(stored) == "%s abre los lunes." % second.alias(BEA)
    assert pn.named(stored, NAMES) == "Bea Pons abre los lunes."


def test_str_replace_finds_a_line_written_under_an_older_alias():
    old = People([ANA, BEA], NAMES)
    nb = Notebook({"/memories/a.md": old.incoming("%s abre.\n" % old.alias(ANA))})
    new = People([BEA, ANA], NAMES)
    _run(nb, new, command="str_replace", path="/memories/a.md",
         old_str="%s abre." % new.alias(ANA), new_str="%s cierra." % new.alias(ANA))
    assert pn.named(nb.files["/memories/a.md"], NAMES) == "Ana Ruiz cierra.\n"


def test_a_real_name_the_model_writes_is_stored_as_a_marker_not_a_name():
    stored = _people().incoming("Ana Ruiz prefiere las mañanas. Bea también.")
    assert "Ana" not in stored and "Bea" not in stored
    assert pn.marker(ANA) in stored and pn.marker(BEA) in stored


def test_an_alias_nobody_holds_is_still_about_a_person():
    stored = _people().incoming("e99 no puede los martes.")
    assert pn.marker(pn.UNKNOWN_ID) in stored
    assert pn.named(stored, NAMES) is None, "no name, no proposal"


def test_what_goes_out_never_carries_a_name_or_an_id():
    people = _people()
    stored = people.incoming("Ana abre; e2 cierra; %s también" % GONE)
    out = people.outgoing(stored + " " + pn.marker(GONE))
    for real in list(NAMES.values()) + [ANA, BEA, GONE]:
        assert real not in out
    for word in ("Ana", "Bea", "Carla"):
        assert word not in out


# --- 3. which lines are notes, and which may apply ------------------------------


def test_only_lines_about_the_business_may_reach_a_calendar():
    files = {
        "/memories/negocio.md": "\n".join(
            [
                "# Notas",
                "- Los viernes por la noche hacen falta tres personas.",
                "%s no hace noches." % pn.marker(ANA),
                "",
                "El sueldo de los fines de semana es más alto.",
                "e1 está de baja por enfermedad.",
                "x" * (pn.MAX_NOTE_CHARS + 1),
                "Los lunes por la mañana basta con dos.",
            ]
        )
    }
    assert pn.business_lines(files) == [
        "Los viernes por la noche hacen falta tres personas.",
        "Los lunes por la mañana basta con dos.",
    ]
    about = [n for n in pn.notes_in(files) if n.about_person]
    assert [n.people for n in about] == [[ANA]]


def test_scrub_drops_what_is_sensitive_and_what_the_manager_deleted():
    content = "Abre a las 8.\nNómina alta en agosto.\nCierra a las 23.\n"
    forgotten = {pn.fingerprint("Cierra a las 23.")}
    assert pn.scrub(content, forgotten) == "Abre a las 8.\n"


def test_planning_context_shows_notes_between_the_manager_and_the_internet():
    profile = BusinessProfile(org_id=uuid.uuid4())
    profile.learning_enabled = True
    profile.house_notes = "Terraza en verano."
    profile.research_notes = "Los bares de playa llenan en agosto."
    text = bp.planning_context(profile, [], ["Los viernes hacen falta tres personas."])
    said = text.index("The manager describes it")
    noticed = text.index("What the planner has NOTICED")
    looked = text.index("What WE looked up")
    assert said < noticed < looked
    assert "NOT confirmed" in text
    # The day notes rank between the two (see test_day_insights.py).
    assert "what the manager said outranks" in text
    assert "outranks what the planner noticed" in text


def test_planning_context_without_notes_is_what_it_always_was():
    profile = BusinessProfile(org_id=uuid.uuid4())
    profile.learning_enabled = True
    profile.house_notes = "Terraza en verano."
    assert "NOTICED" not in bp.planning_context(profile, [])
    assert bp.planning_context(profile, []) == bp.planning_context(profile, [], [])


# --- the loop, with a model that is a script -----------------------------------


class FakeModel:
    """`client.messages.create`, answering from a script. No network.

    ``script`` is a list of functions: each gets the request's keyword
    arguments and returns the list of tool-use inputs to answer with; an empty
    list ends the turn. Every request is kept, so a test can read exactly what
    would have been sent.
    """

    def __init__(self, script):
        self.script = list(script)
        self.requests = []
        self.messages = self

    def create(self, **kwargs):
        self.requests.append(kwargs)
        step = self.script.pop(0) if self.script else (lambda kw: [])
        uses = step(kwargs)
        usage = SimpleNamespace(input_tokens=1000, output_tokens=100,
                                cache_creation_input_tokens=0, cache_read_input_tokens=0)
        if not uses:
            return SimpleNamespace(stop_reason="end_turn", usage=usage,
                                   content=[SimpleNamespace(type="text", text="Sin cambios.")])
        return SimpleNamespace(
            stop_reason="tool_use",
            usage=usage,
            content=[
                SimpleNamespace(type="tool_use", id="tu_%d_%d" % (len(self.requests), i),
                                name="memory", input=u)
                for i, u in enumerate(uses)
            ],
        )

    def sent(self) -> str:
        return json.dumps(self.requests, default=str, ensure_ascii=False)


def _first_alias(kwargs) -> str:
    return re.search(r"\be\d+\b", kwargs["messages"][0]["content"]).group(0)


def test_the_loop_carries_out_commands_and_sends_their_results_back():
    people = _people()
    model = FakeModel(
        [
            lambda kw: [{"command": "view", "path": "/memories"}],
            lambda kw: [{"command": "create", "path": "/memories/negocio.md",
                         "file_text": "Los lunes basta con dos.\n%s abre.\n" % _first_alias(kw)}],
            lambda kw: [],
        ]
    )
    nb = Notebook()
    message = "LO QUE SE HA PUBLICADO\n2027-02-01 lun: %s 08:00-12:00" % people.alias(ANA)
    with api_usage.collect() as ledger:
        result = pn.run_loop(model, nb, people, message)
    assert result.calls == 3
    assert result.stop_reason == "end_turn"
    assert [c[0] for c in result.commands] == ["view", "create"]
    assert pn.named(nb.files["/memories/negocio.md"], NAMES) == "Los lunes basta con dos.\nAna Ruiz abre.\n"
    # Metered, one row per call, under the notes' own purpose.
    assert [e.purpose for e in ledger.entries] == [pn.PURPOSE] * 3
    # The memory tool, the planner's model, low effort, every time.
    for req in model.requests:
        assert req["tools"] == [{"type": "memory_20250818", "name": "memory"}]
        assert req["model"] == pn.MODEL
        assert req["output_config"] == {"effort": "low"}
    # The result of each command went back as a tool_result for its id.
    last = model.requests[-1]["messages"][-1]["content"][0]
    assert last["type"] == "tool_result" and last["tool_use_id"] == "tu_2_0"


def test_a_refused_command_goes_back_as_an_error_the_model_can_read():
    model = FakeModel(
        [
            lambda kw: [{"command": "create", "path": "/etc/passwd", "file_text": "x"}],
            lambda kw: [],
        ]
    )
    nb = Notebook()
    result = pn.run_loop(model, nb, _people(), "hola")
    back = model.requests[1]["messages"][-1]["content"][0]
    assert back["is_error"] is True and "/memories" in back["content"]
    assert result.commands == [("create", "/etc/passwd", False)]
    assert nb.files == {}


def test_the_loop_stops_at_its_ceiling():
    forever = lambda kw: [{"command": "view", "path": "/memories"}]  # noqa: E731
    model = FakeModel([forever] * 50)
    result = pn.run_loop(model, Notebook(), _people(), "hola")
    assert result.calls == pn.MAX_ITERATIONS
    assert len(model.requests) == pn.MAX_ITERATIONS


def test_the_message_names_nobody_and_leaves_out_what_is_private():
    people = _people()
    profile = BusinessProfile(org_id=uuid.uuid4())
    profile.learning_enabled = True
    profile.vertical = "bar"
    profile.vertical_source = "declared"
    profile.house_notes = (
        "Ana Ruiz abre siempre. El sueldo de Bea es más alto. Bea está de baja. "
        "Los viernes se llena."
    )
    profile.interview_notes = "Carla cobra en negro. Abrimos a las 8."
    day = date(2027, 2, 1)
    published = [he.Shift(ANA, day, 480, 720), he.Shift(BEA, day, 1080, 1320)]
    proposed = published + [he.Shift(BEA, day, 480, 720)]
    nb = Notebook({"/memories/negocio.md": people.incoming("Ana abre los lunes.\n")})
    msg = pn.compose_message(profile, published, he.diff(proposed, published), nb, people)
    for real in ("Ana", "Bea", "Carla", ANA, BEA, GONE):
        assert real not in msg
    assert "sueldo" not in msg and "baja" not in msg and "cobra" not in msg
    assert "Los viernes se llena." in msg and "Abrimos a las 8." in msg
    assert "Quitado: 2027-02-01 lun %s 08:00-12:00" % people.alias(BEA) in msg
    assert "%s abre los lunes." % people.alias(ANA) in msg


# --- 4. against the database ------------------------------------------------------


from tests.test_hand_edits import (  # noqa: E402
    MADRID,
    MONDAY,
    _add,
    _as_tenant,
    _auth,
    _planned,
    _publish,
    _signup,
    _trimmed,
    _week,
    skip_no_db,
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def notes_on(monkeypatch):
    monkeypatch.setattr(settings, "planner_notes_enabled", True)
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-never-sent")


def _use(monkeypatch, model):
    monkeypatch.setattr(pn, "_client", lambda: model)


def _no_model(monkeypatch):
    def refuse():
        raise AssertionError("the model must not be called")

    monkeypatch.setattr(pn, "_client", refuse)


BUSINESS = "Los lunes por la mañana basta con una persona."


def _writer(kw):
    alias = _first_alias(kw)
    return [
        {
            "command": "create",
            "path": "/memories/negocio.md",
            "file_text": "%s\n%s no hace el turno de tarde.\n" % (BUSINESS, alias),
        }
    ]


def _team(client, token):
    return {k: _add(client, token, n) for k, n in
            (("ana", "Ana Ruiz"), ("bea", "Bea Pons"), ("carla", "Carla Soler"))}


def _month(ids):
    return [he.Shift(ids[s.employee_id], s.day, s.start, s.end) for s in _week(MONDAY, weeks=4)]


def _files(org_id):
    from sqlalchemy import select

    from app.models.business_memory_file import BusinessMemoryFile

    return _as_tenant(
        org_id,
        lambda db: {
            r.path: r.content
            for r in db.execute(select(BusinessMemoryFile)).scalars()
        },
    )


def _setup(client):
    token, org_id = _signup(client)
    ids = _team(client, token)
    proposal = _month(ids)
    _planned(org_id, "2027-02", proposal)
    return token, org_id, ids, proposal


@skip_no_db
def test_after_a_publish_business_notes_apply_and_person_notes_are_only_proposed(
    client, monkeypatch, notes_on
):
    token, org_id, ids, proposal = _setup(client)
    model = FakeModel([_writer, lambda kw: []])
    _use(monkeypatch, model)

    body = _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert body["published"] > 0

    # Nothing that names anybody was sent.
    sent = model.sent()
    for real in ("Ana Ruiz", "Bea Pons", "Carla Soler", "Ana", "Bea", "Carla", *ids.values()):
        assert real not in sent
    # The retouch was shown to it.
    assert "Quitado:" in sent

    stored = _files(org_id)["/memories/negocio.md"]
    assert BUSINESS in stored
    assert "⟦persona:" in stored, "a person is stored by id, not by alias"

    # The person note is a proposal, inert, with the real name for the manager.
    hints = {h["key"]: h for h in client.get("/api/v1/profile", headers=_auth(token)).json()["hints"]}
    notes = [h for k, h in hints.items() if k.startswith(pn.NOTES_PREFIX)]
    assert len(notes) == 1
    [note] = notes
    assert note["accepted"] is False and note["active"] is False
    assert note["value"]["source"] == "planner_notes"
    assert "no hace el turno de tarde" in note["value"]["text"]
    assert any(n in note["value"]["text"] for n in ("Ana Ruiz", "Bea Pons", "Carla Soler"))

    # The business note reaches the planner's context; the person note does not.
    def context(db):
        profile = bp.get_or_create(db, org_id)
        return bp.planning_context(
            profile, bp.hints_for(db, org_id), pn.business_notes(db, org_id, profile)
        )

    text = _as_tenant(org_id, context)
    assert BUSINESS.rstrip(".") in text
    assert "no hace el turno de tarde" not in text
    for real in ("Ana", "Bea", "Carla"):
        assert real not in text

    # And it was metered under its own purpose.
    from sqlalchemy import select

    from app.models.api_usage import ApiUsage

    purposes = _as_tenant(org_id, lambda db: list(db.execute(select(ApiUsage.purpose)).scalars()))
    assert purposes.count(pn.PURPOSE) == 2


@skip_no_db
def test_the_switch_off_means_no_call_and_no_notes_in_the_context(client, monkeypatch):
    monkeypatch.setattr(settings, "planner_notes_enabled", False)
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-never-sent")
    token, org_id, ids, proposal = _setup(client)
    _no_model(monkeypatch)
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert _files(org_id) == {}

    # Even a notebook that exists is not read while the switch is off.
    from app.models.business_memory_file import BusinessMemoryFile

    def seed(db):
        db.add(BusinessMemoryFile(org_id=org_id, path="/memories/negocio.md", content=BUSINESS))
        db.flush()

    _as_tenant(org_id, seed)
    assert _as_tenant(org_id, lambda db: pn.business_notes(db, org_id)) == []


@skip_no_db
def test_learning_off_means_neither_writing_nor_reading(client, monkeypatch, notes_on):
    token, org_id, ids, proposal = _setup(client)
    off = client.put("/api/v1/profile", headers=_auth(token), json={"learning_enabled": False})
    assert off.status_code == 200, off.text
    _no_model(monkeypatch)
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert _files(org_id) == {}

    from app.models.business_memory_file import BusinessMemoryFile

    def seed(db):
        db.add(BusinessMemoryFile(org_id=org_id, path="/memories/negocio.md", content=BUSINESS))
        db.flush()

    _as_tenant(org_id, seed)
    assert _as_tenant(org_id, lambda db: pn.business_notes(db, org_id)) == []
    got = client.get("/api/v1/profile/notes", headers=_auth(token)).json()
    assert got["enabled"] is False
    assert [n["text"] for n in got["notes"]] == [BUSINESS], "still visible, still deletable"


@skip_no_db
def test_a_model_that_breaks_does_not_break_the_publish(client, monkeypatch, notes_on):
    token, org_id, ids, proposal = _setup(client)

    class Broken:
        messages = None

        def __getattr__(self, name):
            raise RuntimeError("the provider is having a bad day")

    _use(monkeypatch, Broken())
    body = _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert body["published"] == len(_trimmed(proposal, ids["bea"]))
    # No notes -- only the record that this period's pass was spent, so a
    # republish today does not pay for a second one.
    assert set(_files(org_id)) == {pn.RUNS_PATH}


@skip_no_db
def test_a_notebook_that_cannot_be_saved_does_not_break_the_publish(client, monkeypatch, notes_on):
    token, org_id, ids, proposal = _setup(client)
    _use(monkeypatch, FakeModel([_writer, lambda kw: []]))

    def explode(*_a, **_k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(pn, "save", explode)
    body = _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert body["published"] > 0


@skip_no_db
def test_the_manager_sees_every_note_and_a_deleted_one_does_not_come_back(
    client, monkeypatch, notes_on
):
    token, org_id, ids, proposal = _setup(client)
    _use(monkeypatch, FakeModel([_writer, lambda kw: []]))
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))

    got = client.get("/api/v1/profile/notes", headers=_auth(token))
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["enabled"] is True
    texts = {n["text"]: n for n in body["notes"]}
    assert BUSINESS in texts
    person = [n for n in body["notes"] if n["about_person"]]
    assert len(person) == 1 and "⟦" not in person[0]["text"], "the manager reads a name"

    gone = client.delete("/api/v1/profile/notes/%s" % texts[BUSINESS]["id"], headers=_auth(token))
    assert gone.status_code == 200, gone.text
    assert BUSINESS not in {n["text"] for n in gone.json()["notes"]}

    # The planner writes the same sentence again the next day: it is dropped.
    # (A day later, so the once-a-day guard lets the call through.)
    monkeypatch.setattr(pn, "RECENT_RUN_WINDOW", timedelta(0))
    _use(monkeypatch, FakeModel([_writer, lambda kw: []]))
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert BUSINESS not in _files(org_id).get("/memories/negocio.md", "")

    # Deleting everything empties the notebook.
    wiped = client.delete("/api/v1/profile/notes", headers=_auth(token))
    assert wiped.status_code == 200 and wiped.json()["notes"] == []
    # And a note that is already gone is not an error.
    again = client.delete("/api/v1/profile/notes/%s" % texts[BUSINESS]["id"], headers=_auth(token))
    assert again.status_code == 200


@skip_no_db
def test_republishing_the_same_period_the_same_day_does_not_call_again(
    client, monkeypatch, notes_on
):
    token, org_id, ids, proposal = _setup(client)
    model = FakeModel([_writer, lambda kw: []])
    _use(monkeypatch, model)
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert len(model.requests) == 2

    # The typo fix: the whole month again, and one week of it.
    _no_model(monkeypatch)
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    week = [s for s in proposal if s.day < MONDAY + timedelta(days=7)]
    _publish(client, token, MONDAY + timedelta(days=7), 7,
             [s for s in _trimmed(proposal, ids["bea"])
              if MONDAY + timedelta(days=7) <= s.day < MONDAY + timedelta(days=14)])
    assert week  # the helper data is what we think it is

    # A period that does not overlap is noted at once.
    march = [he.Shift(s.employee_id, s.day + timedelta(days=28), s.start, s.end)
             for s in proposal]
    other = FakeModel([lambda kw: []])
    _use(monkeypatch, other)
    _publish(client, token, MONDAY + timedelta(days=28), 28, march)
    assert len(other.requests) == 1


@skip_no_db
def test_the_same_period_is_noted_again_once_the_window_has_passed(client, monkeypatch, notes_on):
    from datetime import timezone

    token, org_id, ids, proposal = _setup(client)
    start = datetime.combine(MONDAY, time.min, tzinfo=MADRID)
    end = start + timedelta(days=28)
    long_ago = datetime.now(timezone.utc) - pn.RECENT_RUN_WINDOW - timedelta(minutes=1)
    _as_tenant(org_id, lambda db: pn.claim_run(db, org_id, start, end, now=long_ago))
    assert not _as_tenant(org_id, lambda db: pn.noted_recently(db, org_id, start, end))

    model = FakeModel([lambda kw: []])
    _use(monkeypatch, model)
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert len(model.requests) == 1
    assert _as_tenant(org_id, lambda db: pn.noted_recently(db, org_id, start, end))
    # The stale line was dropped when the new one was written, and the
    # bookkeeping row is never part of the notebook the model sees.
    assert len(_as_tenant(org_id, lambda db: pn._runs(db, org_id))) == 1
    assert pn.RUNS_PATH not in _as_tenant(org_id, lambda db: pn.load(db, org_id)[0].files)


@skip_no_db
def test_nobody_without_a_session_reads_the_notes(client):
    token, org_id = _signup(client)
    resp = client.get("/api/v1/profile/notes")
    assert resp.status_code in (401, 403)


@skip_no_db
def test_one_business_cannot_read_or_write_anothers_notebook(client, monkeypatch, notes_on):
    from sqlalchemy import select

    from app.models.business_memory_file import BusinessMemoryFile

    token, org_id, ids, proposal = _setup(client)
    _use(monkeypatch, FakeModel([_writer, lambda kw: []]))
    _publish(client, token, MONDAY, 28, _trimmed(proposal, ids["bea"]))
    assert _files(org_id), "the owner sees its own notebook"

    other_token, other = _signup(client)
    assert _files(other) == {}
    assert _as_tenant(other, lambda db: pn.load(db, org_id)[0].files) == {}
    assert client.get("/api/v1/profile/notes", headers=_auth(other_token)).json()["notes"] == []

    def smuggle(db):
        db.add(BusinessMemoryFile(org_id=org_id, path="/memories/x.md", content="hola"))
        db.flush()

    with pytest.raises(Exception):
        _as_tenant(other, smuggle)

    # A save from the other org's session cannot touch the owner's rows.
    def overwrite(db):
        return pn.save(db, org_id, {}, {"/memories/negocio.md": "robado"})

    try:
        _as_tenant(other, overwrite)
    except Exception:
        pass
    assert "robado" not in _files(org_id).get("/memories/negocio.md", "")


@skip_no_db
def test_the_migration_has_one_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    import os

    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option(
        "script_location", os.path.join(os.path.dirname(__file__), "..", "alembic")
    )
    heads = ScriptDirectory.from_config(cfg).get_heads()
    assert heads == ["0046_access_roles"]
