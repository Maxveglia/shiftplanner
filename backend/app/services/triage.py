from __future__ import annotations

"""The desk that reads the sentence first, cheaply, before Claude plans it.

Every adjustment costs TWO calls to the planner today -- one that knows the
calendar vocabulary and one that knows the roster's -- and both run on every
sentence, including "give Ana her Friday off", which has nothing whatever to
say to the roster half. That is not an oversight: neither half decides anything,
so nothing can be lost by asking both. It is simply blind.

This is the receptionist in front of them. A small, fast model reads the
sentence and does the part of the work that needs no judgement about rotas:

**IT RESOLVES WHAT THE SENTENCE POINTS AT.** "La semana que viene" is a pair of
dates; "el nuevo de caja" is somebody with a name. Handing the planner a
sentence whose dates and names are already settled is worth more than it looks:
those are exactly the two things the planner gets wrong quietly -- a date it
guessed wrong is a shift on the wrong day, and a name it could not place is an
operation dropped with a line in `skipped` nobody reads.

**IT NOTICES A STANDING RULE.** Most sentences are about one week. A few are
about how this business always runs -- "Laura siempre abre", "Ana y Luis nunca
juntos" -- and until now those were used once and thrown away: the calendar
obeyed them that month and forgot them, and the manager had to type them again
in November. Spotting one costs nothing here, because this call is already
reading the sentence. What is done with it is deliberately slow: it becomes a
PROPOSAL the manager confirms, never a rule that starts steering rotas on its
own -- see `business_profile.note_stated_rule`.

**IT SAYS WHICH HALVES THE SENTENCE TOUCHES.** And, for now, NOTHING IS DONE
WITH THAT. Both halves are asked exactly as before. The answer is written to
the log so that in a few weeks there is evidence about whether this model is
ever wrong about it -- and only then is it worth saving the call it says is
unnecessary. Turning that on today would be trading a real capability for a
saving nobody has measured.

THREE RULES, AND EACH ONE IS A WAY THIS COULD HAVE GONE WRONG.

*The original words always travel.* The planner receives the manager's sentence
verbatim, and the resolved version beside it as a note. A receptionist that
misreads a sentence can therefore make the planner's job no harder than it was
before -- it cannot delete what the manager actually said. This is the whole
reason a cheap model is safe here.

*It never blocks.* Every failure -- a timeout, a bad key, a model that answers
nonsense -- returns None and the adjustment proceeds exactly as it does today.
Putting a second call in front of a working one is only acceptable if the second
one cannot take the first one down with it.

*It reads the header, not the calendar.* The context it is given stops before
the shift listing: the horizon and the team are what dates and names resolve
against, and four hundred lines of rota are not. That keeps this call at a
fraction of a cent rather than a fraction of the planner's cost, which is the
entire point of it being a small model.
"""

import logging
import time
from typing import Optional

from pydantic import BaseModel, Field

from app.services import api_usage

log = logging.getLogger(__name__)

# The small model, and the reason this is worth doing at all: the planner runs
# on Opus because deciding what a rota should look like is a judgement call.
# Reading a date off a calendar is not.
MODEL = "claude-haiku-4-5"

# Short, because this call is in front of one the manager is already waiting
# for. Anything slower than a couple of seconds costs more in wall-clock than
# it saves in anything, and the fallback -- proceeding without it -- is good.
TIMEOUT_SECONDS = 8.0
MAX_RETRIES = 1

# Small: it writes two short sentences and three flags.
MAX_TOKENS = 1024

PURPOSE = "refine.triage"

# Where the context stops being about the business and starts being the rota.
#
# `buildRefineContext` in the frontend writes the horizon and the team first and
# the shift listing last, under this heading. Everything before it is what a
# date or a name resolves against; everything after it is several hundred lines
# this call has no use for. Coupled to a literal on the other side of the wire
# on purpose, and guarded twice: `refine_context_header_is_findable` in the
# frontend asserts the heading is still written, and `_header_of` below falls
# back to a line count if it ever is not.
_SHIFT_LISTING_HEADING = "SHIFTS PLANNED"

# What to keep when the heading is missing. Generous enough for a big team,
# small enough that a whole month of shifts cannot get through.
_FALLBACK_HEADER_LINES = 60

SYSTEM_PROMPT = """You are the first pass over a manager's request to change a \
staff rota. You do NOT plan anything and you do NOT decide what should change. \
A second, larger model does that, and it is given the manager's own words \
whatever you write. Your job is to make its job easier, and there are three \
parts to it.

1. RESOLVE WHAT THE SENTENCE POINTS AT.
Rewrite the request with its dates and its people made explicit, and change \
NOTHING else. Keep the manager's wording, their language, and their meaning.
- Dates: turn "next week", "la semana que viene", "el lunes", "the 18th" into \
"YYYY-MM-DD", read against the horizon and today's date you were given. A \
stretch of days stays a stretch: write it as "from YYYY-MM-DD to YYYY-MM-DD".
- People: turn "the new one", "el de caja", "#3", a first name or a misspelling \
into the person's full name EXACTLY as the team list spells it.
- Anything you cannot resolve, LEAVE EXACTLY AS IT IS and name it in \
`unresolved`. A guess here is worse than a gap: the larger model still has the \
original sentence and can work it out, but it cannot un-see a date you invented.
- Never add a request, never remove one, never answer one. "Ana is ill" does \
not become "give Ana the week off".

2. NOTICE A STANDING RULE, IF THERE IS ONE.
Set `standing_rule` only when the sentence states something that is true of \
this business EVERY week -- how the rota should always be built. Otherwise \
leave it null, which is the normal answer.
- A RULE: "Laura always opens", "Ana and Luis never work together", "nobody \
closes two days running", "the weekend shift is always two people".
- NOT A RULE, and these are the majority: anything about one week or one day \
("Ana is off on the 18th"), anything about one person's situation ("Juanito is \
ill", "Pedro asked for Friday"), a hiring, a one-off change. A fact about a \
day teaches nothing about how the business runs, and a fact about somebody's \
health or their leave is NEVER a rule -- do not write one from it under any \
wording.
- Write it as ONE short sentence in the manager's own language and their own \
words, as a rule about the rota. Names of people are fine and often necessary \
("Laura siempre cierra"); a reason somebody was away is not.
- If you are not sure it is permanent, leave it null. The cost of missing one \
is that the manager types it again; the cost of inventing one is a standing \
rule about their business that nobody asked for.

3. SAY WHICH HALVES IT TOUCHES.
- `touches_calendar`: it is about shifts, days off, opening hours, how many \
people are needed, who works when.
- `touches_roster`: it is about WHO is on the team -- hiring, somebody leaving, \
a name, a contract, hours contracted, or time off with a reason (illness, \
holiday, a day somebody asked for).
Both can be true; "hire Ana and give her Fridays off" is both. When you are not \
sure, say TRUE. Being wrong in that direction costs a little money. Being wrong \
in the other direction loses something the manager asked for."""


class Triage(BaseModel):
    """What the desk made of the sentence.

    Five fields, and flat, for the reason every schema in this codebase is
    flat: this is the shape the API is asked to fill, and the one that has
    twice been refused here for reaching past it.
    """

    request: str = Field(
        description="The manager's request with its dates and names made "
        "explicit, and nothing else changed."
    )
    touches_calendar: bool = Field(
        description="True if it is about shifts, days off, hours or staffing."
    )
    touches_roster: bool = Field(
        description="True if it is about who is on the team, their terms, or "
        "time off with a reason."
    )
    unresolved: Optional[str] = Field(
        default=None,
        description="Anything in the sentence you could not resolve, left as "
        "it was. Null when everything resolved.",
    )
    standing_rule: Optional[str] = Field(
        default=None,
        description="One short sentence, in the manager's own words, if this "
        "request states something true of the business EVERY week. Null "
        "otherwise -- which is the normal answer.",
    )


def _header_of(context: str) -> str:
    """The part of the planner's context a date or a name resolves against.

    Everything up to the shift listing: the horizon, the opening hours, the
    rules and the team. The listing itself is the long part and is no use for
    resolving anything, so it is cut -- which is what keeps this call cheap
    enough to be worth making.
    """
    cut = context.find(_SHIFT_LISTING_HEADING)
    if cut > 0:
        return context[:cut].rstrip()
    # The heading moved or the context came from somewhere else. Keep a
    # bounded prefix rather than the whole thing: a call that silently started
    # sending a month of shifts to the small model would show up as a bill,
    # not as an error.
    return "\n".join(context.splitlines()[:_FALLBACK_HEADER_LINES])


def read_the_request(
    text: str, context: str, api_key: Optional[str]
) -> Optional[Triage]:
    """Read the sentence cheaply, or return None and let the planner proceed.

    NEVER RAISES. This call sits in front of one that works; every way it can
    fail has to end with the adjustment happening anyway. That is what makes it
    safe to put a second model in the path of the first.
    """
    if not api_key:
        return None

    import anthropic

    started = time.monotonic()
    try:
        client = anthropic.Anthropic(
            api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES
        )
        # No `thinking` and no `effort`: Haiku 4.5 takes neither, and this is
        # not a job that wants either. It reads a date off a calendar.
        response = client.messages.parse(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": "%s\n\nMANAGER'S REQUEST:\n%s"
                    % (_header_of(context), text),
                }
            ],
            output_format=Triage,
        )
    except Exception as exc:  # noqa: BLE001 - the planner does not need this
        log.info("triage: skipped (%s: %s)", type(exc).__name__, exc)
        return None

    try:
        api_usage.note(
            PURPOSE, MODEL, response.usage, int((time.monotonic() - started) * 1000)
        )
    except Exception:  # noqa: BLE001 - the meter must not cost us the answer
        log.exception("triage: could not meter the call")

    read = response.parsed_output
    if read is None or not read.request.strip():
        return None
    return read
