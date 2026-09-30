from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk

# The states a job moves through. Text rather than an enum, like the rest of
# this schema: adding a state should not need a migration that rewrites a type.
QUEUED = "queued"
RUNNING = "running"
DONE = "done"
FAILED = "failed"

# What a month's row says about itself. `planned` means the model answered and
# what it said is in `shifts`; `failed` means it did not, and the client covers
# that block with its own deterministic pass -- which is what it always did.
PLANNED = "planned"
MONTH_FAILED = "failed"


class GenerationJob(Base):
    """One manager asking for a calendar, as a row rather than as a wait.

    Planning used to be one HTTP request that ran for minutes: the model wrote
    twelve months, the provider billed them, and they existed only in the
    memory of that request. A manager who closed the tab at minute four paid
    for work nobody would ever see. This row is where the asking lives now, so
    that closing a window costs nothing.

    WHAT IS HERE IS THE QUESTION, NOT THE ANSWER. `context` is the snapshot the
    client built -- the requirements, the roster, who is unavailable -- under
    the same rule as the endpoint that used to receive it: it carries no pay
    rates and no absence reasons. The answer arrives a month at a time in
    ``GenerationMonth``.

    ``attempts`` is what stops a job that kills its worker from killing every
    worker in turn. A job whose heartbeat goes stale is picked up once more;
    the second time, it is abandoned with an error rather than retried forever.

    ``heartbeat_at`` is written while the model is working, by the worker
    holding the job. It is the only way to tell "still going" from "the
    container was redeployed mid-month", and redeploys are frequent here
    because main is the deploy.
    """

    __tablename__ = "generation_job"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String, nullable=False, default=QUEUED)
    effort: Mapped[str] = mapped_column(String, nullable=False)
    # ["2026-10", "2026-11", ...]. JSONB rather than a text[] because this
    # schema has no precedent for arrays and one consumer for this list.
    months: Mapped[list] = mapped_column(JSONB, nullable=False)
    context: Mapped[str] = mapped_column(String, nullable=False)
    # The ids inside `context`, said plainly, so the server can shorten them
    # for the model and tell a person from a template on the way back.
    employees: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    templates: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Who owns the job right now. Every claim mints a new one, and every write a
    # worker makes names it, so a worker that was declared stale and replaced
    # cannot go on writing into the job it lost. See the migration for the
    # failure this prevents.
    lease: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # Why it gave up, as a code the client translates -- never a sentence. See
    # app/errors.py for why the server does not compose prose.
    error_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    heartbeat_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class GenerationMonth(Base):
    """One month of a job, written the moment the model finishes it.

    This is the whole point of the queue: a month that has been written has
    been billed, so it is persisted before anything else happens -- not held
    until its eleven siblings are done.

    ``shifts`` is exactly the JSON the old endpoint returned: five fields per
    shift, camelCase, no provenance and no guarantees. It is NOT a draft and
    NOT an assignment. Nothing in `assignment` is written from here, so a bad
    month is still worth no more than the paper it is on, and the client
    validates every shift in it against the same rules the generator obeys
    before any of it reaches an employee.
    """

    __tablename__ = "generation_month"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("generation_job.id", ondelete="CASCADE"),
        nullable=False,
    )
    month: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False)
    shifts: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    created_at: Mapped[datetime] = created_at_col()
