from __future__ import annotations

"""Jev: closed questions, answered with a probability, and nothing else.

TypeSafe AI's "System One" model does not write. It is handed a piece of text
and a set of typed questions -- yes or no (``Noul``), one of these options
(``Choice``) -- and it hands back, for each, a probability. That is exactly the
shape of a few questions this product used to answer by looking at the SHAPE of
something because nothing cheaper could read it:

- Is "mínimo tres personas" a rule about the business or about this Saturday?
  (``routers/business_profile.record_observations`` asks;
  ``business_profile.declare_from_ops`` used to decide by the operation alone.)
- Does "sube el plus de noche de Ana" need the calendar half of the planner at
  all? (``refine_intake.ROUTE_QUESTIONS``; all three halves run on every
  sentence, and skip one only with ``jev_route_enforced``.)
- Is the business the interview describes a bar, a clinic, a shop?
  (``business_profile.infer_vertical_from_interview``; the interview stored
  the notes and never the answer.)

WHAT IT IS NOT FOR, written down because the temptation will come: anything
that counts, adds, or compares dates. Its own documentation says it reads a
date as text and "is not a calculator", and every rule about rest, weekly
hours, the annual workday and pay in this codebase is arithmetic on dates. Those
stay in code (`validate.ts`, `rota_law.py`, `workday.py`, `payroll.ts`), where
a rule that holds 97% of the time is not a rule.

THREE PROMISES, the same ones `triage` makes and for the same reason -- this is
a second opinion in front of paths that already work:

*It never raises.* Off, missing its key, resting after a failure, slow, or
answering nonsense: every one ends in ``None``, and the caller does exactly
what it did before this module existed.

*It never sees a name.* Every sentence goes through ``mask`` first, which is
the same table (`id_alias.IdAliases`) that hides the team from the planner.
Jev is hosted in the United States with no EU region; what crosses is "e1
wants Fridays off", never who e1 is, and never a roster or a reason for leave.

*It is metered like everything else.* One row in ``api_usage`` per call, under
``jev.<question>``, so its cost and its latency sit next to the calls it is
meant to save.
"""

import json
import logging
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Dict, Mapping, Optional, Union

from app.config import settings
from app.services import api_usage
from app.services.id_alias import IdAliases

log = logging.getLogger(__name__)

# One attempt, short. Measured independently at ~250 ms p50 from Europe; three
# seconds is the day it is slow. Every caller has a working answer without it,
# so waiting longer than this would cost the manager more than Jev saves.
TIMEOUT_S = 3.0

# After any failure, stop asking for ten minutes -- the same rest Gemini gets in
# `interview.py`, for the same reason: a service that is down answers the next
# caller no faster, and each of them would pay the timeout to find out.
REST_S = 600

# Anything longer than this is not a sentence a manager typed. The API's own
# ceiling is far higher; this is a bound on what we are willing to send.
MAX_STATE_CHARS = 8000


@dataclass(frozen=True)
class Noul:
    """A yes-or-no question. ``true``/``false`` say what each answer MEANS --
    the documentation's advice, and the difference between a question about
    the sentence and one about the business."""

    instructions: str
    true: str
    false: str

    def to_json(self) -> dict:
        return {
            "type": "noul",
            "instructions": self.instructions,
            "criteria": {"true": self.true, "false": self.false},
        }


@dataclass(frozen=True)
class Choice:
    """One of a closed set of options: code -> what that option means."""

    instructions: str
    options: Mapping[str, str]

    def to_json(self) -> dict:
        return {
            "type": "choice",
            "instructions": self.instructions,
            "criteria": dict(self.options),
        }


Question = Union[Noul, Choice]


@dataclass(frozen=True)
class Answer:
    """What came back for one question.

    For a ``Noul``, ``yes`` is P(yes) and nothing else is set: the API returns
    no confidence for it. For a ``Choice``, ``choice`` is the option it picked,
    ``probabilities`` the whole distribution and ``confidence`` how
    concentrated that distribution is.
    """

    yes: Optional[float] = None
    choice: Optional[str] = None
    probabilities: Dict[str, float] = field(default_factory=dict)
    confidence: Optional[float] = None


class Rest:
    """When Jev last failed, so the next caller can skip it. Per process."""

    def __init__(self, clock=time.monotonic):
        self._until = 0.0
        self._clock = clock

    def resting(self) -> bool:
        return self._clock() < self._until

    def rest(self, seconds: float = REST_S) -> None:
        self._until = self._clock() + seconds

    def clear(self) -> None:
        self._until = 0.0


REST = Rest()


def enabled() -> bool:
    """Switched on AND given a key. Resting does not count as off."""
    return bool(settings.jev_enabled and settings.jev_api_key)


def mask(text: str, names: Mapping[str, str]) -> str:
    """``text`` with every person in ``names`` (id -> full name) replaced by
    their alias. The same table the planner's context goes through, so "Ana"
    and "Ana García" are one e1 here as well."""
    aliases = IdAliases()
    aliases.load(names.keys(), [])
    aliases.load_names(names)
    return aliases.shorten(text)


def _prob(value) -> Optional[float]:
    try:
        p = float(value)
    except (TypeError, ValueError):
        return None
    return p if 0.0 <= p <= 1.0 else None


def _read(question: Question, raw) -> Optional[Answer]:
    """One answer, checked against the question it answers, or None.

    An option we did not offer, a probability outside [0, 1], or an answer of
    the wrong type is dropped rather than trusted: a well-formed response is
    this API's whole promise, and one that breaks it is not evidence of
    anything.
    """
    if not isinstance(raw, dict):
        return None
    if isinstance(question, Noul):
        yes = _prob(raw.get("noul"))
        return None if yes is None else Answer(yes=yes)
    picked = raw.get("choice")
    if picked not in question.options:
        return None
    probabilities = {
        str(k): p
        for k, p in (raw.get("probabilities") or {}).items()
        if _prob(p) is not None
    }
    return Answer(
        choice=picked,
        probabilities={k: float(v) for k, v in probabilities.items()},
        confidence=_prob(raw.get("confidence")),
    )


def ask(
    state: str, questions: Mapping[str, Question], purpose: str
) -> Optional[Dict[str, Answer]]:
    """Ask every question about ``state`` in one call. NEVER RAISES.

    ``state`` must already be masked (see ``mask``); this function sends what
    it is given. Returns the answers that came back well-formed -- possibly
    fewer than were asked -- or None when nothing did, when Jev is off, or when
    it is resting after a failure.
    """
    if not enabled() or REST.resting() or not questions:
        return None
    state = (state or "").strip()
    if not state:
        return None

    body = json.dumps(
        {
            "state": state[:MAX_STATE_CHARS],
            "model": settings.jev_model,
            "questions": {k: q.to_json() for k, q in questions.items()},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        settings.jev_base_url,
        data=body,
        method="POST",
        headers={
            "Authorization": "Bearer %s" % settings.jev_api_key,
            "Content-Type": "application/json",
        },
    )

    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        # 401 is our key, 422 our request, 429 the rate limit, 529 their load.
        # All four mean "not now", and the body says which; never the key.
        detail = exc.read().decode("utf-8", "replace")[:200]
        log.warning("jev %s: HTTP %s: %s", purpose, exc.code, detail)
        REST.rest()
        return None
    except (TimeoutError, socket.timeout, urllib.error.URLError, ValueError) as exc:
        log.warning(
            "jev %s: %s after %.1fs", purpose, type(exc).__name__,
            time.monotonic() - started,
        )
        REST.rest()
        return None
    elapsed_ms = int((time.monotonic() - started) * 1000)

    try:
        usage = payload.get("usage") or {}
        api_usage.note(
            "jev." + purpose,
            settings.jev_model,
            SimpleNamespace(
                input_tokens=usage.get("input_tokens", 0),
                output_tokens=usage.get("output_tokens", 0),
            ),
            elapsed_ms,
        )
    except Exception:  # noqa: BLE001 - the meter must not cost us the answer
        log.exception("jev %s: could not meter the call", purpose)

    raw_answers = payload.get("answers") if isinstance(payload, dict) else None
    if not isinstance(raw_answers, dict):
        log.warning("jev %s: response without answers", purpose)
        return None
    answers = {}
    for key, question in questions.items():
        answer = _read(question, raw_answers.get(key))
        if answer is not None:
            answers[key] = answer
    return answers or None
