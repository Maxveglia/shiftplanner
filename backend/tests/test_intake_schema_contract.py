"""Does the API actually ACCEPT our structured-output schemas?

This is the test that would have caught the 2026-09-02 incident and the one
`test_intake_spec.py` structurally cannot: that file builds a `ScheduleBrief`
by hand and checks the conversion, so it never learns whether Claude would
have produced one in the first place.

The failure it guards against is `400 Schema is too complex`. That error is
DETERMINISTIC -- it depends only on the shape of the schema, never on the brief
or on luck -- so one real call per schema settles it for good. Other 400s exist
and mean the opposite thing: they are the account, not the schema, and this file
is careful to say which of the two it just saw. And it is
invisible in production: the frontend used to fall back to a local regex parser
on any intake failure, so a rejected schema looked like an AI that ignored half
of what the manager wrote. (It now refuses instead, which makes the failure
loud, but still only once a manager has hit it.)

Skipped without a key so a contributor without one can still run the suite.
CI must supply ANTHROPIC_API_KEY, or this guard is not running at all.
"""

import os

import pytest

from app.services.intake import (
    MODEL,
    EmphasisFields,
    ScheduleFields,
    TeamFields,
)
from app.services.calendar_plan import MonthPlan
from app.services.refine_intake import CalendarPlan, PayPlan, RosterPlan
from app.services.triage import MODEL as TRIAGE_MODEL, Triage
from app.services import day_insights
from app.services import interview as interview_svc

API_KEY = os.environ.get("ANTHROPIC_API_KEY")

pytestmark = pytest.mark.skipif(
    not API_KEY, reason="needs a real ANTHROPIC_API_KEY: this test calls the API"
)


# Each schema WITH THE MODEL IT IS ACTUALLY SENT TO.
#
# Paired rather than assumed, because they stopped being the same model: the
# planner runs on Opus and the triage desk in front of it on Haiku. A schema
# checked against a model nothing sends it to is a test that passes while the
# real call fails -- the precise failure this file exists to make impossible.
#
# REFINE BELONGS HERE TOO, and its absence is how it broke. This file was
# written for the intake and guarded only the intake, so `EditPlan` grew --
# sixteen operations over nineteen optional fields -- until the API refused
# it outright, and every refinement fell through to the local regex parser
# without a word. Nothing failed loudly, because nothing was watching.
#
# The rule this encodes: any schema an end-to-end path depends on is one
# this test must call. There is no third way to find out.
SCHEMAS = [
    (ScheduleFields, MODEL),
    (TeamFields, MODEL),
    (EmphasisFields, MODEL),
    (CalendarPlan, MODEL),
    (RosterPlan, MODEL),
    (PayPlan, MODEL),
    (MonthPlan, MODEL),
    (Triage, TRIAGE_MODEL),
    (interview_svc._ClaudeTurn, interview_svc.CLAUDE_TURN_MODEL),
    (day_insights.DayReading, day_insights.MODEL),
]


@pytest.mark.parametrize(
    "schema,model", SCHEMAS, ids=lambda v: v.__name__ if hasattr(v, "__name__") else v
)
def test_api_accepts_the_schema(schema, model):
    """The API must accept the schema itself, whatever the brief says.

    Deliberately minimal: one token of output is enough, because what is under
    test is whether the request is accepted, not the quality of the answer.
    """
    import anthropic

    client = anthropic.Anthropic(api_key=API_KEY, timeout=60.0)

    try:
        client.messages.parse(
            model=model,
            max_tokens=1024,
            system="Return an empty result.",
            messages=[{"role": "user", "content": "We open 9 to 5."}],
            output_format=schema,
        )
    except anthropic.BadRequestError as exc:
        # A 400 here is not one failure, it is two, and they point at opposite
        # fixes. "Schema is too complex" is the contract breaking: the shape
        # this repo just changed is one the API will not accept, and the repair
        # is a few lines away. Every other 400 is a condition of the ACCOUNT --
        # an exhausted credit balance is the one that has actually happened --
        # and it says nothing whatsoever about the schema.
        #
        # Telling the second story with the first one's words is expensive:
        # this is the guard people consult before touching the intake, and it
        # was sending them off to split a model that had nothing wrong with it.
        # `AuthenticationError` is a different class and never reached here;
        # a spent balance arrives as a plain BadRequestError, which is exactly
        # why it wore the wrong message.
        if "too complex" not in str(exc).lower():
            pytest.fail(
                "Could not check %s. The API refused the call for a reason "
                "that is NOT the schema, so this run proves nothing either "
                "way -- do not go splitting models over it. Clear the "
                "condition below and run it again.\n\n%s"
                % (schema.__name__, exc)
            )
        pytest.fail(
            "The API rejected %s -- a manager would get no calendar at all.\n"
            "Adding a nested model is what pushes this over the limit; a scalar "
            "field is usually cheap. Split the schema into another call rather "
            "than trimming what the intake can understand.\n\n%s"
            % (schema.__name__, exc)
        )


def test_claude_can_stand_in_for_gemini_in_the_interview():
    """The fallback end to end: the real call, read by the real parse_turn.

    Mid-transcript on purpose, shaped like the one that failed on 2026-09-23:
    our hours question first (an assistant turn with nothing before it), then
    the manager's answers.
    """
    req = interview_svc.GeminiRequest(
        system_instruction=interview_svc.build_system_instruction("es", finish=False),
        contents=interview_svc.to_contents(
            [
                interview_svc.InterviewMessage(
                    role="assistant", text="¿A qué hora abrís cada día?"
                ),
                interview_svc.InterviewMessage(
                    role="manager", text="De lunes a domingo de 19:00 a 03:00."
                ),
                interview_svc.InterviewMessage(role="manager", text="Octubre."),
            ]
        ),
    )
    turn = interview_svc.parse_turn(interview_svc._call_claude(req, API_KEY))
    assert turn.reply and not turn.done
