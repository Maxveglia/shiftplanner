"""Short names for the ids -- AND THE PEOPLE -- the planner reads and writes.

A month of shifts is mostly ids: every shift names an employee and usually a
template, and both are UUIDs -- 36 characters, about 25 tokens each. Measured
against the API on a real month (six people, three templates, 124 shifts) the
JSON the model had to write was 12,001 tokens, 97 per shift; with the aliases
below it is 6,090, or 49. Two of three months were being cut off at the output
ceiling before the closing bracket. The model gains nothing from the ids being
globally unique; it only has to tell them apart.

So the ids the model sees are ``e1``, ``e2``, ... for people and ``t1``, ``t2``,
... for templates, and what it writes back is translated to the real ids before
anything else reads it. The client never sees an alias: this is a compression
between the router and the model, in one place, with one table.

**The prefix is a check, not decoration.** Employees and templates sharing one
namespace meant a model that returned a template's alias as ``employee_id`` got
a real employee id back -- a shift for the wrong person, kept. Asking for an
employee refuses a template's alias.

Which kind an id is, is DECLARED: ``load`` takes the two lists from the request
and the caller is the client that built the context. Reading it out of the
prose instead -- the heading a UUID happened to sit under -- was the first
version of this, and it made the check depend on the exact wording of a text
the other side of the API composes. An id that turns up in the text without
having been declared is filed as unknown and satisfies either request, so a
client that sends no lists degrades to no check rather than to no calendar.

**AND THE SAME TABLE HIDES THE NAMES.** It started as a compression; it is now
also where "Ana Garcia Perez" stops being a thing we send to a third party. The
alias a person's id already has is the pseudonym their NAME gets as well, so
``e1`` in the team listing, ``e1`` in the manager's brief and ``e1`` in the
shift the model writes back are one person throughout. Nothing is lost on the
way out -- the model reasons about e1 exactly as it reasoned about Ana -- and
nothing has to be restored on the way IN, because a planned shift names an id
and the id is already translated below: the manager's calendar goes on saying
Ana because the client never stopped knowing who ``e1`` is.

THE RULE THIS IMPLEMENTS IS THE PRODUCT'S OWN, WRITTEN DOWN ELSEWHERE FIRST.
``services/interview.py``: "Nothing from the roster is ever INCLUDED in a
request either: the only thing sent is what the manager typed into this
conversation." That is the line the planning path crossed -- it read the
roster out of the database and put every full name on the wire -- and the line
it is back behind. Where this goes FURTHER than the interview does is the
manager's own sentence: there the names are masked too, because here, unlike
there, the model answers in ids and loses nothing by being given one.

WHAT THIS CANNOT DO. It masks names it was TOLD, and it is told the roster of
one organisation. A nickname, a misspelling, or somebody who is not on the
roster survives it; so does a first name too short, one a calendar cannot
spare, or one word written in lower case (see ``MIN_NAME_PART``,
``_PARTICLES``, ``_CALENDAR_WORDS`` and ``_stand_in``). It is a redaction of
what we know, not a guarantee about arbitrary prose -- which is why the client
stopped PUTTING names in the planning context as well
(``frontend/src/lib/schedule/planContext.ts``). Two measures, because a regular
expression over free text is not a thing to trust alone.

AND THE TWO MEASURES ARE NOT INDEPENDENT, WHICH COSTS SOMETHING. The client
used to print "e1 | Ana Garcia Perez | active", and that row was the only
place a name in the manager's prose could be tied to an id. With the column
gone, a name this file deliberately lets through -- "Domingo", "Sol" in lower
case, a nickname -- reaches the model attached to nobody: it cannot be read as
a person at all, so the request in that sentence is lost silently rather than
acted on. That is a KNOWN GAP, not an oversight. It is accepted because the
sentences it costs are the rare ones, because the fallback is the rota the
product would have built anyway, and because the alternative -- printing every
full name to keep a handful of sentences resolvable -- is the bug this module
exists to close. If it ever has to be closed properly, the answer is to print
the ALIAS as the person's label in that column, never the name.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Callable, Dict, Iterable, List, Mapping, Optional

UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)

EMPLOYEE, TEMPLATE, UNKNOWN = "e", "t", "x"

# A person we know the NAME of and will not accept a shift for.
#
# ``load_names`` is given this organisation's whole roster, including people
# who have been removed, because a context written yesterday still talks about
# them. Their names must be hidden all the same -- but handing them an ``e``
# alias would quietly re-declare them plannable, and a shift the model wrote
# for somebody who has left used to be DROPPED by ``_restore_ids`` and would
# now be kept. It would then count as cover in the browser, keep the greedy
# pass from filling those hours, and be thrown away at publish
# (``routers/schedule.py``, ``known = set(...live_ids...)``) -- a month that
# looked staffed publishing with holes in it.
#
# So they get their own prefix, which ``_restore`` refuses exactly as it
# refuses a template's alias. The name is hidden; the person stays unplannable.
OFF_ROSTER = "p"

# The shortest run of letters we are willing to call somebody's name.
#
# Two is where the false positives live: "Jo" would swallow every "jo" standing
# on its own, and a surname particle is exactly two letters more often than
# not. The cost of the floor is that a two-letter name is not masked, which is
# the direction to err in -- an unmasked name is the bug we already had, a
# mangled brief is a new one.
MIN_NAME_PART = 3

# Surname particles, which are parts of a name and identify nobody.
#
# "Juan de la Cruz" masked part by part would turn every "la" in the brief into
# a person. The full name is still masked as a whole; only the particle on its
# own is left alone.
_PARTICLES = frozenset(
    {
        "del",
        "las",
        "los",
        "dos",
        "van",
        "von",
        "der",
        "den",
        "dem",
        "san",
        "sant",
        "santa",
        "mac",
        "bin",
        "ibn",
        "abu",
    }
)

# Words a rota cannot do without, which are also somebody's first name.
#
# Julio, Domingo, Mayo, Abril, Marzo are names AND they are the month or the
# weekday the brief is about. Masking "el domingo cerramos" into "el e3
# cerramos" does not leak anything, but it tells the model the shop closes on a
# PERSON, and the month that comes back is wrong -- a quality failure with no
# upper bound, traded against one first name. So these are never masked on
# their own. Said in full ("Julio Ramirez") the name is masked as a whole, and
# a plural ("los domingos") never matched to begin with.
#
# Accents are already gone by the time a key is checked against this set.
_CALENDAR_WORDS = frozenset(
    {
        "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
        "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
        "agosto", "septiembre", "setiembre", "octubre", "noviembre", "diciembre",
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
        "sunday", "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
    }
)

# How many people one ambiguous name may stand for before we stop listing them.
MAX_AMBIGUOUS = 4

# Accented spellings of one letter, so a brief that writes "Garcia" still finds
# "García" on the roster and the other way round. Folding the TEXT instead
# would mean handing the model a de-accented brief, which is a different and
# worse change: we are hiding a name, not rewriting the manager's Spanish.
_VARIANTS = {
    "a": "aáàâäãåā",
    "c": "cç",
    "e": "eéèêëē",
    "i": "iíìîïī",
    "n": "nñ",
    "o": "oóòôöõø",
    "u": "uúùûüū",
    "y": "yý",
}

# "Not touching a letter on either side", spelled without \b so that a name
# beginning or ending in punctuation still gets its boundary. \w would count
# digits and underscore as letters; this class is letters only.
_EDGE_BEFORE = r"(?<![^\W\d_])"
_EDGE_AFTER = r"(?![^\W\d_])"


# Letters NFD does not take apart, because the stroke is part of the letter
# rather than a mark on top of one. They have to be folded by hand or the two
# halves of this module disagree: ``_VARIANTS`` says "o" matches "ø", and
# ``_fold`` used to leave "ø" alone, so "Bjørn" matched the pattern and then
# found no key. Only one-for-one substitutions belong here -- folding "ß" to
# "ss" would make a key the pattern for it could never match.
_UNDECOMPOSED = {"ø": "o", "đ": "d", "ð": "d", "ł": "l", "ħ": "h", "ŧ": "t"}


def _fold(text: str) -> str:
    """One spelling of a name: lower case, no accents, single spaces.

    The key the table is FILED under. It is not used to read a match back --
    see ``_names_pattern`` -- precisely because a fold that disagrees with the
    pattern by one letter would hand back the name instead of the alias.
    """
    bare = "".join(
        _UNDECOMPOSED.get(ch, ch)
        for ch in unicodedata.normalize("NFD", text.lower())
        if not unicodedata.combining(ch)
    )
    return " ".join(bare.split())


def _loose(folded: str) -> str:
    """A folded name as a pattern that matches its accented spellings too."""
    out = []
    for ch in folded:
        if ch == " ":
            out.append(r"\s+")
        elif ch in _VARIANTS:
            out.append("[%s]" % _VARIANTS[ch])
        else:
            out.append(re.escape(ch))
    return "".join(out)


class IdAliases:
    """One table for one request: real id <-> short alias.

    The alias carries its own kind -- it is ``kind`` followed by a number --
    so there is no second table saying what ``e3`` is.
    """

    def __init__(self, employee_alias: Optional[Callable[[str], str]] = None) -> None:
        # Who decides what a PERSON is called, when it is not "the next number".
        #
        # The planner's aliases are coined per request -- ``e1`` today is
        # somebody else tomorrow, and nothing outlives the request that coined
        # it, so that is fine. The business assistant (``services/
        # assistant_privacy.py``) talks to a model that REMEMBERS between
        # conversations, and a memory that says "e3 prefers mornings" would
        # quietly move to whoever is ``e3`` next week. It passes a function
        # here that derives the alias from the employee's id instead, so the
        # same person has the same pseudonym in every conversation, and every
        # other part of this table -- the names, the accents, the two Anas --
        # works exactly as it does for the planner.
        #
        # Such an alias does not begin with ``e``, so ``employee()`` will not
        # restore it. That is deliberate: the assistant is read-only and never
        # hands us an id to act on, so there is nothing to restore.
        self._employee_alias = employee_alias
        # The ids declared as people, whatever their alias looks like.
        self._people: set = set()
        self._alias_of: Dict[str, str] = {}
        self._real_of: Dict[str, str] = {}
        self._counts = {EMPLOYEE: 0, TEMPLATE: 0, UNKNOWN: 0, OFF_ROSTER: 0}
        # Folded name (or part of one) -> the aliases of everybody it could
        # mean. A list and not a single alias because two people share a first
        # name more often than a small team expects; see ``_stand_in``.
        self._by_name: Dict[str, List[str]] = {}
        # An id we were told the name of and nothing else. Kept OUT of
        # ``_alias_of``, so a UUID that turns up in the text is still filed as
        # unknown and still restores -- the degradation this module promises a
        # client that declares no lists.
        self._off_roster: Dict[str, str] = {}
        # The keys of ``_by_name``, longest first, in the order the compiled
        # alternation offers them. A match is read back by its GROUP NUMBER
        # through this list and never by folding the matched text again.
        self._name_keys: List[str] = []
        self._names_re: Optional[re.Pattern] = None

    def load(self, employees: Iterable[str], templates: Iterable[str]) -> None:
        """Declare which ids are people and which are shift templates."""
        for real in employees:
            self._coin(real, EMPLOYEE)
        for real in templates:
            self._coin(real, TEMPLATE)

    def load_names(self, names: Mapping[str, str]) -> None:
        """Declare what each person is CALLED, so their name can be hidden.

        ``names`` maps an employee's real id to their full name, read from our
        own database rather than from the request: the client cannot be the one
        that decides whose name may travel, and a request that simply omitted
        a person would otherwise un-mask them.

        The name is filed whole AND part by part. Whole, because the roster
        listing spells it out; part by part, because the manager's brief says
        "Ana", and a mask that only caught "Ana Garcia Perez" would leave the
        one spelling that people actually type.

        AN ID ``load`` NEVER DECLARED DOES NOT BECOME A PERSON HERE. The roster
        we are handed is the whole organisation, removed people included, and
        the request declares the far shorter list the context is actually about.
        Somebody in the first list and not the second gets an ``OFF_ROSTER``
        alias: their name is hidden just the same, and a shift the model writes
        for them is refused on the way back exactly as it was before this
        method existed. Call ``load`` FIRST -- called the other way round, every
        name is filed off-roster, which is safe but tells the model less.
        """
        for real_id, full_name in names.items():
            if not real_id or not full_name:
                continue
            alias = self._alias_for_name(str(real_id))
            self._file_name(full_name, alias)
            for part in re.split(r"[\s,]+", full_name):
                self._file_name(part, alias)

    def _alias_for_name(self, real_id: str) -> str:
        """The alias a NAME may be replaced with, which is not always an id's.

        Only an id the caller declared as a person answers with its ``e``
        alias. Anything else -- removed, or simply not part of this request --
        gets a pseudonym of its own that no shift can be restored from.
        """
        key = real_id.strip().lower()
        # By what the id was DECLARED as, not by what its alias looks like: a
        # stable alias (see ``employee_alias``) does not start with ``e``.
        if key in self._people:
            return self._alias_of[key]
        alias = self._off_roster.get(key)
        if alias is None:
            self._counts[OFF_ROSTER] += 1
            alias = "%s%d" % (OFF_ROSTER, self._counts[OFF_ROSTER])
            self._off_roster[key] = alias
        return alias

    def shorten(self, text: str) -> str:
        """Replace every UUID in ``text`` with its alias, coining one for any
        id that was not declared, and every name we were told with the alias of
        the person who has it. The same id -- and the same person -- always
        gets the same alias, whatever the case or the accents."""
        text = UUID_RE.sub(lambda m: self._coin(m.group(0), UNKNOWN), text)
        pattern = self._names_pattern()
        return text if pattern is None else pattern.sub(self._stand_in, text)

    def employee(self, alias: Optional[str]) -> Optional[str]:
        """The real employee id behind ``alias``, or ``None``."""
        return self._restore(alias, EMPLOYEE)

    def template(self, alias: Optional[str]) -> Optional[str]:
        """The real template id behind ``alias``, or ``None``."""
        return self._restore(alias, TEMPLATE)

    def _file_name(self, name: str, alias: str) -> None:
        """Record one spelling as meaning ``alias``, unless it means nothing."""
        key = _fold(name)
        if len(key) < MIN_NAME_PART or key in _PARTICLES or key in _CALENDAR_WORDS:
            return
        owners = self._by_name.setdefault(key, [])
        if alias not in owners:
            owners.append(alias)
        # The pattern AND the key order are rebuilt on the next ``shorten``: a
        # table that grows between two calls must not answer with the
        # alternation it had, and a group number must never outlive its list.
        self._names_re = None
        self._name_keys = []

    def _names_pattern(self) -> Optional[re.Pattern]:
        """One alternation over every name we were told, longest first.

        Longest first is what makes "Ana Garcia Perez" one alias rather than
        three: Python's ``|`` takes the first branch that matches, so the whole
        name has to be offered before its parts.

        EVERY BRANCH IS ITS OWN GROUP, so ``_stand_in`` can read a match back
        by number. Folding the matched text again was the obvious way to do it
        and it was wrong: ``_fold`` and ``_loose`` are two descriptions of the
        same spelling, and the day they disagree by one letter -- they did,
        over "ø" -- the lookup misses and the branch that handles a miss hands
        back the NAME. A number cannot disagree with anything.
        """
        if self._names_re is not None or not self._by_name:
            return self._names_re
        self._name_keys = sorted(self._by_name, key=len, reverse=True)
        self._names_re = re.compile(
            "%s(?:%s)%s"
            % (
                _EDGE_BEFORE,
                "|".join("(%s)" % _loose(key) for key in self._name_keys),
                _EDGE_AFTER,
            ),
            re.IGNORECASE,
        )
        return self._names_re

    def _stand_in(self, match: "re.Match") -> str:
        """The alias of whoever this name means.

        TWO PEOPLE CALLED ANA STAY TWO PEOPLE. Picking one of them would turn
        an ambiguity the model used to see -- and resolve, or ask about -- into
        a silent decision made by a regular expression, and the manager would
        read a rota where the wrong Ana works Fridays. Both aliases are handed
        over instead, in words, so the model is left exactly as informed as it
        was and still cannot emit "e1 or e4" as an id.

        ONE WORD, WRITTEN SMALL, IS NOT TAKEN FOR A NAME. Sol, Mar, Paz, Luz,
        Rosa, Alba and Cruz are first names here AND ordinary nouns, and no
        list of them ends: ``_CALENDAR_WORDS`` could only ever name the months
        and the weekdays. Masking "trabaja con sol y mar en la terraza" into
        "trabaja con e1 y e2 en la terraza" does not leak anything, it makes
        the model plan around two people who were never mentioned -- a wrong
        rota, silently, for the whole organisation. A capital letter is what
        tells a person from a noun in the prose we get, and it is free.

        What it costs is written down rather than hidden: a manager who types
        in lower case ("dale los viernes a ana") keeps that first name
        unmasked. That is one first name in one sentence they wrote
        themselves, against a calendar nobody can trust; and it is the reason
        the roster rows are gone from the client altogether, which no amount
        of casing can undo.
        """
        index = match.lastindex
        key = self._name_keys[index - 1] if index else ""
        owners = self._by_name.get(key)
        if not owners:
            # Cannot happen while the pattern and ``_name_keys`` are built
            # together, and if it ever does the answer is still not the name.
            return "someone"
        text = match.group(0)
        if " " not in key and not text[:1].isupper():
            return text
        if len(owners) == 1:
            return owners[0]
        return " or ".join(owners[:MAX_AMBIGUOUS])

    def _coin(self, real: str, kind: str) -> str:
        key = real.strip().lower()
        alias = self._alias_of.get(key)
        if alias is None:
            if kind == EMPLOYEE and self._employee_alias is not None:
                alias = self._employee_alias(key)
                self._people.add(key)
            else:
                self._counts[kind] += 1
                alias = "%s%d" % (kind, self._counts[kind])
                if kind == EMPLOYEE:
                    self._people.add(key)
            self._alias_of[key] = alias
            self._real_of[alias] = real.strip()
        return alias

    def _restore(self, alias: Optional[str], wanted: str) -> Optional[str]:
        if alias is None:
            return None
        key = alias.strip()
        if UUID_RE.fullmatch(key):
            # A model that ignored the aliases and echoed a real id still
            # lands, provided it is one we listed.
            key = self._alias_of.get(key.lower(), "")
        if key[:1] not in (wanted, UNKNOWN):
            return None
        return self._real_of.get(key)

    def __len__(self) -> int:
        return len(self._alias_of)
