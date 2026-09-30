from __future__ import annotations

"""api_usage: what each organization costs us in model calls

Revision ID: 0014_api_usage
Revises: 0013_business_research
Create Date: 2026-09-10

One row per paid model call, keyed by organization. See
``app/models/api_usage.py`` for what the table is and is not.

Row level security like every other tenant table: a manager's session can
only ever read or write its own organization's rows. The back office reads
across organizations through the admin engine, which RLS does not apply to.

``created_at`` is indexed with ``org_id`` because every question asked of this
table is "this customer, this period".
"""

from alembic import op

revision = "0014_api_usage"
down_revision = "0013_business_research"
branch_labels = None
depends_on = None

TABLE = "api_usage"

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS api_usage (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        request_id uuid NOT NULL,
        purpose text NOT NULL,
        model text NOT NULL,
        input_tokens integer NOT NULL DEFAULT 0,
        output_tokens integer NOT NULL DEFAULT 0,
        cache_creation_input_tokens integer NOT NULL DEFAULT 0,
        cache_read_input_tokens integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_api_usage_org_created "
    "ON api_usage(org_id, created_at DESC)",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)
    op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % TABLE)
    op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % TABLE)
    op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % TABLE)
    op.execute(
        "CREATE POLICY org_isolation ON %(t)s "
        "USING (org_id = current_setting('app.current_org_id', true)::uuid) "
        "WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid)"
        % {"t": TABLE}
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user" % TABLE)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % TABLE)
    op.execute("DROP TABLE IF EXISTS api_usage CASCADE")
