from __future__ import annotations

"""The adaptive layer: what we know about a business, and what we may do with it.

Intake translates a brief into a spec. That has always left two holes this
module fills, and it fills them under rules strict enough that neither hole is
plugged with an invention.

THE FOUR SOURCES, in strict precedence order:

1. **The brief.** What the manager wrote, this time. Always wins, never
   softened, never extended. Nothing below may contradict it or add to a field
   it spoke about.
2. **A learned hint.** Something this org's own manager corrected on at least
   ``MIN_EVIDENCE`` separate days. Applied automatically, but ONLY to fields the
   brief left unstated, and tagged ``origin="profile"`` everywhere it surfaces
   so the manager can see it and take it away.
3. **A vertical template.** "Bars close with more people than they open with."
   This is a stereotype about an industry, not a fact about this customer, so
   it is NEVER applied on its own. It comes back as a *suggestion* the manager
   accepts or ignores. A guess about a whole industry silently staffing one
   shop's Saturday night is precisely the bias worth refusing.
4. **The generic default.** 8:00-22:00, two people, 40 hours, 11 hours rest.
   Still there, still last -- but no longer silent: every field that ends up
   here comes back in ``gaps`` so the manager sees the decisions they did not
   make instead of discovering them in a calendar.

AND WHAT THE PLANNER READS, which is a different list. The four sources above
decide a SPEC. The planner that arranges shifts inside a fixed spec is also
told the business's preferences (`planning_context`), and there the order of
standing, highest first, is:

a. What the manager said: the profile they typed, the opening interview they
   approved, and the standing rules they confirmed.
b. What the planner NOTICED itself (`services/planner_notes.py`): notes the
   model kept in its own notebook after earlier publications. Only notes
   about the business, never about a person -- a note that names somebody is
   a proposal on the rules screen and reaches a calendar only once confirmed,
   as (a). Labelled as unconfirmed, and switched off unless
   `planner_notes_enabled`.
c. What we looked up on the internet about businesses like this one.

All three are preferences, never requirements; the closing paragraph of that
section says so to the model in as many words, and says this order too.

WHAT CAN NEVER BE LEARNED. Only the operations that describe the BUSINESS teach
us anything. Every operation about a PERSON -- who gets a day off, who swaps
with whom, who was hired, anyone's terms, anyone's status -- is excluded at the
top of ``observe``. Pay, contract hours and absence reasons never reach this
module at all. A preference about a shop must not quietly become a file on the
people who work in it.
"""

import hashlib
import logging
import re
from datetime import date
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.business_profile import BusinessProfile
from app.models.learned_hint import LearnedHint
from app.models.refine_observation import RefineObservation
from app.services import employees as employees_svc
from app.services import jev

log = logging.getLogger(__name__)

# Separate DAYS on which the same correction was seen before it counts as a
# belief. Days, not events: a manager fixing one Friday with five clicks had
# one bad Friday, not five reasons.
MIN_EVIDENCE = 3

# Times the manager may correct a hint back the other way before it switches
# itself off. Businesses change; a belief that stops matching reality has to be
# able to die without anyone filing a bug.
MAX_CONTRADICTIONS = 2

# The only operations that say something about the business rather than about a
# person. Everything else is dropped before it is even written down.
LEARNABLE_OPS = frozenset(
    {
        "add_coverage",
        "set_min_staff",
        "set_peak",
        "set_hours",
        "set_closed_day",
        "set_max_weekly_hours",
    }
)

# What a calendar should optimise for, when more than one legal rota exists.
#
# CODES ONLY. The weights each of these stands for live in the frontend, next to
# the generator that reads them (frontend/src/lib/schedule/objective.ts), and
# they are deliberately not mirrored here: two copies of "what a good calendar
# is" can disagree, and the copy that would win an argument with the scheduler
# is the one that has never run one. All this file is entitled to know is which
# words are spellable, so that a typo becomes a 422 instead of a business
# silently scheduling on the default for ever.
#
# NULL is a real value and the default: nobody has chosen, and the frontend
# leaves `spec.objective` unset, which is exactly the calendar every existing
# customer already has.
OBJECTIVES = frozenset({"cheapest", "fair", "familiar", "protective"})

WEEKDAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]


class Vertical:
    """One industry template: a sentence of context and some suggestions.

    ``context`` is the only part that reaches the model, and it reaches it as
    background -- it can help resolve "we close with more people" into the
    right hours, and it is explicitly not permission to invent a requirement.

    ``suggestions`` never touch a spec. They are shown to the manager, who
    accepts them or does not.
    """

    def __init__(self, code: str, label: str, context: str, suggestions: List[dict]):
        self.code = code
        self.label = label
        self.context = context
        self.suggestions = suggestions


VERTICALS: Dict[str, Vertical] = {
    "bar": Vertical(
        "bar",
        "Bar / pub",
        "a bar, where the last hours of the day are typically the busiest and "
        "closing usually takes more people than opening",
        [
            {
                "key": "closing_cover",
                "label": "More people in the last two hours than the rest of the day",
                "field": "coverage",
                "shape": "closing_delta",
                "value": 1,
            },
            {
                "key": "weekend_peak",
                "label": "Friday and Saturday evenings busier than weeknights",
                "field": "coverage",
                "shape": "weekend_evening_delta",
                "value": 1,
            },
        ],
    ),
    "restaurant": Vertical(
        "restaurant",
        "Restaurant",
        "a restaurant, where demand arrives in two service peaks (lunch and "
        "dinner) rather than spread across the open day",
        [
            {
                "key": "two_services",
                "label": "Two service peaks (lunch and dinner) rather than flat cover",
                "field": "coverage",
                "shape": "two_services",
                "value": 1,
            },
            {
                "key": "split_shifts",
                # A COUNT, not a flag. The proposal is that ONE person covers
                # both services -- which is what a restaurant manager means --
                # not that the whole team works two halves every day. Saying it
                # as a boolean was how that distinction got lost in the first
                # place.
                "label": "Let one person cover both services (a split day)",
                "field": "splitShiftPeople",
                "shape": "count",
                "value": 1,
            },
        ],
    ),
    "cafe": Vertical(
        "cafe",
        "Café / bakery",
        "a café, where the morning is the busiest part of the day and the "
        "opening hour usually takes more people than the closing one",
        [
            {
                "key": "opening_cover",
                "label": "More people in the first two hours than the rest of the day",
                "field": "coverage",
                "shape": "opening_delta",
                "value": 1,
            }
        ],
    ),
    "retail": Vertical(
        "retail",
        "Retail shop",
        "a retail shop, where opening usually takes more people (deliveries, "
        "restocking) and closing can run on fewer",
        [
            {
                "key": "opening_cover",
                "label": "More people in the first two hours than the rest of the day",
                "field": "coverage",
                "shape": "opening_delta",
                "value": 1,
            },
            {
                "key": "saturday_peak",
                "label": "Saturday afternoon busier than weekdays",
                "field": "coverage",
                "shape": "saturday_afternoon_delta",
                "value": 1,
            },
        ],
    ),
    "grocery": Vertical(
        "grocery",
        "Grocery / supermarket",
        "a grocery shop, where the early hours go on restocking and the "
        "late afternoon is the busiest counter time",
        [
            {
                # Its own key, not the "opening_cover" the cafe and the shop
                # share: the sentence a grocer reads names restocking, and a
                # key is what the client looks the sentence up by. Two
                # different sentences under one key is one of them lost.
                "key": "restock_cover",
                "label": "More people in the first two hours (restocking)",
                "field": "coverage",
                "shape": "opening_delta",
                "value": 1,
            }
        ],
    ),
    "clinic": Vertical(
        "clinic",
        "Clinic / pharmacy",
        "a clinic, where cover is steady across the open day and continuity "
        "matters more than matching a demand curve",
        [
            {
                "key": "steady_cover",
                "label": "Flat cover across the day rather than peaks",
                "field": "coverage",
                "shape": "none",
                "value": 0,
            }
        ],
    ),
    "hotel": Vertical(
        "hotel",
        "Hotel",
        "a hotel, which is open around the clock and runs a small night team "
        "against fuller day shifts",
        [
            {
                "key": "night_skeleton",
                "label": "A smaller overnight team than the day shifts",
                "field": "coverage",
                "shape": "night_floor",
                "value": 1,
            }
        ],
    ),
    "gym": Vertical(
        "gym",
        "Gym / studio",
        "a gym, which is busiest before work and after it, and quiet in the "
        "middle of the day",
        [
            {
                "key": "double_peak",
                "label": "Busy early morning and evening, quiet midday",
                "field": "coverage",
                "shape": "two_services",
                "value": 1,
            }
        ],
    ),
    "office": Vertical(
        "office",
        "Office / services",
        "an office, where cover is flat across business hours and weekends are "
        "usually closed",
        [],
    ),
    "other": Vertical(
        "other",
        "Something else",
        "a business whose shape we have not been told",
        [],
    ),
}


# --- Reading the profile ---------------------------------------------------


def get_or_create(db: Session, org_id: UUID) -> BusinessProfile:
    """The org's profile row, created empty on first use.

    Every org gets a row in the migration, so this only fires for orgs created
    afterwards. An empty row (no vertical, no hints) makes the whole layer a
    no-op, which is the correct behaviour for an account we know nothing about.
    """
    profile = db.execute(
        select(BusinessProfile).where(BusinessProfile.org_id == org_id)
    ).scalar_one_or_none()
    if profile is None:
        profile = BusinessProfile(org_id=org_id)
        db.add(profile)
        db.flush()
    return profile


def open_first_run(db: Session, org_id: UUID) -> BusinessProfile:
    """Mark a brand-new org as still owing us its first answers.

    Called from signup and from nowhere else, which is the whole design: the
    column defaults to false, so being ASKED is opt-in from the one place that
    knows an account was just created. Every org that predates this flow, and
    every profile row ``get_or_create`` writes lazily for one, stays false and
    behaves exactly as it did before -- no backfill, and no date invented for a
    conversation that never happened.

    It is set, never cleared, here. Clearing it is the manager's own act (they
    answered, or they skipped), and that goes through ``PUT /profile`` like
    every other thing they tell us about themselves.
    """
    profile = get_or_create(db, org_id)
    profile.first_run_pending = True
    db.flush()
    return profile


# A rule the manager STATED, as opposed to one we inferred from what they did.
#
# Kept in the same table as the rest deliberately: a manager looking at "why
# does the rota say this?" should read one list, not two, and a stated rule is
# rejected, reactivated and shown by the machinery that is already there.
# The prefix is what separates the two kinds where they must behave
# differently -- see `is_active` directly below.
STATED_PREFIX = "stated:"


def is_stated(hint: LearnedHint) -> bool:
    return hint.key.startswith(STATED_PREFIX)


def is_active(hint: LearnedHint) -> bool:
    """Whether a hint has earned the right to change a calendar.

    Three ways to fail, and each of them is deliberate: the manager said no,
    the evidence is not there yet, or the belief has been contradicted often
    enough that it is no longer about this business.

    A STATED rule answers the second one differently, and the difference is the
    point of the distinction. Evidence exists because an inference could be
    coincidence: three Fridays in a row might be three Fridays in a row and not
    a pattern. A sentence a manager typed is not a coincidence -- but it is not
    necessarily PERMANENT either ("Ana libra el viernes" may be this Friday or
    every Friday), and only they know which. So a stated rule needs no evidence
    and gets no benefit of the doubt: it is inert until they confirm it, and
    `accepted` in its value is that confirmation. Nothing steers a rota because
    a small model thought a sentence sounded permanent.
    """
    if hint.rejected:
        return False
    if is_stated(hint):
        return bool(hint.value.get("accepted"))
    if hint.evidence_days < MIN_EVIDENCE:
        return False
    return hint.contradictions < MAX_CONTRADICTIONS


def hints_for(db: Session, org_id: UUID) -> List[LearnedHint]:
    return list(
        db.execute(
            select(LearnedHint)
            .where(LearnedHint.org_id == org_id)
            .order_by(LearnedHint.key)
        ).scalars()
    )


def note_stated_rule(
    db: Session, org_id: UUID, text: str, today: Optional[date] = None
) -> Optional[str]:
    """Record a rule the manager stated, as a PROPOSAL. Returns its key, or None.

    The sentence comes from the triage desk, which spots it while reading a
    request it was already reading -- so this costs nothing per adjustment. What
    it produces costs nothing either, until a human says otherwise: the row is
    written inactive (see `is_active`), so a rota is never steered by a small
    model's opinion that a sentence sounded permanent.

    IDEMPOTENT ON THE SENTENCE. The key is the normalised text, so the same rule
    said twice is one row rather than two near-identical proposals in a list the
    manager is supposed to be able to sweep with their eye. Said a second time
    it refreshes `last_evidence_on` and nothing else -- evidence is not what
    makes this kind of rule true.

    REJECTION IS PERMANENT, and it is checked here rather than only at read
    time: a manager who threw a proposal away must not have it come back the
    next time they phrase the same thing the same way. That is the failure that
    would make the whole layer feel like it is not listening.
    """
    claim = " ".join(text.split()).strip()
    if not claim:
        return None
    # Bounded: a "rule" longer than this is a paragraph, and a paragraph is not
    # something a manager can confirm at a glance.
    if len(claim) > 300:
        return None

    key = STATED_PREFIX + hashlib.sha256(
        claim.casefold().encode("utf-8")
    ).hexdigest()[:24]

    hint = db.execute(
        select(LearnedHint).where(
            LearnedHint.org_id == org_id, LearnedHint.key == key
        )
    ).scalar_one_or_none()

    if hint is not None:
        # Including a rejected one: saying it again does not un-reject it.
        hint.last_evidence_on = today or date.today()
        db.flush()
        return key

    db.add(
        LearnedHint(
            org_id=org_id,
            key=key,
            value={"text": claim, "accepted": False},
            # One day, because they said it once. It is `accepted` that governs
            # whether this changes anything, not this number.
            evidence_days=1,
            last_evidence_on=today or date.today(),
        )
    )
    db.flush()
    return key


# A rule we noticed in how the manager RETOUCHES our calendars, proposed for
# them to confirm. See `services/hand_edits.py` for how it is noticed.
#
# Under `stated:` ON PURPOSE, although nobody said it. What `stated` means to
# the rest of this module is not "typed" but "inert until a human says yes":
# `is_active` wants `accepted`, the planner hears it as the manager's own rule
# only once confirmed, and the rules screen asks "always?" instead of counting
# days at them. That is exactly the standing a pattern read out of mouse
# clicks deserves. The alternative -- an inferred hint that switches itself on
# at MIN_EVIDENCE, like the refine ones -- is acceptable for "one more person
# on Friday nights" and not for "Laura does not do nights": a sentence about a
# person must never start steering rotas because we counted to three.
#
# The extra `edit:` is what lets the screen say where it came from, and what
# keeps these keys from ever colliding with the hashed sentences above.
EDITS_PREFIX = STATED_PREFIX + "edit:"


def is_from_edits(hint: LearnedHint) -> bool:
    return hint.key.startswith(EDITS_PREFIX)


def propose_from_edits(
    db: Session,
    org_id: UUID,
    key: str,
    value: dict,
    evidence_days: int,
    today: Optional[date] = None,
) -> bool:
    """Write a pattern from the manager's retouches as a PROPOSAL. True if new.

    The same contract as `note_stated_rule`, point by point, because it ends up
    in the same list under the same buttons:

    NEVER ACTIVE BY ITSELF. Written with ``accepted: False``; only the manager
    confirming it on the rules screen changes that.

    IDEMPOTENT ON THE PATTERN. The key is the pattern's identity (weekday,
    band, times, a hashed person), never its wording -- so it survives the
    sentence being phrased differently in a later version of this code, and a
    second publication showing the same thing refreshes the row rather than
    adding a near-duplicate.

    REJECTION IS PERMANENT. A row that exists, rejected or not, is never
    rewritten: its `accepted` and `rejected` are the manager's, and no amount
    of further evidence gets a say over a "no".
    """
    if not key.startswith(EDITS_PREFIX):
        return False
    text = " ".join(str(value.get("text", "")).split()).strip()
    if not text or len(text) > 300:
        return False

    hint = db.execute(
        select(LearnedHint).where(
            LearnedHint.org_id == org_id, LearnedHint.key == key
        )
    ).scalar_one_or_none()
    if hint is not None:
        # Including a rejected one: seeing it again does not un-reject it, and
        # the value -- with its `accepted` -- is left exactly as they left it.
        hint.last_evidence_on = today or date.today()
        db.flush()
        return False

    db.add(
        LearnedHint(
            org_id=org_id,
            key=key,
            value={**value, "text": text, "accepted": False},
            # Kept for the audit, not for the decision: a proposal like this is
            # governed by `accepted`, exactly as a stated one is.
            evidence_days=max(1, int(evidence_days)),
            last_evidence_on=today or date.today(),
        )
    )
    db.flush()
    return True


# --- Turning corrections into evidence -------------------------------------


def _hint_from_op(op: dict) -> Optional[Tuple[str, dict, str]]:
    """One applied refine operation -> (key, value, human label), or None.

    The key is the identity of the claim: two corrections that say the same
    thing must produce the same key, because sharing a key is the whole
    mechanism by which evidence accumulates.
    """
    name = str(op.get("op") or "")
    if name not in LEARNABLE_OPS:
        return None

    def minutes(value: Any) -> Optional[int]:
        try:
            h, m = str(value).strip().split(":")
            total = int(h) * 60 + int(m)
        except (ValueError, AttributeError):
            return None
        return total if 0 <= total <= 24 * 60 else None

    if name == "add_coverage":
        start = minutes(op.get("start"))
        end = minutes(op.get("end"))
        extra = op.get("staff")
        if start is None or end is None or end <= start or not extra:
            return None
        weekday = op.get("weekday")
        # A one-off date teaches nothing: "six people on the 24th" is about
        # Christmas Eve, not about how this business runs. Only a weekday
        # (or an all-week window) is a pattern.
        if weekday is None and op.get("date"):
            return None
        wd = int(weekday) if weekday is not None else -1
        if wd < -1 or wd > 6:
            return None
        return (
            "busy_window:%d:%d-%d" % (wd, start, end),
            {"extra": max(1, min(int(extra), 20)), "weekday": wd,
             "startMin": start, "endMin": end},
            "%d more on %s %s"
            % (
                int(extra),
                WEEKDAY_NAMES[wd] if wd >= 0 else "every day",
                "%s-%s" % (op.get("start"), op.get("end")),
            ),
        )

    if name == "set_peak":
        start = minutes(op.get("start"))
        end = minutes(op.get("end"))
        staff = op.get("staff")
        if start is None or end is None or end <= start or not staff:
            return None
        return (
            "peak:%d-%d" % (start, end),
            {"staff": max(1, min(int(staff), 50)), "startMin": start, "endMin": end},
            "%d on shift %s-%s" % (int(staff), op.get("start"), op.get("end")),
        )

    if name == "set_min_staff":
        staff = op.get("staff")
        if not staff:
            return None
        return (
            "min_staff",
            {"staff": max(1, min(int(staff), 50))},
            "At least %d on shift every open hour" % int(staff),
        )

    if name == "set_hours":
        start = minutes(op.get("start"))
        end = minutes(op.get("end"))
        if start is None or end is None or end <= start:
            return None
        return (
            "opening_hours",
            {"openMin": start, "closeMin": end},
            "Open %s-%s" % (op.get("start"), op.get("end")),
        )

    if name == "set_closed_day":
        weekday = op.get("weekday")
        if weekday is None or not (0 <= int(weekday) <= 6):
            return None
        closed = bool(op.get("closed"))
        return (
            "closed_weekday:%d" % int(weekday),
            {"closed": closed, "weekday": int(weekday)},
            "%s on %s" % ("Closed" if closed else "Open", WEEKDAY_NAMES[int(weekday)]),
        )

    if name == "set_max_weekly_hours":
        hours = op.get("hours")
        if not hours:
            return None
        return (
            "max_weekly_hours",
            {"hours": max(1, min(int(hours), 168))},
            "Max %d h/week per employee" % int(hours),
        )

    return None


def observe(
    db: Session, org_id: UUID, ops: Sequence[dict], today: Optional[date] = None
) -> List[str]:
    """Record the corrections a manager actually applied, and update beliefs.

    Returns the keys whose evidence moved, for the caller to report.

    Only APPLIED operations belong here. One the client refused -- it broke
    availability, or an onboarding limit -- describes something that never
    happened to this business, and learning from it would be learning from our
    own rejected suggestion.
    """
    day = today or date.today()
    touched: List[str] = []

    for op in ops:
        derived = _hint_from_op(op)
        if derived is None:
            continue
        key, value, _label = derived

        # The audit trail is written for every learnable op, whether or not it
        # moves a belief. A hint that cannot be traced back to real corrections
        # is a hint nobody should trust.
        db.add(
            RefineObservation(
                org_id=org_id, op=str(op.get("op")), payload={"key": key, **value}
            )
        )

        hint = db.execute(
            select(LearnedHint).where(
                LearnedHint.org_id == org_id, LearnedHint.key == key
            )
        ).scalar_one_or_none()

        if hint is None:
            db.add(
                LearnedHint(
                    org_id=org_id,
                    key=key,
                    value=value,
                    evidence_days=1,
                    last_evidence_on=day,
                )
            )
            # Flushed immediately: the session does not autoflush, so without
            # this the SELECT above would miss the row we just created and a
            # plan carrying the same correction twice ("one more on Friday
            # evening, and one more on Friday evening") would try to insert two
            # rows under one unique key.
            db.flush()
            touched.append(key)
            continue

        if hint.value == value:
            # Same day, same claim: already counted. Evidence is measured in
            # days precisely so one session cannot manufacture a belief.
            if hint.last_evidence_on != day:
                hint.evidence_days += 1
                hint.last_evidence_on = day
                touched.append(key)
            continue

        # Same claim, different number: the manager is correcting us the other
        # way. Count it, and once it has happened enough, believe the new
        # number instead and start earning evidence again from scratch.
        hint.contradictions += 1
        if hint.contradictions >= MAX_CONTRADICTIONS:
            hint.value = value
            hint.evidence_days = 1
            hint.contradictions = 0
            hint.last_evidence_on = day
        touched.append(key)

    return touched


# --- Context for the model -------------------------------------------------


def hint_label(hint: LearnedHint) -> str:
    """One line describing what a hint claims, for the UI and the prompt."""
    key, value = hint.key, hint.value or {}
    # A stated rule already IS a sentence -- the manager's own. Nothing to
    # phrase, and nothing we could phrase better than they did.
    if key.startswith(STATED_PREFIX):
        return str(value.get("text", "")).strip()
    if key == "min_staff":
        return "at least %s people on shift whenever it is open" % value.get("staff")
    if key == "opening_hours":
        return "open %s-%s" % (_clock(value.get("openMin")), _clock(value.get("closeMin")))
    if key == "max_weekly_hours":
        return "a ceiling of %s hours a week per person" % value.get("hours")
    if key.startswith("closed_weekday:"):
        wd = int(value.get("weekday", 0))
        return "%s on %s" % (
            "closed" if value.get("closed") else "open",
            WEEKDAY_NAMES[wd],
        )
    if key.startswith("peak:"):
        return "%s people between %s and %s" % (
            value.get("staff"),
            _clock(value.get("startMin")),
            _clock(value.get("endMin")),
        )
    if key.startswith("busy_window:"):
        wd = int(value.get("weekday", -1))
        when = WEEKDAY_NAMES[wd] if wd >= 0 else "every day"
        return "%s extra %s between %s and %s" % (
            value.get("extra"),
            "on " + when if wd >= 0 else "every day",
            _clock(value.get("startMin")),
            _clock(value.get("endMin")),
        )
    return key


def _clock(minutes: Optional[int]) -> str:
    if minutes is None:
        return "?"
    total = int(minutes)
    h, m = divmod(total % (24 * 60) if total < 24 * 60 else total, 60)
    return "%02d:%02d" % (h, m)


def model_context(
    profile: Optional[BusinessProfile],
    hints: Iterable[LearnedHint],
    day_facts: Sequence[str] = (),
) -> str:
    """The background block appended to the intake system prompt. May be "".

    Note what this block is *not* allowed to do, and note that the prompt says
    so out loud. The model's job does not change: it still extracts only what
    the brief states. Background is here to resolve an ambiguity the brief
    already contains ("we close with more people" -- which hours are those?),
    never to supply a requirement the brief never made.

    ``day_facts`` are `day_insights.context_lines`: what the manager's day
    notes add up to, already [] when learning is off. See `planning_context`
    for where they rank.
    """
    if profile is None or not profile.learning_enabled:
        return ""

    lines: List[str] = []
    # An INFERRED vertical is withheld: we guessed it, the manager has not
    # confirmed it, and feeding our own guess back to the model as background
    # would let one guess quietly reinforce itself.
    if profile.vertical and profile.vertical_source == "declared":
        vertical = VERTICALS.get(profile.vertical)
        if vertical is not None:
            lines.append("This account is %s." % vertical.context)
    if profile.house_notes and profile.house_notes.strip():
        lines.append("The manager describes it: %s" % profile.house_notes.strip())
    # Theirs too: they read this paragraph and approved it. Labelled by where
    # it came from so a sentence can be traced back if it is ever doubted.
    if profile.interview_notes and profile.interview_notes.strip():
        lines.append(
            "In the opening interview the manager said: %s"
            % profile.interview_notes.strip()
        )

    # The manager's words, our reading of them -- labelled as both. This is
    # the best evidence this block has for its one job: "the busy nights" in a
    # brief is a stretch of hours, and these notes are where this manager has
    # been writing down which hours those are. Not a requirement, like
    # everything else here.
    facts = [" ".join(str(f).split()) for f in day_facts if str(f).strip()]
    if facts:
        lines.append(
            "What the manager's own DAY NOTES add up to, as WE read them (the "
            "manager wrote the notes; nobody has checked our reading). Use it "
            "only to resolve what the brief says vaguely, such as \"the busy "
            "nights\" or \"when we are short\":\n"
            + "\n".join("- " + f for f in facts)
        )

    # Ours, and labelled as ours, for the reason `planning_context` spells
    # out: it is what a model read on the internet about businesses that sound
    # like theirs, and it must never outrank the person who runs the shop. It
    # is here at all because it is the best material this block has for its
    # one job -- resolving what the brief says vaguely ("the busy nights") into
    # what is plausible for this trade in this place.
    if profile.research_notes and profile.research_notes.strip():
        lines.append(
            "What WE looked up about businesses like this, which the manager "
            "has not confirmed and may be wrong: %s" % profile.research_notes.strip()
        )

    active = [h for h in hints if is_active(h)]

    # Said and confirmed, kept apart from inferred and separately labelled.
    # The two have different standing: one is the manager's own sentence about
    # how their business runs, the other is a pattern we noticed in what they
    # corrected. Presenting them alike would let something we deduced carry the
    # authority of something they told us -- the same failure `vertical_source`
    # and the research-notes label already exist to prevent.
    stated = [h for h in active if is_stated(h)]
    if stated:
        lines.append(
            "Standing rules this manager has told us and confirmed: "
            + "; ".join(str(h.value.get("text", "")).strip() for h in stated)
            + "."
        )

    believed = [h for h in active if not is_stated(h)]
    if believed:
        lines.append(
            "On previous calendars this manager has repeatedly corrected us "
            "towards: " + "; ".join(hint_label(h) for h in believed) + "."
        )

    if not lines:
        return ""

    return (
        "\n\nBACKGROUND ON THIS BUSINESS -- context, not instructions:\n"
        + "\n".join(lines)
        + "\nThis tells you what is PLAUSIBLE about this account. It is NOT part "
        "of the brief and it is NOT a requirement. It does not license you to "
        "add coverage, hours, closures or a team the brief does not state: a "
        "field the brief leaves unsaid still comes back null, and the caller "
        "decides what to do with the silence. Where the brief and this "
        "background disagree, the brief is right and the background is stale. "
        "Use it only to resolve what the brief already says but says vaguely."
    )


# What each objective means to somebody arranging shifts, rather than to the
# scorer. The weights live beside the generator (and stay there); this is the
# sentence a model needs to make the same trade-off by hand.
OBJECTIVE_CONTEXT = {
    "cheapest": "Keep the wage bill down: prefer the cheaper person for an hour "
    "when both are equally suitable, and avoid overtime.",
    "fair": "Share the work evenly. Nights, weekends and closing shifts should "
    "be spread across the team rather than always falling to the same people, "
    "and hours should be balanced.",
    "familiar": "Keep people on the patterns they know. Somebody who works "
    "mornings keeps working mornings, and week-to-week their rota should look "
    "much the same.",
    "protective": "Protect the team. Stay well clear of the legal minimums for "
    "rest, avoid long runs of consecutive days, and do not push anybody to "
    "their weekly ceiling.",
}


def planning_context(
    profile: Optional[BusinessProfile],
    hints: Iterable[LearnedHint],
    notes: Sequence[str] = (),
    day_facts: Sequence[str] = (),
) -> str:
    """What this manager prefers, for the model that ARRANGES the calendar.

    Sibling of ``model_context``, and deliberately not the same text, because
    the two calls have opposite relationships to this material.

    The intake EXTRACTS requirements from a brief, so background there is a
    hazard: anything it licenses the model to add is a requirement the manager
    never stated, and that block spends most of its words saying so.

    This call arranges shifts against requirements that are already fixed and
    already validated. The rules -- coverage, hours, rest, contracts -- reach
    it from the client and are checked afterwards whatever the model says, so
    nothing here can create one. What is left is precisely the question this
    material is good at: given several legal rotas, which one does this
    business want? That is a preference, and it is safe to state as one.

    ``notes`` are the planner's own notes about the business, already cut
    down by ``planner_notes.business_notes`` to lines that name nobody and
    already empty when that feature or learning is off. Rendered below what
    the manager said and above what we looked up -- see the module docstring.

    ``day_facts`` are what the manager's day notes add up to
    (`day_insights.context_lines`), counted by us from a small model's reading
    of each note. Below what the manager SAID, because a note is a diary and
    not a rule and the reading is ours; above what the planner noticed and
    what we looked up, because it is the manager's own account of this very
    business.

    Returns "" when there is nothing to say, or when the manager switched the
    adaptive layer off -- the same respect ``model_context`` shows that flag.
    """
    if profile is None or not profile.learning_enabled:
        return ""

    lines: List[str] = []

    # Same rule as the intake: an INFERRED vertical is a guess of ours, and
    # feeding a guess back as preference is how it quietly becomes a fact.
    if profile.vertical and profile.vertical_source == "declared":
        vertical = VERTICALS.get(profile.vertical)
        if vertical is not None:
            lines.append("This is %s." % vertical.context)

    if profile.location and profile.location.strip():
        lines.append("It is in %s." % profile.location.strip())

    if profile.house_notes and profile.house_notes.strip():
        lines.append("The manager describes it: %s" % profile.house_notes.strip())
    # Theirs too: they read this paragraph and approved it. Labelled by where
    # it came from so a sentence can be traced back if it is ever doubted.
    if profile.interview_notes and profile.interview_notes.strip():
        lines.append(
            "In the opening interview the manager said: %s"
            % profile.interview_notes.strip()
        )

    # The manager's words, counted by us. What they wrote about each day --
    # the rush, the dead hours, the nights they were short of hands -- read
    # note by note by a small model and added up by arithmetic. Labelled with
    # both halves of that, so the manager's account keeps its weight and our
    # reading of it does not borrow any.
    facts = [" ".join(str(f).split()) for f in day_facts if str(f).strip()]
    if facts:
        lines.append(
            "What the manager's own DAY NOTES about recent days add up to, as "
            "WE read them (the manager wrote the notes; nobody has checked our "
            "reading):\n" + "\n".join("- " + f for f in facts)
        )

    # Ours too, but about THIS business rather than about its trade: what the
    # planner noticed in earlier publications and wrote down itself. Below
    # the manager, because nobody confirmed it; above the internet, because
    # it was seen here and not read about elsewhere. Only lines that name
    # nobody ever arrive -- a note about a person is a proposal the manager
    # confirms on the rules screen, and then it is one of their rules.
    noticed = [" ".join(str(n).split()) for n in notes if str(n).strip()]
    if noticed:
        lines.append(
            "What the planner has NOTICED on this business's previous "
            "calendars, which the manager has NOT confirmed: "
            + "; ".join(n.rstrip(".") for n in noticed)
            + "."
        )

    # Ours, and said to be ours. Everything above this line is what a human
    # told us; this is what a model read on the internet about businesses that
    # sound like theirs. Presenting the two the same way would let a plausible
    # generalisation about an industry outrank the person who actually runs the
    # shop -- which is the failure `vertical_source` already exists to prevent,
    # and it would arrive here through a different door.
    if profile.research_notes and profile.research_notes.strip():
        lines.append(
            "What WE looked up about businesses like this, which the manager "
            "has not confirmed and may be wrong: %s" % profile.research_notes.strip()
        )

    if profile.objective:
        blurb = OBJECTIVE_CONTEXT.get(profile.objective)
        if blurb:
            lines.append("What they want a rota to optimise for: %s" % blurb)

    if profile.weekend_days:
        names = ", ".join(
            WEEKDAY_NAMES[d]
            for d in profile.weekend_days
            if isinstance(d, int) and 0 <= d < 7
        )
        if names:
            lines.append("Their weekend is %s." % names)

    active = [h for h in hints if is_active(h)]

    # Said and confirmed, kept apart from inferred and separately labelled.
    # The two have different standing: one is the manager's own sentence about
    # how their business runs, the other is a pattern we noticed in what they
    # corrected. Presenting them alike would let something we deduced carry the
    # authority of something they told us -- the same failure `vertical_source`
    # and the research-notes label already exist to prevent.
    stated = [h for h in active if is_stated(h)]
    if stated:
        lines.append(
            "Standing rules this manager has told us and confirmed: "
            + "; ".join(str(h.value.get("text", "")).strip() for h in stated)
            + "."
        )

    believed = [h for h in active if not is_stated(h)]
    if believed:
        lines.append(
            "On previous calendars this manager has repeatedly corrected us "
            "towards: " + "; ".join(hint_label(h) for h in believed) + "."
        )

    if not lines:
        return ""

    return "\n".join(lines) + (
        "\n\nThese are PREFERENCES, not rules. The requirements you were given "
        "are the rules, and a shift that breaks one is discarded whatever this "
        "section says. Use these to choose between arrangements that are all "
        "legal. Where two of them disagree, what the manager said outranks "
        "what their day notes add up to, that outranks what the planner "
        "noticed, and all of them outrank what we looked up."
    )


# --- Applying what we know to a spec ---------------------------------------

# The only spec fields a learned hint is ever allowed to touch. Everything
# absent from this list is unreachable from here BY CONSTRUCTION, not by
# convention: pay, contract hours, who works when, legal minimum rest. Those
# are agreements and law, and no amount of observed behaviour makes them ours
# to infer.
WRITABLE_FIELDS = frozenset(
    {"openMin", "closeMin", "minStaff", "coverage", "closedWeekdays", "maxHoursPerWeek"}
)


def _overlaps(rule: dict, weekday: int, start: int, end: int) -> bool:
    """Whether a coverage rule from the brief already speaks about this window.

    Used to keep a hint out of territory the brief claimed. A rule scoped to
    specific dates is not a standing statement about a weekday, so it does not
    block one.
    """
    if rule.get("dates"):
        return False
    days = rule.get("weekdays") or []
    if days and weekday >= 0 and weekday not in days:
        return False
    r_start = rule.get("startMin")
    r_end = rule.get("endMin")
    if r_start is None or r_end is None:
        return True  # applies to the whole open day, so it covers this window
    return start < r_end and r_start < end


def _write_claim(
    spec: dict,
    silent: set,
    key: str,
    value: dict,
    *,
    may_lower: bool,
    suffix: str,
) -> Optional[Tuple[str, str, str]]:
    """Write one claim about this business into the spec.

    Returns ``(field, rule_kind, rule_label)`` when it wrote something, None
    when it declined -- the brief already spoke about that field, the numbers
    are unusable, or the claim would have made the calendar worse.

    ONE COPY, TWO SOURCES. A learned hint and a declaration say the same kinds
    of thing ("at least three on shift", "closed on Mondays") and used to differ
    only in how long we waited before believing them. Writing that twice would
    be two chances to disagree about what "closed on Monday" does to a spec.

    ``may_lower`` is the one place they genuinely differ, and it is not a
    detail: a HINT is our inference from watching corrections, so it may raise
    cover and never cut it -- a wrong guess that leaves a shift understaffed is
    worse than one that costs an hour of wage. A DECLARATION is the manager
    saying a number out loud. Refusing to lower it because we prefer the higher
    one is not caution, it is ignoring them.
    """
    if key == "min_staff" and "min_staff" in silent:
        staff = int(value.get("staff") or 0)
        if staff <= 0:
            return None
        if not may_lower and staff <= int(spec.get("minStaff") or 0):
            return None
        spec["minStaff"] = staff
        return ("minStaff", "min_staff", "At least %d on shift %s" % (staff, suffix))

    if key == "opening_hours" and "opening_hours" in silent:
        open_min = value.get("openMin")
        close_min = value.get("closeMin")
        if open_min is None or close_min is None or close_min <= open_min:
            return None
        spec["openMin"] = int(open_min)
        spec["closeMin"] = int(close_min)
        return (
            "openMin",
            "opening_hours",
            "Open %s-%s %s" % (_clock(open_min), _clock(close_min), suffix),
        )

    if key == "max_weekly_hours" and "max_weekly_hours" in silent:
        hours = int(value.get("hours") or 0)
        if hours <= 0:
            return None
        spec["maxHoursPerWeek"] = hours
        return (
            "maxHoursPerWeek",
            "max_weekly_hours",
            "Max %d h/week %s" % (hours, suffix),
        )

    if key.startswith("closed_weekday:") and "closures" in silent:
        weekday = int(value.get("weekday", -1))
        if not (0 <= weekday <= 6) or not value.get("closed"):
            return None
        closed = spec.setdefault("closedWeekdays", [])
        if weekday in closed:
            return None
        closed.append(weekday)
        return (
            "closedWeekdays",
            "closed_day",
            "Closed on %s %s" % (WEEKDAY_NAMES[weekday], suffix),
        )

    if key.startswith("busy_window:") or key.startswith("peak:"):
        weekday = int(value.get("weekday", -1))
        start = value.get("startMin")
        end = value.get("endMin")
        if start is None or end is None or end <= start:
            return None
        coverage: List[dict] = spec.setdefault("coverage", [])
        # The brief wins over any window it already spoke about, even when it
        # said nothing about the rest of the week.
        if any(_overlaps(r, weekday, int(start), int(end)) for r in coverage):
            return None
        floor = int(spec.get("minStaff") or 0)
        staff = (
            int(value.get("staff") or 0)
            if key.startswith("peak:")
            else floor + int(value.get("extra") or 0)
        )
        if staff <= 0 or (not may_lower and staff <= floor):
            return None
        coverage.append(
            {
                "weekdays": [weekday] if weekday >= 0 else [],
                "dates": [],
                "startMin": int(start),
                "endMin": int(end),
                "staff": staff,
                # Never exact, from either source: a window added here may put
                # people on, never cap them below what another rule asks for.
                "exact": False,
            }
        )
        return (
            "coverage",
            "peak_cover",
            "%d on shift %s %s-%s %s"
            % (
                staff,
                "on " + WEEKDAY_NAMES[weekday] if weekday >= 0 else "every day",
                _clock(start),
                _clock(end),
                suffix,
            ),
        )

    return None


def _add_rule(spec: dict, kind: str, label: str, origin: str) -> None:
    rules: List[dict] = spec.setdefault("rules", [])
    rules.append(
        {
            "id": "p%d" % (len(rules) + 1),
            "kind": kind,
            "label": label,
            "sourceText": None,
            "origin": origin,
        }
    )


def apply_hints(
    spec: dict, unstated: Iterable[str], hints: Iterable[LearnedHint]
) -> List[dict]:
    """Fill what the brief left unsaid with what this org taught us.

    Mutates ``spec`` and returns one entry per applied hint, so the caller can
    show the manager exactly what was added and on what evidence. Nothing is
    applied invisibly: an entry here becomes a rule tagged ``origin="profile"``
    in the spec and a line in the UI with a way to remove it.

    The rule that keeps this from becoming bias is one line long -- a hint may
    only write a field listed in ``unstated``. If the brief spoke about
    opening hours, learned opening hours are not consulted at all.
    """
    silent = set(unstated)
    applied: List[dict] = []

    for hint in hints:
        if not is_active(hint):
            continue
        written = _write_claim(
            spec,
            silent,
            hint.key,
            hint.value or {},
            may_lower=False,
            suffix="(learned)",
        )
        if written is None:
            continue
        field, kind, label = written
        _add_rule(spec, kind, label, "profile")
        applied.append(
            {
                "key": hint.key,
                # The claim's own numbers, so the client can write the sentence
                # in the manager's language. `label` below is the same thing in
                # English, kept for a client that does not know this shape.
                "value": hint.value or {},
                "field": field,
                "label": hint_label(hint),
                "source": "profile",
                "evidence": hint.evidence_days,
            }
        )
    return applied

GENERIC_DEFAULTS = {
    "opening_hours": "Open 8:00 AM-10:00 PM",
    "min_staff": "2 people on shift whenever open",
    "max_weekly_hours": "40 hours a week per person",
    "min_rest": "11 hours of rest between shifts",
    "coverage": "The same number of people all day, every day",
    # Missing until now, which is why "we assumed you never close" was the one
    # decision this list made and did not report: `gaps()` skips a field with no
    # label, so the field was silently dropped rather than silently applied.
    "closures": "Open every day",
    "shift_length": "Shift length chosen by the scheduler",
    "horizon": "However far ahead the toolbar is set to",
}

# Which of those are worth interrupting a manager about. Rest hours and shift
# length have defensible defaults; how many people and at what hours do not.
# A closed day is the loudest of all: a shutter down on a day that was going
# to open costs a day's trade, and nobody finds that by reading a rota
# carefully. It is only ever inferred, never defaulted, which is why it joins
# this set now rather than when the set was written.
LOUD_GAPS = frozenset({"opening_hours", "min_staff", "coverage", "closed_dates"})


# How much more than the floor a stretch the manager called "busier" gets.
#
# One. Not two, not a proportion: the brief said MORE than the minimum, and one
# more is the smallest thing "more" can mean. Choosing bigger would be guessing
# at a number in the manager's head; choosing this is reading the only word they
# actually gave us. It is marked as ours either way, and one wrong person on a
# rota is a sentence to correct rather than a day to rebuild.
RANKED_EXTRA = 1


def merge_signals(
    ranked: dict,
    signals,
    spec: dict,
    period_dates=None,
) -> dict:
    """Add what the research inferred to what the brief itself ranked.

    THE ONE RULE: an inference only ever speaks where the brief is silent. The
    manager runs the shop and has seen the room; a model has read about rooms
    like it. So every axis is checked before it is filled, and a brief that
    said anything at all about that axis closes it -- not just a brief that
    said something contradictory. "Los martes son los fuertes" settles WHICH
    DAYS are busy, and Friday does not get to be added underneath it just
    because nobody denied it.

    Returns the same shape `ranked_signals` does, plus the provenance `assume`
    needs to name its reasons and the rationale it shows as the "because".

    ``period_dates`` is the set of dates being planned, as "YYYY-MM-DD". A
    holiday only becomes a closure when it falls inside them -- a rota for
    October has no business acting on Sant Joan.
    """
    out = dict(ranked)
    if signals is None or not getattr(signals, "has_anything", False):
        return out

    said_weekdays = bool(ranked.get("weekdays"))
    said_windows = bool(ranked.get("windows"))
    # A coverage rule the brief scoped to weekdays is the manager talking about
    # which days matter, even when they gave a number instead of a ranking.
    for req in spec.get("coverage") or []:
        if req.get("weekdays"):
            said_weekdays = True
        if req.get("startMin") is not None:
            said_windows = True

    month_of = None
    if period_dates:
        months = {int(d.split("-")[1]) for d in period_dates if len(d.split("-")) == 3}
        month_of = months

    # A quiet month does not cut anything -- nothing here may -- but it is a
    # reason not to ADD. A busy month is why the peak is worth staffing at all.
    quiet = set(getattr(signals, "quiet_months", []) or [])
    in_quiet_month = bool(month_of) and month_of.issubset(quiet)

    if not said_weekdays and signals.busy_weekdays and not in_quiet_month:
        out["weekdays"] = list(signals.busy_weekdays)
        out["researched_weekdays"] = list(signals.busy_weekdays)
    if not said_windows and signals.busy_windows and not in_quiet_month:
        out["windows"] = [tuple(w) for w in signals.busy_windows]
        out["researched_windows"] = [tuple(w) for w in signals.busy_windows]

    if signals.peak_staff:
        out["staff"] = signals.peak_staff
    if getattr(signals, "rationale", ""):
        out["rationale"] = signals.rationale

    # Holidays the trade SHUTS on, and only the ones inside the period.
    if period_dates:
        closures = []
        for holiday in getattr(signals, "holidays", []) or []:
            if not holiday.get("closes"):
                continue
            suffix = str(holiday.get("date") or "")
            for date in period_dates:
                if date.endswith("-" + suffix):
                    closures.append(date)
        if closures:
            out["closures"] = sorted(set(closures))

    return out


def assume(
    spec: dict,
    unstated: Iterable[str],
    ranked: dict,
) -> List[dict]:
    """Decide what the brief left open, defensibly, and say what was decided.

    This is the middle of the three things that can happen to a number nobody
    stated. DERIVING is arithmetic on what the brief already says and needs no
    announcement. ASKING is for the cases where every value is a coin flip.
    ASSUMING is everything in between, which is nearly everything -- and the
    test for which one applies is not how confident we are, it is whether the
    manager would SEE a wrong choice: a rota with the wrong number of people on
    a Monday is visible on the screen they are already looking at, so it is an
    assumption, and they correct it by saying so.

    Mutates ``spec`` and returns one entry per assumption, in the same shape
    ``gaps`` returns, so the client has a single list to render rather than two
    concepts to tell apart.

    What it will NOT do is assume its way past silence it cannot fill. A field
    with nothing to lean on keeps the generic constant and is reported by
    ``gaps`` with ``reason="generic"``, which is the honest admission that we
    had nothing -- and the difference between a defensible number and a number.
    """
    silent = set(unstated)
    out: List[dict] = []

    def record(
        field: str,
        value: Any,
        reason: str,
        params: dict,
        why: str = "",
        on_date: str = "",
    ) -> None:
        # `params` stays numbers only. Every one of them is interpolated into a
        # translated sentence by a client that expects a number, so the clause
        # an inference carries -- and the date a closure names -- travel beside
        # them rather than among them.
        entry = {
            "field": field,
            "label": GENERIC_DEFAULTS.get(field, field),
            "value": value,
            "reason": reason,
            "params": params,
            "filledBy": "derived",
            "loud": field in LOUD_GAPS,
        }
        if why:
            entry["why"] = why
        if on_date:
            entry["date"] = on_date
        out.append(entry)

    # --- The floor, before anything that counts up from it. -----------------
    #
    # A number the manager stated that is LOWER than our default is evidence the
    # default is too high for this shop: "solo una persona los lunes" is them
    # telling us one person can run the place. A number that is HIGHER is a
    # peak, and a peak sets no floor -- reading "four on Saturdays" as a weekly
    # minimum would staff four people every day of a week nobody asked that of,
    # which is the expensive direction to be wrong in.
    if "min_staff" in silent:
        # Whole-day rules only. A rule with a WINDOW is the manager talking
        # about a stretch, and "solo uno a mediodia" says nothing about the
        # rest of the week -- reading it as the weekly floor would run the
        # whole shop on the quietest hour of it. A rule without a window is
        # them talking about a day, which is the closest thing to a floor the
        # brief contains.
        stated = [
            int(r.get("staff") or 0)
            for r in spec.get("coverage") or []
            if int(r.get("staff") or 0) > 0
            and r.get("startMin") is None
            and r.get("endMin") is None
        ]
        floor = int(spec.get("minStaff") or 0)
        lower = [n for n in stated if n < floor]
        if lower:
            assumed = min(lower)
            spec["minStaff"] = assumed
            record(
                "min_staff",
                assumed,
                "lowest_stated",
                {"staff": assumed},
            )

    # --- Stretches ranked as busier, without a number. ----------------------
    #
    # Two sources, one mechanism. The brief's own ranking ("los viernes son los
    # fuertes") and what the research inferred about this trade in this city
    # become the same kind of coverage rule and are announced the same way --
    # they differ only in the REASON attached, because the manager is owed the
    # difference between a rule that rests on their own sentence and one that
    # rests on what a model read about bars in Barcelona.
    floor = int(spec.get("minStaff") or 0)
    staff = floor + RANKED_EXTRA
    inferred_staff = ranked.get("staff")
    if isinstance(inferred_staff, int) and inferred_staff > staff:
        # Bounded at the source (`parse_signals`), so this only has to prefer
        # it. Never below `staff`: an inference may raise cover, never cut it.
        staff = inferred_staff
    coverage: List[dict] = spec.setdefault("coverage", [])

    # Which of these the brief said itself, so the rest can be named as ours.
    from_research = set(ranked.get("researched_weekdays") or [])
    windows_from_research = set(ranked.get("researched_windows") or [])
    why = str(ranked.get("rationale") or "")

    for weekday in ranked.get("weekdays") or []:
        coverage.append(
            {
                "weekdays": [weekday],
                "dates": [],
                "startMin": None,
                "endMin": None,
                "staff": staff,
                # Never exact. An assumption may raise cover, never cap it below
                # what the manager asked for somewhere else.
                "exact": False,
            }
        )
        researched = weekday in from_research
        record(
            "coverage",
            staff,
            "researched_weekday" if researched else "ranked_weekday",
            {"staff": staff, "weekday": weekday, "floor": floor},
            why=why if researched else "",
        )

    for start, end in ranked.get("windows") or []:
        coverage.append(
            {
                "weekdays": [],
                "dates": [],
                "startMin": start,
                "endMin": end,
                "staff": staff,
                "exact": False,
            }
        )
        researched = (start, end) in windows_from_research
        record(
            "coverage",
            staff,
            "researched_window" if researched else "ranked_window",
            {
                "staff": staff,
                "startMin": start,
                "endMin": end,
                "floor": floor,
            },
            why=why if researched else "",
        )

    # --- Days the trade usually shuts, where the brief named no closures. ---
    #
    # The most expensive thing an inference can do, so it is the most guarded:
    # only dates inside the period, only where the brief listed no closed dates
    # of its own, and announced LOUD, because a shutter down on a day that was
    # going to open is not something to find out by reading a rota carefully.
    closures = ranked.get("closures") or []
    if closures and not spec.get("closedDates"):
        spec["closedDates"] = sorted(closures)
        for date in sorted(closures):
            record(
                "closed_dates",
                # Null, like every field that is not a figure -- which hours,
                # which closures. The date travels in its own slot.
                None,
                "researched_holiday",
                {},
                why=why,
                on_date=date,
            )

    return out


def gaps(
    unstated: Iterable[str],
    applied: Sequence[dict],
    assumed: Sequence[dict] = (),
    spec: Optional[dict] = None,
) -> List[dict]:
    """What the calendar decided because nobody said otherwise.

    A gap is not an error and does not block anything -- it is the end of the
    product deciding things on a manager's behalf without telling them. Fields a
    hint filled are not gaps: those were decided, by this business, on evidence,
    and they are reported separately. Neither are fields ``assume`` reached:
    those were decided too, on something the brief actually said, and they come
    back in the same list already carrying their reason.

    What is left is the residue -- the fields with nothing whatsoever to lean
    on. They keep the generic constant and are reported with
    ``reason="generic"``, which is the whole point of naming the reason: it is
    the difference between "two people, because you told us one can run Mondays"
    and "two people, because two". Both are assumptions and both are shown; only
    one of them is defensible, and a manager is owed the distinction.

    Every field here is an ASSUMPTION and not a question, and the test is the
    same one throughout: a wrong opening time, a wrong headcount, a shift of the
    wrong length or a week that never closes are all visible in the rota the
    manager is already looking at. A thing they would see is a thing they can
    correct by saying so, and showing it beats asking about it. The questions
    live somewhere else, for what a rota cannot show: a stretch of a brief we
    understood and could not turn into any number at all.
    """
    filled = {a["field"] for a in applied}
    decided = {a["field"] for a in assumed}
    field_of = {
        "opening_hours": "openMin",
        "min_staff": "minStaff",
        "max_weekly_hours": "maxHoursPerWeek",
        "coverage": "coverage",
        "closures": "closedWeekdays",
    }
    # The number each field actually ended up with, so the manager reads the
    # decision rather than a sentence about it. Absent for the two that are not
    # a single figure.
    value_of = {
        "min_staff": lambda sp: sp.get("minStaff"),
        "max_weekly_hours": lambda sp: sp.get("maxHoursPerWeek"),
        "min_rest": lambda sp: sp.get("minRestHours"),
        "opening_hours": lambda sp: [sp.get("openMin"), sp.get("closeMin")],
        "shift_length": lambda sp: sp.get("shiftLengthHours"),
    }
    out: List[dict] = list(assumed)
    for name in unstated:
        if field_of.get(name) in filled or name in decided:
            continue
        label = GENERIC_DEFAULTS.get(name)
        if label is None:
            continue
        reader = value_of.get(name)
        out.append(
            {
                "field": name,
                "label": label,
                "value": reader(spec) if reader and spec is not None else None,
                "reason": "generic",
                "params": {},
                "filledBy": "default",
                "loud": name in LOUD_GAPS,
            }
        )
    return out


def suggestions_for(
    profile: Optional[BusinessProfile], unstated: Iterable[str]
) -> List[dict]:
    """Industry-typical proposals, for the manager to accept or ignore.

    Never applied. This is where a stereotype would do its damage if it were
    allowed to act on its own -- "it's a bar, so staff the evenings" is a
    plausible sentence about bars and an unfounded one about *this* bar. The
    manager turning it into a rule is what makes it true, and they do that by
    saying so in the brief, where it becomes a stated requirement like any
    other.

    Only offered for fields the brief left unstated, and only for a vertical a
    human actually declared.
    """
    if profile is None or not profile.learning_enabled:
        return []
    if not profile.vertical or profile.vertical_source != "declared":
        return []
    vertical = VERTICALS.get(profile.vertical)
    if vertical is None:
        return []
    silent = set(unstated)
    return [
        {**s, "source": "template", "vertical": profile.vertical}
        for s in vertical.suggestions
        if s.get("field") != "coverage" or "coverage" in silent
    ]


# --- What the manager ANSWERED -------------------------------------------
#
# The fourth thing that can decide a requirement, and the one the precedence
# was missing. A declaration is the manager replying to a question we asked;
# it applies at once, outranks anything learned from corrections, and is still
# outranked by the brief -- which is the most recent and most explicit thing
# they have written, so a later brief that disagrees simply wins.
#
# Stored under the field it decides (`declared["day_hours"]`), so the next kind
# of question adds a key rather than a column.


def declared_day_hours(profile: BusinessProfile) -> Dict[int, List[int]]:
    """Weekday -> [openMin, closeMin], for the days this manager has told us.

    Tolerant on read for the same reason every JSONB reader here is: the column
    is written by this file today and by a migration or a fix-up script one day,
    and a malformed entry must cost one weekday rather than the whole request.
    """
    raw = (profile.declared or {}).get("day_hours") or {}
    out: Dict[int, List[int]] = {}
    if not isinstance(raw, dict):
        return out
    for key, value in raw.items():
        try:
            weekday = int(key)
        except (TypeError, ValueError):
            continue
        if not (0 <= weekday <= 6):
            continue
        if not isinstance(value, (list, tuple)) or len(value) != 2:
            continue
        try:
            open_min, close_min = int(value[0]), int(value[1])
        except (TypeError, ValueError):
            continue
        out[weekday] = [open_min, close_min]
    return out


def _gap_field(key: str) -> Optional[str]:
    """Which unstated FIELD a claim decides, so it stops being asked about."""
    if key in ("min_staff", "opening_hours", "max_weekly_hours"):
        return key
    if key.startswith("closed_weekday:"):
        return "closures"
    if key.startswith("busy_window:") or key.startswith("peak:"):
        return "coverage"
    return None


def declared_rules(profile: BusinessProfile) -> Dict[str, dict]:
    """The claims this manager has stated directly, keyed as ``_hint_from_op``.

    Same tolerance as every other JSONB reader here: a malformed entry costs
    one rule, never the request.
    """
    raw = (profile.declared or {}).get("rules") or {}
    if not isinstance(raw, dict):
        return {}
    return {
        str(key): value
        for key, value in raw.items()
        if isinstance(value, dict)
    }


def apply_declarations(
    spec: dict,
    profile: BusinessProfile,
    unstated: Iterable[str],
    unclear_weekdays: Iterable[int] = (),
) -> List[dict]:
    """Write everything this manager has told us directly into the spec.

    Two kinds, one column. The hours of a day they answered a question about,
    and the rules they stated by correcting a calendar -- "en la hora punta
    quiero cuatro" is a policy, and it stopped being a policy the moment the
    week it was said in went past.

    Returns one entry per applied declaration, so the manager can see what is
    in force because they said so, and take it back.

    THE BRIEF STILL WINS. A day whose hours are in this brief keeps them, and a
    claim about a field the brief spoke about is not consulted -- the same
    single rule that keeps learned hints from becoming bias. What a declaration
    does is fill silence, immediately, instead of after three days of watching.

    STANDING HOURS ARE HOURS FOR EVERY DAY. "De lunes a viernes de 17:00 a
    03:00, sábado y domingo hasta las 04:00" arrives as standing hours plus two
    weekend overrides, and only the overrides used to count as "the brief gave
    hours for this day" -- so whatever the opening form had saved for Monday to
    Friday replaced the brief's own 17:00-03:00 on all five. The standing hours
    are the brief speaking about every day it does not single out. The one
    exception is a day it singles out WITHOUT hours ("los sábados abrimos
    casi todo el día", `unclear_weekdays`): that is exactly the day a question
    was asked about, and the answer is what fills it.
    """
    entries: List[dict] = []
    silent = set(unstated)
    unclear = set(unclear_weekdays)

    # --- The hours of a day, answered when we asked. ----------------------
    declared = declared_day_hours(profile)
    if declared:
        day_hours = spec.setdefault("dayHours", [])
        stated = {
            int(d.get("weekday"))
            for d in day_hours
            if isinstance(d, dict) and d.get("weekday") is not None
        }
        if "opening_hours" not in silent:
            stated |= set(range(7)) - unclear
        closed = set(spec.get("closedWeekdays") or [])
        for weekday, (open_min, close_min) in sorted(declared.items()):
            if weekday in stated or weekday in closed:
                continue
            day_hours.append(
                {"weekday": weekday, "openMin": open_min, "closeMin": close_min}
            )
            _add_rule(
                spec,
                "day_hours",
                "%s open %s-%s (you told us)"
                % (WEEKDAY_NAMES[weekday], _clock(open_min), _clock(close_min)),
                "parsed",
            )
            entries.append(
                {
                    "key": "day_hours:%d" % weekday,
                    "field": "dayHours",
                    # The numbers, not a sentence about them. The client writes
                    # the sentence, in the manager's language -- the same rule
                    # `SpecGap` follows, and for the same reason: this server
                    # has no dictionary and the label it can build is English
                    # prose nobody should be shown.
                    "value": {
                        "weekday": weekday,
                        "openMin": open_min,
                        "closeMin": close_min,
                    },
                    "source": "declared",
                }
            )

    # --- The rules they stated by correcting a calendar. ------------------
    for key, value in sorted(declared_rules(profile).items()):
        written = _write_claim(
            spec, silent, key, value, may_lower=True, suffix="(you told us)"
        )
        if written is None:
            continue
        field, kind, label = written
        _add_rule(spec, kind, label, "parsed")
        entries.append(
            {
                "key": key,
                "field": field,
                # As above: the claim's own numbers, for the client to write a
                # sentence from. `label` stays out of the payload entirely so
                # nothing can render it by accident.
                "value": value,
                "source": "declared",
                # What it takes out of play, so nothing assumes it afterwards.
                "gapField": _gap_field(key),
            }
        )
    return entries


def declare_day_hours(
    db: Session,
    org_id: UUID,
    weekday: int,
    open_min: int,
    close_min: int,
) -> BusinessProfile:
    """Record the hours a manager just gave us for one weekday.

    A whole new dict rather than a mutation: SQLAlchemy does not track changes
    made INSIDE a JSONB value, so appending to the existing one would be saved
    on some requests and silently dropped on others depending on what else
    touched the row.
    """
    profile = get_or_create(db, org_id)
    existing = dict(profile.declared or {})
    day_hours = dict(existing.get("day_hours") or {})
    day_hours[str(int(weekday))] = [int(open_min), int(close_min)]
    existing["day_hours"] = day_hours
    profile.declared = existing
    db.flush()
    return profile


# How late a declared day may close, in minutes from ITS OWN midnight. A bar
# that opens at 18:00 and closes at 03:00 is open until 27:00 in the spec's
# terms (the intake does the same: a close before the open is the next day),
# and six hours past midnight is as far as any trade this product plans for
# goes. Beyond that the answer is not a late night but a different day.
LATEST_CLOSE_MIN = 24 * 60 + 6 * 60


def declare_week_hours(
    db: Session,
    org_id: UUID,
    week: Dict[int, Optional[Tuple[int, int]]],
) -> BusinessProfile:
    """Record the whole week's opening hours in one go, as the interview asks them.

    ``week`` maps a weekday (0 = Sunday) to ``(open_min, close_min)`` or to
    None for a day the business is closed. Every day given REPLACES what was
    declared for it before: the manager filled a form for the whole week, so
    the form is the answer, and an hour from an earlier answer must not survive
    beside it. A weekday absent from ``week`` is left alone.

    Two shapes, one column, because the spec has two fields for them. Open
    days go to ``declared["day_hours"]`` where ``apply_declarations`` already
    reads them into ``dayHours``; closed days go to ``declared["rules"]`` under
    the same ``closed_weekday:N`` key a spoken "los lunes cerramos" would
    write, so the rest of this file needs no third kind of thing to know
    about. A day that is open again takes its closed rule away.

    A whole new dict rather than a mutation, for the reason `declare_day_hours`
    spells out: SQLAlchemy does not see a change made INSIDE a JSONB value.
    """
    profile = get_or_create(db, org_id)
    existing = dict(profile.declared or {})
    day_hours = dict(existing.get("day_hours") or {})
    rules = dict(existing.get("rules") or {})
    for weekday, hours in week.items():
        weekday = int(weekday)
        if not 0 <= weekday <= 6:
            raise ValueError("weekday must be 0..6, got %r" % weekday)
        key = str(weekday)
        closed_key = "closed_weekday:%d" % weekday
        if hours is None:
            day_hours.pop(key, None)
            rules[closed_key] = {"closed": True, "weekday": weekday}
            continue
        open_min, close_min = int(hours[0]), int(hours[1])
        if not (0 <= open_min < 24 * 60 and open_min < close_min <= LATEST_CLOSE_MIN):
            raise ValueError(
                "hours for weekday %d must open within the day and close after "
                "opening, at the latest %d minutes past midnight"
                % (weekday, LATEST_CLOSE_MIN - 24 * 60)
            )
        day_hours[key] = [open_min, close_min]
        rules.pop(closed_key, None)
    existing["day_hours"] = day_hours
    existing["rules"] = rules
    profile.declared = existing
    db.flush()
    return profile


def declare_rule(db: Session, org_id: UUID, key: str, value: dict) -> BusinessProfile:
    """Record a rule the manager just stated by correcting the calendar.

    A whole new dict rather than a mutation, for the reason `declare_day_hours`
    spells out: SQLAlchemy does not see a change made INSIDE a JSONB value, so
    an in-place append is saved on some requests and dropped on others.

    Keyed as ``_hint_from_op`` keys it, which is what makes "four at the peak"
    said twice one rule rather than two.
    """
    profile = get_or_create(db, org_id)
    existing = dict(profile.declared or {})
    rules = dict(existing.get("rules") or {})
    rules[str(key)] = value
    existing["rules"] = rules
    profile.declared = existing
    db.flush()
    return profile


def undeclare(db: Session, org_id: UUID, key: str) -> bool:
    """Take back one thing the manager told us. True when something went.

    Every other source in this file can be removed by the person it describes,
    and a declaration is the one they are most entitled to take back: it is the
    only one they stated on purpose.
    """
    profile = get_or_create(db, org_id)
    existing = dict(profile.declared or {})
    removed = False

    if key.startswith("day_hours:"):
        day_hours = dict(existing.get("day_hours") or {})
        weekday = key.split(":", 1)[1]
        if weekday in day_hours:
            del day_hours[weekday]
            existing["day_hours"] = day_hours
            removed = True
    else:
        rules = dict(existing.get("rules") or {})
        if key in rules:
            del rules[key]
            existing["rules"] = rules
            removed = True

    if removed:
        profile.declared = existing
        db.flush()
    return removed


# How sure Jev must be that the manager's sentence describes the business EVERY
# week before a correction made with it is declared (`declare_from_ops`).
#
# The two mistakes are not the same size, and the line leans the way that makes
# the cheap one the likely one. A rule declared by mistake steers every brief
# from then on, silently, until the manager finds it on the rules screen and
# takes it back. A rule NOT declared loses nothing: `observe` still counts the
# correction as evidence, three days of it become a belief, and the manager can
# say it again. So a sentence Jev is not leaning towards calling a rule -- the
# unsure half included -- stays a correction. Not higher than the midpoint, yet:
# nobody has measured how Jev's probabilities fall on real sentences for this
# question, and a stricter number would be picked for how it sounds. The
# "jev: one-off" log line below is where that measurement starts.
DECLARE_FROM = 0.5


def declarable(ops: Sequence[dict]) -> bool:
    """Whether any of these corrections has the shape of a rule at all.

    The first of the two questions ``declare_from_ops`` asks, on its own, so a
    caller can skip asking the second -- the one that costs a call -- when the
    answer could not change anything.
    """
    return any(_hint_from_op(op) is not None for op in ops)


def declare_from_ops(
    db: Session,
    org_id: UUID,
    ops: Sequence[dict],
    p_standing: Optional[float] = None,
) -> List[str]:
    """Turn the corrections that state a RULE into declarations. Returns keys.

    Say "en la hora punta quiero cuatro", watch it happen this week, and then
    watch the next brief go back to three: the correction was evidence only,
    and the belief built from it needed three separate days before anything
    would act on it. That patience is right for what it was built for -- whoever
    fixes one Friday had a bad Friday, not a policy -- and it is wrong for a
    sentence that states a policy outright.

    TWO QUESTIONS, AND THE OPERATION CAN ONLY ANSWER THE FIRST. Could this be a
    rule? ``_hint_from_op`` returns None for a correction about one date or one
    person and a key for one that names a pattern, and reusing that line is what
    stops this from becoming a second, drifting opinion about which corrections
    CAN be rules. IS it one? Four of the six learnable operations carry no date
    at all -- ``set_min_staff``, ``set_peak``, ``set_hours``,
    ``set_max_weekly_hours`` -- so "este sábado que haya mínimo cuatro" and
    "siempre mínimo cuatro" arrive as the same operation, and deciding by its
    shape alone wrote the first as a policy for every brief after it. That
    answer is in the manager's sentence and nowhere else.

    ``p_standing`` is it: the probability, read from the sentence by Jev (see
    ``record_observations``), that it describes how the business always runs.
    Below ``DECLARE_FROM`` nothing is declared, and ``observe`` -- which the
    caller runs either way -- keeps the correction as evidence, so a one-off
    that turns out to be a habit still becomes a belief, the slow way. None is
    no opinion (Jev off or resting, no sentence, no answer), and then the
    operation decides alone, exactly as before the question existed.

    ONLY WITH LEARNING ON, like ``observe``. The declaration written whatever
    the switch says is the one made by ANSWERING a question; nobody asked for
    this one -- the manager fixed a calendar. ``record_observations`` spells
    out why that difference decides it.
    """
    rules: List[Tuple[str, dict]] = []
    for op in ops:
        derived = _hint_from_op(op)
        if derived is None:
            continue
        key, value, _label = derived
        rules.append((key, value))

    if rules and p_standing is not None and p_standing < DECLARE_FROM:
        log.info(
            "jev: one-off, not declared p=%.2f keys=%s",
            p_standing,
            [key for key, _value in rules],
        )
        return []

    declared: List[str] = []
    for key, value in rules:
        declare_rule(db, org_id, key, value)
        declared.append(key)
    return declared


# --- The vertical we GUESS -------------------------------------------------
#
# A manager who does the opening interview is never asked what kind of
# business they run: `POST /interview/complete` closes the first run, and the
# one step that asks (`FirstRunPanel`) is never shown to them. The interview
# itself did ask -- it is its first topic -- but the answer only ever reached
# the planner as prose. So it is read back here, by Jev (services/jev.py), as
# one closed question over the codes in ``VERTICALS``, and kept with
# ``vertical_source="inferred"``.
#
# Which, by the rule on the model (``BusinessProfile.vertical_source``), buys
# nothing on its own: every reader of the vertical -- the intake background,
# the planner's preferences, the suggestions, the research, the assistant --
# reads a DECLARED one only. An inferred vertical is a proposal waiting for
# the manager to confirm it, and a wrong one costs a proposal, never a
# calendar.
#
# WHAT CROSSES. Jev is hosted in the United States, and the interview's
# paragraph is not only about the business: its last topic is the team, and
# the brief is told to name every person with their contract hours
# (`interview.build_system_instruction`). Two measures, because neither is
# enough alone:
#
# 1. Only the part BEFORE the team (``business_part``). The paragraph is prose
#    -- written by a model, then edited by the manager -- with nothing in it to
#    split on, so there is no reliable line between the business and its
#    people. What there is, is a habit: the team comes last, because it is the
#    last topic, and every person in it comes with an hours figure ("Ana y
#    Luis con 40 horas", "Jordi sin horas fijas"). Everything from the first
#    clause that reads like that is dropped, including later clauses with no
#    figure in them ("Marta también."). What kind of business it is comes
#    FIRST in the same habit, so it survives the cut.
# 2. ``jev.mask`` with every name this org has on file. Of no use on the very
#    first interview, which is the common case: /welcome saves the paragraph
#    before anybody is on the roster (the team is created later, from the
#    first brief). It is what catches a name in the business half of a second
#    interview.
#
# NOT A GUARANTEE, and not presented as one. On a first interview, a name the
# manager puts before the team ("Ana y yo abrimos un bar") crosses. The two
# ways of being wrong are not the same size: cut too early and a guess is not
# made; cut too late and a name is in another jurisdiction. So every doubt in
# ``business_part`` resolves towards cutting.

# How concentrated Jev's answer must be before the guess is kept.
#
# Not a guard on any calendar -- an inferred vertical never reaches one -- but
# on what the manager will be asked to confirm. A proposal that is wrong one
# time in three teaches them to dismiss it unread, which is worse than
# proposing nothing: nothing is the state every business was in before this,
# and the full list is still there to pick from. 0.6 is a starting point and
# not a measurement: well clear of a coin toss, and low enough that a paragraph
# saying "tengo un bar" in so many words clears it. Every answer is logged
# with its confidence and none of the text (``infer_vertical``), so it can be
# moved on evidence.
INFER_FROM = 0.6

# "other" is offered, so that a florist is not forced into "retail", and never
# KEPT: as a guess it says "none of these, or we could not tell", which is what
# an unknown vertical already says, and a manager asked to confirm "Something
# else" has been asked nothing.
_UNKNOWN_VERTICAL = "other"

# Where one clause of the paragraph ends: after a full stop, question or
# exclamation mark, semicolon or colon that is followed by a space -- never the
# colon of a clock ("18:00") or the point of a decimal ("37.5 h") -- and at a
# line break.
_CLAUSE_END = re.compile(r"(?<=[.!?;:])\s+|\n+")

_HOURS_UNIT = r"(?:h|hrs?|horas?|hours?)\b"
_NUMBER = r"\d+(?:[.,:]\d+)?"

# A figure of hours: "40 horas", "20 h", "37,5 hours". Not the minutes of a
# clock ("18:00 h"), which the look-behind leaves out.
_HOURS_FIGURE = re.compile(r"(?<![\d.,:])\d+(?:[.,]\d+)?\s*" + _HOURS_UNIT, re.IGNORECASE)

# The ways an hours figure describes the DOORS rather than a person, removed
# before a clause is judged: a range ("de 9 a 20 h", "9-20h", "from 9 to 17
# h"), a time of day ("a las 20 h", "hasta las 3 h"), and never closing
# ("abierto 24 horas", "las 24 horas", "24 horas al día", "24/7"). A range needs
# a figure on BOTH sides: "Marta a 20 horas" is a contract, not a closing time.
# And a day's length only at 24: "8 horas al día" is as often somebody's shift
# as the business's.
_OPENING_HOURS = re.compile(
    r"\b" + _NUMBER + r"\s*(?:h\s*)?(?:a|to|hasta|until|till|-|–)\s*" + _NUMBER
    + r"\s*" + _HOURS_UNIT
    + r"|\b(?:a|de|desde|hasta)\s+las\s+" + _NUMBER + r"\s*(?:h|horas?)\b"
    + r"|\blas\s+24\s*(?:h|horas?)\b"
    + r"|\b(?:abiert[oa]s?|open)\s+(?:las\s+)?\d+\s*" + _HOURS_UNIT
    + r"|\b24\s*" + _HOURS_UNIT + r"\s*(?:(?:al|a|per|each|every)\s+(?:d[ií]a|day)\b|diari[oa]s\b)"
    + r"|\b24\s*/\s*7\b",
    re.IGNORECASE,
)

# Words only a sentence about people's terms uses -- including the two ways the
# roster form says a person has no hours yet ("sin concretar las horas",
# "hours not settled"). "jornada" costs a clause about a long working day now
# and then; that is a guess not made, which is the cheap way to be wrong.
_TEAM_WORDS = re.compile(
    r"contrat|contract|jornada|full[- ]?time|part[- ]?time"
    r"|horas fijas|fixed hours|sin concretar|not settled",
    re.IGNORECASE,
)


def _about_the_team(clause: str) -> bool:
    if _TEAM_WORDS.search(clause):
        return True
    return bool(_HOURS_FIGURE.search(_OPENING_HOURS.sub(" ", clause)))


def business_part(notes: str) -> str:
    """The interview paragraph up to where it starts on the team. May be "".

    Clause by clause, stopping at the first that carries a contract-hours
    figure or a word about contracts, and dropping everything from there on.
    See "WHAT CROSSES" above for why this is a habit and not a boundary.
    """
    kept: List[str] = []
    for clause in _CLAUSE_END.split(notes or ""):
        clause = clause.strip()
        if not clause:
            continue
        if _about_the_team(clause):
            break
        kept.append(clause)
    return " ".join(kept)


def vertical_question() -> jev.Choice:
    """The one question: which of our codes the paragraph describes.

    Each option is its label and its context, which is also how the intake
    would describe it. Those contexts talk about busy hours, and a model shown
    a bar's late close could match it against a gym's late evenings -- so the
    instruction says what to decide by.
    """
    return jev.Choice(
        "A manager describes the business they run. Which kind of business is "
        "it? Decide by what the business is, and what it sells or does, as the "
        "text names it. What each option says about busy hours only tells the "
        "kinds apart; do not match it against the hours in the text. If the "
        "text does not say what kind of business it is, or it is none of these, "
        "choose other.",
        {code: "%s: %s" % (v.label, v.context) for code, v in VERTICALS.items()},
    )


def infer_vertical(state: str) -> Optional[str]:
    """Jev's reading of ``state`` as one of ``VERTICALS``, or None.

    ``state`` must already be cut and masked -- this sends what it is given.
    None when Jev is off, fails, hesitates (below ``INFER_FROM``) or says
    "other". Never raises: ``jev.ask`` does not.
    """
    answers = jev.ask(state, {"vertical": vertical_question()}, "vertical")
    answer = (answers or {}).get("vertical")
    if answer is None or answer.choice is None:
        return None
    confidence = answer.confidence
    kept = (
        answer.choice != _UNKNOWN_VERTICAL
        and confidence is not None
        and confidence >= INFER_FROM
    )
    # The code and the number, never the text: enough to move INFER_FROM on
    # evidence, and nothing a log reader could learn a business from.
    log.info(
        "jev vertical: %s at %s, %s",
        answer.choice,
        "?" if confidence is None else "%.2f" % confidence,
        "kept" if kept else "not kept",
    )
    return answer.choice if kept else None


def infer_vertical_from_interview(
    db: Session, profile: BusinessProfile, notes: str
) -> None:
    """Guess the vertical again from a NEW interview paragraph. NEVER RAISES.

    A DECLARED vertical is the manager's, and is left exactly as it is -- Jev
    is not even asked. Anything else is either nothing or a guess drawn from
    the LAST interview, and a second interview replaces the first whole (see
    ``routers/interview.interview_complete``): a bar that became a shop must
    not keep "bar" because Jev was down on the day it said so. So an old guess
    is cleared first, whatever happens next, and then guessed again if Jev is
    on. Off, failing or unsure, the vertical stays unknown -- the state every
    business was in before this existed.

    Only called with notes that were actually kept: a skip is not an answer,
    and erases nothing.
    """
    if profile.vertical_source == "declared" and profile.vertical:
        return
    if profile.vertical_source == "inferred":
        # The column is NOT NULL, so "unknown" is spelled the way a fresh row
        # spells it: no vertical, and the column's own default.
        profile.vertical = None
        profile.vertical_source = "declared"
    if not jev.enabled():
        return
    try:
        state = jev.mask(
            business_part(notes), employees_svc.names_by_id(db, profile.org_id)
        )
        choice = infer_vertical(state)
    except Exception:  # noqa: BLE001 - a guess is never worth the request
        log.exception("jev vertical: could not guess; it stays unknown")
        return
    if choice is not None:
        profile.vertical = choice
        profile.vertical_source = "inferred"
