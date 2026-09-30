""""Este sábado que haya mínimo cuatro" is not a rule for every Saturday after it.

A correction became a standing rule by its SHAPE: `_hint_from_op` gave it a
key, and `declare_from_ops` wrote that key into every brief from then on. The
shape knows a date from a weekday, but four of the learnable operations carry
neither -- so "this Saturday, four" and "always four" were the same
`set_min_staff`, and both were declared for good.

The sentence knows which, and Jev reads it. These tests hold the three things
that must stay true around that question: below the line nothing is declared
and the correction is still observed; with no opinion (Jev off, no sentence, no
answer) the old behaviour is kept exactly; and Jev is never asked when nothing
could be declared, or shown a name.

No network: `jev.ask` is replaced, and its own wire is `test_jev.py`'s.
"""

from __future__ import annotations

import logging

import pytest

from app.config import settings
from app.schemas import limits
from app.services import business_profile as bp
from app.services import jev
from app.services.business_profile import declared_rules

from tests.test_business_profile import (
    _auth,
    _org_session,
    _signup,
    client,  # noqa: F401  -- fixture, used by name
    skip_no_db,
)

pytestmark = skip_no_db

# One operation, two sentences it can come from. The operation carries no date,
# so nothing in it says which of the two it was.
MIN_FOUR = {"op": "set_min_staff", "staff": 4}
THIS_SATURDAY = "Este sábado que haya mínimo cuatro"
ALWAYS = "Siempre mínimo cuatro personas"

ONE_DAY = {"op": "add_coverage", "date": "2026-12-24", "start": "18:00",
           "end": "22:00", "staff": 6}
DAY_OFF = {"op": "day_off", "employee": "e1", "date": "2026-12-26"}


@pytest.fixture
def jev_on(monkeypatch):
    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(settings, "jev_api_key", "test-key")


def _jev(monkeypatch, p):
    """Replace Jev with one that answers ``p`` to every question, and keeps
    what it was asked. ``p=None`` is Jev failing -- which ``ask`` reports as
    None and never as an exception."""
    asked = []

    def ask(state, questions, purpose):
        asked.append({"state": state, "questions": dict(questions), "purpose": purpose})
        if p is None:
            return None
        return {key: jev.Answer(yes=p) for key in questions}

    monkeypatch.setattr(jev, "ask", ask)
    return asked


def _post(client, token, ops, text=None):  # noqa: F811
    body = {"ops": ops}
    if text is not None:
        body["text"] = text
    resp = client.post("/api/v1/profile/observations", headers=_auth(token), json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _state(token):
    """What the org now has: its declarations, and the keys it has evidence for."""
    db, org_id = _org_session(token)
    try:
        declared = declared_rules(bp.get_or_create(db, org_id))
        evidence = {h.key: h.evidence_days for h in bp.hints_for(db, org_id)}
    finally:
        db.close()
    return declared, evidence


# --- No opinion: exactly what happened before Jev -------------------------


def test_with_jev_off_the_operation_decides_and_nothing_is_asked(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "jev_enabled", False)
    asked = _jev(monkeypatch, 0.0)
    token = _signup(client)

    _post(client, token, [MIN_FOUR], THIS_SATURDAY)

    declared, _ = _state(token)
    assert declared == {"min_staff": {"staff": 4}}
    assert asked == []


def test_jev_on_without_a_key_is_still_off(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(settings, "jev_api_key", "")
    asked = _jev(monkeypatch, 0.0)
    token = _signup(client)

    _post(client, token, [MIN_FOUR], THIS_SATURDAY)

    assert _state(token)[0] == {"min_staff": {"staff": 4}}
    assert asked == []


def test_no_answer_from_jev_is_no_opinion(client, monkeypatch, jev_on):  # noqa: F811
    # Down, slow, resting, or answering nonsense: all of it is None, and a
    # manager must not lose a rule they stated because a second opinion was
    # unavailable.
    asked = _jev(monkeypatch, None)
    token = _signup(client)

    _post(client, token, [MIN_FOUR], ALWAYS)

    assert _state(token)[0] == {"min_staff": {"staff": 4}}
    assert len(asked) == 1


@pytest.mark.parametrize("text", [None, "", "   "])
def test_without_a_sentence_there_is_nothing_to_ask(client, monkeypatch, jev_on, text):  # noqa: F811
    # A correction that did not come from a sentence has no "this Saturday" to
    # read. The operation decides, as it always did.
    asked = _jev(monkeypatch, 0.0)
    token = _signup(client)

    _post(client, token, [MIN_FOUR], text)

    assert _state(token)[0] == {"min_staff": {"staff": 4}}
    assert asked == []


def test_nothing_declarable_is_not_worth_a_call(client, monkeypatch, jev_on):  # noqa: F811
    # One date and one person: neither can become a rule whatever the sentence
    # says, so the answer would change nothing and is not paid for.
    asked = _jev(monkeypatch, 0.9)
    token = _signup(client)

    _post(client, token, [ONE_DAY, DAY_OFF], "Seis el 24 y e1 libra el 26")

    assert _state(token)[0] == {}
    assert asked == []


# --- The sentence decides --------------------------------------------------


def test_a_one_off_is_not_declared_but_is_still_observed(
    client, monkeypatch, jev_on, caplog  # noqa: F811
):
    asked = _jev(monkeypatch, 0.1)
    token = _signup(client)
    caplog.set_level(logging.INFO, logger=bp.__name__)

    out = _post(client, token, [MIN_FOUR], THIS_SATURDAY)

    declared, evidence = _state(token)
    assert declared == {}
    # Evidence, exactly as before: if this Saturday turns out to be every
    # Saturday, three days of it still become a belief.
    assert out == {"recorded": 1, "learned": ["min_staff"]}
    assert evidence == {"min_staff": 1}
    assert len(asked) == 1
    assert "jev: one-off, not declared p=0.10 keys=['min_staff']" in caplog.text


def test_a_standing_rule_is_declared(client, monkeypatch, jev_on):  # noqa: F811
    asked = _jev(monkeypatch, 0.9)
    token = _signup(client)

    out = _post(client, token, [MIN_FOUR], ALWAYS)

    declared, evidence = _state(token)
    assert declared == {"min_staff": {"staff": 4}}
    assert out["learned"] == ["min_staff"]
    assert evidence == {"min_staff": 1}

    # One call, one closed question, metered under its own name.
    [call] = asked
    assert call["purpose"] == "standing_rule"
    assert list(call["questions"]) == ["standing"]
    assert isinstance(call["questions"]["standing"], jev.Noul)
    assert call["state"] == ALWAYS


def test_the_line_itself_declares(client, monkeypatch, jev_on):  # noqa: F811
    # "From", as the constant's name says: Jev at exactly the midpoint is not
    # leaning away from a rule.
    _jev(monkeypatch, bp.DECLARE_FROM)
    token = _signup(client)

    _post(client, token, [MIN_FOUR], ALWAYS)

    assert _state(token)[0] == {"min_staff": {"staff": 4}}


# --- What Jev is shown, and when it is not asked at all -------------------


def test_jev_never_reads_a_name(client, monkeypatch, jev_on):  # noqa: F811
    asked = _jev(monkeypatch, 0.1)
    token = _signup(client)
    resp = client.post(
        "/api/v1/employees",
        headers=_auth(token),
        json={
            "external_id": None,
            "full_name": "Valentina Ortega",
            "email": None,
            "employment_status": "active",
            "hire_date": "2026-01-01",
        },
    )
    assert resp.status_code == 201, resp.text

    _post(client, token, [MIN_FOUR], "Valentina Ortega está de baja: este sábado mínimo cuatro")

    [call] = asked
    assert "Valentina" not in call["state"]
    assert "Ortega" not in call["state"]
    assert call["state"] == "e1 está de baja: este sábado mínimo cuatro"


def test_learning_switched_off_still_does_nothing(client, monkeypatch, jev_on):  # noqa: F811
    # Not a declaration, not an observation, and not a question either: a
    # product told to stop adapting has no use for the answer.
    asked = _jev(monkeypatch, 0.9)
    token = _signup(client)
    client.put("/api/v1/profile", headers=_auth(token), json={"learning_enabled": False})

    out = _post(client, token, [MIN_FOUR], ALWAYS)

    assert out == {"recorded": 0, "learned": []}
    assert _state(token) == ({}, {})
    assert asked == []


def test_a_sentence_longer_than_an_adjustment_is_refused(client):  # noqa: F811
    # The same ceiling `/schedule/refine` puts on the sentence, so one that got
    # through there is never refused here.
    token = _signup(client)

    resp = client.post(
        "/api/v1/profile/observations",
        headers=_auth(token),
        json={"ops": [MIN_FOUR], "text": "x" * (limits.ADJUSTMENT + 1)},
    )

    assert resp.status_code == 422
