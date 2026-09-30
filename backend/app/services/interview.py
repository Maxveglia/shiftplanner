"""The opening interview: a few questions about the business, asked by Gemini.

WHY A SECOND MODEL. The brief is the whole product: a manager who writes a
good one gets a good calendar, and a manager who writes "haz el horario" gets
assumptions. Many managers do not know what a good brief contains. So before
anyone writes one, something can ASK -- opening hours, closures, busy times,
how many people and on what contracts -- and write the brief for them from
the answers. Asking is cheap, mechanical work; it does not need the model that
plans the calendar. Gemini's free tier does it for nothing, and the brief it
produces goes to Claude exactly as if the manager had typed it.

THE RULE THAT SHAPES EVERYTHING HERE: the free tier means Google may train on
what is sent, so what may be asked is drawn narrowly and on purpose. Until
2026-09-14 that line sat before names; the product owner moved it, knowingly,
so the interview can ask WHO works here and for how many contract hours --
the two facts a calendar cannot be built without, and the ones a manager
would otherwise type into the roster by hand afterwards. What stays on the
far side of the line is everything else about a person: age, health, pay,
address, personal situation. None of it is asked, and a manager who
volunteers it is not asked about it again.

Nothing from the roster is ever INCLUDED in a request either: the only thing
sent is what the manager typed into this conversation, names and all. The
line under the chat box says exactly this, before the first question.

WHAT IT DOES NOT DO. It does not learn, does not write hints or beliefs, does
not touch the database. Its whole output is one paragraph of text, shown to
the manager, who can edit it before a word of it is used.

The HTTP call is isolated in `_call_gemini` so everything else -- the
instruction, the transcript shape, the parse of the reply -- runs in tests
without a key.
"""
from __future__ import annotations

import json
import logging
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, List, Literal, Optional

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

# The free tier answers "high demand, try again later" (503) and "too many
# requests" (429) as a matter of course, several times an hour. A manager
# mid-conversation must not see either for a blip that clears in a second, so
# the call is tried this many times, waiting these seconds between tries,
# before it gives up and the router reports it.
RETRY_STATUSES = (429, 503)
RETRY_WAITS_S = (1.5, 3.0, 6.0)

# A 429 is two different incidents wearing one number, and the whole budget
# above is 10.5 seconds. "Too many requests this minute" clears inside that;
# "you have spent your allowance for the day" does not, and waiting for it
# costs a manager ten seconds before telling them the same thing. Google
# names which one it is in the body -- a QuotaFailure violation whose quotaId
# says PerDay or PerMonth, or a RetryInfo asking for longer than we have --
# so those fail at once and the rest are still tried again.
#
# The same lesson the intake learned from `400`: a status code is the start
# of the diagnosis, not the end of it.
_SPENT_QUOTA_MARKERS = ("perday", "permonth", "per_day", "per_month")


class QuotaSpent(RuntimeError):
    """The allowance is gone until it resets. Distinct because the answer is.

    Everything else that goes wrong with these calls is worth retrying or
    worth showing as a fault. This one is neither: nothing is broken, there
    is simply no more of it today, and the only honest thing to tell the
    manager is that -- not a stack of JSON with the word RESOURCE_EXHAUSTED
    in it. A class rather than a string to match on, so the routers that map
    it to a status code cannot be broken by rewording the message.
    """
# A saturated model can also simply not answer. Twenty seconds is many times
# what the lite model needs, and a second try beats a manager left hanging.
CALL_TIMEOUT_S = 20

# How long ONE turn of the interview may take, both models included.
#
# The per-call timeout above is not a promise to anybody: three retries of it
# plus the waits between them come to ninety seconds, while the browser gives
# up on the turn well before that (INTERVIEW_TURN_TIMEOUT_MS in
# frontend/src/api/interview.ts, which must stay ABOVE this).
#
# And waiting longer does not help. On 2026-09-23 the lite model answered two
# 503 "high demand" and then two tries that never came back: 45 seconds spent
# on a model that was not going to answer, and a manager with no question at
# the end of them. So Gemini gets a short budget -- the lite model answers in
# about a second when it answers at all -- and what is left goes to Claude,
# which asks the same question from the same instructions (see
# `_call_claude`).
#
# 4 s and not 8: measured the same evening, a Gemini that is down cost every
# single question 8 s of nothing before Claude answered in one or two, and the
# manager read it as the app being stuck. With a budget this short there is no
# retry inside it either: the fallback IS the retry.
GEMINI_TURN_BUDGET_S = 6
GEMINI_TURN_TRY_S = 4
CLAUDE_TURN_TIMEOUT_S = 25
TURN_DEADLINE_S = GEMINI_TURN_BUDGET_S + CLAUDE_TURN_TIMEOUT_S

# And once it has failed, it is not asked again for a while. Gemini's bad
# spells last minutes to hours (high demand, or the free quota spent until it
# resets), so asking it first on every question meant paying the wait on every
# question. For this long after a failure the turn goes straight to Claude.
GEMINI_REST_S = 600

# The web search after the interview rests longer after a 429: its free quota
# (grounding has its own) is spent for the day when it is spent at all, and the
# welcome waits for that call before opening the dashboard.
RESEARCH_REST_S = 3600


class GeminiRest:
    """When Gemini last failed for a use, so the next caller can skip it.

    Per process, in memory: a restart forgets it, which costs one slow call.
    """

    def __init__(self, clock=time.monotonic):
        self._until = 0.0
        self._clock = clock

    def resting(self) -> bool:
        return self._clock() < self._until

    def rest(self, seconds: float) -> None:
        self._until = self._clock() + seconds

    def clear(self) -> None:
        self._until = 0.0


TURN_REST = GeminiRest()
RESEARCH_REST = GeminiRest()


# The stand-in. Haiku because asking one short question is the same small
# job it does in triage, and it is the fastest model we are billed for.
CLAUDE_TURN_MODEL = "claude-haiku-4-5"
CLAUDE_TURN_MAX_TOKENS = 2048

# No try is started with less than this left: a call cut off after two
# seconds cannot come back with a turn, and only delays the honest answer.
MIN_ATTEMPT_S = 5

# What the interview has to find out, in the order it asks. Each line is one
# topic, not one question: the model phrases the question itself, in the
# manager's language, and skips a topic the manager already covered. Edit
# this list to change what is asked; nothing else knows the topics.
TOPICS: List[str] = [
    "What kind of business it is (a bar, a shop, a clinic...).",
    "Where it is (the town or neighbourhood).",
    "How many people work there in total -- just the number.",
    "How many of them need to be working at the same time while it is open "
    "-- the fewest that can hold the place.",
    "Who those people are: what each one is called and how many hours a week "
    "their contract is for. LAST, and after the number in topic 3, because "
    "the client answers this one with a table it builds from that number. "
    "Ask for the whole team in one question.",
]

Role = Literal["manager", "assistant"]


class InterviewMessage(BaseModel):
    role: Role
    text: str = Field(min_length=1, max_length=4000)


# The forms the client can put under a question instead of a text box. A
# CODE the model picks, never a guess made from the words it wrote: branching
# on the question's text would break the moment it was phrased differently or
# translated. Anything outside this set is read as "no form" -- an older or
# newer model saying something we do not serve must not blank the box the
# manager was about to type into.
FORMS = ("roster",)


class InterviewTurn(BaseModel):
    """What the model answers with, every turn."""

    reply: str
    done: bool
    brief: Optional[str] = None
    #: The form that answers this question, when one of ours does.
    form: Optional[str] = None
    #: For the roster form: how many people the manager said work there, so
    #: the table opens with a row each instead of one empty row. None when
    #: they have not said a number, or said one nobody staffs a rota with.
    form_people: Optional[int] = None


# The structured shape asked of the model, so a turn is never prose to parse.
RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "reply": {
            "type": "STRING",
            "description": "The next thing to say to the manager: one question, "
            "or a short closing line when done.",
        },
        "done": {
            "type": "BOOLEAN",
            "description": "True once every topic is covered or the manager asked "
            "to stop.",
        },
        "brief": {
            "type": "STRING",
            "description": "Only when done: the brief, first person, in the "
            "language the instruction names -- never in another one, whatever "
            "language the manager answered in. Empty otherwise.",
        },
        "form": {
            "type": "STRING",
            "enum": ["none", "roster"],
            "description": "'roster' when this question is the one asking who "
            "works here and on what contract hours, so the manager can fill a "
            "table in instead of typing a list. 'none' for every other turn.",
        },
        "formPeople": {
            "type": "INTEGER",
            "description": "With form 'roster': how many people the manager "
            "said work there in total, so the table opens with that many rows. "
            "0 if they never said a number. 0 on every other turn.",
        },
    },
    "required": ["reply", "done", "brief", "form", "formPeople"],
}

# The most rows the table is opened with from what the model read. A big
# number here is a misread ("40 horas" heard as forty people), and forty empty
# rows in front of a manager is worse than one: they have to delete them.
MAX_FORM_PEOPLE = 30


# The language the interview is held in, as the instruction names it. The
# router has already narrowed the client's tag to one of these two.
LANGUAGE_NAMES = {"es": "Spanish", "en": "English"}

# A worked example of the closing brief -- one per language, and that is the
# point.
#
# An example is the strongest line in a prompt: it fixes the register, the
# length and the shape at once, in a way no description of them does. For a
# long time there was only the Spanish one, sitting under an instruction to
# write "the manager's language" -- so an English interview asked its questions
# in English and then handed back a Spanish paragraph often enough to be a bug
# rather than a quirk, because the only brief the model had ever been shown was
# Spanish. The example travels with the language now.
BRIEF_EXAMPLES = {
    "es": (
        "Tengo un bar que abre de 18:00 a 3:00 todos los días. Somos seis: "
        "Ana y Luis con 40 horas, Marta con 20..."
    ),
    "en": (
        "I run a bar that is open from 6pm to 3am every day. There are six of "
        "us: Ana and Luis on 40 hours, Marta on 20..."
    ),
}

# What "write it properly" means in each language, in the one way each of them
# actually goes wrong here: Spanish loses its accents, and English drifts into
# whatever language the manager is answering in.
SPELLING_NOTES = {
    "es": "in Spanish that means the accents and the opening \u00bf of a question",
    "en": (
        "in English that means plain, correctly spelled sentences, with no "
        "words or punctuation borrowed from another tongue"
    ),
}


def build_system_instruction(language: str, finish: bool = False) -> str:
    """The instruction for one turn. `finish` asks for the brief now.

    Every line that depends on the language is chosen from `language` rather
    than written into the prose -- the question, the closing line, the brief
    and the example of it. Half of them used to be written in, which is how an
    English interview ended in a Spanish paragraph.
    """
    lang = "es" if language == "es" else "en"
    name = LANGUAGE_NAMES[lang]
    topics = "\n".join("%d. %s" % (i + 1, t) for i, t in enumerate(TOPICS))
    lines = [
        "You help the manager of a small business describe how it runs, so a "
        "shift calendar can be planned for it. You gather facts; you do not "
        "plan anything and you do not give advice.",
        "",
        "Speak %s. Ask ONE short question at a time, in plain words a busy "
        "manager answers in one breath. Never ask two things in one message."
        % name,
        "",
        "EVERY WORD YOU WRITE IS IN %s: every question, the closing line, and "
        "the brief at the end. The manager chose that language in the product, "
        "so it is the language of the interview even when they answer you in "
        "another one, and even when the people who work there have names from "
        "another one. Those names are the single exception -- spell each one "
        "back exactly as the manager wrote it." % name.upper(),
        "",
        "Write it properly -- %s. A screen that spells the manager's own "
        "language badly reads as a cheap product, whatever it then says."
        % SPELLING_NOTES[lang],
        "",
        "Cover these topics, in this order, skipping any the manager already "
        "answered:",
        topics,
        "",
        "WHAT YOU MAY ASK ABOUT PEOPLE, AND NOTHING BEYOND IT: who works "
        "there -- the name each one is called by -- and how many hours a week "
        "each one's contract is for. That is the whole list. Never ask about "
        "anyone's age, health, pay, address, family or personal situation, "
        "and if the manager volunteers any of it, do not repeat it and do not "
        "ask about it.",
        "",
        "Ask how MANY people work there (topic 3) before you ask who they are "
        "(topic 5). The table the manager fills the names into is built from "
        "that number, so asking for it first is what makes the last question "
        "a form they confirm rather than a list they type.",
        "",
        "When you ask who works there, set `form` to \"roster\" and "
        "`formPeople` to the number they gave in topic 3 (0 if they never "
        "gave one), and ask for the whole team in that one question: the "
        "manager answers it with a table rather than by typing a list, and "
        "their answer comes back as one message naming each person and their "
        "contract hours. Every other turn sets `form` to \"none\" and "
        "`formPeople` to 0.",
        "",
        "Do not invent facts the manager did not state. If they do not know "
        "something, move on; the calendar has sensible defaults.",
        "",
        "The opening hours of each weekday were collected in a form before "
        "this conversation and appear as the manager's first message. Do not "
        "ask about opening hours or closed days again; carry them into the "
        "brief exactly as given.",
        "",
        "The month of the first calendar was chosen in a form too, right after "
        "the opening hours, and appears in the transcript as the manager's "
        "second message. Never ask which month, dates or period to plan. And "
        "NEVER PUT THAT MONTH, OR THE DAYS OF IT BEING PLANNED, IN THE BRIEF: "
        "the month is kept separately, and the brief is remembered as a standing "
        "description of the business, read again every time a later calendar "
        "is planned -- a month written into it would plan every later "
        "calendar for that same month. Dates that are facts about the "
        "business -- a holiday it closes, a month it shuts -- are not that "
        "month: they stay in the brief.",
        "",
        "When every topic is covered, or the manager says that is all, set "
        "done to true and write the brief: one paragraph, first person, in "
        "%s, saying only what they told you (never the month or dates of the "
        "first calendar), the way they would type it "
        "themselves (e.g. \"%s\"). No headings and no lists: one paragraph. "
        "Name each person with their contract hours, exactly as the manager "
        "gave them and spelled the same way -- the calendar is built from "
        "those names. In `reply`, say in one line that the brief is ready for "
        "them to check." % (name, BRIEF_EXAMPLES[lang]),
    ]
    if finish:
        lines += [
            "",
            "THE MANAGER HAS ASKED TO STOP NOW. Do not ask anything more: set "
            "done to true and write the brief from what you have, however "
            "little. If nothing at all was said, the brief is an empty string.",
        ]
    return "\n".join(lines)


def to_contents(messages: List[InterviewMessage]) -> List[dict]:
    """The transcript in Gemini's shape. An empty transcript is the opening turn."""
    if not messages:
        return [{"role": "user", "parts": [{"text": "(start the interview)"}]}]
    out = [
        {
            "role": "model" if m.role == "assistant" else "user",
            "parts": [{"text": m.text}],
        }
        for m in messages
    ]
    # Gemini wants the last turn to be the user's. After the model's own
    # question the manager has not answered yet only when we are asked to
    # finish; a nudge stands in for the missing answer.
    if out[-1]["role"] == "model":
        out.append({"role": "user", "parts": [{"text": "(that is all I have)"}]})
    return out


def parse_turn(raw: str, force_done: bool = False) -> InterviewTurn:
    """The model's JSON as a turn. `force_done` closes it whatever it said."""
    data = json.loads(raw)
    brief = data.get("brief") or None
    done = force_done or bool(data.get("done"))
    # A form belongs to a question. Once the interview is over there is
    # nothing left to answer, so a model that asks for one anyway is ignored.
    form = data.get("form")
    form = form if (not done and form in FORMS) else None
    # Only meaningful with a form, and only when it is a number of people
    # somebody could actually roster. Anything else is read as "not said",
    # which the client answers with a single empty row.
    people = data.get("formPeople")
    people = people if isinstance(people, int) and not isinstance(people, bool) else None
    if form is None or people is None or not (1 <= people <= MAX_FORM_PEOPLE):
        people = None
    return InterviewTurn(
        reply=str(data.get("reply", "")).strip(),
        done=done,
        brief=brief.strip() if (done and brief) else None,
        form=form,
        form_people=people,
    )


@dataclass
class GeminiRequest:
    system_instruction: str
    contents: List[dict]


Caller = Callable[[GeminiRequest, str, str], str]


def _call_gemini(req: GeminiRequest, api_key: str, model: str) -> str:
    """One generateContent call. Returns the model's JSON text."""
    body = {
        "system_instruction": {"parts": [{"text": req.system_instruction}]},
        "contents": req.contents,
        "generationConfig": {
            "temperature": 0.3,
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }
    # Standard library on purpose. The production image installs only the
    # runtime dependencies, and `httpx` is a test dependency here: importing
    # it took the whole app down at startup on 2026-09-08. Nothing this call
    # needs is beyond urllib.
    url = "%s?%s" % (
        GEMINI_ENDPOINT.format(model=model),
        urllib.parse.urlencode({"key": api_key}),
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    payload = _post_with_retries(
        req, timeout=GEMINI_TURN_TRY_S, deadline_s=GEMINI_TURN_BUDGET_S
    )
    try:
        return payload["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Gemini returned no content: %s" % payload) from exc


def is_spent_quota(status: int, body: str) -> bool:
    """Whether a 429 is an allowance that is gone rather than a busy minute.

    Read from the body's QuotaFailure violations and RetryInfo, both of which
    Google fills in. Tolerant by design: anything it cannot read is treated as
    the transient kind, because retrying a spent quota wastes seconds while
    NOT retrying a busy minute loses an answer that was coming.
    """
    if status != 429:
        return False
    try:
        error = (json.loads(body) or {}).get("error") or {}
    except (ValueError, AttributeError):
        return False
    for detail in error.get("details") or []:
        if not isinstance(detail, dict):
            continue
        kind = str(detail.get("@type", ""))
        if kind.endswith("QuotaFailure"):
            for violation in detail.get("violations") or []:
                quota_id = str((violation or {}).get("quotaId", "")).lower()
                if any(marker in quota_id for marker in _SPENT_QUOTA_MARKERS):
                    return True
        if kind.endswith("RetryInfo"):
            delay = str(detail.get("retryDelay", "")).rstrip("s")
            try:
                # Longer than everything we were ever going to wait.
                if float(delay) > sum(RETRY_WAITS_S):
                    return True
            except ValueError:
                continue
    return False


def _quota_ids(body: str) -> str:
    """The quotas a 429 names, for the log: the message alone says only "quota".

    Never raises: it only decorates a log line, whatever shape the body has.
    """
    try:
        error = (json.loads(body) or {}).get("error") or {}
    except (ValueError, AttributeError):
        return ""
    if not isinstance(error, dict):
        return ""
    ids = []
    for d in error.get("details") or []:
        if not isinstance(d, dict):
            continue
        for v in d.get("violations") or []:
            if isinstance(v, dict) and v.get("quotaId"):
                ids.append(str(v["quotaId"]))
        if d.get("retryDelay"):
            ids.append("retry in %s" % d["retryDelay"])
    return " [%s]" % ", ".join(ids) if ids else ""


def _is_timeout(exc: BaseException) -> bool:
    """A call that ran out of time, however urllib chose to wrap it.

    A timeout while reading arrives as TimeoutError; one while CONNECTING
    arrives as a URLError whose reason is the timeout, and used to escape the
    retries as a generic fault.
    """
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return True
    return isinstance(exc, urllib.error.URLError) and isinstance(
        exc.reason, (TimeoutError, socket.timeout)
    )


def _post_with_retries(
    req: urllib.request.Request,
    sleep=time.sleep,
    timeout: float = CALL_TIMEOUT_S,
    deadline_s: Optional[float] = None,
    clock=time.monotonic,
) -> dict:
    """POST, trying again on the statuses the free tier hands out under load.

    With `deadline_s`, the whole thing -- every try and every wait -- fits in
    that many seconds: a try gets whatever is left if that is less than
    `timeout`, and no try or wait is started that could not finish in time.
    Every failed try is logged with its status, because the router turns the
    last one into a 502 and the ones before it were otherwise never seen.
    """
    started = clock()
    # The model and method, e.g. "gemini-x:generateContent". Never the query:
    # the API key travels in it.
    call = urllib.parse.urlsplit(req.full_url).path.rsplit("/", 1)[-1]

    def left() -> float:
        if deadline_s is None:
            return float("inf")
        return deadline_s - (clock() - started)

    def may_retry(attempt: int) -> bool:
        if attempt >= len(RETRY_WAITS_S):
            return False
        return left() - RETRY_WAITS_S[attempt] >= MIN_ATTEMPT_S

    attempt = 0
    while True:
        try:
            with urllib.request.urlopen(req, timeout=min(timeout, left())) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            # Read the body WHOLE before trimming it. The quota that says "come
            # back tomorrow" is named in `details`, well past the first 500
            # characters, so a truncated body parses as nothing and every spent
            # allowance would look like a busy minute.
            body = exc.read().decode("utf-8", "replace")
            detail = body[:500]
            logger.warning(
                "Gemini %s try %d: HTTP %s after %.1fs: %s%s",
                call, attempt + 1, exc.code, clock() - started, detail[:200],
                _quota_ids(body),
            )
            if is_spent_quota(exc.code, body):
                raise QuotaSpent(
                    "Gemini quota is spent (%s): %s" % (exc.code, detail)
                ) from exc
            if exc.code in RETRY_STATUSES and may_retry(attempt):
                sleep(RETRY_WAITS_S[attempt])
                attempt += 1
                continue
            raise RuntimeError("Gemini returned %s: %s" % (exc.code, detail)) from exc
        except (TimeoutError, urllib.error.URLError) as exc:
            if not _is_timeout(exc):
                logger.warning("Gemini %s try %d: %s", call, attempt + 1, exc)
                raise
            logger.warning(
                "Gemini %s try %d: no answer after %.1fs",
                call, attempt + 1, clock() - started,
            )
            if may_retry(attempt):
                sleep(RETRY_WAITS_S[attempt])
                attempt += 1
                continue
            raise RuntimeError("Gemini did not answer in time") from exc


class _ClaudeTurn(BaseModel):
    """RESPONSE_SCHEMA, in the shape the Anthropic SDK takes.

    Dumped back to Gemini's JSON (by alias) so both models go through the same
    `parse_turn`: whatever that function refuses from one, it refuses from the
    other.
    """

    reply: str = Field(description=RESPONSE_SCHEMA["properties"]["reply"]["description"])
    done: bool = Field(description=RESPONSE_SCHEMA["properties"]["done"]["description"])
    brief: str = Field(description=RESPONSE_SCHEMA["properties"]["brief"]["description"])
    form: Literal["none", "roster"] = Field(
        description=RESPONSE_SCHEMA["properties"]["form"]["description"]
    )
    form_people: int = Field(
        alias="formPeople",
        description=RESPONSE_SCHEMA["properties"]["formPeople"]["description"],
    )


def to_claude_messages(contents: List[dict]) -> List[dict]:
    """Gemini's transcript as Claude's: `model` is `assistant`, and it opens on the user.

    The interview's first line is ours (the hours question), which Gemini takes
    as a model turn with nothing before it. Claude wants the user first, so the
    same "(start the interview)" the empty transcript uses stands in front.
    """
    out = [
        {
            "role": "assistant" if c["role"] == "model" else "user",
            "content": "".join(p.get("text", "") for p in c["parts"]),
        }
        for c in contents
    ]
    if out and out[0]["role"] == "assistant":
        out.insert(0, {"role": "user", "content": "(start the interview)"})
    return out


def _call_claude(req: GeminiRequest, api_key: str) -> str:
    """The same turn from Claude, as the JSON text `parse_turn` reads."""
    import anthropic

    from app.services import api_usage

    started = time.monotonic()
    client = anthropic.Anthropic(
        api_key=api_key, timeout=CLAUDE_TURN_TIMEOUT_S, max_retries=0
    )
    # No `thinking` and no `effort`: Haiku 4.5 takes neither (see triage.py).
    response = client.messages.parse(
        model=CLAUDE_TURN_MODEL,
        max_tokens=CLAUDE_TURN_MAX_TOKENS,
        system=req.system_instruction,
        messages=to_claude_messages(req.contents),
        output_format=_ClaudeTurn,
    )
    try:
        api_usage.note(
            "interview.fallback",
            CLAUDE_TURN_MODEL,
            response.usage,
            int((time.monotonic() - started) * 1000),
        )
    except Exception:  # noqa: BLE001 - the meter must not cost us the answer
        logger.exception("interview: could not meter the fallback call")
    if response.parsed_output is None:
        raise RuntimeError("Claude returned no turn")
    return response.parsed_output.model_dump_json(by_alias=True)


FallbackCaller = Callable[[GeminiRequest, str], str]


def next_turn(
    messages: List[InterviewMessage],
    language: str,
    api_key: str,
    model: str,
    finish: bool = False,
    call: Caller = _call_gemini,
    fallback_key: str = "",
    fallback: FallbackCaller = _call_claude,
    rest: Optional[GeminiRest] = None,
) -> InterviewTurn:
    """Ask Gemini what to say next, or for the brief when `finish` is set.

    If Gemini cannot answer -- busy, silent, or out of quota -- and there is an
    Anthropic key, Claude asks instead. If Claude fails too, the error raised
    is Gemini's, so a spent quota still reads as one.
    """
    req = GeminiRequest(
        system_instruction=build_system_instruction(language, finish=finish),
        contents=to_contents(messages),
    )
    rest = TURN_REST if rest is None else rest
    if fallback_key and rest.resting():
        # Gemini failed a moment ago: do not make this question wait for it too.
        return parse_turn(fallback(req, fallback_key), force_done=finish)
    try:
        raw = call(req, api_key, model)
    except Exception as exc:
        if not fallback_key:
            raise
        logger.warning(
            "interview: Gemini failed (%s), asking Claude instead for the next %d s",
            exc, GEMINI_REST_S,
        )
        rest.rest(GEMINI_REST_S)
        try:
            raw = fallback(req, fallback_key)
        except Exception as fallback_exc:  # noqa: BLE001 - Gemini's error is the one to report
            logger.warning("interview: Claude failed too: %s", fallback_exc)
            raise exc from fallback_exc
    # Asked to stop, it must stop: whatever it wrote is the close.
    return parse_turn(raw, force_done=finish)
