from __future__ import annotations

"""The planner's own notebook about each business, kept with the API's memory tool.

`hand_edits` counts what a manager does to our calendars and proposes three
kinds of rule it can recognise by arithmetic. It is deliberately narrow: a
retouch that is not a trim, a moved start or a night kept off is invisible to
it. This module is the wider, softer ear. After a publish, in the background,
the model is shown what was published, what the manager changed in its
proposal, and the business's profile, and it keeps a few lines of notes about
the business in a notebook only it writes and only this business has.

THE TOOL. The notebook is the API's memory tool (`memory_20250818`): the model
asks to view, create, str_replace, insert, delete or rename files under
`/memories`, and we carry the commands out. Where the files live is ours to
decide -- here, `business_memory_file`, one row per file per organisation (see
migration 0027). The loop is written by hand against `client.messages.create`
rather than the SDK's beta tool runner: it is twenty lines, it has a hard
ceiling on iterations, it meters every call with `api_usage` like every other
call this product makes, and a fake client can drive it in a test.

ISOLATION BY CONSTRUCTION. `Notebook` is a dictionary of ONE organisation's
files, loaded before the model is called and saved after. The model never
supplies an org, never supplies a path outside `/memories`, and never reaches
the database: there is no command it can phrase that touches anything but that
dictionary. The rows are also behind `org_isolation` like every tenant table,
so even a bug in this file could not read a neighbour's notebook.

LIMITS. At most `MAX_FILES` files of `MAX_FILE_BYTES` each and `MAX_TOTAL_BYTES`
in all. A command that would break one is refused with an error the model can
read and recover from, and the notebook is left as it was. Paths are
normalised and refused if they try to leave `/memories` (`..`, encoded
separators, backslashes, hidden names).

PEOPLE, AND WHY THEY ARE STORED AS MARKERS. Nothing that names a person leaves
this building (`id_alias.py`). The model sees `e1`, `e2` -- aliases coined for
THIS request, which will mean somebody else next time. So what it writes with
an alias is stored with a marker holding that person's employee id,
`⟦persona:<uuid>⟧`, and every time the notebook is shown to the model again
the markers are shortened back into that request's aliases. A real name that
somehow reaches the model's text (it never sees one) is masked by the same
table on the way IN, so it is stored as a marker too.

"ONLY THE OBVIOUS THINGS" -- Max's decision, and enforced here, not asked for.
The model may note what it likes; what APPLIES by itself is decided by code:

* A line that mentions a person (holds a marker) NEVER applies. It becomes a
  PROPOSAL on the rules screen through `business_profile.propose_from_edits`
  -- inert until the manager says "always", rejection permanent -- with the
  person's real name written in at that moment, into our own database, where
  the manager reads it. A marker we cannot put a name to proposes nothing.
* A line about the business (no person in it) reaches the next calendar
  through `business_profile.planning_context`, in a section of its own that
  says it is what the planner NOTICED and nobody confirmed -- below what the
  manager said, above what we looked up on the internet.
* The system prompt asks for obvious, repeated facts, short, one per line. It
  is a request, not a control: everything above holds whatever the model
  writes.

WHAT THE CALL NEVER SEES. No pay, no contracts, no absences, no reasons. The
published and proposed calendars arrive through `hand_edits.learnable_sides`,
which has already taken every shift touched by an absence out of both; the
profile texts are sent sentence by sentence with any sentence that mentions
pay, contracts, leave, health or family dropped (`SENSITIVE`); and a line the
model writes that mentions any of those is dropped before it is stored.

VISIBLE AND REMOVABLE. The manager sees every line (`GET /profile/notes`) and
can delete any of them. A deleted line is remembered by its fingerprint in a
reserved row (`/.forgotten`, never shown to the model), so the planner cannot
write the same sentence back the day after. A paraphrase can come back; that
is a known limit, and the manager can delete it again.

ONE PASS PER PERIOD PER DAY. Republishing to fix a typo does not buy a
second call: a period that overlaps one noted in the last `RECENT_RUN_WINDOW`
is skipped, remembered in another reserved row (`/.runs`).

THE SWITCHES. `settings.planner_notes_enabled` (off by default) and the
profile's `learning_enabled`. Either off: the model is not called and the
notes do not reach a calendar.
"""

import hashlib
import logging
import posixpath
import re
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models.business_memory_file import BusinessMemoryFile
from app.services import api_usage
from app.services import business_profile as bp
from app.services import hand_edits as he
from app.services.calendar_plan import MODEL
from app.services.id_alias import IdAliases

log = logging.getLogger(__name__)

# MODEL is the planner's: the notebook is about the same calendars, and a
# second model family to price, meter and reason about buys nothing at this
# volume. The effort is LOW -- this is reading two short lists and editing a
# few lines, and nothing it writes applies without a second guard.
EFFORT = "low"

# What the ledger calls these calls. An attempt the SDK retried and threw
# away is metered by `api_usage.meter_attempts` as ``notes.publish.lost``.
PURPOSE = "notes.publish"

MEMORY_TOOL = {"type": "memory_20250818", "name": "memory"}

# One reply is a handful of short commands. The ceiling is generous for that
# and small enough that a loop gone wrong costs cents, not dollars.
MAX_TOKENS = 4000
# API calls per publication. View, edit, confirm is three; six leaves room for
# a recovery from an error and nothing more.
MAX_ITERATIONS = 6
# Commands carried out per publication, across all iterations. A model that
# asks for more than this is not keeping notes.
MAX_COMMANDS = 24

TIMEOUT_SECONDS = 60.0
MAX_RETRIES = 1

ROOT = "/memories"
DEFAULT_FILE = ROOT + "/negocio.md"
MAX_FILES = 20
MAX_FILE_BYTES = 4 * 1024
MAX_TOTAL_BYTES = 16 * 1024
MAX_PATH = 120
MAX_DEPTH = 2  # /memories/a/b.md, no deeper

# Ours, outside /memories, so the notebook the model sees can never contain it.
FORGOTTEN_PATH = "/.forgotten"
MAX_FORGOTTEN = 300

# Ours too: when this org's notebook was last passed to the model, and for
# which period. One line per run, "<ran at> <period start> <period end>", all
# ISO instants. Kept in the same table as a reserved row -- outside /memories,
# so the model never sees it and `forget_all` never clears it -- rather than
# in a new column, because it is bookkeeping for one feature, not a fact
# about the business.
RUNS_PATH = "/.runs"

# How long a period, once noted, is not noted again. A manager who publishes
# October, spots a typo and publishes October again ten minutes later has not
# shown the planner anything new -- and that second pass is the same call,
# the same price, for the same notes. Twenty-four hours covers the "fix it the
# next morning" republish as well. Any overlap counts: re-publishing one week
# of a month that was just noted is still a republish of that month. A
# different, non-overlapping period is noted at once.
RECENT_RUN_WINDOW = timedelta(hours=24)

# A line longer than this is a paragraph, and a paragraph is not a note a
# manager can confirm or delete at a glance -- the same bound as a stated rule.
MAX_NOTE_CHARS = 300

# How many business notes reach a calendar. The notebook can hold more; the
# planner's prompt should not be where it is all read.
MAX_CONTEXT_NOTES = 15

# How much of the period is described. Two months of days and a few dozen
# retouches is everything a note could be about; past that it is tokens.
MAX_DAYS_DESCRIBED = 62
MAX_DIFF_LINES = 40

_WEEKDAYS_ES = ("dom", "lun", "mar", "mié", "jue", "vie", "sáb")

MARKER_RE = re.compile(r"⟦persona:([0-9a-fA-F-]{36}|\?)⟧")
UNKNOWN_ID = "?"
# What the model sees for a person we can no longer place: an alias no id can
# be restored from, so writing it back keeps the line about "a person".
UNKNOWN_ALIAS = "p0"
# The aliases the model uses. `e` is a person in this request, `x` an id we
# could not classify (a removed employee), `p` a name with no plannable id.
ALIAS_RE = re.compile(r"(?<![0-9A-Za-zÀ-ÿ_])([epx])(\d{1,4})(?![0-9A-Za-zÀ-ÿ_])")

# What must never reach the call, nor come back out of it. Spanish and English,
# stems rather than words, and broad on purpose: dropping a sentence about the
# business costs a note; keeping one about somebody's leave costs a promise.
SENSITIVE = re.compile(
    r"salari|sueldo|n[óo]mina|\bpag[ao]s?\b|\bcobr|€|\beur(?:o|os)?\b|"
    r"contrat|convenio|\bwage|\bpay\b|payroll|salary|"
    r"\bbaja|vacaci|ausen|absen|\bleave\b|holiday pay|"
    r"enferm|\bsick|m[ée]dic|medical|salud|health|embaraz|pregnan|"
    r"materni|paterni|lactan|"
    r"famili|\bhij[oa]s?\b|child|"
    r"motivo personal|personal reason|religi|sindica|\bunion\b|"
    r"despid|dismiss|fired|disciplin|sanci[óo]n",
    re.IGNORECASE,
)

_BULLET_RE = re.compile(r"^\s*(?:[-*•·]|\d{1,2}[.)])\s+")

SYSTEM_PROMPT = """You keep a small notebook about ONE business that uses a shift-planning product. You write it for yourself: it is read back to you the next time you help plan this business's calendar.

Each time the manager publishes a calendar you are shown what was published, how the manager changed the calendar the planner had proposed, and what the manager has told us about the business. Look at your notebook under /memories and update it.

What to write:
- Only facts that are OBVIOUS and REPEATED in what you see: something that happens on most of the days it could, or that the manager changed the same way more than once. Never a guess, never a one-off, never an explanation of why.
- One fact per line, a short plain sentence in Spanish, under 150 characters. No headings, no dates of this publication, no numbering.
- Keep everything in /memories/negocio.md unless it truly does not fit.
- Remove or correct a line that what you see now plainly contradicts. Leave alone a line you have no new evidence about.
- If nothing new is obvious, change nothing. That is the usual, correct outcome.

About people:
- People appear only as aliases such as e1 or e2. If a fact is about one person, write that alias exactly; the notebook keeps track of who it is. Never invent or guess a name.
- Never write anything about pay, contracts, hours owed, absences, leave, health, family or personal reasons. You are not shown any of it and must not infer it.

The notebook is small: at most 20 files, 4 KB per file, 16 KB in total. Do not use it for anything else, and do not record this conversation. When you are done, reply with one short sentence saying what you changed."""


class NotebookError(Exception):
    """A command the notebook refuses. The text goes back to the model."""


# --- paths ---------------------------------------------------------------------


_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,59}$")


def normalize_path(path: object) -> str:
    """The one spelling of a path under /memories, or NotebookError.

    Refused rather than repaired: `..`, anything percent-encoded, backslashes,
    control characters, hidden names, doubled slashes, and anything deeper than
    `MAX_DEPTH`. A path that normalises to something else than it says is a
    path trying to be two things at once.
    """
    if not isinstance(path, str):
        raise NotebookError("The path must be a string.")
    raw = path.strip()
    if not raw or len(raw) > MAX_PATH:
        raise NotebookError("The path must be between 1 and %d characters." % MAX_PATH)
    if "\\" in raw or "%" in raw or any(ord(c) < 32 for c in raw):
        raise NotebookError("Path %s is not allowed." % raw)
    if raw.rstrip("/") == ROOT:
        return ROOT
    if not raw.startswith(ROOT + "/"):
        raise NotebookError("Path must start with %s, got: %s" % (ROOT, raw))
    trimmed = raw.rstrip("/")
    if posixpath.normpath(trimmed) != trimmed:
        raise NotebookError("Path %s would escape %s." % (raw, ROOT))
    parts = trimmed[len(ROOT) + 1 :].split("/")
    if len(parts) > MAX_DEPTH:
        raise NotebookError("Paths may be at most %d levels deep." % MAX_DEPTH)
    for part in parts:
        if part in (".", "..") or not _SEGMENT_RE.match(part):
            raise NotebookError("Path %s is not allowed." % raw)
    return trimmed


# --- people: aliases out, markers in ---------------------------------------------


def marker(employee_id: str) -> str:
    return "⟦persona:%s⟧" % employee_id


class People:
    """The one table that turns markers into aliases and back, for ONE request.

    Built on `IdAliases`, so a name, a UUID and an alias mean the same person
    here as they do in the planner. ``active`` are the people who can be
    planned (they get `e` aliases); ``names`` is the whole roster, removed
    people included, so every name we know is masked.
    """

    def __init__(self, active: Iterable[str], names: Mapping[str, str]):
        self._aliases = IdAliases()
        self._aliases.load(sorted(str(a) for a in active), [])
        self._aliases.load_names({str(k): v for k, v in names.items()})

    def alias(self, employee_id: str) -> str:
        return self._aliases.shorten(str(employee_id))

    def outgoing(self, canonical: str) -> str:
        """Stored text -> what the model may read."""

        def stand_in(m: "re.Match") -> str:
            return UNKNOWN_ALIAS if m.group(1) == UNKNOWN_ID else self.alias(m.group(1))

        return self._aliases.shorten(MARKER_RE.sub(stand_in, canonical))

    def incoming(self, text: str) -> str:
        """What the model wrote -> stored text, with every person as a marker.

        Names and UUIDs are shortened FIRST, so a name that got into the text
        becomes an alias and then a marker instead of being stored.
        """
        text = str(text).replace("⟦", "").replace("⟧", "")
        text = self._aliases.shorten(text)

        def restore(m: "re.Match") -> str:
            if m.group(1) in ("e", "x"):
                real = self._aliases.employee(m.group(0))
                if real:
                    return marker(real.lower())
            return marker(UNKNOWN_ID)

        return ALIAS_RE.sub(restore, text)


def named(canonical: str, names: Mapping[str, str], unknown: str = "?") -> Optional[str]:
    """Stored text with each marker replaced by the person's real name.

    For our own database and the manager's screen only. None when a marker
    cannot be put a name to -- a sentence about nobody we can name is not one
    a manager can confirm.
    """
    missing = []

    def name(m: "re.Match") -> str:
        who = " ".join(str(names.get(m.group(1).lower()) or "").split())
        if not who:
            missing.append(m.group(1))
            return unknown
        return who

    out = MARKER_RE.sub(name, canonical)
    return None if missing else out


# --- the notebook ----------------------------------------------------------------


def _bytes(text: str) -> int:
    return len(text.encode("utf-8"))


@dataclass
class Notebook:
    """One organisation's files, in memory. Paths are normalised; content is stored text."""

    files: Dict[str, str] = field(default_factory=dict)

    def copy(self) -> "Notebook":
        return Notebook(dict(self.files))

    # ---- limits ----

    def _check(self, files: Dict[str, str]) -> None:
        if len(files) > MAX_FILES:
            raise NotebookError("The notebook holds at most %d files." % MAX_FILES)
        for path, content in files.items():
            if _bytes(content) > MAX_FILE_BYTES:
                raise NotebookError(
                    "%s would be %d bytes; a file holds at most %d."
                    % (path, _bytes(content), MAX_FILE_BYTES)
                )
        total = sum(_bytes(c) for c in files.values())
        if total > MAX_TOTAL_BYTES:
            raise NotebookError(
                "The notebook would hold %d bytes; the limit is %d. Remove "
                "something first." % (total, MAX_TOTAL_BYTES)
            )

    def _commit(self, files: Dict[str, str]) -> None:
        self._check(files)
        self.files = files

    def _is_dir(self, path: str) -> bool:
        if path == ROOT:
            return True
        prefix = path + "/"
        return any(p.startswith(prefix) for p in self.files)

    # ---- commands ----

    def execute(self, command: Mapping, people: People) -> str:
        """Carry out one memory-tool command. Raises NotebookError."""
        if not isinstance(command, Mapping):
            raise NotebookError("The command must be an object.")
        name = command.get("command")
        handler = {
            "view": self._view,
            "create": self._create,
            "str_replace": self._str_replace,
            "insert": self._insert,
            "delete": self._delete,
            "rename": self._rename,
        }.get(name)
        if handler is None:
            raise NotebookError("Unknown command: %s" % name)
        return handler(command, people)

    def _view(self, command, people: People) -> str:
        path = normalize_path(command.get("path"))
        if path in self.files:
            lines = people.outgoing(self.files[path]).split("\n")
            start = 1
            rng = command.get("view_range")
            if isinstance(rng, (list, tuple)) and len(rng) == 2:
                try:
                    lo, hi = int(rng[0]), int(rng[1])
                except (TypeError, ValueError):
                    raise NotebookError("view_range must be two integers.")
                start = max(1, lo)
                lines = lines[start - 1 : (len(lines) if hi == -1 else hi)]
            numbered = "\n".join(
                "%6d\t%s" % (i + start, line) for i, line in enumerate(lines)
            )
            return "Here's the content of %s with line numbers:\n%s" % (path, numbered)
        if self._is_dir(path):
            prefix = "" if path == ROOT else path[len(ROOT) + 1 :] + "/"
            rows = ["%dB\t%s" % (sum(_bytes(c) for c in self.files.values()), path)]
            for p in sorted(self.files):
                rel = p[len(ROOT) + 1 :]
                if rel.startswith(prefix):
                    rows.append("%dB\t%s" % (_bytes(self.files[p]), p))
            return (
                "Here're the files and directories up to 2 levels deep in %s, "
                "excluding hidden items:\n%s" % (path, "\n".join(rows))
            )
        raise NotebookError("The path %s does not exist." % path)

    def _file(self, command, key: str = "path") -> str:
        path = normalize_path(command.get(key))
        if path == ROOT or self._is_dir(path):
            raise NotebookError("The path %s is a directory." % path)
        return path

    def _create(self, command, people: People) -> str:
        path = self._file(command)
        text = command.get("file_text")
        if not isinstance(text, str):
            raise NotebookError("create needs file_text.")
        files = dict(self.files)
        files[path] = people.incoming(text)
        self._commit(files)
        return "File created successfully at: %s" % path

    def _existing(self, command, key: str = "path") -> str:
        path = self._file(command, key)
        if path not in self.files:
            raise NotebookError("The path %s does not exist." % path)
        return path

    def _str_replace(self, command, people: People) -> str:
        path = self._existing(command)
        old, new = command.get("old_str"), command.get("new_str", "")
        if not isinstance(old, str) or not old or not isinstance(new, str):
            raise NotebookError("str_replace needs a non-empty old_str and a new_str.")
        content = self.files[path]
        stored_old = people.incoming(old)
        count = content.count(stored_old)
        if count == 0:
            raise NotebookError(
                "No replacement was performed, old_str did not appear verbatim in %s." % path
            )
        if count > 1:
            raise NotebookError(
                "No replacement was performed. old_str appears %d times in %s; "
                "make it unique." % (count, path)
            )
        files = dict(self.files)
        files[path] = content.replace(stored_old, people.incoming(new), 1)
        self._commit(files)
        return "The memory file has been edited."

    def _insert(self, command, people: People) -> str:
        path = self._existing(command)
        text = command.get("insert_text")
        try:
            at = int(command.get("insert_line"))
        except (TypeError, ValueError):
            raise NotebookError("insert needs an integer insert_line.")
        if not isinstance(text, str):
            raise NotebookError("insert needs insert_text.")
        lines = self.files[path].split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        if not 0 <= at <= len(lines):
            raise NotebookError(
                "Invalid insert_line %d. It should be within [0, %d]." % (at, len(lines))
            )
        lines.insert(at, people.incoming(text).rstrip("\n"))
        files = dict(self.files)
        files[path] = "\n".join(lines) + "\n"
        self._commit(files)
        return "The file %s has been edited." % path

    def _delete(self, command, people: People) -> str:
        path = normalize_path(command.get("path"))
        if path == ROOT:
            raise NotebookError("Cannot delete the %s directory itself." % ROOT)
        if path in self.files:
            files = {p: c for p, c in self.files.items() if p != path}
        elif self._is_dir(path):
            files = {p: c for p, c in self.files.items() if not p.startswith(path + "/")}
        else:
            raise NotebookError("The path %s does not exist." % path)
        self._commit(files)
        return "Successfully deleted %s" % path

    def _rename(self, command, people: People) -> str:
        old = normalize_path(command.get("old_path"))
        new = normalize_path(command.get("new_path"))
        if old == ROOT or new == ROOT:
            raise NotebookError("Cannot rename the %s directory itself." % ROOT)
        if new in self.files or self._is_dir(new):
            raise NotebookError("The destination %s already exists." % new)
        files = dict(self.files)
        if old in files:
            files[new] = files.pop(old)
        elif self._is_dir(old):
            if new.startswith(old + "/"):
                raise NotebookError("Cannot move a directory into itself.")
            for p in list(files):
                if p.startswith(old + "/"):
                    files[new + p[len(old) :]] = files.pop(p)
            for p in files:
                normalize_path(p)  # a move must not create a path deeper than allowed
        else:
            raise NotebookError("The path %s does not exist." % old)
        self._commit(files)
        return "Successfully renamed %s to %s" % (old, new)


# --- lines: what a note is, and which ones may apply --------------------------------


@dataclass(frozen=True)
class Note:
    path: str
    text: str  # stored text, markers and all
    id: str

    @property
    def about_person(self) -> bool:
        return MARKER_RE.search(self.text) is not None

    @property
    def people(self) -> List[str]:
        return [m.group(1).lower() for m in MARKER_RE.finditer(self.text)]


def fingerprint(text: str) -> str:
    """The identity of a line, whatever file it sits in and however it is spaced."""
    return hashlib.sha256(" ".join(text.split()).casefold().encode("utf-8")).hexdigest()[:16]


def note_id(path: str, text: str) -> str:
    return hashlib.sha256(("%s\n%s" % (path, " ".join(text.split()))).encode("utf-8")).hexdigest()[:16]


def _clean_line(line: str) -> str:
    return " ".join(_BULLET_RE.sub("", line).split())


def is_note_line(line: str) -> bool:
    text = _clean_line(line)
    return bool(text) and not text.startswith("#") and len(text) <= MAX_NOTE_CHARS


def scrub(content: str, forgotten: Set[str]) -> str:
    """A file as it may be stored: nothing sensitive, nothing the manager deleted."""
    kept = []
    for line in content.split("\n"):
        text = _clean_line(line)
        if text and (SENSITIVE.search(text) or fingerprint(text) in forgotten):
            continue
        kept.append(line)
    return "\n".join(kept)


def notes_in(files: Mapping[str, str]) -> List[Note]:
    out: List[Note] = []
    for path in sorted(files):
        for line in files[path].split("\n"):
            if not is_note_line(line):
                continue
            text = _clean_line(line)
            if SENSITIVE.search(text):
                continue
            out.append(Note(path=path, text=text, id=note_id(path, text)))
    return out


def business_lines(files: Mapping[str, str]) -> List[str]:
    """The notes that may reach a calendar: about the business, not about anyone."""
    return [n.text for n in notes_in(files) if not n.about_person][:MAX_CONTEXT_NOTES]


# --- the database side ------------------------------------------------------------


def _rows(db: Session, org_id: UUID) -> List[BusinessMemoryFile]:
    # The org is in the WHERE as well as in RLS: two locks on one door.
    return list(
        db.execute(
            select(BusinessMemoryFile).where(BusinessMemoryFile.org_id == org_id)
        ).scalars()
    )


def load(db: Session, org_id: UUID) -> Tuple[Notebook, Set[str]]:
    """This org's notebook, and the fingerprints of the lines it may not hold."""
    files: Dict[str, str] = {}
    forgotten: Set[str] = set()
    for row in _rows(db, org_id):
        if row.path == FORGOTTEN_PATH:
            forgotten = {x for x in (row.content or "").split() if x}
        elif row.path.startswith(ROOT + "/"):
            try:
                files[normalize_path(row.path)] = row.content or ""
            except NotebookError:
                continue
    return Notebook(files), forgotten


def _write(db: Session, org_id: UUID, path: str, content: Optional[str]) -> None:
    row = db.execute(
        select(BusinessMemoryFile).where(
            BusinessMemoryFile.org_id == org_id, BusinessMemoryFile.path == path
        )
    ).scalar_one_or_none()
    if content is None:
        if row is not None:
            db.delete(row)
        return
    if row is None:
        db.add(BusinessMemoryFile(org_id=org_id, path=path, content=content))
    else:
        row.content = content
        row.updated_at = datetime.now(timezone.utc)


def save(
    db: Session,
    org_id: UUID,
    before: Mapping[str, str],
    after: Mapping[str, str],
) -> int:
    """Write what the model changed. Returns the files written.

    ONLY what changed, and only where nobody else changed it meanwhile: the
    model works for seconds with no session open, and a manager may delete a
    note in that time. A file whose stored content is no longer what we loaded
    is left as the manager left it -- their deletion wins over our edit.
    """
    current, forgotten = load(db, org_id)
    written = 0
    for path in sorted(set(before) | set(after)):
        if current.files.get(path) != before.get(path):
            continue
        new = after.get(path)
        if new is not None:
            new = scrub(new, forgotten)
        if new == before.get(path):
            continue
        _write(db, org_id, path, new)
        written += 1
    db.flush()
    return written


def _runs(db: Session, org_id: UUID) -> List[Tuple[datetime, datetime, datetime]]:
    row = db.execute(
        select(BusinessMemoryFile).where(
            BusinessMemoryFile.org_id == org_id, BusinessMemoryFile.path == RUNS_PATH
        )
    ).scalar_one_or_none()
    out = []
    for line in (row.content if row is not None else "").split("\n"):
        parts = line.split()
        if len(parts) != 3:
            continue
        try:
            out.append(tuple(datetime.fromisoformat(p) for p in parts))
        except ValueError:
            continue
    return out


def noted_recently(
    db: Session,
    org_id: UUID,
    period_start: datetime,
    period_end: datetime,
    now: Optional[datetime] = None,
) -> bool:
    """Whether a period overlapping this one was noted in `RECENT_RUN_WINDOW`."""
    now = now or datetime.now(timezone.utc)
    for ran_at, start, end in _runs(db, org_id):
        if now - ran_at < RECENT_RUN_WINDOW and start < period_end and period_start < end:
            return True
    return False


def claim_run(
    db: Session,
    org_id: UUID,
    period_start: datetime,
    period_end: datetime,
    now: Optional[datetime] = None,
) -> None:
    """Write down that this period is being noted now, dropping stale lines.

    Claimed BEFORE the model is called and committed with the read: two
    publishes of the same month a second apart must not both pay, and a run
    that then fails has still been paid for -- the next chance is tomorrow.
    """
    now = now or datetime.now(timezone.utc)
    kept = [r for r in _runs(db, org_id) if now - r[0] < RECENT_RUN_WINDOW]
    kept.append((now, period_start, period_end))
    _write(
        db,
        org_id,
        RUNS_PATH,
        "\n".join(" ".join(t.isoformat() for t in r) for r in kept),
    )
    db.flush()


def business_notes(db: Session, org_id: UUID, profile=None) -> List[str]:
    """The lines `planning_context` may show, or [] when either switch is off."""
    if not settings.planner_notes_enabled:
        return []
    profile = profile if profile is not None else bp.get_or_create(db, org_id)
    if not profile.learning_enabled:
        return []
    notebook, _ = load(db, org_id)
    return business_lines(notebook.files)


def list_notes(db: Session, org_id: UUID, names: Mapping[str, str]) -> List[dict]:
    """Every line, for the manager, with people written by their real names."""
    notebook, _ = load(db, org_id)
    out = []
    for note in notes_in(notebook.files):
        out.append(
            {
                "id": note.id,
                "text": named(note.text, names, "?") or MARKER_RE.sub("?", note.text),
                "about_person": note.about_person,
            }
        )
    return out


def _remember_forgotten(db: Session, org_id: UUID, prints: Iterable[str]) -> None:
    _, forgotten = load(db, org_id)
    merged = [p for p in forgotten if p not in set(prints)] + list(dict.fromkeys(prints))
    _write(db, org_id, FORGOTTEN_PATH, "\n".join(merged[-MAX_FORGOTTEN:]))


def forget(db: Session, org_id: UUID, wanted: str) -> bool:
    """Delete one line, and never let the planner write it back verbatim."""
    notebook, _ = load(db, org_id)
    for path in sorted(notebook.files):
        lines = notebook.files[path].split("\n")
        for i, line in enumerate(lines):
            if is_note_line(line) and note_id(path, _clean_line(line)) == wanted:
                text = _clean_line(line)
                del lines[i]
                _write(db, org_id, path, "\n".join(lines))
                _remember_forgotten(db, org_id, [fingerprint(text)])
                db.flush()
                return True
    return False


def forget_all(db: Session, org_id: UUID) -> int:
    notebook, _ = load(db, org_id)
    notes = notes_in(notebook.files)
    db.execute(
        delete(BusinessMemoryFile)
        .where(BusinessMemoryFile.org_id == org_id)
        .where(BusinessMemoryFile.path.like(ROOT + "/%"))
    )
    if notes:
        _remember_forgotten(db, org_id, [fingerprint(n.text) for n in notes])
    db.flush()
    return len(notes)


NOTES_PREFIX = bp.EDITS_PREFIX + "note:"


def propose_person_notes(
    db: Session,
    org_id: UUID,
    files: Mapping[str, str],
    names: Mapping[str, str],
    today: Optional[date] = None,
) -> List[str]:
    """Every line about a person becomes a PROPOSAL, never a rule. Returns new keys.

    Keyed on the stored text -- markers, not names -- so renaming somebody
    does not make the same note a second proposal, and the key never holds a
    name. The sentence in the value does: it is written in our database for
    the manager to read, which is the one place a name is allowed.
    """
    new: List[str] = []
    for note in notes_in(files):
        if not note.about_person:
            continue
        sentence = named(note.text, names)
        if not sentence:
            continue
        key = NOTES_PREFIX + fingerprint(note.text)
        if bp.propose_from_edits(
            db,
            org_id,
            key,
            {"source": "planner_notes", "pattern": "note", "text": sentence},
            1,
            today,
        ):
            new.append(key)
    return new


# --- what the model is shown ---------------------------------------------------------


def _hhmm(minutes: int) -> str:
    h, m = divmod(int(minutes) % he.DAY, 60)
    return "%02d:%02d" % (h, m)


def _span(s: he.Shift) -> str:
    return "%s-%s" % (_hhmm(s.start), _hhmm(s.end))


def _day(d: date) -> str:
    return "%s %s" % (d.isoformat(), _WEEKDAYS_ES[he.weekday(d)])


def safe_prose(text: Optional[str], people: People) -> str:
    """A profile text as the model may read it: masked, and without any
    sentence about pay, contracts, leave, health or family."""
    if not text or not text.strip():
        return ""
    sentences = re.split(r"(?<=[.!?;])\s+|\n+", text.strip())
    kept = [s.strip() for s in sentences if s.strip() and not SENSITIVE.search(s)]
    return people.outgoing(" ".join(kept))[:1500]


def describe_profile(profile, people: People) -> List[str]:
    lines: List[str] = []
    if profile is None:
        return lines
    if profile.vertical and profile.vertical_source == "declared":
        vertical = bp.VERTICALS.get(profile.vertical)
        if vertical is not None:
            lines.append("Tipo de negocio: %s." % vertical.label)
    if profile.location and profile.location.strip():
        lines.append("Dónde está: %s." % safe_prose(profile.location, people))
    if profile.weekend_days:
        lines.append(
            "Su fin de semana: %s."
            % ", ".join(_WEEKDAYS_ES[d] for d in profile.weekend_days if 0 <= d < 7)
        )
    if profile.objective:
        lines.append("Qué quiere optimizar: %s." % profile.objective)
    house = safe_prose(profile.house_notes, people)
    if house:
        lines.append("Lo que el manager cuenta del negocio: %s" % house)
    interview = safe_prose(profile.interview_notes, people)
    if interview:
        lines.append("Lo que dijo en la entrevista inicial: %s" % interview)
    return lines


def describe_published(published: Sequence[he.Shift], people: People) -> List[str]:
    by_day: Dict[date, List[he.Shift]] = {}
    for s in published:
        by_day.setdefault(s.day, []).append(s)
    out = []
    for d in sorted(by_day)[:MAX_DAYS_DESCRIBED]:
        shifts = sorted(by_day[d], key=lambda s: (s.start, s.end, people.alias(s.employee_id)))
        out.append(
            "%s: %s"
            % (_day(d), ", ".join("%s %s" % (people.alias(s.employee_id), _span(s)) for s in shifts))
        )
    return out


def describe_diff(d: Optional[he.Diff], people: People) -> List[str]:
    if d is None:
        return []
    out = []
    for s in sorted(d.removed, key=he._order)[:MAX_DIFF_LINES]:
        out.append("Quitado: %s %s %s" % (_day(s.day), people.alias(s.employee_id), _span(s)))
    for p, q in sorted(d.changed, key=lambda pq: he._order(pq[0]))[:MAX_DIFF_LINES]:
        out.append(
            "Cambiado: %s %s %s -> %s %s"
            % (
                _day(p.day),
                people.alias(p.employee_id),
                _span(p),
                people.alias(q.employee_id),
                _span(q),
            )
        )
    if d.added:
        # Counted, never listed: most of what was added is the client's own
        # gap-filling, not the manager's hand, and it teaches nothing.
        out.append("Añadidos después (casi siempre relleno automático): %d turnos." % len(d.added))
    out.append("Sin tocar: %d de %d turnos propuestos." % (len(d.kept), len(d.kept) + len(d.changed) + len(d.removed)))
    return out


def compose_message(
    profile,
    published: Sequence[he.Shift],
    d: Optional[he.Diff],
    notebook: Notebook,
    people: People,
) -> str:
    parts = []
    about = describe_profile(profile, people)
    parts.append(
        "LO QUE SABEMOS DEL NEGOCIO\n" + ("\n".join(about) if about else "(nada todavía)")
    )
    parts.append("LO QUE SE HA PUBLICADO\n" + ("\n".join(describe_published(published, people)) or "(nada)"))
    diff_lines = describe_diff(d, people)
    parts.append(
        "LO QUE EL MANAGER CAMBIÓ DE LA PROPUESTA DEL PLANIFICADOR\n"
        + (
            "\n".join(diff_lines)
            if diff_lines
            else "(no hay una propuesta comparable: el calendario se hizo de otra forma)"
        )
    )
    if notebook.files:
        shown = "\n\n".join(
            "%s:\n%s" % (p, people.outgoing(notebook.files[p])) for p in sorted(notebook.files)
        )
        parts.append(
            "TU LIBRETA AHORA MISMO (no hace falta que la vuelvas a ver)\n" + shown
        )
    else:
        parts.append("TU LIBRETA AHORA MISMO\n(vacía: %s no existe todavía)" % DEFAULT_FILE)
    parts.append("Revisa tu libreta y actualízala solo si hay algo obvio y repetido.")
    return "\n\n".join(parts)


# --- the loop ----------------------------------------------------------------------------


@dataclass
class LoopResult:
    calls: int = 0
    stop_reason: Optional[str] = None
    commands: List[Tuple[str, str, bool]] = field(default_factory=list)


def _block(obj, key):
    return obj.get(key) if isinstance(obj, Mapping) else getattr(obj, key, None)


def run_loop(
    client,
    notebook: Notebook,
    people: People,
    message: str,
    max_iterations: int = MAX_ITERATIONS,
) -> LoopResult:
    """Let the model work on the notebook until it stops, or until the ceiling.

    `notebook` is changed in place, command by command; the caller decides
    whether any of it is saved. Every call is metered under `PURPOSE`.
    """
    messages: List[dict] = [{"role": "user", "content": message}]
    result = LoopResult()
    while result.calls < max_iterations:
        started = time.monotonic()
        response = client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            output_config={"effort": EFFORT},
            tools=[MEMORY_TOOL],
            # The prefix grows by one exchange per iteration and is re-sent
            # whole; cached, the second and third reads cost a tenth.
            cache_control={"type": "ephemeral"},
            messages=messages,
        )
        result.calls += 1
        api_usage.note(
            PURPOSE, MODEL, getattr(response, "usage", None),
            int((time.monotonic() - started) * 1000),
        )
        result.stop_reason = getattr(response, "stop_reason", None)
        content = list(getattr(response, "content", None) or [])
        uses = [b for b in content if _block(b, "type") == "tool_use"]
        if result.stop_reason != "tool_use" or not uses:
            break
        messages.append({"role": "assistant", "content": content})
        results = []
        for use in uses:
            command = _block(use, "input") or {}
            name = command.get("command") if isinstance(command, Mapping) else None
            path = ""
            if isinstance(command, Mapping):
                path = str(command.get("path") or command.get("old_path") or "")
            if len(result.commands) >= MAX_COMMANDS:
                text, ok = "Too many commands for one publication; stop here.", False
            elif _block(use, "name") != MEMORY_TOOL["name"]:
                text, ok = "Unknown tool.", False
            else:
                try:
                    text, ok = notebook.execute(command, people), True
                except NotebookError as exc:
                    text, ok = str(exc), False
            result.commands.append((str(name), path, ok))
            block = {"type": "tool_result", "tool_use_id": _block(use, "id"), "content": text}
            if not ok:
                block["is_error"] = True
            results.append(block)
        messages.append({"role": "user", "content": results})
    return result


# --- after a publish ------------------------------------------------------------------------


def _client():
    import anthropic

    client = anthropic.Anthropic(
        api_key=settings.anthropic_api_key,
        timeout=TIMEOUT_SECONDS,
        max_retries=MAX_RETRIES,
    )
    return client.with_middleware(api_usage.meter_attempts(PURPOSE, MODEL))


@dataclass
class _Snapshot:
    profile: object
    sides: he.Sides
    names: Dict[str, str]
    active: List[str]
    notebook: Notebook


def _read(db: Session, org_id: UUID, period_start, period_end, shifts) -> Optional[_Snapshot]:
    from app.models.employee import Employee

    profile = bp.get_or_create(db, org_id)
    if not profile.learning_enabled:
        return None
    if settings.api_budget_enforced:
        if api_usage.spent_usd_this_month(db, org_id) >= settings.api_budget_usd_per_month:
            log.info("planner notes: org %s is over its budget; not writing notes", org_id)
            return None
    sides = he.learnable_sides(db, org_id, period_start, period_end, shifts)
    if not sides.published:
        return None
    if noted_recently(db, org_id, period_start, period_end):
        log.info("planner notes: org %s noted this period recently; skipping", org_id)
        return None
    claim_run(db, org_id, period_start, period_end)
    from app.services import employees as employees_svc

    names = employees_svc.names_by_id(db, org_id)
    active = [
        str(i)
        for i in db.execute(
            select(Employee.id)
            .where(Employee.org_id == org_id)
            .where(Employee.deleted_at.is_(None))
        ).scalars()
    ]
    notebook, _ = load(db, org_id)
    # Plain values only: the session is closed before the model is called.
    db.expunge(profile)
    return _Snapshot(profile, sides, names, active, notebook)


def _in_session(org_id: UUID, work: Callable[[Session], object]):
    from app.db import AppSessionLocal, set_current_org

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        out = work(db)
        db.commit()
        return out
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def after_publish(
    org_id: UUID,
    period_start: datetime,
    period_end: datetime,
    shifts: Sequence[Tuple[str, datetime, datetime]],
) -> None:
    """The background task `/publish` schedules after `hand_edits`. NEVER RAISES.

    Three short steps, and no connection is held across the model call:
    read (one session), think (none), write (another session). A note we
    failed to take is taken next month; a publish that failed because of it
    would be a rota nobody got.
    """
    if not settings.planner_notes_enabled or not settings.anthropic_api_key:
        return
    try:
        snap = _in_session(
            org_id, lambda db: _read(db, org_id, period_start, period_end, shifts)
        )
        if snap is None:
            return
        people = People(snap.active, snap.names)
        d = he.retouched(snap.sides.proposed, snap.sides.published)
        message = compose_message(snap.profile, snap.sides.published, d, snap.notebook, people)
        before = dict(snap.notebook.files)
        working = snap.notebook.copy()

        with api_usage.collect() as ledger:
            try:
                result = run_loop(_client(), working, people, message)
            finally:
                api_usage.record(org_id, ledger)

        def write(db: Session):
            # Asked again: the manager may have switched learning off while
            # the model was working, and off means nothing is kept.
            if not bp.get_or_create(db, org_id).learning_enabled:
                return 0, []
            written = save(db, org_id, before, working.files)
            stored, _ = load(db, org_id)
            proposed = propose_person_notes(db, org_id, stored.files, snap.names)
            return written, proposed

        written, proposed = _in_session(org_id, write)
        log.info(
            "planner notes: org %s, %d call(s), %d command(s), %d file(s) written, "
            "%d new proposal(s), stop=%s",
            org_id,
            result.calls,
            len(result.commands),
            written,
            len(proposed),
            result.stop_reason,
        )
    except Exception:  # noqa: BLE001 - see the docstring
        log.exception("planner notes: could not take notes for org %s", org_id)
