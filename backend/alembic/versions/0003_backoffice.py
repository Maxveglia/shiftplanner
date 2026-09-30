from __future__ import annotations

"""back office: subscriptions, platform admins, last-seen signal

Revision ID: 0002_backoffice
Revises: 0001_initial
Create Date: 2026-08-31

Adds the three things the platform operator's view needs and the tenant app
does not have:

* ``subscription`` -- one row per organization, carrying the plan and the
  lifecycle status. This is what makes "paying customer" a fact rather than an
  inference. RLS is enabled with the same org-isolation policy as every other
  tenant table, but ``app_user`` is granted **SELECT only**: a customer may
  eventually see which plan they are on, and may never change it.
* ``platform_admin`` -- the operator's login. Granted to nobody. The runtime
  role cannot read this table at all, so a bug in the tenant API cannot reach
  the credentials that unlock every tenant.
* ``user_account.last_seen_at`` -- the difference between a customer who pays
  and a customer who is still there.

The backfill dates each existing organization's trial from its own signup, not
from today, so a company that registered three months ago is reported as a
lapsed trial rather than a fresh one.
"""

from alembic import op

revision = "0003_backoffice"
# Chained after the employee view: both were written against 0001 in
# parallel branches, and Alembic will not upgrade with two heads.
down_revision = "0002_employee_view"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    # --- Commercial state, one row per organization -------------------------
    """
    CREATE TABLE subscription (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL UNIQUE REFERENCES organization(id) ON DELETE CASCADE,
        plan text NOT NULL DEFAULT 'trial',
        status text NOT NULL DEFAULT 'trialing',
        seats integer,
        trial_ends_at date,
        activated_at timestamptz,
        canceled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX ix_subscription_status ON subscription(status)",
    "CREATE INDEX ix_subscription_plan ON subscription(plan)",
    # --- The operator's own identity ----------------------------------------
    """
    CREATE TABLE platform_admin (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email text NOT NULL UNIQUE,
        hashed_password text NOT NULL,
        full_name text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    # --- Usage signal -------------------------------------------------------
    "ALTER TABLE user_account ADD COLUMN last_seen_at timestamptz",
    "CREATE INDEX ix_user_account_last_seen_at ON user_account(last_seen_at)",
    # --- Backfill: every existing org becomes a trialing customer -----------
    """
    INSERT INTO subscription (org_id, plan, status, trial_ends_at)
    SELECT o.id, 'trial', 'trialing', (o.created_at::date + INTERVAL '14 days')::date
    FROM organization o
    WHERE NOT EXISTS (SELECT 1 FROM subscription s WHERE s.org_id = o.id)
    """,
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)

    # subscription is tenant data, so it gets the same RLS barrier as the rest
    # -- but read-only for the runtime role. The back office writes it through
    # the superuser session; the tenant app never can.
    op.execute("ALTER TABLE subscription ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE subscription FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY org_isolation ON subscription "
        "USING (org_id = current_setting('app.current_org_id', true)::uuid) "
        "WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid)"
    )
    op.execute("GRANT SELECT ON subscription TO app_user")

    # platform_admin: no GRANT at all. app_user is NOSUPERUSER, so the absence
    # of a grant is the whole protection -- there is nothing to bypass.


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS org_isolation ON subscription")
    op.execute("DROP INDEX IF EXISTS ix_user_account_last_seen_at")
    op.execute("ALTER TABLE user_account DROP COLUMN IF EXISTS last_seen_at")
    op.execute("DROP TABLE IF EXISTS platform_admin CASCADE")
    op.execute("DROP TABLE IF EXISTS subscription CASCADE")
