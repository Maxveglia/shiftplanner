from __future__ import annotations

"""The vertical Jev guesses from the opening interview.

A manager who does the interview is never asked what kind of business they
run, so ``/interview/complete`` asks Jev to read it off the paragraph and keeps
the answer as ``vertical_source="inferred"`` -- a guess, which nothing acts on
until the manager confirms it. What is pinned here, in order of how badly it
would go wrong:

- what is SENT: never a name on file, and never the team half of the
  paragraph;
- that a guess stays a guess: it reaches neither the intake nor the planner;
- that a declared vertical is the manager's and no interview touches it;
- that a new interview replaces the old guess, as it replaces everything else
  the last interview produced;
- that Jev off, failing or unsure is the product exactly as it was.

No network anywhere: ``jev.ask`` is replaced, or ``urlopen`` under it.
"""

import io
import json
import urllib.request
import uuid

import pytest

from tests.test_business_profile import (
    _auth,
    _org_session,
    _signup,
    client,  # noqa: F401  -- fixture, used by name
    skip_no_db,
)

from app.config import settings
from app.models.business_profile import BusinessProfile
from app.services import business_profile as bp
from app.services import jev


BAR = (
    "Tengo un bar en Gràcia que abre de 18:00 a 3:00 todos los días. "
    "Somos seis: Ana y Luis con 40 horas, Marta con 20 y Jordi sin horas fijas."
)
SHOP = "Ahora es una tienda de ropa que abre de 10 a 20 h. Somos dos: Ana 40 h, Luis 40 h."


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(settings, "jev_api_key", "test-key")


def _jev_says(monkeypatch, choice, confidence, calls=None):
    """Replace Jev with one that answers ``choice`` at ``confidence``."""

    def ask(state, questions, purpose):
        if calls is not None:
            calls.append({"state": state, "questions": questions, "purpose": purpose})
        return {
            "vertical": jev.Answer(
                choice=choice,
                probabilities={choice: confidence or 0.0},
                confidence=confidence,
            )
        }

    monkeypatch.setattr(jev, "ask", ask)


def _complete(client, token, notes):  # noqa: F811
    resp = client.post(
        "/api/v1/interview/complete", json={"notes": notes}, headers=_auth(token)
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _vertical(client, token):  # noqa: F811
    body = client.get("/api/v1/profile", headers=_auth(token)).json()
    return body["vertical"], body["vertical_source"]


def _hire(client, token, name):  # noqa: F811
    resp = client.post(
        "/api/v1/employees",
        headers=_auth(token),
        json={
            "external_id": None,
            "full_name": name,
            "email": None,
            "employment_status": "active",
            "hire_date": "2025-01-01",
        },
    )
    assert resp.status_code == 201, resp.text


# --- What is sent -----------------------------------------------------------


@pytest.mark.parametrize(
    "notes, kept, dropped",
    [
        # The interview's own shape: the business first, the team last, each
        # person with their hours.
        (BAR, ["bar", "Gràcia", "18:00 a 3:00"], ["Ana", "Luis", "Marta", "Jordi"]),
        (
            "I run a bar in Gràcia that is open from 6pm to 3am every day. "
            "There are six of us: Ana and Luis on 40 hours, Marta on 20, and "
            "Pedro with no fixed hours.",
            ["bar"],
            ["Ana", "Luis", "Marta", "Pedro"],
        ),
        # A second sentence about the team with no figure in it goes too: the
        # cut is at the first clause about people, not clause by clause.
        (
            "Tengo una tienda de ropa que abre de 10 a 20 h. Ana y Luis tienen "
            "40 horas. Marta tiene 20.",
            ["tienda", "10 a 20 h"],
            ["Ana", "Luis", "Marta"],
        ),
        # Hours that describe the DOORS are not taken for the team...
        (
            "Tengo un hotel en Sitges abierto las 24 horas. Somos 8. Ana 40 h, Luis 40 h.",
            ["hotel"],
            ["Ana", "Luis"],
        ),
        (
            "Tengo una clínica dental que abre a las 9 h y cierra a las 20 h. "
            "Marta a 20 horas y Ana a jornada completa.",
            ["clínica"],
            ["Marta", "Ana"],
        ),
        # ...but "a 20 horas" with no figure before it is somebody's contract.
        ("Tengo un café. Marta a 20 horas.", ["café"], ["Marta"]),
        # The roster form's own sentence, as it reaches the brief.
        (
            "Tengo un bar que abre de 18:00 h a 3:00 h. Trabaja una persona, y "
            "estas son sus horas de contrato a la semana: Ana 40 h.",
            ["bar"],
            ["Ana"],
        ),
        (
            "Tengo una panadería que abre de 7 a 14. Somos tres: Ana, Luis y "
            "Marta, sin concretar las horas.",
            ["panadería"],
            ["Ana", "Luis", "Marta"],
        ),
        # The team FIRST: nothing is sent. A guess not made, never a name.
        ("Somos Ana (40 h) y Luis (30 h) y tenemos un bar.", [], ["Ana", "Luis", "bar"]),
    ],
)
def test_only_the_business_half_of_the_paragraph_is_sent(notes, kept, dropped):
    part = bp.business_part(notes)
    for word in kept:
        assert word in part, part
    for word in dropped:
        assert word not in part, part


def test_the_question_is_every_vertical_by_its_label_and_context():
    question = bp.vertical_question()
    assert set(question.options) == set(bp.VERTICALS)
    for code, vertical in bp.VERTICALS.items():
        assert vertical.label in question.options[code]
        assert vertical.context in question.options[code]


@skip_no_db
def test_no_name_on_file_is_sent(client, on, monkeypatch):  # noqa: F811
    """A second interview, when the team is on the roster: masked by the table.

    Ana is named in the BUSINESS half on purpose -- the half that is sent --
    so only the mask stands between her name and the wire. Pepa is in the
    team half and is not on file: the cut is what keeps her off it.
    """
    token = _signup(client)
    _hire(client, token, "Ana García Pérez")
    _hire(client, token, "Luis Romero")
    calls = []
    _jev_says(monkeypatch, "bar", 0.9, calls)

    _complete(
        client,
        token,
        "Ana y Luis Romero llevamos un bar en Gràcia que abre de 18:00 a 3:00. "
        "Somos tres: Ana y Luis con 40 horas, Pepa con 20.",
    )

    (call,) = calls
    state = call["state"]
    for name in ("Ana", "García", "Luis", "Romero", "Pepa"):
        assert name not in state, state
    assert "bar" in state
    assert call["purpose"] == "vertical"


@skip_no_db
def test_through_the_real_client_the_wire_and_the_meter(client, on, monkeypatch):  # noqa: F811
    """Everything but the network: what the request carries, and its api_usage row."""

    class _Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    sent = []

    def urlopen(req, timeout):
        sent.append(json.loads(req.data.decode("utf-8")))
        return _Resp(
            json.dumps(
                {
                    "answers": {
                        "vertical": {
                            "type": "choice",
                            "choice": "bar",
                            "probabilities": {"bar": 0.9, "restaurant": 0.1},
                            "confidence": 0.85,
                        }
                    },
                    "usage": {"input_tokens": 140, "output_tokens": 2},
                }
            ).encode("utf-8")
        )

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    token = _signup(client)
    _complete(client, token, BAR)

    (body,) = sent
    assert body["state"] == bp.business_part(BAR)
    assert set(body["questions"]["vertical"]["criteria"]) == set(bp.VERTICALS)
    assert _vertical(client, token) == ("bar", "inferred")

    from sqlalchemy import select

    from app.models.api_usage import ApiUsage

    db, org_id = _org_session(token)
    try:
        rows = db.execute(
            select(ApiUsage).where(ApiUsage.org_id == org_id)
        ).scalars().all()
    finally:
        db.close()
    assert [(r.purpose, r.input_tokens) for r in rows] == [("jev.vertical", 140)]


# --- What is kept -----------------------------------------------------------


@skip_no_db
def test_off_jev_is_not_asked_and_nothing_changes(client, monkeypatch):  # noqa: F811
    calls = []
    _jev_says(monkeypatch, "bar", 0.99, calls)
    token = _signup(client)

    assert _complete(client, token, BAR) == {"remembered": True, "hours_declared": 0}

    assert calls == []
    assert _vertical(client, token) == (None, "declared")


@skip_no_db
@pytest.mark.parametrize(
    "choice, confidence, kept",
    [
        ("bar", 0.9, ("bar", "inferred")),
        ("bar", bp.INFER_FROM, ("bar", "inferred")),
        ("bar", bp.INFER_FROM - 0.01, (None, "declared")),
        ("bar", None, (None, "declared")),
        # Sure it is none of ours is not a guess worth confirming.
        ("other", 0.95, (None, "declared")),
    ],
)
def test_only_a_confident_guess_is_kept_and_kept_as_a_guess(
    client, on, monkeypatch, choice, confidence, kept  # noqa: F811
):
    _jev_says(monkeypatch, choice, confidence)
    token = _signup(client)
    _complete(client, token, BAR)
    assert _vertical(client, token) == kept


@skip_no_db
def test_a_declared_vertical_is_never_touched_and_jev_is_not_asked(
    client, on, monkeypatch  # noqa: F811
):
    token = _signup(client)
    resp = client.put("/api/v1/profile", headers=_auth(token), json={"vertical": "clinic"})
    assert resp.status_code == 200, resp.text
    calls = []
    _jev_says(monkeypatch, "bar", 0.99, calls)

    _complete(client, token, BAR)

    assert calls == []
    assert _vertical(client, token) == ("clinic", "declared")


@skip_no_db
def test_a_second_interview_replaces_the_guess(client, on, monkeypatch):  # noqa: F811
    token = _signup(client)
    _jev_says(monkeypatch, "bar", 0.9)
    _complete(client, token, BAR)
    assert _vertical(client, token) == ("bar", "inferred")

    _jev_says(monkeypatch, "retail", 0.8)
    _complete(client, token, SHOP)
    assert _vertical(client, token) == ("retail", "inferred")


@skip_no_db
@pytest.mark.parametrize("second", ["unsure", "down", "off"])
def test_a_second_interview_that_cannot_be_guessed_forgets_the_old_guess(
    client, on, monkeypatch, second  # noqa: F811
):
    """A shop must not stay "bar" because Jev was unsure, down or off that day."""
    token = _signup(client)
    _jev_says(monkeypatch, "bar", 0.9)
    _complete(client, token, BAR)
    assert _vertical(client, token) == ("bar", "inferred")

    if second == "unsure":
        _jev_says(monkeypatch, "retail", 0.3)
    elif second == "down":
        monkeypatch.setattr(jev, "ask", lambda state, questions, purpose: None)
    else:
        monkeypatch.setattr(settings, "jev_enabled", False)
    _complete(client, token, SHOP)
    assert _vertical(client, token) == (None, "declared")


@skip_no_db
def test_a_skip_keeps_the_guess(client, on, monkeypatch):  # noqa: F811
    """A skip is not an answer, so it erases nothing -- this included."""
    token = _signup(client)
    _jev_says(monkeypatch, "bar", 0.9)
    _complete(client, token, BAR)
    calls = []
    _jev_says(monkeypatch, "retail", 0.9, calls)

    _complete(client, token, "")

    assert calls == []
    assert _vertical(client, token) == ("bar", "inferred")


@skip_no_db
@pytest.mark.parametrize("failure", ["none", "raises"])
def test_jev_failing_costs_the_manager_nothing(client, on, monkeypatch, failure):  # noqa: F811
    """``ask`` promises never to raise; the endpoint does not rely on it."""
    if failure == "none":
        monkeypatch.setattr(jev, "ask", lambda state, questions, purpose: None)
    else:

        def boom(state, questions, purpose):
            raise RuntimeError("jev exploded")

        monkeypatch.setattr(jev, "ask", boom)
    token = _signup(client)

    assert _complete(client, token, BAR) == {"remembered": True, "hours_declared": 0}

    body = client.get("/api/v1/profile", headers=_auth(token)).json()
    assert body["interview_notes"] == BAR
    assert body["first_run_pending"] is False
    assert (body["vertical"], body["vertical_source"]) == (None, "declared")


# --- A guess stays a guess --------------------------------------------------


@skip_no_db
def test_a_guessed_vertical_reaches_neither_the_intake_nor_the_planner(
    client, on, monkeypatch  # noqa: F811
):
    """The rule on ``BusinessProfile.vertical_source``, through the real door.

    The intake is read where it is built -- the background handed to
    ``interpret_brief`` by ``POST /schedule/interpret`` -- and the planner
    from the stored profile. Each is also shown the same profile DECLARED, so
    a test that could not see the vertical at all would fail here.
    """
    token = _signup(client)
    _jev_says(monkeypatch, "bar", 0.9)
    _complete(client, token, BAR)
    assert _vertical(client, token) == ("bar", "inferred")
    context = bp.VERTICALS["bar"].context

    seen = []

    def interpret_brief(text, api_key, today, background=""):
        seen.append(background)
        raise RuntimeError("stop here: only the background was wanted")

    from app.routers import schedule as schedule_router

    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    monkeypatch.setattr(schedule_router, "interpret_brief", interpret_brief)
    resp = client.post(
        "/api/v1/schedule/interpret",
        headers=_auth(token),
        json={"text": "Haz el horario de octubre."},
    )
    assert resp.status_code == 502, resp.text
    (background,) = seen
    # The profile WAS read: the interview is in it, the guess is not.
    assert "Tengo un bar en Gràcia" in background
    assert context not in background

    db, _org_id = _org_session(token)
    try:
        profile = bp.get_or_create(db, _org_id)
        assert context not in bp.planning_context(profile, [])
        assert bp.suggestions_for(profile, ["coverage"]) == []

        # The control: the same row, declared, does carry it.
        profile.vertical_source = "declared"
        assert context in bp.model_context(profile, [])
        assert context in bp.planning_context(profile, [])
        assert bp.suggestions_for(profile, ["coverage"]) != []
    finally:
        db.rollback()
        db.close()


def test_the_guess_is_withheld_by_every_reader_of_the_vertical():
    """The same rule without a database, for every builder that reads it."""
    profile = BusinessProfile(
        org_id=uuid.uuid4(),
        learning_enabled=True,
        vertical="bar",
        vertical_source="inferred",
        interview_notes=BAR,
    )
    context = bp.VERTICALS["bar"].context
    assert context not in bp.model_context(profile, [])
    assert context not in bp.planning_context(profile, [])
    assert bp.suggestions_for(profile, ["coverage"]) == []
