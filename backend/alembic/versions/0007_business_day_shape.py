from __future__ import annotations

"""business profile: where the day ends and which days are the weekend

Revision ID: 0007_business_day_shape
Revises: 0006_backfill_missing_contracts
Create Date: 2026-09-03

Two columns on ``business_profile``, both nullable.

They exist because "the weekend is Saturday and Sunday" and "a day ends at
midnight" were not settings but literals -- written into four different files,
one of which decides what people are paid. A bar that opens at six in the
evening and closes at four in the morning could not describe either fact, so it
lost the Friday night it staffs hardest and paid a weekend premium for the
Sunday it barely opens.

NULL is meaningful here and is the default on purpose: it means nobody has been
asked yet, and every reader falls back to the behaviour that shipped before this
migration. That keeps the upgrade silent for every existing tenant, and leaves
room for the next step, where a vertical PROPOSES values a manager can accept --
which requires telling "confirmed as Saturday and Sunday" apart from "never
discussed".

Additive and idempotent, like 0005: ``ADD COLUMN IF NOT EXISTS`` only, no
backfill, and no touch to the row-level security already on the table.
"""

from alembic import op

revision = "0007_business_day_shape"
down_revision = "0006_backfill_missing_contracts"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE business_profile "
    "ADD COLUMN IF NOT EXISTS day_boundary_min integer",
    "ALTER TABLE business_profile "
    "ADD COLUMN IF NOT EXISTS weekend_days jsonb",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS weekend_days",
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS day_boundary_min",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
