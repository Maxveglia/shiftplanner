"""The vocabulary that turns "Juanito está enfermo" into a row in `absence`.

Two things are checked here, and neither needs the API.

THE WORDS ARE IN THE PROMPT. The model can only emit `add_absence` if it is
told the operation exists, and it can only be told once -- the roster call.
This file fails if the operation is added to the schema and not to the prompt,
which is the shape of the bug that is invisible in production: the field is
there, nothing ever fills it, and every absence keeps arriving as a `day_off`
that dies with the draft.

THE SCHEMA STAYS SMALL. `refine_intake` exists in two halves because one schema
describing sixteen operations over nineteen fields was answered with
`400 Schema is too complex`, and the failure was silent -- a working fallback
caught it and the manager got a regex. Every field added to a half moves it
back towards that wall, so the count is asserted rather than left to be
noticed. `test_intake_schema_contract.py` settles the real question against the
real API; this one is the cheap guard that runs on every commit.
"""

from app.services.refine_intake import (
    CALENDAR_SYSTEM_PROMPT,
    CalendarOp,
    ROSTER_SYSTEM_PROMPT,
    RosterOp,
)


def test_the_roster_call_knows_how_to_record_an_absence():
    ops = RosterOp.model_fields["op"].annotation.__args__
    assert "add_absence" in ops
    for field in ("date", "date_to", "absence_kind"):
        assert field in RosterOp.model_fields


def test_the_prompt_teaches_the_operation_it_was_given():
    # The schema alone is not enough: an operation nobody is told about is
    # never emitted, and the absence keeps arriving as a day off.
    assert "add_absence" in ROSTER_SYSTEM_PROMPT
    for kind in ("sick", "vacation", "personal", "unpaid", "unknown"):
        assert kind in ROSTER_SYSTEM_PROMPT


def test_the_prompt_says_which_call_owns_a_reason_and_which_owns_a_preference():
    # The distinction the whole feature rests on. A reason somebody is away is
    # an absence; a preference about the rota is a day off. Said in the roster
    # prompt, because that is the call that has to decide.
    assert "day_off" in ROSTER_SYSTEM_PROMPT
    assert "NEVER GUESS IT" in ROSTER_SYSTEM_PROMPT


def test_a_stretch_of_days_is_sayable_in_one_calendar_operation():
    assert "date_to" in CalendarOp.model_fields
    assert "date_to" in CALENDAR_SYSTEM_PROMPT


def test_neither_half_has_grown_back_towards_the_complexity_ceiling():
    # The numbers that failed were 16 operations over 19 fields, in ONE model.
    assert len(CalendarOp.model_fields) <= 14
    assert len(RosterOp.model_fields) <= 16
