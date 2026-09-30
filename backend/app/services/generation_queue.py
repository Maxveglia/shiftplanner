from __future__ import annotations

"""The queue a calendar is asked for through, and the rules for taking a job.

WHY THERE IS A QUEUE AT ALL. Planning was one request that ran for minutes:
the model wrote up to twelve months, the provider billed every one of them,
and they existed only in the memory of that request. Closing the tab threw
away work already paid for -- it happened on 14-sep-2026, nine attempts
generated and discarded, and the meter showed a quiet afternoon. A request
that returns immediately cannot lose anything by being abandoned.

WHAT RUNS PRIVILEGED, AND WHY IT HAS TO. Under row-level security a query with
no ``app.current_org_id`` set matches nothing, so "is there a job for anybody?"
cannot be asked as ``app_user``: the worker does not know whose org to set
until it has read the row. So exactly two statements here run on the superuser
session -- CLAIM and REAP -- and both of them touch only this queue. Everything
that follows a claim (the profile, the meter, the months) runs as ``app_user``
with the org taken from the row that was just claimed, which is the same
barrier every other read in this product goes through.

WHY POSTGRES AND NOT A BROKER. `FOR UPDATE SKIP LOCKED` is a work queue, and
it is already running in production with backups and a migration history. Redis
plus Celery would add a broker, a second service and a third way to fail, for a
few dozen jobs a day.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Sequence, Tuple

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import set_current_org
from app.models.generation_job import (
    DONE,
    FAILED,
    GenerationJob,
    GenerationMonth,
    MONTH_FAILED,
    PLANNED,
    QUEUED,
    RUNNING,
)

log = logging.getLogger(__name__)

# What a job that was picked up and never finished is called. A worker that is
# redeployed mid-month leaves one of these behind, and a person watching a
# progress bar deserves better than a spinner that never ends.
ABANDONED = "generation_abandoned"


@dataclass
class ClaimedJob:
    """A job this worker now owns. Plain values, not an ORM row.

    Deliberately detached: it is read on the superuser session and used on a
    tenant one, and an ORM instance carried between sessions is how an
    expired attribute turns into a query with no org context behind it.
    """

    id: uuid.UUID
    org_id: uuid.UUID
    months: List[str]
    context: str
    employees: List[str]
    templates: List[str]
    effort: str
    attempts: int
    # Proof of ownership. Passed to every write this worker makes; a write whose
    # lease no longer matches the row touches nothing, which is how a worker
    # that lost its job stops being able to corrupt it.
    lease: uuid.UUID


# --- the manager's side (tenant session, RLS applies) -------------------------


class AlreadyPlanning(Exception):
    """This organisation already has a calendar in flight.

    Raised from the database's own answer, not from a check: see
    `uq_generation_job_one_per_org`. A read-then-write cannot enforce this --
    two requests a few milliseconds apart both read "none" and both insert.

    Carries the job that won, when it can still be read, so the client can JOIN
    it instead of being told to wait for something it cannot see.
    """

    def __init__(self, job_id: Optional[uuid.UUID] = None) -> None:
        super().__init__("this organisation is already planning a calendar")
        self.job_id = job_id


def enqueue(
    db: Session,
    org_id: uuid.UUID,
    *,
    months: Sequence[str],
    context: str,
    employees: Sequence[str],
    templates: Sequence[str],
    effort: str,
) -> GenerationJob:
    """Write the question down. Returns immediately; nothing is planned yet.

    Raises ``AlreadyPlanning`` when this org already has one queued or running.
    The partial unique index is what decides that, so a double click cannot buy
    the same twelve months twice.
    """
    job = GenerationJob(
        org_id=org_id,
        status=QUEUED,
        effort=effort,
        months=list(months),
        context=context,
        employees=list(employees),
        templates=list(templates),
    )
    db.add(job)
    try:
        db.flush()
    except IntegrityError as exc:
        if "uq_generation_job_one_per_org" not in str(exc.orig):
            raise
        # The session has to be usable again: a failed flush poisons the
        # transaction, so every statement after it -- including the read that
        # names the job that won -- would be refused. The rollback also discards
        # the row we failed to write, so there is nothing to expunge by hand.
        #
        # And the rollback takes the tenant context with it: `set_current_org`
        # is SET LOCAL, scoped to the transaction. Re-arming it is not optional;
        # without it the read below runs with no org and RLS answers "nothing",
        # which would silently turn "join the job in flight" into "no job".
        db.rollback()
        set_current_org(db, org_id)
        winner = active_job(db, org_id)
        raise AlreadyPlanning(winner.id if winner is not None else None) from exc
    db.refresh(job)
    return job


def active_job(db: Session, org_id: uuid.UUID) -> Optional[GenerationJob]:
    """The job this org already has in flight, if any.

    One at a time, per organisation. The browser used to refuse a second run
    with a React ref, which is the wrong place for the rule: a ref does not
    survive a reload, and two tabs have two of them. The cost of getting it
    wrong is a second bill for the same calendar.
    """
    return db.execute(
        select(GenerationJob)
        .where(GenerationJob.org_id == org_id)
        .where(GenerationJob.status.in_([QUEUED, RUNNING]))
        .order_by(GenerationJob.created_at.desc())
    ).scalars().first()


def read_job(
    db: Session, org_id: uuid.UUID, job_id: uuid.UUID
) -> Optional[Tuple[GenerationJob, List[GenerationMonth]]]:
    """A job and the months of it that have arrived so far.

    The org filter is belt and braces: RLS already stands between this and
    another customer's job, and the test suite checks it from both sides.
    """
    job = db.execute(
        select(GenerationJob)
        .where(GenerationJob.org_id == org_id)
        .where(GenerationJob.id == job_id)
    ).scalar_one_or_none()
    if job is None:
        return None
    months = list(
        db.execute(
            select(GenerationMonth)
            .where(GenerationMonth.job_id == job.id)
            .order_by(GenerationMonth.month.asc())
        ).scalars()
    )
    return job, months


def latest_job(
    db: Session, org_id: uuid.UUID
) -> Optional[Tuple[GenerationJob, List[GenerationMonth]]]:
    """The most recent job of this org, whatever state it is in.

    What a reopened tab asks for. A manager who closed the laptop mid-plan
    comes back to the months that were written while it was shut, rather than
    to an empty calendar and a bill.
    """
    job = db.execute(
        select(GenerationJob)
        .where(GenerationJob.org_id == org_id)
        .order_by(GenerationJob.created_at.desc())
    ).scalars().first()
    if job is None:
        return None
    return read_job(db, org_id, job.id)


# --- the worker's side -------------------------------------------------------


def reap_abandoned() -> int:
    """Fail the jobs whose worker died and that have used up their attempts.

    PRIVILEGED (superuser session): it sweeps every org, and there is no org to
    set. It reads and writes nothing but this queue.

    Run before claiming, so a job that has already been picked up twice is not
    picked up a third time. Without this a job that kills its worker -- a
    context that makes the SDK throw, say -- would take down every worker in
    turn, forever, and the only symptom would be a queue that never moves.
    """
    from app.db import AdminSessionLocal

    db = AdminSessionLocal()
    try:
        result = db.execute(
            text(
                "UPDATE generation_job SET status = :failed, "
                "error_code = :code, finished_at = now() "
                "WHERE status = :running "
                "AND heartbeat_at < now() - make_interval(secs => :stale) "
                "AND attempts >= :max_attempts"
            ),
            {
                "failed": FAILED,
                "code": ABANDONED,
                "running": RUNNING,
                "stale": float(settings.generation_stale_after_seconds),
                "max_attempts": settings.generation_max_attempts,
            },
        )
        db.commit()
        return result.rowcount or 0
    except Exception:  # noqa: BLE001 - a worker must not die of housekeeping
        db.rollback()
        log.exception("generation_queue: could not reap abandoned jobs")
        return 0
    finally:
        db.close()


def claim() -> Optional[ClaimedJob]:
    """Take the next job, atomically. None when the queue is empty.

    PRIVILEGED (superuser session), for the reason in the module docstring: the
    org is not known until the row is read.

    `FOR UPDATE SKIP LOCKED` is what makes more than one worker -- in this
    process or in another container -- safe without a lock table: two workers
    asking at the same moment get two different jobs, or one gets nothing.

    A stale `running` row is claimable again, which is how a redeploy
    mid-generation resumes instead of stranding a manager. The months already
    written are not written twice: `uq_generation_month_job_month` makes that
    a conflict, and `record_month` treats it as the no-op it is.
    """
    from app.db import AdminSessionLocal

    db = AdminSessionLocal()
    try:
        row = db.execute(
            text(
                "UPDATE generation_job SET "
                "  status = :running, "
                "  started_at = COALESCE(started_at, now()), "
                "  heartbeat_at = now(), "
                "  attempts = attempts + 1, "
                "  lease = gen_random_uuid() "
                "WHERE id = ( "
                "  SELECT id FROM generation_job "
                "   WHERE attempts < :max_attempts "
                "     AND (status = :queued OR (status = :running AND "
                "          heartbeat_at < now() - make_interval(secs => :stale))) "
                "   ORDER BY created_at "
                "   FOR UPDATE SKIP LOCKED "
                "   LIMIT 1 "
                ") "
                "RETURNING id, org_id, months, context, employees, templates, "
                "          effort, attempts, lease"
            ),
            {
                "running": RUNNING,
                "queued": QUEUED,
                "stale": float(settings.generation_stale_after_seconds),
                "max_attempts": settings.generation_max_attempts,
            },
        ).first()
        db.commit()
    except Exception:  # noqa: BLE001 - the loop tries again in a second
        db.rollback()
        log.exception("generation_queue: could not claim a job")
        return None
    finally:
        db.close()

    if row is None:
        return None
    return ClaimedJob(
        id=row[0],
        org_id=row[1],
        months=list(row[2] or []),
        context=row[3],
        employees=list(row[4] or []),
        templates=list(row[5] or []),
        effort=row[6],
        attempts=row[7],
        lease=row[8],
    )


def beat(org_id: uuid.UUID, job_id: uuid.UUID, lease: uuid.UUID) -> bool:
    """Say the worker is still alive. False when the job is no longer ours.

    Tenant session: the org is known by now. Fenced on the lease, so this is
    also the question "do I still own this?" -- a worker whose heartbeat could
    not reach the database (a saturated pool is enough) is declared stale and
    replaced, and it needs to find that out rather than keep writing.

    A failure to WRITE is reported as lost too: from here, "the update matched
    no rows" and "the update could not be made" have the same consequence, and
    assuming ownership we cannot confirm is how two workers end up finishing the
    same job.
    """
    return (
        _own_session_update(
            org_id,
            "UPDATE generation_job SET heartbeat_at = now() "
            "WHERE id = :id AND lease = :lease",
            {"id": job_id, "lease": lease},
            "beat",
        )
        == 1
    )


def record_month(
    org_id: uuid.UUID,
    job_id: uuid.UUID,
    month: str,
    shifts: Optional[list],
    lease: Optional[uuid.UUID] = None,
) -> None:
    """Persist one month THE MOMENT it comes back. `None` means it failed.

    This is the whole point of the queue, so it gets its own session and its own
    transaction: a month that is written has been billed, and holding it until
    its siblings are done is exactly the loss this replaces.

    FENCED on the lease: the insert happens only while this worker still owns
    the job, so a worker that was replaced cannot add months to a job somebody
    else is finishing. (`lease=None` is for callers that are not a worker --
    tests seeding a month, and nothing else.)

    ON CONFLICT: a month already stored as `planned` is never overwritten -- a
    resumed job must not contradict something the manager may already be looking
    at. A month stored as FAILED, though, is promoted if a later attempt manages
    to write it: the alternative is throwing away a month that was paid for
    because an earlier attempt timed out on it.
    """
    from app.db import AppSessionLocal, set_current_org

    import json

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        db.execute(
            text(
                "INSERT INTO generation_month "
                "  (org_id, job_id, month, status, shifts) "
                "SELECT :org, :job, :month, :status, CAST(:shifts AS jsonb) "
                " WHERE CAST(:lease AS uuid) IS NULL OR EXISTS ("
                "   SELECT 1 FROM generation_job "
                "    WHERE id = :job AND lease = CAST(:lease AS uuid)) "
                "ON CONFLICT ON CONSTRAINT uq_generation_month_job_month "
                "DO UPDATE SET status = excluded.status, shifts = excluded.shifts "
                " WHERE generation_month.status = :failed "
                "   AND excluded.status = :planned"
            ),
            {
                "org": org_id,
                "job": job_id,
                "month": month,
                "status": PLANNED if shifts is not None else MONTH_FAILED,
                "shifts": json.dumps(shifts if shifts is not None else []),
                "lease": lease,
                "failed": MONTH_FAILED,
                "planned": PLANNED,
            },
        )
        db.commit()
    except Exception:  # noqa: BLE001 - a month we cannot store is not an outage
        db.rollback()
        log.exception(
            "generation_queue: could not record month %s of job %s", month, job_id
        )
    finally:
        db.close()


def months_recorded(org_id: uuid.UUID, job_id: uuid.UUID) -> List[str]:
    """Which months of this job are already on disk.

    Read by a resumed job so a redeploy does not buy October twice.
    """
    from app.db import AppSessionLocal, set_current_org

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        return list(
            db.execute(
                select(GenerationMonth.month).where(
                    GenerationMonth.job_id == job_id
                )
            ).scalars()
        )
    except Exception:  # noqa: BLE001
        log.exception("generation_queue: could not read months of job %s", job_id)
        return []
    finally:
        db.close()


def finish(
    org_id: uuid.UUID,
    job_id: uuid.UUID,
    *,
    lease: Optional[uuid.UUID] = None,
    error_code: Optional[str] = None,
) -> None:
    """Close the job. `error_code` set means it failed as a whole.

    A job whose months merely failed is DONE, not failed: the client covers a
    missing month with its own deterministic pass, which is what it did before
    any of this existed. `failed` is reserved for "there is no answer coming".

    FENCED: a worker that lost the job cannot close it. Without that, the worker
    that was replaced marks `done` a calendar its replacement is still writing,
    the browser stops polling, and a half-planned year is adopted as finished.
    """
    _own_session_update(
        org_id,
        "UPDATE generation_job SET status = :status, error_code = :code, "
        "finished_at = now(), heartbeat_at = now() "
        "WHERE id = :id AND (CAST(:lease AS uuid) IS NULL OR lease = CAST(:lease AS uuid))",
        {
            "id": job_id,
            "status": FAILED if error_code else DONE,
            "code": error_code,
            "lease": lease,
        },
        "finish",
    )


def _own_session_update(
    org_id: uuid.UUID, sql: str, params: dict, what: str
) -> int:
    """One short tenant transaction. Returns rows changed, -1 if it could not run.

    Never raises: a worker outlives its bookkeeping. It does REPORT, though --
    swallowing the outcome in silence is what let a worker believe it was still
    alive when the database had never heard from it.
    """
    from app.db import AppSessionLocal, set_current_org

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        changed = db.execute(text(sql), params).rowcount
        db.commit()
        return changed or 0
    except Exception:  # noqa: BLE001
        db.rollback()
        log.exception("generation_queue: could not %s job %s", what, params.get("id"))
        return -1
    finally:
        db.close()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
