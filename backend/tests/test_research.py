"""What we look up about a business, and how it is kept apart from what they said.

Nothing here reaches Gemini: the grounded call is one injectable function,
so the instruction, the prompt, the request body and the parse of a grounded
reply are pinned without a key. The property that matters most -- that the
search is built only from what the manager approved for a free tier, never
from the settings box -- is checked on the text that would be sent.
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.request
import uuid

import pytest

from app.models.business_profile import BusinessProfile
from tests.test_interview import _signup as _signup_research
from tests.test_interview import client  # noqa: F401 -- fixture, used by name
from tests.test_interview import skip_no_db as skip_no_db_research
from app.services import business_profile as bp
from app.services import interview as interview_svc
from app.services import research as svc


def _grounded_payload(text: str, chunks=None, queries=None) -> dict:
    meta = {}
    if chunks is not None:
        meta["groundingChunks"] = chunks
    if queries is not None:
        meta["webSearchQueries"] = queries
    return {
        "candidates": [
            {
                "content": {"role": "model", "parts": [{"text": text}]},
                "groundingMetadata": meta,
            }
        ]
    }


def test_the_instruction_asks_for_what_matters_to_staffing_and_nothing_personal():
    text = svc.build_system_instruction("es")
    assert "in Spanish" in text
    for word in ("busy hours", "seasonality", "local holidays"):
        assert word in text
    assert "Never mention or look up any person" in text
    assert "in English" in svc.build_system_instruction("en")


def test_the_prompt_is_built_from_the_interview_and_the_place_only():
    inp = svc.ResearchInput(
        notes="Tengo un bar en el Raval.",
        location="Barcelona",
        vertical_label="Bar / pub",
        language="es",
    )
    prompt = svc.build_prompt(inp)
    assert "Kind of business: Bar / pub." in prompt
    assert "Where it is: Barcelona." in prompt
    assert "Tengo un bar en el Raval." in prompt
    # Nothing else is a field of ResearchInput: house_notes cannot get here.
    assert not hasattr(inp, "house_notes")


def test_nothing_known_means_nothing_to_search():
    assert not svc.ResearchInput(notes="  ").has_anything()
    assert svc.ResearchInput(notes="", location="Girona").has_anything()


def test_the_request_switches_google_search_on_and_asks_for_no_schema(monkeypatch):
    """The one body shape the API grounds: a `google_search` tool, plain prose back."""
    seen = {}

    class R(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def capture(req, timeout):
        seen["url"] = req.full_url
        seen["body"] = json.loads(req.data.decode("utf-8"))
        seen["timeout"] = timeout
        return R(json.dumps(_grounded_payload("ok")).encode("utf-8"))

    monkeypatch.setattr(urllib.request, "urlopen", capture)
    payload = svc._call_gemini_grounded(
        svc.GeminiRequest(system_instruction="sys", prompt="bar en Barcelona"),
        "key",
        "gemini-test",
    )
    assert payload["candidates"][0]["content"]["parts"][0]["text"] == "ok"
    assert "gemini-test:generateContent" in seen["url"]
    assert seen["body"]["tools"] == [{"google_search": {}}]
    assert "responseSchema" not in seen["body"]["generationConfig"]
    assert "responseMimeType" not in seen["body"]["generationConfig"]
    assert seen["body"]["contents"][0]["parts"][0]["text"] == "bar en Barcelona"
    assert seen["timeout"] == svc.CALL_TIMEOUT_S


def test_a_grounded_reply_is_read_as_a_summary_and_its_sources():
    payload = _grounded_payload(
        "Los bares del Raval llenan de jueves a sábado por la noche.",
        chunks=[
            {"web": {"uri": "https://redirect/1", "title": "barcelona.cat"}},
            {"web": {"uri": "https://redirect/1", "title": "barcelona.cat"}},  # duplicate
            {"retrievedContext": {"uri": "x"}},  # not a web chunk
            {"web": {"uri": "https://redirect/2", "title": "timeout.com"}},
        ],
        queries=["bares Raval Barcelona horario"],
    )
    result = svc.parse_result(payload)
    assert result.summary.startswith("Los bares del Raval")
    assert [s.title for s in result.sources] == ["barcelona.cat", "timeout.com"]
    assert result.queries == ["bares Raval Barcelona horario"]

    kept = svc.notes_with_sources(result)
    assert kept.endswith("Sources: barcelona.cat; timeout.com")
    assert svc.notes_with_sources(svc.ResearchResult(summary="solo")) == "solo"


def test_a_reply_that_searched_nothing_still_has_a_summary():
    result = svc.parse_result({"candidates": [{"content": {"parts": [{"text": "general"}]}}]})
    assert result.summary == "general" and result.sources == []


def test_an_empty_or_missing_reply_is_an_error_not_a_blank_note():
    with pytest.raises(RuntimeError):
        svc.parse_result({"candidates": []})
    with pytest.raises(RuntimeError):
        svc.parse_result(_grounded_payload("   "))


def test_a_long_summary_is_cut_rather_than_kept_whole():
    result = svc.parse_result(_grounded_payload("x" * (svc.MAX_SUMMARY_CHARS + 500)))
    assert len(result.summary) <= svc.MAX_SUMMARY_CHARS + 1


def test_research_sends_the_instruction_and_prompt_and_returns_the_parse():
    seen = {}

    def fake(req, api_key, model):
        seen["req"], seen["model"] = req, model
        return _grounded_payload("August is quiet.")

    result = svc.research(
        svc.ResearchInput(notes="A shop in Girona.", language="en"),
        "key",
        "gemini-research",
        call=fake,
    )
    assert result.summary == "August is quiet."
    assert seen["model"] == "gemini-research"
    assert "A shop in Girona." in seen["req"].prompt
    assert "in English" in seen["req"].system_instruction


# --- Where it lands, and how it is labelled -------------------------------


def _profile(**kw) -> BusinessProfile:
    return BusinessProfile(org_id=uuid.uuid4(), learning_enabled=True, **kw)


def test_the_research_reaches_the_intake_labelled_as_ours():
    ctx = bp.model_context(_profile(research_notes="Thursdays are busy in the Raval."), [])
    assert (
        "What WE looked up about businesses like this, which the manager has not "
        "confirmed and may be wrong: Thursdays are busy in the Raval." in ctx
    )
    assert "NOT a requirement" in ctx


def test_the_research_never_reads_as_something_the_manager_said():
    ctx = bp.model_context(
        _profile(interview_notes="Abrimos a las 12.", research_notes="Cierran a las 3."),
        [],
    )
    assert "In the opening interview the manager said: Abrimos a las 12." in ctx
    assert "the manager said: Cierran a las 3." not in ctx
    assert "may be wrong: Cierran a las 3." in ctx


def test_switching_learning_off_silences_the_research_in_the_intake_too():
    p = _profile(research_notes="Anything.")
    p.learning_enabled = False
    assert bp.model_context(p, []) == ""


# --- The whole week, declared at once ---------------------------------------


class _NoDb:
    def flush(self):
        pass


def _fresh_profile_store(monkeypatch, declared=None):
    profile = _profile()
    profile.declared = declared
    monkeypatch.setattr(bp, "get_or_create", lambda db, org_id: profile)
    return profile


def test_declaring_a_week_writes_open_days_as_hours_and_closed_days_as_rules(monkeypatch):
    profile = _fresh_profile_store(monkeypatch)
    week = {1: (9 * 60, 20 * 60), 5: (18 * 60, 27 * 60), 0: None}
    bp.declare_week_hours(_NoDb(), uuid.uuid4(), week)
    assert bp.declared_day_hours(profile) == {1: [540, 1200], 5: [1080, 1620]}
    assert bp.declared_rules(profile) == {"closed_weekday:0": {"closed": True, "weekday": 0}}


def test_a_new_week_replaces_the_old_answer_day_by_day(monkeypatch):
    profile = _fresh_profile_store(
        monkeypatch,
        declared={
            "day_hours": {"1": [600, 1300], "2": [600, 1300]},
            "rules": {
                "closed_weekday:0": {"closed": True, "weekday": 0},
                "min_staff": {"staff": 3},
            },
        },
    )
    # Monday changes, Tuesday is untouched, Sunday opens again, Saturday closes.
    bp.declare_week_hours(
        _NoDb(), uuid.uuid4(), {1: (540, 1200), 0: (720, 1080), 6: None}
    )
    assert bp.declared_day_hours(profile) == {1: [540, 1200], 2: [600, 1300], 0: [720, 1080]}
    rules = bp.declared_rules(profile)
    assert "closed_weekday:0" not in rules, "a day that is open again is no longer closed"
    assert rules["closed_weekday:6"] == {"closed": True, "weekday": 6}
    assert rules["min_staff"] == {"staff": 3}, "a rule about something else is untouched"


@pytest.mark.parametrize(
    "week",
    [
        {7: (540, 1200)},
        {1: (1200, 540)},
        {1: (540, 540)},
        {1: (-10, 540)},
        {1: (540, bp.LATEST_CLOSE_MIN + 30)},
    ],
)
def test_impossible_hours_are_refused_whole(monkeypatch, week):
    profile = _fresh_profile_store(monkeypatch)
    with pytest.raises(ValueError):
        bp.declare_week_hours(_NoDb(), uuid.uuid4(), week)
    assert profile.declared is None, "nothing is written when any day is wrong"


def test_declared_hours_from_the_form_fill_a_brief_that_said_nothing(monkeypatch):
    """The whole point: the next brief starts from the week the form gave."""
    profile = _fresh_profile_store(monkeypatch)
    bp.declare_week_hours(_NoDb(), uuid.uuid4(), {1: (540, 1200), 0: None})
    spec = {"dayHours": [], "closedWeekdays": [], "rules": []}
    entries = bp.apply_declarations(spec, profile, unstated=["opening_hours", "closures"])
    assert {"weekday": 1, "openMin": 540, "closeMin": 1200} in spec["dayHours"]
    assert 0 in spec["closedWeekdays"]
    keys = {e["key"] for e in entries}
    assert {"day_hours:1", "closed_weekday:0"} <= keys


# --- A 429 is two incidents wearing one number -----------------------------
#
# Measured against the real API on 2026-09-11: the free tier's Google Search
# allowance came back 429 RESOURCE_EXHAUSTED with a QuotaFailure naming a
# per-day quota. Retrying that three times buys nothing and costs a manager
# ten seconds mid-signup, while a per-minute 429 clears inside the same
# budget. These pin the difference.


def _quota_body(quota_id: str = "GenerateRequestsPerDayPerProjectPerModel") -> str:
    return json.dumps(
        {
            "error": {
                "code": 429,
                "status": "RESOURCE_EXHAUSTED",
                "message": "You exceeded your current quota, please check your plan "
                "and billing details. " + "padding. " * 80,
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                        "violations": [{"quotaMetric": "generate_content_requests", "quotaId": quota_id}],
                    }
                ],
            }
        }
    )


def test_a_spent_daily_allowance_is_told_apart_from_a_busy_minute():
    assert interview_svc.is_spent_quota(429, _quota_body()) is True
    assert (
        interview_svc.is_spent_quota(429, _quota_body("GenerateRequestsPerMinutePerProject"))
        is False
    )
    # Anything unreadable is treated as transient: losing an answer that was
    # coming is worse than waiting ten seconds for one that was not.
    assert interview_svc.is_spent_quota(429, "not json at all") is False
    assert interview_svc.is_spent_quota(503, _quota_body()) is False


def test_a_long_retry_delay_is_also_a_spent_allowance():
    body = json.dumps(
        {
            "error": {
                "code": 429,
                "details": [
                    {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "57s"}
                ],
            }
        }
    )
    assert interview_svc.is_spent_quota(429, body) is True
    soon = body.replace('"57s"', '"2s"')
    assert interview_svc.is_spent_quota(429, soon) is False


def test_the_quota_body_is_read_whole_and_not_from_its_first_500_characters(monkeypatch):
    """The regression that hid it: the details are past the truncation point."""
    body = _quota_body()
    assert len(body) > 500 and "QuotaFailure" not in body[:500]

    calls = {"n": 0}

    def exhausted(req, timeout):
        calls["n"] += 1
        raise urllib.error.HTTPError(
            req.full_url, 429, "quota", {}, io.BytesIO(body.encode("utf-8"))
        )

    monkeypatch.setattr(urllib.request, "urlopen", exhausted)
    waits = []
    req = urllib.request.Request("https://example.test", data=b"{}", method="POST")
    with pytest.raises(interview_svc.QuotaSpent, match="quota is spent"):
        interview_svc._post_with_retries(req, sleep=waits.append)
    assert calls["n"] == 1, "a spent quota is asked once, not four times"
    assert waits == [], "and nothing is waited for"


def test_a_busy_minute_is_still_tried_again(monkeypatch):
    body = _quota_body("GenerateRequestsPerMinutePerProject")
    calls = {"n": 0}

    class R(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def flaky(req, timeout):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError(
                req.full_url, 429, "busy", {}, io.BytesIO(body.encode("utf-8"))
            )
        return R(b'{"ok": true}')

    monkeypatch.setattr(urllib.request, "urlopen", flaky)
    waits = []
    req = urllib.request.Request("https://example.test", data=b"{}", method="POST")
    assert interview_svc._post_with_retries(req, sleep=waits.append) == {"ok": True}
    assert calls["n"] == 2 and waits == [interview_svc.RETRY_WAITS_S[0]]


@skip_no_db_research
def test_a_spent_allowance_reads_as_try_later_not_as_a_broken_search(client, monkeypatch):
    """What the manager sees when the free tier is done for the day."""
    from app.config import settings
    from app.services import research as research_svc

    token = _signup_research(client)
    client.post(
        "/api/v1/interview/complete",
        json={"notes": "Tengo un bar."},
        headers={"Authorization": "Bearer " + token},
    )
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")

    def spent(inp, api_key, model, call=None):
        raise interview_svc.QuotaSpent("Gemini quota is spent (429): {...}")

    monkeypatch.setattr(research_svc, "research", spent)
    resp = client.post(
        "/api/v1/interview/research",
        json={"language": "es"},
        headers={"Authorization": "Bearer " + token},
    )
    assert resp.status_code == 429, resp.text
    detail = resp.json()["detail"]
    assert detail["code"] == "research_quota_spent"
    message = detail["message"]
    assert "allowance" in message
    assert "429" not in message and "{" not in message, (
        "no raw API error reaches the manager"
    )


# --- A spent search is not retried on every welcome -------------------------


def test_after_a_429_the_search_rests_and_says_so_at_once():
    rest = interview_svc.GeminiRest()
    calls = {"n": 0}

    def spent(req, key, model):
        calls["n"] += 1
        raise RuntimeError("Gemini returned 429: You exceeded your current quota")

    inp = svc.ResearchInput(notes="Un bar", location=None, vertical_label=None,
                            language="es")
    with pytest.raises(RuntimeError, match="429"):
        svc.research(inp, "k", "m", call=spent, rest=rest)
    with pytest.raises(interview_svc.QuotaSpent):
        svc.research(inp, "k", "m", call=spent, rest=rest)
    assert calls["n"] == 1


def test_other_failures_do_not_rest_the_search():
    rest = interview_svc.GeminiRest()

    def broken(req, key, model):
        raise RuntimeError("Gemini returned 500: oops")

    inp = svc.ResearchInput(notes="Un bar", location=None, vertical_label=None,
                            language="es")
    with pytest.raises(RuntimeError):
        svc.research(inp, "k", "m", call=broken, rest=rest)
    assert not rest.resting()
