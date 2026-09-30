from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class BusinessProfile(Base):
    """What kind of business this organization runs. One row per org.

    This is the WEAKEST of the four sources that can decide a scheduling
    requirement, and it exists to answer a question the product could not ask
    before: a bar and a phone shop that both write "open 10 to 22, two people"
    do not want the same calendar. The bar's late hours are its busiest; the
    shop's are its quietest.

    Every number that describes a WHOLE INDUSTRY is still a template constant
    in ``app/services/business_profile.py`` and not a column here, so changing
    a default for every bar on the platform stays a code change somebody can
    review rather than a silent UPDATE across tenants.

    The two columns below are the exception that proves that rule, because they
    are not industry defaults: they are what THIS manager said about THIS
    business. Where a day ends and which days are its weekend cannot be
    constants -- they were, spelled `weekday == 0 || weekday == 6` in four
    different files, and a bar could not describe itself at all. Both stay NULL
    until somebody sets them, which is how a value a manager confirmed is told
    apart from one nobody has been asked about yet.

    ``objective`` is a third of that kind, and the only one that changes a
    calendar rather than describing a week: which of four trade-offs this
    manager wants made when several legal rotas exist. Same NULL rule, same
    reason -- a business that has never been asked keeps the rota it has today.

    ``first_run_pending`` is the odd one out: not a fact about the business but
    about our conversation with it -- whether the manager has been asked the
    handful of questions a new account gets once. It lives here anyway, because
    it is per-ORG and not per-user: a second manager joining the same shop must
    not be asked again about hours the first one already gave.

    ``vertical_source`` is the honesty column. "declared" means a human said
    it; "inferred" means we guessed it from a brief. The two are never treated
    alike: an inferred vertical is shown to the manager for confirmation and
    contributes nothing until they accept it. Guessing that a business is a bar
    and then quietly staffing its evenings is exactly the bias this table has
    to avoid being the source of.
    """

    __tablename__ = "business_profile"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    # One of app.services.business_profile.VERTICALS, or null while unknown.
    vertical: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    vertical_source: Mapped[str] = mapped_column(
        String, nullable=False, server_default=text("'declared'")
    )
    # Free text the manager wrote about how their business runs. Passed to the
    # model as context; never parsed into a number by us.
    house_notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Where the business is, in the manager's own words ("Valencia", "a beach
    # town near Alicante", "downtown Phoenix").
    #
    # Free text and not a jurisdiction code, because those are two different
    # facts and only one of them we can always honour. `jurisdiction_code` on
    # `organization` names a body of labour rules we hold, and we hold three:
    # US-FED, US-CA and US-AZ. Somewhere else is not a bad answer, it is an
    # answer this product cannot yet act on legally -- and it is still the most
    # useful thing anyone can tell a planner about seasons, tourism and when a
    # neighbourhood eats.
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # What we LOOKED UP about a business like this one, in the place it is --
    # a summary written by a model that searched the web from the manager's
    # onboarding answers.
    #
    # Deliberately not `house_notes`. That column is the manager's own words
    # and is treated as fact; this one is a guess of ours, and the difference
    # is the same one `vertical_source` exists to keep. It reaches the planner
    # labelled as ours, so a rota is never arranged around something we read on
    # the internet as though the manager had said it.
    research_notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # What the manager said in the opening interview, as one paragraph a model
    # wrote from their answers and they approved. Kept so that every brief
    # after the first starts from a business the planner already knows.
    #
    # Not `house_notes` either, and for the mirror-image reason to
    # `research_notes`: this is a paraphrase a human waved through, not words
    # they typed. It is treated as theirs -- they read it and said yes -- but
    # it is kept apart so that a sentence that was never quite said can be
    # traced to the interview rather than to the manager.
    interview_notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    interviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When that research was done. A timestamp and not a flag: an answer stays
    # true until the manager changes it, but what is typical of a neighbourhood
    # was true when we looked, and whatever decides to look again needs to know
    # how long ago that was.
    # What that research MEANS for a calendar, as values the planner acts on:
    # busy weekdays and windows, a peak headcount, busy and quiet months, local
    # holidays. The prose above is what a person reads; this is what the
    # scheduler reads. Null for every business whose research never ran.
    research_signals: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    researched_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # A manager can switch the whole adaptive layer off. When false, intake
    # behaves exactly as it did before this feature existed.
    learning_enabled: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("true")
    )
    # The minute at which one working day becomes the next: 0 for a bakery,
    # 6*60 for a bar that closes at four. NULL means nobody has said, and the
    # frontend reads midnight -- which is what every screen assumed before this
    # column existed.
    day_boundary_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # The weekdays this business staffs and pays as its weekend, 0 = Sunday.
    # A list rather than a pair: an office may have none, and a business that
    # works Thursday to Saturday is not two days wide by law.
    weekend_days: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    # What this business wants a calendar to optimise for, as one of
    # ``app.services.business_profile.OBJECTIVES``, or NULL while nobody has
    # chosen.
    #
    # A CODE and not a set of weights, for the same reason the vertical is a
    # code: the numbers behind "the cheapest shift that covers the hour" belong
    # beside the generator that scores with them, and are a code change somebody
    # reviews rather than fifteen floats sitting in a tenant's row. It also
    # means retuning a profile improves every business that picked it, instead
    # of only the ones that pick it next.
    objective: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Whether this org still owes us the handful of answers a new account is
    # asked for once. False is "no" for two different reasons that never need
    # telling apart -- it answered them, or it was never going to be asked --
    # and that is exactly why it is a boolean and not a timestamp: only signup
    # sets it true, so every org that predates the flow, and every profile row
    # created lazily by ``get_or_create``, keeps the behaviour it always had
    # without anyone back-dating a date the manager never saw.
    first_run_pending: Mapped[bool] = mapped_column(
        nullable=False, server_default=text("false")
    )
    # What this manager ANSWERED when we asked them something. The fourth thing
    # that can decide a requirement, and the one that was missing: everything
    # said after the brief used to go through the learning layer, which waits
    # for three days of evidence. That is right for a correction and wrong for
    # a direct answer -- asking a question and then ignoring the reply for three
    # days is not caution. Shaped `{"day_hours": {"6": [480, 1440]}}`, keyed by
    # the field it decides, so the next kind of question adds a key rather than
    # a column. NULL means nobody has answered anything yet.
    declared: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
