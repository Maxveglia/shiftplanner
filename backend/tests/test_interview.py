"""The opening interview: what is asked, what is never asked, what comes back.

Nothing here reaches Gemini. The HTTP call is one injectable function, so the
instruction, the transcript shape and the parse are pinned without a key --
and the one property that matters most, that no request ever carries a
person's details, is checked on the text that would be sent.
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone

import pytest

from app.services import interview as svc


def test_the_instruction_asks_for_names_and_hours_and_nothing_else_personal():
    """The line moved on 2026-09-14; it did not disappear.

    Names and contract hours are asked for now, because the roster cannot be
    built without them. Everything else about a person is still out, and this
    is the test that says so if someone widens the topic list again.
    """
    text = build = svc.build_system_instruction("es")
    assert "the name each one is called by" in text
    assert "how many hours a week" in text
    assert "Never ask about" in text
    for forbidden in ("age", "health", "pay", "address", "family"):
        assert forbidden in text
    assert "Spanish" in build


def test_the_topics_ask_who_works_there_and_nothing_else_about_them():
    joined = " ".join(svc.TOPICS).lower()
    assert "who those people are" in joined
    assert "contract is for" in joined
    for word in ("salary", "age", "health", "address"):
        assert word not in joined


def test_the_headcount_is_asked_before_the_names():
    """The table is built from the number, so the number has to come first."""
    how_many = next(i for i, t in enumerate(svc.TOPICS) if "how many people" in t.lower())
    who = next(i for i, t in enumerate(svc.TOPICS) if "who those people are" in t.lower())
    at_once = next(i for i, t in enumerate(svc.TOPICS) if "same time" in t.lower())
    assert how_many < at_once < who
    assert who == len(svc.TOPICS) - 1


@pytest.mark.parametrize("language", ["es", "en"])
@pytest.mark.parametrize("finish", [False, True])
def test_the_first_month_comes_from_a_form_and_stays_out_of_the_brief(language, finish):
    """The month is chosen with buttons and handed over apart from the brief.

    The brief is kept as `interview_notes` and read again before every later
    calendar, so a month written into it would steer every one of them to the
    same month. The rule sits beside the brief instructions and holds on the
    turn that stops early, which is the turn most likely to write one.
    """
    text = svc.build_system_instruction(language, finish=finish)
    assert "The month of the first calendar was chosen in a form" in text
    assert "Never ask which month, dates or period to plan" in text
    assert "NEVER PUT THAT MONTH, OR THE DAYS OF IT BEING PLANNED, IN THE BRIEF" in text
    assert "a holiday it closes" in text
    assert "never the month or dates of the first calendar" in text
    # The form's rule comes before the brief is described, as the hours' does.
    assert text.index("chosen in a form") < text.index("write the brief:")


def test_an_empty_transcript_is_the_opening_turn():
    contents = svc.to_contents([])
    assert len(contents) == 1
    assert contents[0]["role"] == "user"


def test_the_transcript_ends_on_the_managers_turn():
    msgs = [
        svc.InterviewMessage(role="assistant", text="¿Qué horario tenéis?"),
        svc.InterviewMessage(role="manager", text="De 18 a 3"),
        svc.InterviewMessage(role="assistant", text="¿Cerráis algún día?"),
    ]
    contents = svc.to_contents(msgs)
    assert [c["role"] for c in contents] == ["model", "user", "model", "user"]
    assert contents[1]["parts"][0]["text"] == "De 18 a 3"


def test_a_finished_turn_carries_the_brief_and_an_unfinished_one_does_not():
    done = svc.parse_turn(
        json.dumps({"reply": "Listo", "done": True, "brief": " Tengo un bar... "})
    )
    assert done.done and done.brief == "Tengo un bar..."
    asking = svc.parse_turn(
        json.dumps({"reply": "¿Y los domingos?", "done": False, "brief": "draft"})
    )
    assert not asking.done and asking.brief is None


def test_only_what_the_manager_typed_is_sent():
    """The request is the instruction plus the transcript: no roster, no org."""
    seen = {}

    def fake(req, api_key, model):
        seen["req"] = req
        return json.dumps({"reply": "¿Quiénes trabajan aquí?", "done": False, "brief": "", "form": "roster"})

    turn = svc.next_turn(
        [svc.InterviewMessage(role="manager", text="Un bar de 18 a 3")],
        "es",
        "key",
        "gemini-test",
        call=fake,
    )
    assert turn.reply == "¿Quiénes trabajan aquí?"
    assert turn.form == "roster"
    sent = json.dumps(seen["req"].contents)
    assert "Un bar de 18 a 3" in sent
    assert "EMP-" not in sent and "@" not in sent


def test_asking_to_finish_ends_it_even_if_the_model_wanted_more():
    def fake(req, api_key, model):
        assert "ASKED TO STOP NOW" in req.system_instruction
        return json.dumps({"reply": "¿Algo más?", "done": False, "brief": "Abro de 18 a 3."})

    turn = svc.next_turn([], "en", "key", "m", finish=True, call=fake)
    assert turn.done is True
    assert turn.brief == "Abro de 18 a 3."


@pytest.mark.parametrize("language,word", [("es", "Spanish"), ("en", "English")])
def test_it_speaks_the_managers_language(language, word):
    assert word in svc.build_system_instruction(language)


def test_the_example_brief_is_written_in_the_language_being_spoken():
    """The example is the instruction, whatever the sentence above it says.

    An English interview used to be shown a Spanish paragraph as the model of
    what a brief looks like, under a line asking for "the manager's language".
    It asked its questions in English and closed in Spanish often enough to be
    a bug. Both halves are pinned here because fixing one and not the other
    puts it straight back.
    """
    english = svc.build_system_instruction("en")
    assert svc.BRIEF_EXAMPLES["en"] in english
    assert svc.BRIEF_EXAMPLES["es"] not in english
    assert "Tengo un bar" not in english
    assert "in English, saying only what they told you" in english

    spanish = svc.build_system_instruction("es")
    assert svc.BRIEF_EXAMPLES["es"] in spanish
    assert svc.BRIEF_EXAMPLES["en"] not in spanish
    assert "in Spanish, saying only what they told you" in spanish


@pytest.mark.parametrize("language", ["es", "en"])
def test_the_language_holds_whatever_the_manager_answers_in(language):
    """The chosen language is the interview's, not the transcript's.

    A manager reading the product in English, typing back in Spanish, with a
    team called Ana and Luis, gives the model three reasons to switch. It must
    not: the brief is shown, stored and edited in the language the interface
    speaks.
    """
    text = svc.build_system_instruction(language)
    assert "EVERY WORD YOU WRITE IS IN %s" % svc.LANGUAGE_NAMES[language].upper() in text
    assert "even when they answer you in another one" in text


def test_a_busy_free_tier_is_tried_again_and_a_real_error_is_not(monkeypatch):
    import io
    import urllib.error
    import urllib.request

    calls = {"n": 0}
    waits = []

    def flaky(req, timeout):
        calls["n"] += 1
        if calls["n"] < 3:
            raise urllib.error.HTTPError(
                req.full_url, 503, "busy", {}, io.BytesIO(b'{"error":"high demand"}')
            )

        class R(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return R(b'{"ok": true}')

    monkeypatch.setattr(urllib.request, "urlopen", flaky)
    req = urllib.request.Request("https://example.test", data=b"{}", method="POST")
    assert svc._post_with_retries(req, sleep=waits.append) == {"ok": True}
    assert calls["n"] == 3 and waits == list(svc.RETRY_WAITS_S[:2])

    def broken(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 400, "bad", {}, io.BytesIO(b"nope"))

    monkeypatch.setattr(urllib.request, "urlopen", broken)
    with pytest.raises(RuntimeError, match="400"):
        svc._post_with_retries(req, sleep=waits.append)


# --- What the interview leaves behind ---------------------------------------
#
# The interview used to end in a brief that was used once and forgotten. Now
# the approved paragraph is kept on the business profile and reaches both
# models as background, so the second brief starts from a business the
# planner already knows. These tests are about that memory: that it is
# written, that it is labelled as the interview's, and that skipping closes
# the first run without inventing anything.

import uuid

from app.models.business_profile import BusinessProfile
from app.services import business_profile as bp


def _profile(**kw) -> BusinessProfile:
    return BusinessProfile(org_id=uuid.uuid4(), learning_enabled=True, **kw)


def test_interview_notes_reach_the_intake_as_background():
    ctx = bp.model_context(_profile(interview_notes="Tengo un bar en Valencia."), [])
    assert "In the opening interview the manager said: Tengo un bar en Valencia." in ctx
    assert "NOT a requirement" in ctx, "the intake block must still disclaim itself"


def test_interview_notes_reach_the_planner_too():
    ctx = bp.planning_context(_profile(interview_notes="Cerramos los lunes."), [])
    assert "In the opening interview the manager said: Cerramos los lunes." in ctx


def test_interview_notes_are_not_mistaken_for_typed_notes():
    """Two provenances, two labels: a paraphrase must not read as dictation."""
    ctx = bp.model_context(
        _profile(house_notes="Somos un bar de tapas.", interview_notes="Abrimos a las 12."),
        [],
    )
    assert "The manager describes it: Somos un bar de tapas." in ctx
    assert "In the opening interview the manager said: Abrimos a las 12." in ctx


def test_switching_learning_off_silences_the_interview_as_well():
    p = _profile(interview_notes="Cerramos los lunes.")
    p.learning_enabled = False
    assert bp.model_context(p, []) == ""
    assert bp.planning_context(p, []) == ""


def _db_available() -> bool:
    try:
        from sqlalchemy import text

        from app.db import app_engine

        with app_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


skip_no_db = pytest.mark.skipif(
    not _db_available(),
    reason="No Postgres reachable. Start it and run `alembic upgrade head`.",
)


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


def _signup(client) -> str:
    resp = client.post(
        "/api/v1/auth/signup",
        json={
            "org_name": "Interviewed Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": "Bearer " + token}


@skip_no_db
def test_completing_the_interview_is_remembered_and_closes_the_first_run(client):
    token = _signup(client)
    before = client.get("/api/v1/profile", headers=_auth(token)).json()
    assert before["first_run_pending"] is True
    assert before["interview_notes"] is None

    resp = client.post(
        "/api/v1/interview/complete",
        json={"notes": "  Tengo un bar en Valencia, abrimos de 12 a 24.  "},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"remembered": True, "hours_declared": 0}

    after = client.get("/api/v1/profile", headers=_auth(token)).json()
    assert after["interview_notes"] == "Tengo un bar en Valencia, abrimos de 12 a 24."
    assert after["interviewed_at"] is not None
    assert after["first_run_pending"] is False


@skip_no_db
def test_skipping_the_interview_closes_the_first_run_and_remembers_nothing(client):
    token = _signup(client)
    resp = client.post("/api/v1/interview/complete", json={"notes": ""}, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"remembered": False, "hours_declared": 0}

    after = client.get("/api/v1/profile", headers=_auth(token)).json()
    assert after["interview_notes"] is None
    assert after["interviewed_at"] is None
    assert after["first_run_pending"] is False


@skip_no_db
def test_the_manager_can_correct_what_the_interview_kept(client):
    token = _signup(client)
    client.post("/api/v1/interview/complete", json={"notes": "Abrimos a las 12."}, headers=_auth(token))
    resp = client.put(
        "/api/v1/profile",
        json={"interview_notes": "Abrimos a las 13."},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["interview_notes"] == "Abrimos a las 13."


# --- The week from the form, and the research after ------------------------


@skip_no_db
def test_the_weeks_hours_from_the_form_are_declared_day_by_day(client):
    from tests.test_business_profile import _org_session

    token = _signup(client)
    resp = client.post(
        "/api/v1/interview/complete",
        json={
            "notes": "Tengo una tienda.",
            "open_hours": {"1": [540, 1200], "6": [600, 900], "0": None},
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"remembered": True, "hours_declared": 3}

    db, org_id = _org_session(token)
    try:
        profile = bp.get_or_create(db, org_id)
        assert bp.declared_day_hours(profile) == {1: [540, 1200], 6: [600, 900]}
        assert bp.declared_rules(profile)["closed_weekday:0"] == {"closed": True, "weekday": 0}
    finally:
        db.close()


@skip_no_db
def test_an_impossible_week_is_a_422_and_declares_nothing(client):
    token = _signup(client)
    resp = client.post(
        "/api/v1/interview/complete",
        json={"notes": "", "open_hours": {"1": [1200, 540]}},
        headers=_auth(token),
    )
    assert resp.status_code == 422, resp.text


@skip_no_db
def test_research_is_kept_as_ours_and_dated(client, monkeypatch):
    from app.config import settings
    from app.services import research as research_svc

    token = _signup(client)
    client.post(
        "/api/v1/interview/complete",
        json={"notes": "Tengo un bar en el Raval de Barcelona."},
        headers=_auth(token),
    )
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    seen = {}

    def fake(inp, api_key, model, call=None):
        seen["inp"], seen["model"] = inp, model
        return research_svc.ResearchResult(
            summary="Los bares del Raval llenan de jueves a sábado.",
            sources=[research_svc.Source(title="barcelona.cat", url="https://r/1")],
        )

    monkeypatch.setattr(research_svc, "research", fake)
    resp = client.post(
        "/api/v1/interview/research", json={"language": "es"}, headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"].startswith("Los bares del Raval")
    assert body["sources"] == [{"title": "barcelona.cat", "url": "https://r/1"}]
    assert body["researched_at"]
    assert seen["inp"].notes == "Tengo un bar en el Raval de Barcelona."
    assert seen["inp"].language == "es"
    assert seen["model"] == settings.gemini_research_model

    after = client.get("/api/v1/profile", headers=_auth(token)).json()
    assert after["research_notes"] == (
        "Los bares del Raval llenan de jueves a sábado.\n\nSources: barcelona.cat"
    )
    assert after["researched_at"] is not None
    # Theirs is untouched: the research did not become something they said.
    assert after["interview_notes"] == "Tengo un bar en el Raval de Barcelona."

    # And the manager can strike it out.
    resp = client.put("/api/v1/profile", json={"research_notes": ""}, headers=_auth(token))
    assert resp.status_code == 200, resp.text
    assert resp.json()["research_notes"] is None


@skip_no_db
def test_research_with_nothing_known_is_refused(client, monkeypatch):
    from app.config import settings

    token = _signup(client)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    resp = client.post("/api/v1/interview/research", json={}, headers=_auth(token))
    assert resp.status_code == 409, resp.text


@skip_no_db
def test_research_without_a_key_is_a_503(client, monkeypatch):
    from app.config import settings

    token = _signup(client)
    monkeypatch.setattr(settings, "gemini_api_key", "")
    resp = client.post("/api/v1/interview/research", json={}, headers=_auth(token))
    assert resp.status_code == 503


def test_the_form_is_a_code_from_the_model_and_an_unknown_one_is_ignored():
    """A form is served or it is not; nothing is inferred from the words.

    An older model that never sets the field, and a newer one that asks for a
    form this client does not have, must both leave the manager with the text
    box they were going to type into.
    """
    asked = svc.parse_turn(
        json.dumps(
            {"reply": "¿Quién trabaja aquí?", "done": False, "brief": "", "form": "roster"}
        )
    )
    assert asked.form == "roster"

    unknown = svc.parse_turn(
        json.dumps({"reply": "¿Y los domingos?", "done": False, "brief": "", "form": "payroll"})
    )
    assert unknown.form is None

    silent = svc.parse_turn(json.dumps({"reply": "¿Y los domingos?", "done": False}))
    assert silent.form is None


def test_a_finished_interview_has_nothing_left_to_fill_in():
    """The brief is the end of it: a form under the closing line answers nothing."""
    turn = svc.parse_turn(
        json.dumps(
            {"reply": "Listo", "done": True, "brief": "Tengo un bar.", "form": "roster"}
        )
    )
    assert turn.done and turn.form is None


def test_the_table_opens_with_a_row_for_each_person_the_manager_counted():
    """The headcount they already gave becomes the rows, within reason."""
    turn = svc.parse_turn(
        json.dumps(
            {"reply": "¿Quién trabaja aquí?", "done": False, "brief": "",
             "form": "roster", "formPeople": 6}
        )
    )
    assert turn.form_people == 6

    # Never said, or a number nobody staffs a rota with: one empty row, which
    # is what the client does with None. Forty rows to delete is worse than
    # one to fill in, and "40 horas" misread as forty people is how you get
    # there.
    for said in (0, -2, 400, "six", True, None):
        turn = svc.parse_turn(
            json.dumps(
                {"reply": "¿Quién?", "done": False, "brief": "",
                 "form": "roster", "formPeople": said}
            )
        )
        assert turn.form_people is None

    # And it means nothing without the form it belongs to.
    plain = svc.parse_turn(
        json.dumps({"reply": "¿Y los domingos?", "done": False, "brief": "",
                    "form": "none", "formPeople": 4})
    )
    assert plain.form is None and plain.form_people is None


@skip_no_db
def test_a_second_interview_replaces_the_first_whole(client):
    """Including the research, which is the part nobody would think of.

    A bar that becomes a shop keeps its staff and its calendars -- those are
    facts, not answers -- but everything the LAST round of questions produced
    is about a business that no longer exists. The notes and the week already
    replaced themselves; `research_notes` did not, and it is filed as
    something we know rather than something they said, so every later brief
    was read with a paragraph about bars in mind.
    """
    token = _signup(client)

    first = client.post(
        "/api/v1/interview/complete",
        json={"notes": "Tengo un bar en Gràcia, abrimos de noche."},
        headers=_auth(token),
    )
    assert first.status_code == 200, first.text

    # Stand in for a research pass having run against those first answers.
    from app.db import AdminSessionLocal
    from app.models.business_profile import BusinessProfile
    from sqlalchemy import select

    org_id = client.get("/api/v1/auth/me", headers=_auth(token)).json()["org_id"]
    db = AdminSessionLocal()
    try:
        profile = db.execute(
            select(BusinessProfile).where(BusinessProfile.org_id == org_id)
        ).scalar_one()
        profile.research_notes = "Los bares de Gràcia cierran tarde y..."
        profile.researched_at = datetime.now(timezone.utc)
        db.add(profile)
        db.commit()
    finally:
        db.close()

    assert client.get("/api/v1/profile", headers=_auth(token)).json()["research_notes"]

    second = client.post(
        "/api/v1/interview/complete",
        json={"notes": "Ahora es una tienda de ropa, abrimos de 10 a 20."},
        headers=_auth(token),
    )
    assert second.status_code == 200, second.text

    after = client.get("/api/v1/profile", headers=_auth(token)).json()
    assert after["interview_notes"].startswith("Ahora es una tienda")
    assert after["research_notes"] is None
    assert after["researched_at"] is None


@skip_no_db
def test_skipping_changes_nothing_that_was_already_answered(client):
    """A skip is not an answer, so it erases nothing."""
    token = _signup(client)
    client.post(
        "/api/v1/interview/complete",
        json={"notes": "Tengo un bar."},
        headers=_auth(token),
    )
    skipped = client.post(
        "/api/v1/interview/complete", json={"notes": ""}, headers=_auth(token)
    )
    assert skipped.status_code == 200
    after = client.get("/api/v1/profile", headers=_auth(token)).json()
    assert after["interview_notes"] == "Tengo un bar."


# --- A turn has a deadline --------------------------------------------------
#
# The browser gives up on a turn after INTERVIEW_TURN_TIMEOUT_MS. Before the
# deadline, one slow try plus a retry outlived it: the manager saw "timeout
# of 30000ms exceeded" while the server was still waiting on Gemini. These
# run on a fake clock that the fake urlopen and the fake sleep both advance.


class _Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, s):
        self.now += s


def test_a_slow_turn_gives_up_inside_the_deadline(monkeypatch):
    clock = _Clock()
    timeouts = []

    def slow(req, timeout):
        timeouts.append(timeout)
        clock.now += timeout
        raise TimeoutError("timed out")

    monkeypatch.setattr(urllib.request, "urlopen", slow)
    req = urllib.request.Request("https://example.test", data=b"{}", method="POST")
    with pytest.raises(RuntimeError, match="did not answer in time"):
        svc._post_with_retries(
            req, sleep=clock.sleep, deadline_s=svc.TURN_DEADLINE_S, clock=clock
        )
    assert clock.now <= svc.TURN_DEADLINE_S
    assert len(timeouts) == 2, "one retry fits, a third try would not"


def test_the_last_try_gets_only_what_is_left(monkeypatch):
    clock = _Clock()
    timeouts = []

    def slow(req, timeout):
        timeouts.append(timeout)
        clock.now += timeout
        raise TimeoutError("timed out")

    monkeypatch.setattr(urllib.request, "urlopen", slow)
    req = urllib.request.Request("https://example.test", data=b"{}", method="POST")
    with pytest.raises(RuntimeError):
        svc._post_with_retries(
            req, sleep=clock.sleep, timeout=20, deadline_s=30, clock=clock
        )
    assert timeouts == [20, 30 - 20 - svc.RETRY_WAITS_S[0]]
    assert clock.now == 30


def test_a_timeout_while_connecting_is_retried_too(monkeypatch):
    calls = {"n": 0}

    class R(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def connect_timeout(req, timeout):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.URLError(TimeoutError("timed out"))
        return R(b'{"ok": true}')

    monkeypatch.setattr(urllib.request, "urlopen", connect_timeout)
    req = urllib.request.Request("https://example.test", data=b"{}", method="POST")
    assert svc._post_with_retries(req, sleep=lambda s: None) == {"ok": True}
    assert calls["n"] == 2


def test_every_failed_try_is_logged_without_the_key(monkeypatch, caplog):
    def busy(req, timeout):
        raise urllib.error.HTTPError(
            req.full_url, 503, "busy", {}, io.BytesIO(b'{"error":"high demand"}')
        )

    monkeypatch.setattr(urllib.request, "urlopen", busy)
    req = urllib.request.Request(
        "https://example.test/v1beta/models/m:generateContent?key=SECRET",
        data=b"{}",
        method="POST",
    )
    with caplog.at_level("WARNING", logger=svc.logger.name):
        with pytest.raises(RuntimeError, match="503"):
            svc._post_with_retries(req, sleep=lambda s: None)
    tries = [r for r in caplog.records if "HTTP 503" in r.getMessage()]
    assert len(tries) == len(svc.RETRY_WAITS_S) + 1
    assert "m:generateContent" in tries[0].getMessage()
    assert not any("SECRET" in r.getMessage() for r in caplog.records)


def test_the_turn_uses_the_deadline(monkeypatch):
    seen = {}

    def fake_post(req, **kw):
        seen.update(kw)
        return {"candidates": [{"content": {"parts": [{"text": "hola"}]}}]}

    monkeypatch.setattr(svc, "_post_with_retries", fake_post)
    req = svc.GeminiRequest(system_instruction="s", contents=[])
    assert svc._call_gemini(req, "k", "m") == "hola"
    assert seen["deadline_s"] == svc.GEMINI_TURN_BUDGET_S
    assert seen["timeout"] == svc.GEMINI_TURN_TRY_S


# --- When Gemini cannot answer, Claude asks ---------------------------------
#
# 2026-09-23: two 503 "high demand" and two silent tries from the lite model,
# and the manager was left with no question. Claude asks the same question
# from the same instructions; the turn goes through the same parse_turn.


def _gemini_down(req, key, model):
    raise RuntimeError("Gemini returned 503: high demand")


def test_claude_asks_when_gemini_cannot():
    seen = {}

    def claude(req, key):
        seen["key"] = key
        seen["system"] = req.system_instruction
        return json.dumps(
            {"reply": "¿Cuántos sois?", "done": False, "brief": "",
             "form": "roster", "formPeople": 4}
        )

    turn = svc.next_turn(
        [svc.InterviewMessage(role="manager", text="Un bar")],
        "es", "gk", "m", call=_gemini_down, fallback_key="ak", fallback=claude,
    )
    assert turn.reply == "¿Cuántos sois?"
    assert turn.form == "roster" and turn.form_people == 4
    assert seen["key"] == "ak"
    assert seen["system"] == svc.build_system_instruction("es", finish=False)


def test_without_an_anthropic_key_gemini_s_error_stands():
    def claude(req, key):  # pragma: no cover - must not be reached
        raise AssertionError("no key, no fallback")

    with pytest.raises(RuntimeError, match="503"):
        svc.next_turn([], "es", "gk", "m", call=_gemini_down, fallback=claude)


def test_when_both_fail_a_spent_quota_still_reads_as_one():
    def spent(req, key, model):
        raise svc.QuotaSpent("Gemini quota is spent (429)")

    def claude(req, key):
        raise RuntimeError("credit balance is too low")

    with pytest.raises(svc.QuotaSpent):
        svc.next_turn(
            [], "es", "gk", "m", call=spent, fallback_key="ak", fallback=claude
        )


def test_a_healthy_gemini_never_calls_claude():
    def gemini(req, key, model):
        return json.dumps({"reply": "hola", "done": False, "brief": "",
                           "form": "none", "formPeople": 0})

    def claude(req, key):  # pragma: no cover - must not be reached
        raise AssertionError("Gemini answered")

    turn = svc.next_turn([], "es", "gk", "m", call=gemini, fallback_key="ak",
                         fallback=claude)
    assert turn.reply == "hola"


def test_claude_s_transcript_opens_on_the_user():
    contents = svc.to_contents(
        [
            svc.InterviewMessage(role="assistant", text="¿A qué hora abrís?"),
            svc.InterviewMessage(role="manager", text="De 19:00 a 03:00"),
            svc.InterviewMessage(role="manager", text="Octubre."),
        ]
    )
    out = svc.to_claude_messages(contents)
    assert out[0] == {"role": "user", "content": "(start the interview)"}
    assert out[1] == {"role": "assistant", "content": "¿A qué hora abrís?"}
    assert out[-1] == {"role": "user", "content": "Octubre."}


def test_claude_s_schema_dumps_to_gemini_s_shape():
    raw = svc._ClaudeTurn(
        reply="r", done=True, brief="b", form="none", formPeople=0
    ).model_dump_json(by_alias=True)
    assert set(json.loads(raw)) == set(svc.RESPONSE_SCHEMA["properties"])
    assert svc.parse_turn(raw).brief == "b"


def test_the_whole_turn_fits_before_the_browser_gives_up():
    # INTERVIEW_TURN_TIMEOUT_MS in frontend/src/api/interview.ts is 50 s.
    assert svc.TURN_DEADLINE_S < 50


# --- A Gemini that just failed is not waited for again ----------------------
#
# 2026-09-23 evening: Gemini down, and every question cost 8 s of waiting for
# it before Claude answered in one or two. After one failure the next turns
# go straight to Claude for GEMINI_REST_S.


def _claude_says(text):
    def claude(req, key):
        return json.dumps({"reply": text, "done": False, "brief": "",
                           "form": "none", "formPeople": 0})
    return claude


def test_after_one_failure_the_next_turn_skips_gemini():
    now = {"t": 0.0}
    rest = svc.GeminiRest(clock=lambda: now["t"])
    calls = {"gemini": 0}

    def gemini_down(req, key, model):
        calls["gemini"] += 1
        raise RuntimeError("Gemini did not answer in time")

    for _ in range(3):
        turn = svc.next_turn([], "es", "gk", "m", call=gemini_down,
                             fallback_key="ak", fallback=_claude_says("¿Qué negocio?"),
                             rest=rest)
        assert turn.reply == "¿Qué negocio?"
    assert calls["gemini"] == 1, "asked once, then left to rest"

    now["t"] = svc.GEMINI_REST_S + 1
    svc.next_turn([], "es", "gk", "m", call=gemini_down, fallback_key="ak",
                  fallback=_claude_says("x"), rest=rest)
    assert calls["gemini"] == 2, "and asked again once the rest is over"


def test_without_a_fallback_gemini_is_never_skipped():
    rest = svc.GeminiRest()
    rest.rest(svc.GEMINI_REST_S)

    def gemini(req, key, model):
        return json.dumps({"reply": "hola", "done": False, "brief": "",
                           "form": "none", "formPeople": 0})

    assert svc.next_turn([], "es", "gk", "m", call=gemini, rest=rest).reply == "hola"


def test_a_turn_waits_for_gemini_only_a_few_seconds():
    assert svc.GEMINI_TURN_TRY_S <= 4
    assert svc.GEMINI_TURN_BUDGET_S < 2 * svc.GEMINI_TURN_TRY_S


def test_a_429_logs_which_quota_it_was(monkeypatch, caplog):
    body = json.dumps({"error": {"code": 429, "message": "You exceeded your current quota",
        "details": [{"@type": "type.googleapis.com/google.rpc.QuotaFailure",
                     "violations": [{"quotaId": "GenerateRequestsPerMinutePerProject"}]},
                    {"@type": "type.googleapis.com/google.rpc.RetryInfo",
                     "retryDelay": "2s"}]}})

    def busy(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 429, "q", {}, io.BytesIO(body.encode()))

    monkeypatch.setattr(urllib.request, "urlopen", busy)
    req = urllib.request.Request("https://example.test/m:generateContent", data=b"{}")
    with caplog.at_level("WARNING", logger=svc.logger.name):
        with pytest.raises(RuntimeError):
            svc._post_with_retries(req, sleep=lambda s: None)
    assert "GenerateRequestsPerMinutePerProject" in caplog.records[0].getMessage()
    assert "retry in 2s" in caplog.records[0].getMessage()
