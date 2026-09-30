from __future__ import annotations

"""business profile: what this business wants a calendar to optimise for

Revision ID: 0010_business_objective
Revises: 0009_first_run_pending
Create Date: 2026-09-04

One nullable text column on ``business_profile``, and the interesting thing
about it is what it does NOT hold.

The generator has always scored its choices with fifteen weights -- how much the
wage bill matters, how hard to spread hours, how far to bend a contract before
leaving an hour uncovered. They were named and pulled into a `SchedulingObjective`
last week, and then nothing wrote one: a bar squeezing its margin and a clinic
that needs a predictable rota got the same compromise, decided by constants
somebody typed once. A dial, fitted and not connected.

This column connects it, and stores a CODE -- "cheapest", "fair", "familiar",
"protective" -- rather than the numbers behind it. Fifteen floats per tenant
would have meant two places in the product able to disagree about what a good
calendar is, and the one that would win the argument is the one that has never
run a schedule. It would also freeze every business on the tuning that happened
to be current the day they chose, where a code means retuning a profile improves
everybody who picked it.

NULL is the default and means nobody has chosen. The client then leaves the
spec's ``objective`` unset, the generator reads the constants it always read,
and the calendar is the one that business already has -- pinned, assignment by
assignment, by objective.identity in the frontend. So this migration changes no
existing rota, which is the whole reason the column is nullable instead of
defaulted to a profile somebody would have had to pick on the tenant's behalf.

Additive and idempotent, like 0007, 0008 and 0009: ``ADD COLUMN IF NOT EXISTS``,
no backfill, no touch to the row-level security already on the table.
"""

from alembic import op

revision = "0010_business_objective"
down_revision = "0009_first_run_pending"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS objective text",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS objective",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
