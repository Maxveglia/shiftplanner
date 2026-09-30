"""A shift from nine to nine is a mistake, not a day.

"09:00-09:00" is somebody who filled the second box before they meant to. Read
as a night it becomes twenty-four hours on one person, which no manager asked
for and no law allows. A close before an open IS a night (22:00-06:00), so the
rule is about the one reading that says nothing: the same minute twice.

Publishing already refuses it, because the server compares instants and two
equal instants are a shift that "ends before it starts". A shift TEMPLATE does
not: its schema compares nothing, so ``POST /shift-templates`` stores
09:00-09:00 and every calendar cut from it inherits the question.

Eval case: .claude/evals/reglas-de-turnos/cases/01-inicio-igual-fin.md

Pure tests -- no database, no network. ``validate_shifts`` is handed a stand-in
for the two lookups it makes, which is all of the session it reads.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.assignment import ShiftIn
from app.schemas.shift_template import ShiftTemplateCreate
from app.services.schedule import validate_shifts
from tests.known_gap import known_gap

ORG = uuid.uuid4()
ANA = uuid.uuid4()
MONTH_START = datetime(2026, 3, 1, tzinfo=timezone.utc)
MONTH_END = datetime(2026, 4, 1, tzinfo=timezone.utc)


class _Lookups:
    """What ``validate_shifts`` reads: the live roster, then the org's templates.

    In that order, one ``execute`` each. Anything more and this raises, which is
    the cue to use the real database instead of growing this.
    """

    def __init__(self, employees, templates):
        self._answers = [list(employees), list(templates)]

    def execute(self, _statement):
        ids = self._answers.pop(0)
        return SimpleNamespace(scalars=lambda: iter(ids))


def _validate(start: datetime, end: datetime):
    shift = ShiftIn(employee_id=ANA, start_at=start, end_at=end)
    return validate_shifts(
        _Lookups(employees=[ANA], templates=[]),
        ORG,
        [shift],
        MONTH_START,
        MONTH_END,
    )


def _template(start: str, end: str) -> ShiftTemplateCreate:
    return ShiftTemplateCreate(
        name="Mañana",
        start_time=start,
        end_time=end,
        unpaid_break_minutes=0,
        color="#2563EB",
        is_night=False,
        is_weekend_premium=False,
    )


# --------------------------------------------------------------------------
# Publishing: the instants already say it.
# --------------------------------------------------------------------------


def test_a_shift_that_ends_the_minute_it_starts_is_refused_by_name():
    nine = datetime(2026, 3, 2, 9, 0, tzinfo=timezone.utc)
    error = _validate(nine, nine)
    assert error is not None
    assert error["code"] == "shift_ends_before_start"


def test_a_night_that_ends_the_next_morning_is_still_published():
    """The guard on the guard: refusing 09:00-09:00 must not refuse 22:00-06:00."""
    error = _validate(
        datetime(2026, 3, 2, 22, 0, tzinfo=timezone.utc),
        datetime(2026, 3, 3, 6, 0, tzinfo=timezone.utc),
    )
    assert error is None


# --------------------------------------------------------------------------
# Templates: the wall clock says nothing yet.
# --------------------------------------------------------------------------


@known_gap("ShiftTemplateCreate does not compare start_time with end_time")
def test_a_template_that_starts_when_it_ends_is_refused():
    with pytest.raises(ValidationError):
        _template("09:00", "09:00")


def test_a_template_that_runs_past_midnight_is_accepted():
    """A night template is the legitimate case the fix above must keep."""
    night = _template("22:00", "06:00")
    assert (night.start_time.hour, night.end_time.hour) == (22, 6)
