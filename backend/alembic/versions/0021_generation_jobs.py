from __future__ import annotations

"""generation_job / generation_month: a calendar the browser does not have to wait for

WHAT WAS WRONG. Planning a year was one HTTP request that ran for minutes.
The months were written by the model, billed by the provider, and held in the
memory of one request until all twelve were done -- so a manager who closed
the tab at minute four threw away work that had already been paid for. It
happened for real on 14-sep-2026: nine attempts were generated and discarded,
and the only trace was a quiet afternoon in `api_usage`.

WHAT THIS IS. A queue in the database we already have. The request writes a
job and returns; a worker in the same container picks it up and writes each
month into `generation_month` THE MOMENT that month comes back from the model.
The browser asks how it is going. Nothing that has been paid for is held
anywhere it can be lost by closing a window.

No Redis and no Celery: a broker, a second service and a third failure mode
for a few dozen jobs a day would be worse than the problem.

WHAT IS STORED IS A PROPOSAL, NOT A CALENDAR. `generation_month.shifts` is
exactly the JSON the old endpoint returned -- five fields per shift, camelCase,
no provenance and no guarantees. It is not a draft and it is not an
assignment: nothing in `assignment` is written from here, so a bad month is
still worth no more than the paper it is on. The client (and, from step 2, the
server's own judge) decides what of it may stand.

RLS, AND THE ONE THING THE WORKER DOES PRIVILEGED. Both tables carry `org_id`
and the usual `org_isolation` policy, so a manager reading their job reads it
through the same barrier as everything else. The worker is the exception it
cannot avoid: to ask "is there a job for anyone?" it does not yet know whose
org to set, and under RLS a query with no `app.current_org_id` matches nothing
at all. So the CLAIM -- one UPDATE of one row of this queue -- runs on the
superuser session, and everything after it runs as `app_user` with the org set
from the row it just claimed. The privileged statement reads no business data:
it reads the queue.
"""

from alembic import op

revision = "0021_generation_jobs"
down_revision = "0020_research_signals"
branch_labels = None
depends_on = None

TABLES = ("generation_month", "generation_job")  # child first, for the drop

UPGRADE_STATEMENTS = [
    # `status` is text rather than an enum for the same reason the rest of this
    # schema avoids them: adding a state should not need a migration that
    # rewrites a type. The states are queued | running | done | failed.
    #
    # `attempts` is what keeps a job that kills its worker from killing every
    # worker forever: a job whose heartbeat goes stale is picked up again, and
    # the second time it is abandoned rather than retried.
    """
    CREATE TABLE IF NOT EXISTS generation_job (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'queued',
        effort text NOT NULL,
        months jsonb NOT NULL,
        context text NOT NULL,
        employees jsonb NOT NULL DEFAULT '[]'::jsonb,
        templates jsonb NOT NULL DEFAULT '[]'::jsonb,
        attempts integer NOT NULL DEFAULT 0,
        -- Who owns the job RIGHT NOW. Generated fresh by every claim, so a
        -- worker that has been declared stale and replaced cannot go on writing
        -- into the job it lost: every write it makes names its own lease and
        -- matches no rows.
        --
        -- Without this, a worker whose heartbeat failed to reach the database
        -- (a saturated pool is enough) is declared abandoned while it is still
        -- writing, a second worker resumes the job, and then the FIRST one
        -- finishes it -- marking `done` a calendar that is still half written,
        -- while the client stops polling and adopts it. Fencing is what makes
        -- "resume an abandoned job" safe at all.
        lease uuid,
        error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        finished_at timestamptz,
        heartbeat_at timestamptz
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_generation_job_org_created "
    "ON generation_job(org_id, created_at DESC)",
    # What the claim orders by. Without it every poll of an idle queue is a
    # sequential scan of every job this product has ever run.
    "CREATE INDEX IF NOT EXISTS ix_generation_job_claim "
    "ON generation_job(status, created_at)",
    # One calendar in flight per organisation, as a CONSTRAINT.
    #
    # It was a read-then-write in the router: look for an active job, and insert
    # if there is none. Two requests a few milliseconds apart -- a double click,
    # two tabs reloading together -- both read "none" and both insert, and the
    # same twelve months are bought twice. That is exactly the cost the check
    # was there to avoid, so the database has to be the one enforcing it.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_generation_job_one_per_org
    ON generation_job(org_id)
    WHERE status IN ('queued', 'running')
    """,
    # One row per month of a job. `org_id` is carried rather than joined so the
    # policy can be the same one every other tenant table has.
    #
    # UNIQUE (job_id, month) is the whole retry story: a worker that dies after
    # writing October and before writing November is picked up again, and
    # October is written once.
    """
    CREATE TABLE IF NOT EXISTS generation_month (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        job_id uuid NOT NULL REFERENCES generation_job(id) ON DELETE CASCADE,
        month text NOT NULL,
        status text NOT NULL,
        shifts jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_generation_month_job_month UNIQUE (job_id, month)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_generation_month_job "
    "ON generation_month(job_id)",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)
    for table in TABLES:
        op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % table)
        op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % table)
        # Dropped first so a re-run replaces the policy instead of failing on a
        # duplicate name.
        op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % table)
        op.execute(
            "CREATE POLICY org_isolation ON %(t)s "
            "USING (org_id = current_setting('app.current_org_id', true)::uuid) "
            "WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid)"
            % {"t": table}
        )
        op.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user" % table
        )


def downgrade() -> None:
    for table in TABLES:
        op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % table)
        op.execute("DROP TABLE IF EXISTS %s CASCADE" % table)
