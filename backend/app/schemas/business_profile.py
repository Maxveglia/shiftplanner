from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.schemas import limits


class VerticalOut(BaseModel):
    """One industry the manager can pick from."""

    code: str
    label: str


class HintOut(BaseModel):
    """Something we believe about this business, with the receipts.

    ``evidence`` and ``needed`` are both sent so the UI can say "seen on 2 of
    the 3 days needed" rather than presenting a belief as a fact. A hint the
    manager can inspect is a hint they can correct.

    ``key`` and ``value`` are the claim itself -- its shape and its numbers --
    and they are what the client writes the sentence from, the same way it
    already does for a gap and for a declaration. ``claim`` is that sentence
    written here, in English, and it stays for two reasons: the model prompt
    reads it, and a client meeting a claim shape newer than itself can show
    English prose rather than nothing.
    """

    key: str
    value: Dict[str, Any] = Field(default_factory=dict)
    claim: str
    evidence: int
    needed: int
    contradictions: int
    active: bool
    rejected: bool
    # Whether this came from something the manager SAID rather than from a
    # pattern in what they corrected. The two need different words on screen
    # and a different control: evidence promotes an inferred hint, and a
    # confirmation promotes a stated one. `evidence`/`needed` are meaningless
    # for a stated rule and the client must not draw "seen on 1 of 3 days"
    # beside a sentence the manager typed.
    stated: bool = False
    # For a stated rule only: whether they have confirmed it. Until they do it
    # is a proposal and changes nothing.
    accepted: bool = False


class ProfileOut(BaseModel):
    vertical: Optional[str] = None
    vertical_source: str = "declared"
    house_notes: Optional[str] = None
    # What the manager said in the opening interview, and when. Shown in
    # Settings under its own label so they can see -- and correct -- what the
    # planner has been told about them.
    interview_notes: Optional[str] = None
    interviewed_at: Optional[datetime] = None
    # Where the business is, in the manager's own words. Distinct from
    # ``jurisdiction_code`` below, which is the body of labour rules applied to
    # it: we hold three of those and they are all American, so "Valencia" is a
    # perfectly good answer to one question and unanswerable for the other.
    location: Optional[str] = None
    # The labour jurisdiction in force, read from the organization. Sent here
    # because this is the screen where a manager reads what we believe about
    # their business, and until now this belief was the one they could not see
    # -- it was set to US-FED at signup and never shown or changed.
    jurisdiction_code: str = "US-FED"
    # What we looked up about businesses like theirs, and when.
    #
    # Readable on purpose. This panel exists so a customer can see every belief
    # the product holds about them and switch any of it off; a summary a model
    # wrote about their neighbourhood is exactly such a belief, and the one
    # they would most want to correct.
    research_notes: Optional[str] = None
    # What that research MEANS for a calendar: which weekdays and hours are
    # busy, how many people at the peak, which months, which local holidays.
    # Sent so this panel -- the one place a manager reads every belief the
    # product holds about them -- can show a belief that changes who works on
    # Friday. Null for a business whose research never ran.
    research_signals: Optional[dict] = None
    researched_at: Optional[datetime] = None
    learning_enabled: bool = True
    # Null means nobody has said. Readers fall back to midnight and to Saturday
    # and Sunday, which is what every screen assumed before these existed -- so
    # a business that never answers keeps the calendar it already had.
    day_boundary_min: Optional[int] = None
    # A week has seven days, so a list longer than that is not a week.
    weekend_days: Optional[List[int]] = Field(default=None, max_length=7)
    # Which trade-off this business wants made when several legal rotas exist,
    # as one of ``business_profile.OBJECTIVES``. Null means nobody has chosen,
    # and the client then leaves the spec's objective unset -- which is the
    # calendar every business already has.
    objective: Optional[str] = None
    # Whether this org has still to be asked the first-run questions. Defaults
    # to False so a client reading an older server -- or an org created before
    # the flow existed -- gets today's behaviour: no questions.
    first_run_pending: bool = False
    hints: List[HintOut] = Field(default_factory=list)
    verticals: List[VerticalOut] = Field(default_factory=list)


class BusinessShapeOut(BaseModel):
    """The two business parameters an employee's own screens need.

    A separate model rather than a slice of ``ProfileOut`` so that widening the
    profile can never widen what an employee sees. Anything an employee may read
    about their employer has to be added here on purpose.
    """

    day_boundary_min: Optional[int] = None
    weekend_days: Optional[List[int]] = None


class ProfileUpdate(BaseModel):
    """Every field optional: the manager corrects one thing at a time.

    Which is why the two business-shape fields cannot use None to mean "clear
    it": None already means "I am not touching this one". Clearing the weekend
    is an empty list, which is a real answer -- an office that pays no weekend
    differential -- and not the same as never having been asked.
    """

    vertical: Optional[str] = Field(default=None, max_length=limits.CODE)
    house_notes: Optional[str] = Field(default=None, max_length=limits.NOTES)
    # Editable for the same reason ``house_notes`` is: what the planner has
    # been told about a business must be something the manager can fix.
    #
    # Its ceiling is the model's, not a textarea's: this text was WRITTEN by
    # Gemini and comes back here edited, so anything smaller than what the
    # interview can produce would make a summary the manager cannot save.
    interview_notes: Optional[str] = Field(default=None, max_length=limits.PROSE)
    # Same again, and more so: this one we wrote from a web search, and it is
    # the belief a manager is likeliest to want to strike out. "" clears it.
    research_notes: Optional[str] = Field(default=None, max_length=limits.PROSE)
    # Free text, and "" clears it -- the same job the empty list does for
    # ``weekend_days``. A manager who moved and has not decided what to write
    # yet must be able to take the old answer away.
    location: Optional[str] = Field(default=None, max_length=limits.NAME)
    # A jurisdiction we hold rules for. Validated against ``labor_profile``
    # rather than accepted as typed: an unknown code would leave a business
    # believing its rota respects local law while the scheduler falls back to
    # whatever it can find, and nothing on screen would say so.
    jurisdiction_code: Optional[str] = Field(default=None, max_length=limits.CODE)
    learning_enabled: Optional[bool] = None
    day_boundary_min: Optional[int] = None
    weekend_days: Optional[List[int]] = None
    # An objective code, or "" to go back to having chosen nothing.
    #
    # The empty string is doing the job None cannot, exactly as the empty list
    # does for ``weekend_days``: None already means "I am not touching this
    # one". Without a way to say it, picking a profile would be a one-way door
    # -- four buttons a manager can press and never un-press -- and "the
    # balanced default" is a real answer, not the absence of one.
    objective: Optional[str] = Field(default=None, max_length=limits.CODE)
    # Said the same way it is read, rather than as a "first_run_done" that has
    # to be inverted at both ends. The client sends False when the manager
    # finishes the questions AND when they skip them: both mean the same thing
    # to everyone downstream -- do not ask again -- and inventing a third state
    # would only create a case nobody knows what to do with.
    first_run_pending: Optional[bool] = None


class HintUpdate(BaseModel):
    """The manager's verdict on one learned hint.

    Rejecting is the escape hatch that makes the whole layer safe to ship: a
    belief the manager disagrees with stops affecting their calendar the moment
    they say so, whatever the evidence behind it.

    ``accepted`` is the opposite gesture, and it exists for STATED rules only --
    the ones read out of something the manager typed. Those are inert until
    confirmed (see ``business_profile.is_active``), so for them this is not a
    veto but the switch that turns the proposal into a rule. Optional because
    an inferred hint has no use for it: evidence is what promotes those.
    """

    rejected: bool
    accepted: Optional[bool] = None


class ObservationsIn(BaseModel):
    """The refine operations the client actually APPLIED.

    Not the ones it planned, and not the ones it refused. An operation that was
    skipped never happened to this business.
    """

    # One operation here is one observation written down, so the list is a
    # write like ``PublishIn.shifts`` is. A manager adjusting a month applies
    # tens of these in a sitting; 500 is a wall an attacker meets and a
    # customer does not.
    ops: List[dict] = Field(default_factory=list, max_length=limits.OPS)
    # The sentence the manager typed that these operations came from, when
    # they came from one. It is the only place "this Saturday" and "every
    # Saturday" differ -- both are one `set_min_staff` -- so it is read once,
    # masked, to ask whether it states a rule, and never stored. Absent means
    # no opinion, and the operations are judged by their shape as before.
    text: Optional[str] = Field(default=None, max_length=limits.ADJUSTMENT)


class ObservationsOut(BaseModel):
    recorded: int
    learned: List[str] = Field(default_factory=list)


class PlannerNoteOut(BaseModel):
    """One line of the planner's notebook, as the manager reads it.

    ``text`` has people written by their real names -- this is the manager's
    own screen. ``about_person`` says the line can never apply by itself: it
    is asked about on the rules screen instead.
    """

    id: str
    text: str
    about_person: bool


class PlannerNotesOut(BaseModel):
    """Everything the planner has written down about this business.

    ``enabled`` is whether the notes are being taken and read at all: the
    server switch AND the manager's learning switch. The notes are listed
    either way, so whatever was written before a switch went off can still be
    seen and deleted.
    """

    enabled: bool
    notes: List[PlannerNoteOut] = Field(default_factory=list)
