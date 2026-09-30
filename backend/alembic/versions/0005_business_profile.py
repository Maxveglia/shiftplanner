from __future__ import annotations

"""adaptive layer: business profile, learned hints, refine observations

Revision ID: 0005_business_profile
Revises: 0004_learned_preference
Create Date: 2026-09-03

Three tenant tables that let intake adapt to the business behind the account:

* ``business_profile`` -- one row per org, holding the vertical (bar, retail,
  clinic ...) and whether a human declared it or we inferred it.
* ``learned_hint`` -- what we believe about this org's staffing, derived from
  its own corrections, with the evidence count that earned the belief.
* ``refine_observation`` -- the corrections themselves, the audit trail a hint
  can be recomputed from.

WRITTEN TO TOLERATE OBJECTS THAT ALREADY EXIST. The production database was
stamped with a revision (``0004_learned_preference``) whose file was lost, and
whatever it created is still there -- see the bridge migration for the whole
story. None of the names below collide with it, which was the first line of
defence; ``IF NOT EXISTS`` on every create and ``DROP ... IF EXISTS`` before
every policy is the second. Running this twice, or against a database that
already carries some of it, is a no-op rather than a failed deploy.

RLS is the same org-isolation barrier every tenant table gets, and the runtime
role is granted full DML: unlike ``subscription``, this IS the customer's own
data -- they must be able to correct what we think we learned about them.
"""

from alembic import op

revision = "0005_business_profile"
down_revision = "0004_learned_preference"
branch_labels = None
depends_on = None


TABLES = ("business_profile", "learned_hint", "refine_observation")

UPGRADE_STATEMENTS = [
    # --- What kind of business this is --------------------------------------
    """
    CREATE TABLE IF NOT EXISTS business_profile (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL UNIQUE REFERENCES organization(id) ON DELETE CASCADE,
        vertical text,
        vertical_source text NOT NULL DEFAULT 'declared',
        house_notes text,
        learning_enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    # --- What we believe, and what earned the belief ------------------------
    """
    CREATE TABLE IF NOT EXISTS learned_hint (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        key text NOT NULL,
        value jsonb NOT NULL,
        evidence_days integer NOT NULL DEFAULT 0,
        contradictions integer NOT NULL DEFAULT 0,
        last_evidence_on date,
        rejected boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_learned_hint_org_key UNIQUE (org_id, key)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_learned_hint_org ON learned_hint(org_id)",
    # --- The audit trail ----------------------------------------------------
    """
    CREATE TABLE IF NOT EXISTS refine_observation (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        op text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_refine_observation_org_created "
    "ON refine_observation(org_id, created_at DESC)",
    # --- Every org gets a profile row, so intake never has to branch --------
    """
    INSERT INTO business_profile (org_id)
    SELECT o.id FROM organization o
    WHERE NOT EXISTS (
        SELECT 1 FROM business_profile b WHERE b.org_id = o.id
    )
    """,
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)

    for table in TABLES:
        op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % table)
        op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % table)
        # Dropped first so a re-run replaces the policy instead of failing on
        # a duplicate name.
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
    op.execute("DROP TABLE IF EXISTS refine_observation CASCADE")
    op.execute("DROP TABLE IF EXISTS learned_hint CASCADE")
    op.execute("DROP TABLE IF EXISTS business_profile CASCADE")
