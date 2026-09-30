from __future__ import annotations

"""What the manager's mouse teaches us: the retouches between proposal and publish.

The adaptive layer already listens to what a manager SAYS -- the adjustments
they ask for (`business_profile.observe`) and the rules they state in passing
(`note_stated_rule`). It was deaf to what they DO. The planner proposes a
month; the manager drags a shift, deletes another, hands a third to somebody
else, and publishes. Next month the planner proposes the same thing, and the
manager makes the same three changes. That repetition is the most honest
feedback this product receives, and until now it went nowhere.

HOW IT LISTENS. After a publish -- in a background task, after the response,
on its own session, and unable to raise -- the calendar that was published is
compared with the one the planner proposed for the same days (the latest
generation job that has months covering them). Out of that difference come a
few patterns, found by counting and never by a model, and each pattern earns
evidence one PUBLICATION at a time on distinct days. At `MIN_EVIDENCE` days it
becomes a PROPOSAL on the rules screen, inert until the manager says "always".

WHAT COUNTS, AND WHAT DOES NOT.

*Only what the planner proposed and the manager took away or changed.* A shift
the manager ADDED is never evidence of anything. Most added shifts are not the
manager's at all: the client's greedy pass fills every hole the model left,
and those shifts were never the planner's to be corrected on. Added shifts are
still counted as people on shift -- a pattern that says "fewer people than we
proposed" has to see the people who ended up there -- but they can only ever
cancel evidence, never create it.

*Nothing about a person's absence.* A shift that disappeared because its
person was on leave, had asked for leave, or has left the team says something
about that person's life, not about how the business runs -- and learning
from it would be learning from exactly the data this layer promised never to
read. Those (person, day) pairs are taken out of BOTH calendars before they
are compared, so the absence is invisible here rather than filtered after.

*Nothing from a calendar that was not retouched but replaced.* If fewer than
half of the proposed shifts survive untouched, what was published is not our
calendar with edits; it is a different calendar -- rebuilt by the client's
own generator, planned in another browser's time zone, or drafted before a
newer job. Comparing two unrelated calendars produces nothing but noise, so
it produces nothing.

THE THREE PATTERNS, and why only three. Each one is a question a manager can
answer yes or no at a glance, each one survives the most common innocent
explanation for a single edit, and together they cover what managers were seen
doing by hand: taking people out, moving a start, and keeping somebody off a
shift they cannot do.

1. **Trim** -- "every Monday morning, the minimum cover is enough". The
   planner's shift was removed AND the band ended with fewer people than
   proposed. The second half is what separates trimming from shuffling:
   deleting María's shift and giving the slot to Luis is not a vote for fewer
   people. It must happen on at least half of that weekday's occurrences in
   the published period, so one quiet Monday is not a rule about Mondays.

2. **Start** -- "every Friday, the 18:00 shift starts at 17:00". The same
   person, the same day, a start moved by at most three hours (further than
   that is a different shift, not a corrected one). Same half-the-occurrences
   rule, on the exact pair of times, so a manager nudging different shifts by
   different amounts teaches nothing.

3. **No nights** -- "Laura does not do nights". The planner gave her at least
   two night shifts, the published calendar gives her none, and she is still
   on it for the rest of the period. The last condition is the one that keeps
   this from being about somebody who was simply away. This is the only
   pattern about a person, and it is allowed for the same reason the triage
   desk's "Laura siempre abre" is: nothing happens until the manager confirms
   it. The observation keeps a salted hash of her id, never her name; the name
   is read from the roster only to write the sentence she is confirmed in.

"Night" is the band the calendar paints as night (`frontend/src/lib/schedule/
bands.ts`, by the shift's midpoint), mirrored below, so what we propose is
about the same shifts the manager sees coloured as night.

THE CLOCK. The planner writes wall-clock times ("2026-10-05", "18:00"); the
published shifts arrive as instants. They are compared on the business's wall
clock (`business_time`), which is the clock the planner was asked to write in.
A browser in another zone makes every shift look moved -- and then fewer than
half survive and the guard above says nothing, which is the right answer to a
comparison we cannot make.

THE LANGUAGE. There is no stored language for an organisation: it lives in
the browser. The sentence written into the proposal is in Spanish, the
language of the only market this product sells to (the reasoning of
`rota_email`), and it is what the planner reads once confirmed. The rules
screen does not show that sentence when it can help it: it rebuilds it from
the pattern's numbers in whatever language the manager has chosen, the same
convention every other learned claim follows.
"""

import hashlib
import logging
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.absence import Absence
from app.models.employee import Employee
from app.models.generation_job import GenerationJob, GenerationMonth, PLANNED
from app.models.hand_edit_observation import HandEditObservation
from app.models.learned_hint import LearnedHint
from app.services import business_profile as bp
from app.services.business_time import BUSINESS_ZONE, business_day, to_business_time

log = logging.getLogger(__name__)

DAY = 24 * 60

# Below this share of the proposal surviving untouched, what was published is a
# different calendar and not a retouched one. See the module docstring.
MIN_KEPT_SHARE = 0.5

# A calendar this small has too few shifts for "most of it survived" to mean
# anything: three shifts, one of them moved, is 66% kept and proves nothing.
MIN_PROPOSED = 6

# How far a start may move and still be the same shift, corrected. Further
# than this and the manager replaced a morning shift with an evening one.
MAX_START_SHIFT_MIN = 3 * 60

# How many of the planner's night shifts a person must have lost before
# keeping them off nights is a pattern rather than one swap.
MIN_NIGHTS_LOST = 2

# How many recent jobs are searched for the one that covers the published
# days. A manager regenerates; a job five attempts back is not the proposal
# they were looking at.
JOBS_SEARCHED = 5

# Absence states that mean the person was not meant to be there. A rejected
# request says nothing, so it does not hide anything.
ABSENT = ("approved", "requested")

# Mirrors `BANDS` in frontend/src/lib/schedule/bands.ts, by the midpoint of the
# shift. Kept identical so "night" here is exactly what the manager sees
# coloured as night on the calendar.
_BANDS = (
    ("early", 5 * 60, 8 * 60),
    ("morning", 8 * 60, 12 * 60),
    ("afternoon", 12 * 60, 17 * 60),
    ("evening", 17 * 60, 22 * 60),
)
NIGHT = "night"

# Spanish, lower case, Sunday first -- the numbering `WEEKDAY_NAMES` and the
# client's `weekdayName` both use, and the one stored in the proposal.
_DAYS_ES = ("domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado")
_BANDS_ES = {
    "early": "a primera hora",
    "morning": "por la mañana",
    "afternoon": "por la tarde",
    "evening": "al final de la tarde",
    "night": "por la noche",
}


@dataclass(frozen=True)
class Shift:
    """One shift on the business's wall clock.

    ``end`` is minutes from the midnight of ``day`` and runs past 1440 for a
    shift that crosses midnight, so a 22:00-02:00 shift is (1320, 1560) and
    every comparison below is plain arithmetic.
    """

    employee_id: str
    day: date
    start: int
    end: int


@dataclass
class Diff:
    kept: List[Shift]
    # (proposed, published): the same shift, with its time or its person changed.
    changed: List[Tuple[Shift, Shift]]
    removed: List[Shift]
    # Never evidence. Here only so counts of people on shift are true.
    added: List[Shift]


@dataclass(frozen=True)
class Pattern:
    key: str
    value: dict


# --- reading both calendars --------------------------------------------------


def _clock(value) -> Optional[int]:
    try:
        h, m = str(value).strip().split(":")
        minutes = int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return None
    return minutes if 0 <= minutes <= DAY else None


def proposal_shifts(rows: Iterable[dict]) -> List[Shift]:
    """The planner's JSON (`generation_worker._as_json`) as shifts.

    Forgiving like the client's parser: a row we cannot read is dropped, not
    fatal. An end written at or before the start is a shift that crosses
    midnight, "22:00"-"02:00", exactly as the planner is told to write it.
    """
    out: List[Shift] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        start = _clock(row.get("start"))
        end = _clock(row.get("end"))
        try:
            day = date.fromisoformat(str(row.get("date")))
        except ValueError:
            continue
        employee = str(row.get("employeeId") or "").strip()
        if start is None or end is None or not employee:
            continue
        if end <= start:
            end += DAY
        out.append(Shift(employee, day, start, end))
    return out


def published_shifts(
    shifts: Iterable[Tuple[str, datetime, datetime]],
) -> List[Shift]:
    """The published instants, read on the business's wall clock.

    The end is read as a wall clock too, not as start plus elapsed time, so a
    night shift compares equal to the one the planner wrote even on the night
    the clocks change.
    """
    out: List[Shift] = []
    for employee_id, start_at, end_at in shifts:
        start = to_business_time(start_at)
        end = to_business_time(end_at)
        day = start.date()
        start_min = start.hour * 60 + start.minute
        end_min = (end.date() - day).days * DAY + end.hour * 60 + end.minute
        out.append(Shift(str(employee_id), day, start_min, end_min))
    return out


def band(shift: Shift) -> str:
    """The band the calendar paints a shift in, by its midpoint.

    ``(a + b + 1) // 2`` is JavaScript's Math.round on a half, which is what
    the client does; Python's round() would send 12:30 the other way.
    """
    mid = ((shift.start + shift.end + 1) // 2) % DAY
    for key, lo, hi in _BANDS:
        if lo <= mid < hi:
            return key
    return NIGHT


def weekday(day: date) -> int:
    """Sunday = 0, the numbering every stored weekday in this product uses."""
    return (day.weekday() + 1) % 7


# --- comparing them ------------------------------------------------------------


def diff(proposed: Sequence[Shift], published: Sequence[Shift]) -> Diff:
    """Pair every proposed shift with what became of it.

    In three passes, each more permissive than the last, so a shift is only
    ever explained by the loosest story when no tighter one fits:

    1. Untouched: same person, day, start and end.
    2. Retimed: same person and day, the nearest start among what is left.
    3. Reassigned: same day and times, somebody else.

    Whatever proposed shift is left was removed; whatever published one is
    left was added. Deterministic -- the lists are sorted before pairing -- so
    the same two calendars always tell the same story.
    """
    left = Counter(published)
    kept: List[Shift] = []
    pending: List[Shift] = []
    for p in sorted(proposed, key=_order):
        if left[p] > 0:
            left[p] -= 1
            kept.append(p)
        else:
            pending.append(p)

    remaining = sorted(left.elements(), key=_order)
    changed: List[Tuple[Shift, Shift]] = []

    still: List[Shift] = []
    for p in pending:
        best = None
        for i, q in enumerate(remaining):
            if q.employee_id == p.employee_id and q.day == p.day:
                if best is None or abs(q.start - p.start) < abs(remaining[best].start - p.start):
                    best = i
        if best is None:
            still.append(p)
        else:
            changed.append((p, remaining.pop(best)))

    removed: List[Shift] = []
    for p in still:
        match = next(
            (
                i
                for i, q in enumerate(remaining)
                if q.day == p.day and q.start == p.start and q.end == p.end
            ),
            None,
        )
        if match is None:
            removed.append(p)
        else:
            changed.append((p, remaining.pop(match)))

    return Diff(kept=kept, changed=changed, removed=removed, added=remaining)


def _order(s: Shift) -> tuple:
    return (s.day, s.start, s.end, s.employee_id)


def _enough_of_it(hits: int, occurrences: int) -> bool:
    """On at least half of the days it could have happened, and twice if twice
    was possible. One Monday of a four-Monday month is an afternoon, not a rule.
    """
    if occurrences <= 0:
        return False
    return hits >= min(2, occurrences) and 2 * hits >= occurrences


def person_token(org_id, employee_id: str) -> str:
    """A stable stand-in for a person in a key, that is not their id.

    Salted with the org so the same employee id could never be matched across
    tables or exports; one-way so the evidence trail is not a list of who.
    """
    raw = ("%s:%s" % (org_id, employee_id)).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def extract(
    org_id,
    proposed: Sequence[Shift],
    published: Sequence[Shift],
    names: Optional[Dict[str, str]] = None,
) -> List[Pattern]:
    """The patterns one publication shows. Pure: no database, no model.

    Returns [] when the proposal was too small to say anything, or when so
    little of it survived that what was published is another calendar.
    """
    d = retouched(proposed, published)
    if d is None:
        return []

    found: List[Pattern] = []
    found.extend(_trims(proposed, published, d))
    found.extend(_starts(proposed, d))
    found.extend(_no_nights(org_id, proposed, published, names or {}))
    return found


def _trims(proposed, published, d: Diff) -> List[Pattern]:
    prop = Counter((s.day, band(s)) for s in proposed)
    pub = Counter((s.day, band(s)) for s in published)
    removed = Counter((s.day, band(s)) for s in d.removed)

    occurrences: Dict[Tuple[int, str], int] = Counter()
    hits: Dict[Tuple[int, str], int] = Counter()
    for (day, b), count in prop.items():
        slot = (weekday(day), b)
        occurrences[slot] += 1
        # Removed AND fewer people. Removing one shift and filling the slot
        # with somebody else is a swap, not a vote for a leaner shift.
        if removed[(day, b)] > 0 and pub[(day, b)] < count:
            hits[slot] += 1

    out = []
    for (wd, b), n in sorted(hits.items()):
        if not _enough_of_it(n, occurrences[(wd, b)]):
            continue
        out.append(
            Pattern(
                key="%strim:%d:%s" % (bp.EDITS_PREFIX, wd, b),
                value={
                    "source": "hand_edits",
                    "pattern": "trim",
                    "weekday": wd,
                    "band": b,
                    "text": "Cada %s %s basta con la cobertura mínima: sin "
                    "turnos de más." % (_DAYS_ES[wd], _BANDS_ES[b]),
                },
            )
        )
    return out


def _starts(proposed, d: Diff) -> List[Pattern]:
    # How often the planner put a shift starting at this time on this weekday:
    # the denominator of "at least half the times".
    offered: Dict[Tuple[int, int], set] = defaultdict(set)
    for s in proposed:
        offered[(weekday(s.day), s.start)].add(s.day)

    moved: Dict[Tuple[int, int, int], set] = defaultdict(set)
    for p, q in d.changed:
        if p.employee_id != q.employee_id or p.day != q.day:
            continue
        if p.start == q.start or abs(q.start - p.start) > MAX_START_SHIFT_MIN:
            continue
        moved[(weekday(p.day), p.start, q.start)].add(p.day)

    out = []
    for (wd, frm, to), days in sorted(moved.items()):
        if not _enough_of_it(len(days), len(offered[(wd, frm)])):
            continue
        out.append(
            Pattern(
                key="%sstart:%d:%d-%d" % (bp.EDITS_PREFIX, wd, frm, to),
                value={
                    "source": "hand_edits",
                    "pattern": "start",
                    "weekday": wd,
                    "fromMin": frm,
                    "toMin": to,
                    "text": "Cada %s, el turno que empieza a las %s entra a "
                    "las %s." % (_DAYS_ES[wd], _hhmm(frm), _hhmm(to)),
                },
            )
        )
    return out


def _no_nights(org_id, proposed, published, names: Dict[str, str]) -> List[Pattern]:
    ai_nights = Counter(s.employee_id for s in proposed if band(s) == NIGHT)
    pub_nights = Counter(s.employee_id for s in published if band(s) == NIGHT)
    on_rota = {s.employee_id for s in published}

    out = []
    for employee_id, lost in sorted(ai_nights.items()):
        if lost < MIN_NIGHTS_LOST or pub_nights[employee_id] > 0:
            continue
        # Still working the rest of the period. Somebody who is simply not on
        # the rota was away, and that is not something to learn from.
        if employee_id not in on_rota:
            continue
        name = " ".join(str(names.get(employee_id) or "").split())[:120]
        if not name:
            # No name, no sentence a manager could confirm at a glance.
            continue
        out.append(
            Pattern(
                key="%sno_nights:%s" % (bp.EDITS_PREFIX, person_token(org_id, employee_id)),
                value={
                    "source": "hand_edits",
                    "pattern": "no_nights",
                    "name": name,
                    "text": "%s no hace turnos de noche." % name,
                },
            )
        )
    return out


def _hhmm(minutes: int) -> str:
    h, m = divmod(int(minutes) % DAY, 60)
    return "%02d:%02d" % (h, m)


# --- the database side ---------------------------------------------------------


def _proposal_for(
    db: Session, org_id: UUID, period_start: datetime, period_end: datetime
) -> Optional[Tuple[UUID, List[Shift]]]:
    """The planner's proposal for the published days, and the job it came from.

    The most recent job with planned months that put at least one shift inside
    the window. Only the shifts that START inside it are kept -- the same rule
    `publish` uses for what it replaces.
    """
    jobs = list(
        db.execute(
            select(GenerationJob.id)
            .where(GenerationJob.org_id == org_id)
            .order_by(GenerationJob.created_at.desc())
            .limit(JOBS_SEARCHED)
        ).scalars()
    )
    for job_id in jobs:
        rows = db.execute(
            select(GenerationMonth.shifts)
            .where(GenerationMonth.org_id == org_id)
            .where(GenerationMonth.job_id == job_id)
            .where(GenerationMonth.status == PLANNED)
        ).scalars()
        inside = [
            s
            for month in rows
            for s in proposal_shifts(month)
            if period_start <= _instant(s) < period_end
        ]
        if inside:
            return job_id, inside
    return None


def _instant(s: Shift) -> datetime:
    return datetime.combine(s.day, time.min, tzinfo=BUSINESS_ZONE) + timedelta(
        minutes=s.start
    )


def _away(db: Session, org_id: UUID) -> Tuple[set, Dict[str, list]]:
    """Who cannot be learned about, and when.

    Returns the ids of people no longer on the roster, and each person's
    absence spans (approved or asked for). Read to be
    SUBTRACTED, never recorded: nothing about an absence leaves this function.
    """
    gone = {
        str(i)
        for i in db.execute(
            select(Employee.id)
            .where(Employee.org_id == org_id)
            .where(Employee.deleted_at.is_not(None))
        ).scalars()
    }
    spans: Dict[str, list] = defaultdict(list)
    for employee_id, during in db.execute(
        select(Absence.employee_id, Absence.during)
        .where(Absence.org_id == org_id)
        .where(Absence.status.in_(ABSENT))
    ):
        spans[str(employee_id)].append(during)
    return gone, spans


def _touches_absence(s: Shift, spans: list) -> bool:
    # The whole day, not the instant: a person on leave in the afternoon who
    # lost their morning shift too lost it for the same reason.
    day_start = datetime.combine(s.day, time.min, tzinfo=BUSINESS_ZONE)
    day_end = day_start + timedelta(days=1)
    for span in spans:
        lower = span.lower or datetime.min.replace(tzinfo=timezone.utc)
        upper = span.upper or datetime.max.replace(tzinfo=timezone.utc)
        if lower < day_end and day_start < upper:
            return True
    return False


def _today() -> date:
    """The business day it is now: the day a publication is evidence for."""
    return business_day(datetime.now(timezone.utc))


@dataclass
class Sides:
    """Both calendars of one publication, with every absence already taken out.

    ``job_id`` is None and ``proposed`` empty when no recent job proposed
    anything for these days -- a calendar built by hand, or by the client's
    own generator. ``published`` is there either way.
    """

    job_id: Optional[UUID]
    proposed: List[Shift]
    published: List[Shift]


def learnable_sides(
    db: Session,
    org_id: UUID,
    period_start: datetime,
    period_end: datetime,
    shifts: Sequence[Tuple[str, datetime, datetime]],
) -> Sides:
    """What was proposed and what was published, minus what is not ours to read.

    Its own function because two readers need exactly this and nothing else:
    the counting above, and the planner's notebook (`planner_notes`), which
    must not see an absence any more than the counting may. One place takes
    the absences out, so the two can never disagree about what they saw.
    """
    found = _proposal_for(db, org_id, period_start, period_end)
    job_id, proposed = found if found is not None else (None, [])

    published = published_shifts(shifts)
    gone, spans = _away(db, org_id)

    def learnable(s: Shift) -> bool:
        if s.employee_id in gone:
            return False
        return not _touches_absence(s, spans.get(s.employee_id, ()))

    # Out of BOTH sides, so a shift removed for somebody's leave is neither a
    # removal nor a gap in the count of people.
    return Sides(
        job_id=job_id,
        proposed=[s for s in proposed if learnable(s)],
        published=[s for s in published if learnable(s)],
    )


def retouched(proposed: Sequence[Shift], published: Sequence[Shift]) -> Optional[Diff]:
    """The diff, but only when it is a diff of the SAME calendar.

    The two guards of `extract`, shared: too small a proposal says nothing,
    and one where fewer than half the shifts survived was replaced, not
    retouched. None in both cases, so a reader cannot mistake noise for edits.
    """
    if len(proposed) < MIN_PROPOSED:
        return None
    d = diff(proposed, published)
    if len(d.kept) < MIN_KEPT_SHARE * len(proposed):
        return None
    return d


def learn_from_publication(
    db: Session,
    org_id: UUID,
    period_start: datetime,
    period_end: datetime,
    shifts: Sequence[Tuple[str, datetime, datetime]],
    today: Optional[date] = None,
) -> List[str]:
    """Compare, record, and propose. Returns the keys that became proposals.

    Runs on a tenant session whose org is already set. Raises like any other
    database code; `after_publish` is what makes that harmless.
    """
    profile = bp.get_or_create(db, org_id)
    # Switched off means switched off: not "observe but do not propose". A
    # manager who turned learning off did not agree to be watched either.
    if not profile.learning_enabled:
        return []

    sides = learnable_sides(db, org_id, period_start, period_end, shifts)
    if sides.job_id is None:
        return []
    job_id, proposed, published = sides.job_id, sides.proposed, sides.published

    from app.services import employees as employees_svc

    names = employees_svc.names_by_id(db, org_id)
    patterns = extract(org_id, proposed, published, names)
    if not patterns:
        return []

    day = today or _today()
    period_day = business_day(period_start)
    known = {
        k
        for k in db.execute(
            select(LearnedHint.key)
            .where(LearnedHint.org_id == org_id)
            .where(LearnedHint.key.in_([p.key for p in patterns]))
        ).scalars()
    }

    proposed_keys: List[str] = []
    for pattern in patterns:
        if pattern.key in known:
            # Already a proposal, confirmed, or rejected. In every case the
            # manager has the question in front of them or has answered it.
            continue
        db.execute(
            insert(HandEditObservation)
            .values(
                org_id=org_id,
                key=pattern.key,
                job_id=job_id,
                period_start=period_day,
                observed_on=day,
            )
            .on_conflict_do_nothing(constraint="uq_hand_edit_observation_once")
        )
        days = db.execute(
            select(func.count(func.distinct(HandEditObservation.observed_on)))
            .where(HandEditObservation.org_id == org_id)
            .where(HandEditObservation.key == pattern.key)
        ).scalar_one()
        if days < bp.MIN_EVIDENCE:
            continue
        if bp.propose_from_edits(db, org_id, pattern.key, pattern.value, days, day):
            proposed_keys.append(pattern.key)

    if proposed_keys:
        log.info(
            "hand edits: org %s, %d new proposal(s) from retouches",
            org_id,
            len(proposed_keys),
        )
    return proposed_keys


def after_publish(
    org_id: UUID,
    period_start: datetime,
    period_end: datetime,
    shifts: Sequence[Tuple[str, datetime, datetime]],
) -> None:
    """The background task `/publish` schedules. NEVER RAISES.

    Its own session, because the request's has been closed by the time this
    runs; its own transaction, so nothing here can reach back into the rota
    that was just committed. A pattern we failed to notice is noticed next
    month. A publish that failed because of it would be a rota nobody got.
    """
    from app.db import AppSessionLocal, set_current_org

    try:
        db = AppSessionLocal()
    except Exception:  # noqa: BLE001 - see the docstring
        log.exception("hand edits: no session for org %s", org_id)
        return
    try:
        set_current_org(db, org_id)
        learn_from_publication(db, org_id, period_start, period_end, shifts)
        db.commit()
    except Exception:  # noqa: BLE001 - see the docstring
        db.rollback()
        log.exception("hand edits: could not learn from org %s's publish", org_id)
    finally:
        db.close()
