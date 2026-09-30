from __future__ import annotations

"""The month that never stops being written.

Streaming fixed the failure of 14-sep-2026 -- a whole-answer timeout of 180s
against a reply that takes minutes -- by removing the whole-answer deadline
altogether. That left nothing at all stopping a month, and the browser's own
600s would have become the real limit: it can report that it waited, and
nothing about what it was waiting for.

So the ceiling is kept by hand now, and this is what holds it there. What the
test asserts is not the number: it is that the number is ENFORCED, and that
blowing it costs one month rather than the calendar -- the greedy pass covers
the block, same as any other failed month.

It also holds the meter to the same story. A month we gave up on was still
written and still billed, and metering only the months that arrived is what
let an afternoon of nine abandoned attempts look, in `api_usage`, like an
afternoon when nobody generated anything.
"""

from types import SimpleNamespace

import pytest

from app.services import api_usage


USAGE = SimpleNamespace(
    input_tokens=10, output_tokens=10, cache_creation_input_tokens=0,
    cache_read_input_tokens=0,
)


class _EndlessStream:
    """A reply that keeps arriving. Every event is well-formed and on time --
    the connection is healthy, which is exactly the case the per-event timeout
    cannot see.

    ``snapshot`` is what the SDK accumulates as the reply lands. ``None`` is
    the call that died before its first event, which has nothing to meter.
    """

    def __init__(self, snapshot):
        self._snapshot = snapshot

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        while True:
            yield SimpleNamespace(type="content_block_delta")

    @property
    def current_message_snapshot(self):
        # The SDK asserts here when no event has landed yet; anything raised
        # is "nothing to meter", which is the behaviour under test.
        assert self._snapshot is not None
        return self._snapshot

    def get_final_message(self):  # pragma: no cover - never reached
        raise AssertionError("the deadline should have fired first")


class _SlowModel:
    """Writes forever. ``snapshot`` is shared by every month it is asked for."""

    snapshot = None

    def __init__(self, *args, **kwargs):
        self.messages = self

    def with_middleware(self, *_middleware):
        """The real client returns a cheap copy that shares the connection
        pool. The planner wraps itself once per generation to count the HTTP
        attempts the SDK retries internally, so a double that cannot do this
        is a double that no longer matches the thing it stands in for."""
        return self

    def stream(self, **kw):
        return _EndlessStream(_SlowModel.snapshot)


@pytest.fixture
def slow_model(monkeypatch):
    import anthropic
    from app.services import calendar_plan

    _SlowModel.snapshot = None
    monkeypatch.setattr(anthropic, "Anthropic", _SlowModel)
    # Zero, so the first event is already late. The clock is what is under
    # test, not how generous it is.
    monkeypatch.setattr(calendar_plan, "WHOLE_ANSWER_SECONDS", 0.0)
    return _SlowModel


def test_a_month_still_being_written_at_the_deadline_is_one_failed_month(slow_model):
    from app.services import calendar_plan

    shifts, failed = calendar_plan.plan_calendar("context", ["2026-10"], "key")

    assert failed == ["2026-10"]
    assert shifts == []


def test_a_month_given_up_on_is_metered_for_what_it_had_already_written(slow_model):
    from app.services import calendar_plan

    slow_model.snapshot = SimpleNamespace(usage=USAGE)

    with api_usage.collect() as ledger:
        _, failed = calendar_plan.plan_calendar("context", ["2026-10"], "key")

    assert failed == ["2026-10"]
    # Metered apart from the months that arrived: the back office shows it as
    # its own line, which is the only way spend with nothing to show for it is
    # visible at all.
    assert [(e.purpose, e.output_tokens) for e in ledger.entries] == [
        ("plan.month.failed", USAGE.output_tokens)
    ]


def test_a_month_that_died_before_its_first_event_meters_nothing(slow_model):
    from app.services import calendar_plan

    # No snapshot: the connection failed before the reply began, so there is
    # nothing the provider could bill for and nothing to invent.
    slow_model.snapshot = None

    with api_usage.collect() as ledger:
        _, failed = calendar_plan.plan_calendar("context", ["2026-10"], "key")

    assert failed == ["2026-10"]
    assert ledger.entries == []
