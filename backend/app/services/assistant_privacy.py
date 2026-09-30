"""Who the business assistant may know, and by what name.

The assistant (``services/assistant.py``) runs at Anthropic, in the United
States, and it REMEMBERS: what it writes in its memory store is read back into
every later conversation with the same business. So the rule the planner lives
by -- no name leaves this building (``id_alias.py``) -- matters more here, not
less, and it has to hold for a text that outlives the request that wrote it.

STABLE ALIASES. The planner calls people ``e1``, ``e2``, coined per request;
that is fine for something that forgets. A memory that says "e3 prefers
mornings" would, next week, be about whoever happens to be ``e3`` then. Here
each person's alias is derived from their employee id -- ``P-`` and six hex
characters of a hash of it -- so it is the same in every conversation, in every
tool result and in every line of memory, for as long as the person exists. It
is a hash rather than the id's own first characters so that it reveals nothing
about our ids, and a hash of the id rather than of the name so that renaming
somebody does not turn them into a stranger the assistant has notes about.

Collisions: six hex characters is sixteen million values, and two people in one
business sharing one is roughly a one-in-ten-thousand event for a team of
twenty. When it happens both get ten characters instead, which is still
stable, just longer. What is NOT stable is the moment it starts: the day a
second person arrives whose short alias equals an existing one, the existing
person's alias grows -- and any memory written about the short form is then
about nobody. That is written down rather than engineered away: storing a
table of issued aliases would fix it and would be one more table holding a
mapping to people, for an event that will very likely never happen.

THREE DIRECTIONS, ONE TABLE.

* ``mask`` -- what the manager typed, and every tool result, on the way OUT:
  every name we know becomes that person's alias (the planner's own
  ``IdAliases`` machinery, with its accents, its two Anas and its calendar
  words, now handing out stable aliases).
* ``unmask`` -- what the assistant answers, and what it remembers when the
  manager asks to see it, on the way IN: every alias becomes the person's name
  again, in our process, for the manager's screen only.
* ``names`` are read from our own database (every employee of the org,
  removed ones included -- a memory may still talk about them), never from the
  request, so no client can decide whose name may travel.

WHAT THIS CANNOT DO, same as ``id_alias``: a nickname, a misspelling, a
two-letter name, or one written in lower case survives ``mask``. It is a
redaction of what we know. The system prompt tells the assistant never to write
a name, and ``services/assistant.py`` runs every memory it writes back through
``mask`` after each answer, so a name that slipped through in the manager's own
sentence is replaced in the memory before the next conversation reads it.
"""

from __future__ import annotations

import hashlib
import re
from typing import Dict, Iterable, Mapping, Optional

from app.services.id_alias import IdAliases

PREFIX = "P-"
SHORT = 6
LONG = 10

# An alias in text the assistant wrote. Hex in either case: a model that
# capitalises "P-7C3F9A" in a heading still means the same person.
ALIAS_RE = re.compile(r"(?<![0-9A-Za-z_-])P-([0-9a-fA-F]{%d,%d})(?![0-9A-Za-z_])" % (SHORT, LONG))


def _digest(employee_id: str) -> str:
    # Namespaced so this hash of an id can never be mistaken for, or
    # compared with, a hash of the same id taken for another purpose.
    return hashlib.sha256(("shiftplanner-assistant:%s" % employee_id.strip().lower()).encode()).hexdigest()


def stable_aliases(employee_ids: Iterable[str]) -> Dict[str, str]:
    """Employee id -> its alias, for every id given. Deterministic.

    Given the WHOLE roster of one organisation, removed people included:
    whether an alias needs its long form depends on who else is in the
    business, and asking about a subset could answer differently.
    """
    ids = sorted({str(i).strip().lower() for i in employee_ids if str(i).strip()})
    short: Dict[str, str] = {i: _digest(i)[:SHORT] for i in ids}
    taken: Dict[str, int] = {}
    for value in short.values():
        taken[value] = taken.get(value, 0) + 1
    return {
        i: PREFIX + (_digest(i)[:LONG] if taken[short[i]] > 1 else short[i])
        for i in ids
    }


class People:
    """Names and aliases for ONE organisation, both ways."""

    def __init__(self, names: Mapping[str, str]):
        # Every employee we have a name for. ``names`` is
        # ``employees.names_by_id`` -- the whole roster, removed people too.
        self._alias_of = stable_aliases(names.keys())
        self._name_of: Dict[str, str] = {}
        for employee_id, alias in self._alias_of.items():
            name = " ".join(str(names.get(employee_id) or names.get(employee_id.upper()) or "").split())
            if name:
                self._name_of[alias.lower()] = name
        self._aliases = IdAliases(employee_alias=lambda real: self._alias_of[real])
        # Every one of them is declared a person: nothing is restored from an
        # alias here, so there is no plannable/unplannable distinction to keep
        # -- only names to hide.
        self._aliases.load(sorted(self._alias_of), [])
        self._aliases.load_names({k.lower(): v for k, v in names.items()})

    def alias(self, employee_id: object) -> str:
        """The alias of one employee. An id we do not know is nobody."""
        return self._alias_of.get(str(employee_id).strip().lower(), PREFIX + "?")

    def mask(self, text: Optional[str]) -> str:
        """Text on its way to Anthropic: every name we know becomes an alias."""
        if not text:
            return ""
        return self._aliases.shorten(str(text))

    def unmask(self, text: Optional[str]) -> str:
        """Text on its way to the manager: every alias becomes the name.

        An alias we cannot place -- a person who has since been deleted
        outright, or one the model made up -- is left as it is. Writing
        "alguien" instead would read as an answer; the alias reads as what it
        is.
        """
        if not text:
            return ""

        def name(m: "re.Match") -> str:
            return self._name_of.get(("P-" + m.group(1)).lower(), m.group(0))

        return ALIAS_RE.sub(name, str(text))

    def __len__(self) -> int:
        return len(self._alias_of)
