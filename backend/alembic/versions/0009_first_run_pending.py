from __future__ import annotations

"""business profile: whether this org still owes us its first answers

Revision ID: 0009_first_run_pending
Revises: 0008_shift_template_seed_key
Create Date: 2026-09-03

One boolean on ``business_profile``, and the interesting thing about it is the
DEFAULT.

Signup creates an organization, seeds it, and drops the manager in front of an
empty textarea having asked him nothing. The first-run questions change that,
which means something has to remember whether an org has already been through
them -- ask twice and the product looks like it forgets, ask never and the
questions do not exist.

Where to put that: here, beside ``vertical``, ``day_boundary_min`` and
``weekend_days``, because it is the same kind of fact -- something about THIS
business that a human either did or did not tell us. It is not a user
preference (a second manager on the same org must not be asked again about
hours the first one already gave) and it is not a learned hint (nothing is
inferred from it and nothing decays).

DEFAULT false, and PENDING rather than DONE, so that the default reproduces
today's behaviour exactly:

* Every org that already exists keeps false and is never interrupted. No
  backfill, and -- more to the point -- no timestamp invented for a flow those
  managers never saw. A ``first_run_done_at`` column would have had to be
  back-dated with a lie in order to leave them alone.
* ``business_profile`` rows are created lazily by ``get_or_create``, so an org
  that predates 0005 gets its row the first time anyone reads its profile. That
  row also comes out false, which is right: the org is not new.
* Only ``auth.signup`` ever sets it true. Being asked is opt-in, from the one
  place that knows an account is genuinely new.

Additive and idempotent, like 0007 and 0008: ``ADD COLUMN IF NOT EXISTS``, no
backfill, no touch to the row-level security already on the table.
"""

from alembic import op

revision = "0009_first_run_pending"
down_revision = "0008_shift_template_seed_key"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE business_profile "
    "ADD COLUMN IF NOT EXISTS first_run_pending boolean NOT NULL DEFAULT false",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS first_run_pending",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
