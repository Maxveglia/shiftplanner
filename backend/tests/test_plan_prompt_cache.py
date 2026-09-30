"""Prompt caching in the month planner: where the markers go, and who waits.

The saving is small (input is ~5% of what a month costs) and the ways to get
it wrong are silent: a marker after the month line writes a fresh entry per
month and reads none, and months fired together each pay the write premium.
These tests pin the shape, since a bill is the only other place it shows.
"""
from __future__ import annotations

import threading
import time
from types import SimpleNamespace

import pytest

USAGE = SimpleNamespace(
    input_tokens=1,
    output_tokens=1,
    cache_creation_input_tokens=0,
    cache_read_input_tokens=0,
)


class _Stream:
    def __init__(self, response, events=(), before_first=None):
        self._response = response
        self._events = list(events)
        self._before_first = before_first

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        for event in self._events:
            if self._before_first is not None:
                assert self._before_first.wait(timeout=30), "never released"
                self._before_first = None
            yield event

    def get_final_message(self):
        return self._response


class _Model:
    calls: list = []
    hold_first: dict = {}
    fail: set = set()
    lock = threading.Lock()

    def __init__(self, *args, **kwargs):
        self.messages = self

    def with_middleware(self, *_middleware):
        return self

    def stream(self, **kw):
        from app.services.calendar_plan import MonthPlan

        month = kw["messages"][0]["content"][-1]["text"]
        with _Model.lock:
            _Model.calls.append((time.monotonic(), month, kw))
        if month in _Model.fail:
            raise RuntimeError("no stream for %s" % month)
        events = [
            SimpleNamespace(type="message_start"),
            SimpleNamespace(type="content_block_start"),
        ]
        return _Stream(
            SimpleNamespace(parsed_output=MonthPlan(), usage=USAGE),
            events,
            _Model.hold_first.get(month),
        )


@pytest.fixture
def model(monkeypatch):
    import anthropic

    _Model.calls = []
    _Model.hold_first = {}
    _Model.fail = set()
    monkeypatch.setattr(anthropic, "Anthropic", _Model)
    return _Model


def _plan(months, context="THE BUSINESS", preferences=""):
    from app.services.calendar_plan import plan_calendar

    return plan_calendar(context, months, "k", preferences=preferences)


def test_one_month_sends_no_cache_marker(model):
    """Nothing would read it, so a write is only a 25% surcharge on input."""
    _plan(["2026-10"])
    (_, _, kw), = model.calls
    assert all("cache_control" not in b for b in kw["system"])
    assert all("cache_control" not in b for b in kw["messages"][0]["content"])
    assert kw["messages"][0]["content"][-1]["text"] == "Plan the month of 2026-10."


def test_the_shared_prefix_is_marked_and_the_month_comes_after_it(model):
    _plan(["2026-10", "2026-11", "2026-12"], preferences="e1 always opens")
    assert len(model.calls) == 3
    prefixes = set()
    for _, month, kw in model.calls:
        (system,) = kw["system"]
        assert system["cache_control"] == {"type": "ephemeral"}
        assert "WHAT THIS MANAGER PREFERS" in system["text"]
        shared, asked = kw["messages"][0]["content"]
        assert shared == {
            "type": "text",
            "text": "THE BUSINESS",
            "cache_control": {"type": "ephemeral"},
        }
        # The varying line carries no marker, or each month writes its own.
        assert "cache_control" not in asked
        assert asked["text"] == month
        prefixes.add((system["text"], shared["text"]))
    # Byte-identical prefix across months, or nothing is ever read.
    assert len(prefixes) == 1


def test_no_empty_block_when_there_is_no_context(model):
    """The API refuses an empty text block."""
    _plan(["2026-10", "2026-11"], context="  ")
    for _, _, kw in model.calls:
        (only,) = kw["messages"][0]["content"]
        assert only["text"].startswith("Plan the month of")
        assert "cache_control" not in only


def test_siblings_wait_for_the_first_month_to_start_streaming(model, monkeypatch):
    from app.services import calendar_plan

    monkeypatch.setattr(calendar_plan, "FIRST_MONTH_HEAD_START_SECONDS", 30.0)
    release = threading.Event()
    model.hold_first = {"Plan the month of 2026-10.": release}

    done = threading.Event()
    worker = threading.Thread(
        target=lambda: (_plan(["2026-10", "2026-11", "2026-12"]), done.set())
    )
    worker.start()
    time.sleep(0.3)
    assert [m for _, m, _ in model.calls] == ["Plan the month of 2026-10."]

    release.set()
    assert done.wait(timeout=10)
    worker.join()
    asked = [m for _, m, _ in model.calls]
    assert asked[0] == "Plan the month of 2026-10."
    assert sorted(asked[1:]) == [
        "Plan the month of 2026-11.",
        "Plan the month of 2026-12.",
    ]


def test_a_first_month_that_dies_does_not_hold_the_rest(model, monkeypatch):
    from app.services import calendar_plan

    monkeypatch.setattr(calendar_plan, "FIRST_MONTH_HEAD_START_SECONDS", 30.0)
    model.fail = {"Plan the month of 2026-10."}
    started = time.monotonic()
    _, failed = _plan(["2026-10", "2026-11"])
    assert failed == ["2026-10"]
    assert time.monotonic() - started < 5
    assert len(model.calls) == 2
