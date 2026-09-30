from __future__ import annotations

"""The thing that plans a calendar while nobody is waiting for it.

WHERE IT RUNS. In this container, as background threads started by the app's
lifespan -- not a second Railway service. One service is what this product is
(the image builds the frontend and the API serves it), and a worker that ships
with the app cannot be at a different commit than the schema it writes. It is
worth moving out later, when generation starts competing with requests for
memory: the queue it reads is already shaped for that, since `FOR UPDATE SKIP
LOCKED` does not care how many containers are asking.

WHAT IT IS CAREFUL ABOUT, and why each one is here:

**Short transactions.** The model holds a thread for minutes. Every read this
needs happens in its own session, which is CLOSED before the call starts --
the mistake this whole change exists to undo was a request that held a pooled
connection, and a Postgres transaction, for the duration of a generation.

**A heartbeat.** Written on its own timer while the model works, because a
month can take minutes and silence has to mean something. Without it, "the
container was redeployed" and "October is still being written" look identical,
and one of them needs another worker to pick the job up.

**Resuming, not restarting.** A job that is claimed a second time plans only
the months that are not on disk yet. October is not bought twice.

**Nothing published, nothing drafted.** What it writes is a PROPOSAL, in
`generation_month`. No row of `assignment` is touched here: the judgement of
what may stand -- against availability, rest, contracts, opening hours -- still
happens where it happened before, and publishing is still the manager's act.
"""

import logging
import threading
from typing import List, Optional

from app.config import settings
from app.errors import ai_failure
from app.services import api_usage
from app.services import business_profile as bp
from app.services import day_insights
from app.services import employees as employees_svc
from app.services import generation_queue as queue
from app.services import planner_notes
from app.services.calendar_plan import plan_calendar

log = logging.getLogger(__name__)

# How often an idle worker asks the queue whether anything arrived. Two seconds
# is a compromise between a manager watching a progress panel and a database
# being asked a question with no answer: the claim is one indexed statement.
POLL_SECONDS = 2.0

# How often the worker says it is still alive while the model writes. Well
# inside `generation_stale_after_seconds`, so a live worker is never mistaken
# for a dead one on a slow month.
HEARTBEAT_SECONDS = 60.0

# What the job's error_code says when the server has no key at all. The client
# reads this and falls back to its own deterministic generator -- the same thing
# it has always done with the 503 from the synchronous endpoint.
NO_KEY = "anthropic_key_missing"
OVER_BUDGET = "org_budget_spent"


def work_once() -> bool:
    """Reap, claim, and plan one job. True if a job was worked on.

    Reaping first is what keeps a job that kills its worker from killing every
    worker in turn: by the time it has been picked up `generation_max_attempts`
    times it is failed rather than offered again.
    """
    queue.reap_abandoned()
    job = queue.claim()
    if job is None:
        return False
    plan_one(job)
    return True


def plan_one(job: queue.ClaimedJob) -> None:
    """Plan the months of one claimed job, writing each as it arrives."""
    if not settings.anthropic_api_key:
        # Nothing to ask and nothing to wait for. Failing the job immediately
        # is kinder than leaving it queued: the client can fall back to its own
        # generator the moment it reads this.
        queue.finish(job.org_id, job.id, lease=job.lease, error_code=NO_KEY)
        return

    remaining = _months_left(job)
    if not remaining:
        queue.finish(job.org_id, job.id, lease=job.lease)
        return

    try:
        preferences = _preferences(job.org_id)
    except Exception:  # noqa: BLE001 - a profile we cannot read is not a stop
        log.exception("generation: could not read the profile of org %s", job.org_id)
        preferences = ""

    if _over_budget(job.org_id):
        queue.finish(job.org_id, job.id, lease=job.lease, error_code=OVER_BUDGET)
        return

    # The roster's names, so `plan_calendar` can take them out of the context
    # this job has been carrying since the browser wrote it. Read HERE and not
    # stored on the job: the row keeps the manager's context verbatim, which is
    # ours to keep, and the redaction happens once, at the edge, next to the
    # call that leaves the building.
    names = _employee_names(job.org_id)

    stop_beating, lost = _start_heartbeat(job)
    error_code: Optional[str] = None
    try:
        with api_usage.collect() as ledger:
            try:
                plan_calendar(
                    job.context,
                    remaining,
                    settings.anthropic_api_key,
                    preferences,
                    job.employees,
                    job.templates,
                    names,
                    job.effort,
                    on_month=lambda month, shifts: queue.record_month(
                        job.org_id,
                        job.id,
                        month,
                        None if shifts is None else _as_json(shifts),
                        job.lease,
                    ),
                )
            except Exception as exc:  # noqa: BLE001 - the job carries the reason
                # The cause, read from the vendor's own words, exactly as the
                # synchronous endpoint reported it: "the account is out of
                # credit" and "something went wrong" need different people to
                # do different things.
                error_code = ai_failure(exc, "plan_failed", str(exc))["code"]
                log.exception("generation: job %s failed", job.id)
            finally:
                api_usage.record(job.org_id, ledger)
    finally:
        stop_beating.set()

    if lost.is_set():
        # Somebody else owns this job now -- our heartbeat stopped landing and it
        # was resumed. Closing it would mark `done` a calendar its new owner is
        # still writing, and the browser would stop polling and adopt it. The
        # fencing in `finish` would refuse us anyway; not asking is how we avoid
        # pretending otherwise in the log.
        log.warning(
            "generation: job %s was taken over while we worked on it; leaving "
            "it to its new owner",
            job.id,
        )
        return

    queue.finish(job.org_id, job.id, lease=job.lease, error_code=error_code)


def _months_left(job: queue.ClaimedJob) -> List[str]:
    """The months of this job that are not on disk yet.

    Only interesting on a second attempt -- a redeploy mid-generation -- and
    that is exactly when buying a month twice would be unforgivable.
    """
    if job.attempts <= 1:
        return list(job.months)
    already = set(queue.months_recorded(job.org_id, job.id))
    left = [m for m in job.months if m not in already]
    if already:
        log.info(
            "generation: job %s resumed, %d month(s) already stored",
            job.id,
            len(already),
        )
    return left


def _preferences(org_id) -> str:
    """What this business prefers, in its own short transaction.

    Opened and CLOSED before the model is called. Holding it would put the
    worker back into the shape this change removed from the request.
    """
    from app.db import AppSessionLocal, set_current_org

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        profile = bp.get_or_create(db, org_id)
        preferences = bp.planning_context(
            profile,
            bp.hints_for(db, org_id),
            planner_notes.business_notes(db, org_id, profile),
            day_insights.context_lines(db, org_id),
        )
        db.commit()
        return preferences
    finally:
        db.close()


def _employee_names(org_id) -> dict:
    """Employee id -> full name, in its own short transaction.

    Never fatal. A roster we could not read means the names in this job's
    context are not masked, which is the behaviour this worker had before the
    masking existed -- a calendar nobody gets is worse. It is logged loudly
    because it is a privacy regression for that one job, not a slow day.
    """
    from app.db import AppSessionLocal, set_current_org

    try:
        db = AppSessionLocal()
        try:
            set_current_org(db, org_id)
            names = employees_svc.names_by_id(db, org_id)
            db.commit()
            return names
        finally:
            db.close()
    except Exception:  # noqa: BLE001 - see the docstring
        log.exception(
            "generation: could not read the roster of org %s; the planning "
            "context goes out with whatever names it carries",
            org_id,
        )
        return {}


def _over_budget(org_id) -> bool:
    """Checked again here, not only when the job was queued.

    Minutes can pass between the two, and another job of the same organisation
    can spend the difference. Only refuses when enforcement is on -- see
    `api_budget_enforced`.
    """
    if not settings.api_budget_enforced:
        return False
    from app.db import AppSessionLocal, set_current_org

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        spent = api_usage.spent_usd_this_month(db, org_id)
        db.commit()
        return spent >= settings.api_budget_usd_per_month
    except Exception:  # noqa: BLE001 - a meter we cannot read does not refuse
        log.exception("generation: could not read the spend of org %s", org_id)
        return False
    finally:
        db.close()


def _as_json(shifts) -> list:
    """The proposal, in the shape the client already parses.

    The same five camelCase fields the synchronous endpoint returned, so the
    browser's parser did not have to learn anything for this change.
    """
    return [
        {
            "employeeId": s.employee_id,
            "date": s.date,
            "start": s.start,
            "end": s.end,
            **({"templateId": s.template_id} if s.template_id else {}),
        }
        for s in shifts
    ]


def _start_heartbeat(job: queue.ClaimedJob) -> tuple:
    """Say "still here" every minute. Returns (stop event, lost event).

    `lost` is set when the heartbeat stops landing -- because the job was
    resumed by somebody else, or because we could not reach the database to say
    otherwise. Both mean the same thing to us: we are no longer the owner, and
    everything we write from here on has to be refused rather than trusted.

    Its own thread on purpose: the model holds the calling thread for minutes,
    so a heartbeat written between months would be a heartbeat written every few
    minutes at best -- which is not a heartbeat.
    """
    stop = threading.Event()
    lost = threading.Event()

    def beat() -> None:
        while not stop.wait(HEARTBEAT_SECONDS):
            if not queue.beat(job.org_id, job.id, job.lease):
                log.warning(
                    "generation: lost the lease on job %s; stopping the "
                    "heartbeat",
                    job.id,
                )
                lost.set()
                return

    threading.Thread(
        target=beat, name="generation-heartbeat", daemon=True
    ).start()
    return stop, lost


def run_forever(stop: threading.Event, poll_seconds: float = POLL_SECONDS) -> None:
    """Take jobs until asked to stop.

    The backoff is not decoration. Without a database this loop would log an
    exception every two seconds -- which is most of the test suite, where
    Postgres is often absent -- so a failing queue is retried more and more
    slowly, and said once rather than forty times.
    """
    quiet_failures = 0
    while not stop.is_set():
        try:
            did_something = work_once()
            quiet_failures = 0
        except Exception:  # noqa: BLE001 - a worker outlives any one job
            if quiet_failures == 0:
                log.exception("generation: worker loop failed; backing off")
            quiet_failures += 1
            did_something = False

        if did_something:
            continue
        wait = poll_seconds
        if quiet_failures:
            wait = min(60.0, poll_seconds * (2 ** min(quiet_failures, 5)))
        stop.wait(wait)


def start(count: Optional[int] = None) -> tuple:
    """Start the workers. Returns (stop event, threads) for the lifespan.

    A job in flight when the process is asked to stop is NOT waited for: the
    container is going away and the row it holds goes stale, which is the case
    `claim` already knows how to resume. Blocking a redeploy for the minutes a
    month takes would be the worse trade.
    """
    workers = settings.generation_workers if count is None else count
    stop = threading.Event()
    threads = []
    for n in range(max(0, workers)):
        thread = threading.Thread(
            target=run_forever,
            args=(stop,),
            name="generation-worker-%d" % (n + 1),
            daemon=True,
        )
        thread.start()
        threads.append(thread)
    if threads:
        log.info("generation: %d worker(s) started", len(threads))
    return stop, threads
