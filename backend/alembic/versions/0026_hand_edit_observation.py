from __future__ import annotations

"""hand_edit_observation: what the manager did to our calendar before publishing it

Revision ID: 0026_hand_edit_observation
Revises: 0025_premiums_per_contract
Create Date: 2026-09-22

WHAT WAS MISSING. The adaptive layer learns from two things a manager does:
the adjustments they ASK for in a sentence (`refine_observation`) and the rules
they STATE in passing (`learned_hint` rows under `stated:`). It learned nothing
from the thing they do most -- dragging, deleting and reassigning the shifts
the model proposed, and then pressing publish. A manager who takes the
planner's extra Monday-morning shift out every single month was teaching us
something every month, and we were not listening.

WHAT THIS IS. The evidence trail for that, and nothing more. One row says:
"when this job's calendar was published for the period starting on this day,
the manager's retouches showed this pattern". The proposal a manager confirms
still lives in `learned_hint`, written inactive by `services/hand_edits.py`
only once the same pattern has been seen on `MIN_EVIDENCE` different days --
so nothing in this table can ever change a rota on its own.

WHY A TABLE AND NOT A COUNTER ON `learned_hint`. Because a counter cannot tell
a new piece of evidence from the same one seen twice. Managers republish: they
publish October, notice a typo, fix it and publish October again the next
morning. Counting that as a second day would let one retouched calendar
manufacture a belief -- exactly what `evidence_days` was designed against. The
unique key below makes the unit of evidence one (job, period), and the count
that matters is DISTINCT `observed_on` over those rows.

WHAT IS DELIBERATELY NOT HERE. No names, no hours worked, no pay, no absence.
The one pattern that is about a person ("keeps X off nights") carries a
one-way hash of the employee id salted with the org, not the id and never the
name: the name is read from the roster only at the moment a proposal is written
for the manager to confirm, which is the only place it is allowed to appear.

`job_id` is a plain uuid, not a foreign key. A generation job may be cleaned
up one day; the fact that its calendar was retouched does not stop being
evidence when it is.
"""

from alembic import op

revision = "0026_hand_edit_observation"
down_revision = "0025_premiums_per_contract"
branch_labels = None
depends_on = None

TABLE = "hand_edit_observation"

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS hand_edit_observation (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        -- The identity of the claim, the same string the proposal will carry
        -- in `learned_hint.key` once it has earned one.
        key text NOT NULL,
        job_id uuid NOT NULL,
        period_start date NOT NULL,
        -- The business day the publication happened on. Evidence is counted
        -- in distinct values of this, never in rows.
        observed_on date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_hand_edit_observation_once
            UNIQUE (org_id, key, job_id, period_start)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_hand_edit_observation_org_key "
    "ON hand_edit_observation(org_id, key)",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)
    op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % TABLE)
    op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % TABLE)
    # Dropped first so a re-run replaces the policy instead of failing on a
    # duplicate name.
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
    op.execute("DROP TABLE IF EXISTS %s CASCADE" % TABLE)
