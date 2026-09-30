"""The desk in front of the planner, and the three ways it must not hurt.

None of this calls the API. What is worth testing here is not whether a small
model reads a date correctly -- that is the model's job and an eval's question
-- but the wiring around it, which is where a cheap helper in front of a
working call turns into an outage:

1. A desk that fails leaves the adjustment exactly as it was.
2. A desk that answers does not get to overwrite the manager's own words.
3. A desk that answers is not given four hundred lines of rota to read.

The routing it reports is deliberately not tested for correctness, because
nothing acts on it yet: both halves of the planner are asked either way, and
the answer only goes to the log. When that changes, this file gets the test
that says a skipped half was a half nothing was lost from.
"""

from unittest.mock import patch

import pytest

from app.services import triage
from app.services.refine_intake import plan_edits
from app.services.triage import Triage, _header_of

CONTEXT = """PERIOD 2026-10-01 to 2026-10-31. Today is 2026-10-12.
OPENING HOURS 09:00-21:00.

TEAM (#number | name | status | hours planned | days unavailable in this period).
  #1 | Juanito Perez | active | 120h | none
  #2 | Sarah Chen | active | 96h | none

SHIFTS PLANNED (date, employee, start-end):
""" + "\n".join(
    "  2026-10-%02d Juanito Perez 09:00-17:00" % day for day in range(1, 32)
)


def test_the_header_stops_before_the_shift_listing():
    header = _header_of(CONTEXT)
    assert "Juanito Perez" in header  # the team resolves names
    assert "2026-10-01 to 2026-10-31" in header  # the horizon resolves dates
    assert "SHIFTS PLANNED" not in header
    assert "09:00-17:00" not in header


def test_a_context_without_the_heading_is_still_bounded():
    # The frontend's heading moved, or the context came from somewhere else.
    # Sending the whole thing to the small model would not fail -- it would
    # quietly cost money, which is the failure nobody notices.
    runaway = "\n".join("line %d" % n for n in range(500))
    assert len(_header_of(runaway).splitlines()) <= 60


def test_no_key_means_no_desk_and_no_exception():
    assert triage.read_the_request("Juanito is ill", CONTEXT, None) is None


def test_a_desk_that_fails_is_simply_not_there():
    # Every failure mode ends the same way: None, and the planner proceeds.
    with patch("anthropic.Anthropic", side_effect=RuntimeError("boom")):
        assert triage.read_the_request("Juanito is ill", CONTEXT, "key") is None


def test_an_empty_answer_is_treated_as_no_answer():
    class _Response:
        usage = None
        parsed_output = Triage(
            request="   ", touches_calendar=True, touches_roster=False
        )

    class _Messages:
        def parse(self, **_):
            return _Response()

    class _Client:
        messages = _Messages()

    with patch("anthropic.Anthropic", return_value=_Client()):
        assert triage.read_the_request("Juanito is ill", CONTEXT, "key") is None


class _Planner:
    """A stand-in for the two planner calls that records what it was sent."""

    def __init__(self):
        self.messages = []

    def __call__(self, **kwargs):
        self.messages.append(kwargs["messages"][0]["content"])

        class _Parsed:
            ops = []
            unsupported = None

        class _Response:
            usage = None
            parsed_output = _Parsed()

        return _Response()


def _planner_sees(desk_answer, request="Juanito no puede la semana que viene"):
    """Run plan_edits with the desk stubbed, and return what the planner read."""
    planner = _Planner()

    class _Messages:
        parse = staticmethod(lambda **kw: planner(**kw))

    class _Client:
        messages = _Messages()

        def with_middleware(self, *_):
            return self

    with patch("anthropic.Anthropic", return_value=_Client()), patch.object(
        triage, "read_the_request", return_value=desk_answer
    ), patch("app.services.api_usage.note"):
        plan_edits(request, CONTEXT, "key")
    assert planner.messages, "the planner was never called"
    return planner.messages[0]


def test_the_managers_own_words_always_reach_the_planner():
    # The point of the whole design. A desk that rewrote the sentence into
    # something else would be a cheap model silently editing what a manager
    # asked for, and no amount of accuracy makes that a good trade.
    sent = _planner_sees(
        Triage(
            request="Somebody entirely different is off in March",
            touches_calendar=True,
            touches_roster=False,
        )
    )
    assert "Juanito no puede la semana que viene" in sent


def test_a_resolved_sentence_is_offered_as_a_note_under_the_original():
    sent = _planner_sees(
        Triage(
            request="Juanito Perez no puede del 2026-10-19 al 2026-10-25",
            touches_calendar=True,
            touches_roster=True,
        )
    )
    assert "2026-10-19" in sent
    # And it is labelled, so the planner knows which of the two is the request.
    assert "THEY win" in sent


def test_nothing_is_appended_when_the_desk_changed_nothing():
    words = "Juanito no puede la semana que viene"
    sent = _planner_sees(
        Triage(request=words, touches_calendar=True, touches_roster=False),
        request=words,
    )
    assert sent.count(words) == 1
    assert "RESOLVE TO" not in sent


def test_what_the_desk_could_not_read_is_passed_on_as_such():
    sent = _planner_sees(
        Triage(
            request="Juanito no puede la semana que viene",
            touches_calendar=True,
            touches_roster=False,
            unresolved="'la semana que viene' - no horizon given",
        )
    )
    assert "could not resolve" in sent
    assert "la semana que viene" in sent


def test_both_halves_are_asked_whatever_the_desk_says_they_touch():
    # The safety rule, and the reason this is not a risk today: the desk's
    # routing is written to the log and acted on by nobody. A desk that is
    # wrong about which half a sentence touches costs nothing at all.
    planner = _Planner()

    class _Messages:
        parse = staticmethod(lambda **kw: planner(**kw))

    class _Client:
        messages = _Messages()

        def with_middleware(self, *_):
            return self

    with patch("anthropic.Anthropic", return_value=_Client()), patch.object(
        triage,
        "read_the_request",
        return_value=Triage(
            request="Juanito is ill", touches_calendar=False, touches_roster=False
        ),
    ), patch("app.services.api_usage.note"):
        plan_edits("Juanito is ill", CONTEXT, "key")

    # Three since per-person premiums got a call of their own (the pay half);
    # the desk skips none of them.
    assert len(planner.messages) == 3


def test_the_planner_still_works_with_no_desk_at_all():
    sent = _planner_sees(None)
    assert "Juanito no puede la semana que viene" in sent
    assert "RESOLVE TO" not in sent
