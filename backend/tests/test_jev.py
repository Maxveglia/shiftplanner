"""The Jev client: what it sends, what it believes, and that it never raises."""

import io
import json
import urllib.error
import urllib.request

import pytest

from app.config import settings
from app.services import api_usage
from app.services import jev


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(settings, "jev_api_key", "test-key")


def _answering(payload, seen=None):
    def urlopen(req, timeout):
        if seen is not None:
            seen.append(json.loads(req.data.decode("utf-8")))
            seen.append(dict(req.header_items()))
        return _Resp(json.dumps(payload).encode("utf-8"))

    return urlopen


RULE = jev.Noul("Is this a rule?", true="Every week.", false="This time only.")
KIND = jev.Choice("What is it?", {"bar": "A bar.", "other": "Anything else."})


def test_off_by_default_nothing_leaves_the_server(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("no call may be made while Jev is off")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    assert settings.jev_enabled is False
    assert jev.ask("Ana libra el viernes", {"rule": RULE}, "test") is None


def test_on_without_a_key_is_still_off(monkeypatch):
    monkeypatch.setattr(settings, "jev_enabled", True)
    monkeypatch.setattr(settings, "jev_api_key", "")
    assert jev.enabled() is False
    assert jev.ask("x", {"rule": RULE}, "test") is None


def test_it_sends_typed_questions_and_reads_typed_answers(on, monkeypatch):
    seen = []
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        _answering(
            {
                "model": "jev-1.13.0",
                "answers": {
                    "rule": {"type": "noul", "noul": 0.91},
                    "kind": {
                        "type": "choice",
                        "choice": "bar",
                        "probabilities": {"bar": 0.8, "other": 0.2},
                        "confidence": 0.7,
                    },
                },
                "usage": {"input_tokens": 120, "output_tokens": 4},
            },
            seen,
        ),
    )
    answers = jev.ask("Somos un bar", {"rule": RULE, "kind": KIND}, "test")

    body, headers = seen
    assert body["model"] == settings.jev_model
    assert body["state"] == "Somos un bar"
    assert body["questions"]["rule"] == {
        "type": "noul",
        "instructions": "Is this a rule?",
        "criteria": {"true": "Every week.", "false": "This time only."},
    }
    assert body["questions"]["kind"]["criteria"] == {"bar": "A bar.", "other": "Anything else."}
    assert headers["Authorization"] == "Bearer test-key"

    assert answers["rule"].yes == pytest.approx(0.91)
    assert answers["kind"].choice == "bar"
    assert answers["kind"].confidence == pytest.approx(0.7)
    assert answers["kind"].probabilities == {"bar": 0.8, "other": 0.2}


def test_an_answer_outside_what_was_asked_is_dropped_not_trusted(on, monkeypatch):
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        _answering(
            {
                "answers": {
                    "rule": {"type": "noul", "noul": 1.7},
                    "kind": {"type": "choice", "choice": "nightclub", "confidence": 0.9},
                }
            }
        ),
    )
    assert jev.ask("x", {"rule": RULE, "kind": KIND}, "test") is None


@pytest.mark.parametrize("code", [401, 422, 429, 529])
def test_a_failure_is_none_and_rests_the_next_caller(on, monkeypatch, code):
    calls = {"n": 0}

    def failing(req, timeout):
        calls["n"] += 1
        raise urllib.error.HTTPError(req.full_url, code, "no", {}, io.BytesIO(b"{}"))

    monkeypatch.setattr(urllib.request, "urlopen", failing)
    assert jev.ask("x", {"rule": RULE}, "test") is None
    assert jev.REST.resting()
    # The next caller does not pay for the same failure again.
    assert jev.ask("x", {"rule": RULE}, "test") is None
    assert calls["n"] == 1


def test_a_timeout_is_none_too(on, monkeypatch):
    def slow(req, timeout):
        raise TimeoutError("timed out")

    monkeypatch.setattr(urllib.request, "urlopen", slow)
    assert jev.ask("x", {"rule": RULE}, "test") is None


def test_garbage_is_none(on, monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout: _Resp(b"<html>"))
    assert jev.ask("x", {"rule": RULE}, "test") is None


def test_every_call_is_metered_under_its_question(on, monkeypatch):
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        _answering(
            {
                "answers": {"rule": {"type": "noul", "noul": 0.2}},
                "usage": {"input_tokens": 300, "output_tokens": 3},
            }
        ),
    )
    with api_usage.collect() as ledger:
        jev.ask("x", {"rule": RULE}, "standing_rule")
    (spend,) = ledger.entries
    assert spend.purpose == "jev.standing_rule"
    assert spend.model == "jev-latest"
    assert spend.input_tokens == 300
    assert spend.duration_ms is not None
    assert api_usage.cost_usd("jev-latest", 1_000_000, 1_000_000) == pytest.approx(0.042)


def test_names_are_masked_whole_and_by_first_name():
    names = {
        "11111111-1111-1111-1111-111111111111": "Ana García Pérez",
        "22222222-2222-2222-2222-222222222222": "Luis Romero",
    }
    masked = jev.mask("Ana y Luis Romero nunca juntos; García cierra", names)
    for part in ("Ana", "García", "Luis", "Romero"):
        assert part not in masked
    assert masked == "e1 y e2 nunca juntos; e1 cierra"
    # The table's own rule, not ours to change here: one word written small
    # ("sol", "rosa") is a noun as often as a name, and stays as typed.
