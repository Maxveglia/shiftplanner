from __future__ import annotations

"""login_attempt: a password may be guessed five times, not five million

Revision ID: 0023_login_attempt
Revises: 0022_overtime_over_contract
Create Date: 2026-09-19

Both logins -- the manager's and the platform operator's -- verified a password
and answered, with nothing anywhere counting how often they were asked. There
was no limiter, no backoff and no lockout: a leaked password list could be
worked through an account at whatever rate the network allowed. The back office
was the same door with every customer on the platform behind it.

WHY THE COUNTER IS A TABLE. A counter in the process is reset by every deploy,
and this product deploys from `main` several times a day, so "five guesses per
fifteen minutes" would quietly mean "five guesses per deploy". It would also be
wrong the day Railway runs two replicas, because two processes each counting to
five is ten. Postgres is already here, already the thing that survives a
restart, and a row per refused password is a few hundred bytes for fifteen
minutes. The in-memory cache in `services/login_guard.py` sits in FRONT of this
table as an optimisation; this is what it is an optimisation OF.

WHY THERE IS NO org_id AND NO RLS. A login happens before anyone knows which
organization is being logged into -- that is exactly why both routes run on the
superuser session -- so there is no tenant to isolate by and an `org_isolation`
policy would have nothing to read. Rows here are not a customer's data; they
are the doorbell.

WHY THERE IS NO GRANT EITHER, AND WHY THAT IS SPELT OUT. Same judgement
`0003_backoffice` made for `platform_admin`, and for the same reason.
`subscription` in that migration is tenant data a customer may one day be
shown, so it is granted SELECT and fenced with a policy. `platform_admin` is
granted to nobody, because `app_user` is NOSUPERUSER and there is then nothing
to bypass. This table is in the second group: it is written and read only by
the pre-tenant auth layer on `get_admin_db`, no runtime path has any business
reading who has been trying to get in, and a table the restricted role cannot
reach at all is a table a bug in the tenant API cannot turn into a list of
which addresses have accounts.

The difference is that this one says so out loud, with a REVOKE. Writing no
GRANT is not the same as having no grant: `infra/initdb/01-app-role.sql` sets
`ALTER DEFAULT PRIVILEGES ... GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO
app_user`, so in any database initialised by that script -- the compose stack,
and any local one set up the same way -- every table Alembic creates arrives
already granted, and the protection that reads as deliberate in 0003 is only
true where nobody ran that line. (It is not true of `platform_admin` in the
compose stack today; that is worth its own change and is not this one.) A
security property that depends on which environment you are in is not a
security property, so it is stated here rather than assumed.

The three indexes are the three questions asked of it: how many failures for
this email lately, how many from this address lately, and what is old enough to
delete (every failure prunes, so the table is a sliding fifteen minutes and
never a log).

Reversible, and nothing is lost by reversing it: the only thing in here is
fifteen minutes of doorbell.
"""

from alembic import op

revision = "0023_login_attempt"
down_revision = "0022_overtime_over_contract"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    # `scope` is text rather than an enum for the same reason the rest of this
    # schema avoids them: 'tenant' | 'platform' today, and a third front door
    # should not need a migration that rewrites a type.
    #
    # `identifier` is the email as knocked on -- trimmed and lowercased, never
    # resolved to an account, and deliberately not a foreign key. Counting only
    # the addresses we recognise would make a 429 mean "this address is real".
    """
    CREATE TABLE IF NOT EXISTS login_attempt (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scope text NOT NULL,
        identifier text NOT NULL,
        ip text,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_login_attempt_identifier "
    "ON login_attempt(scope, identifier, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_login_attempt_created_at "
    "ON login_attempt(created_at)",
    # Said rather than omitted. A default privilege granted when the cluster
    # was initialised would otherwise have handed this table to app_user the
    # moment it was created -- see the docstring. Harmless where no such
    # default exists, which is the point of writing it either way.
    "REVOKE ALL ON login_attempt FROM app_user",
    "REVOKE ALL ON login_attempt FROM PUBLIC",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)

    # No ENABLE ROW LEVEL SECURITY, on purpose: there is no tenant to isolate
    # by at a moment before anyone has logged in. The runtime role is kept out
    # by having no privilege at all, which is a barrier with nothing to bypass
    # rather than a policy with a hole to find.


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS login_attempt CASCADE")
