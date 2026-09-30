from __future__ import annotations

"""business profile: what the manager answered when we asked

Revision ID: 0011_declared_requirements
Revises: 0010_business_objective
Create Date: 2026-09-04

One nullable JSONB column on ``business_profile``.

It holds the answers to questions this product asked -- the fourth thing that
can decide a requirement, and the only one that was missing. Until now anything
a manager said AFTER the brief went through the learning layer, which waits for
three separate days of evidence before it believes a correction. That patience
is right for a correction ("whoever fixed a Friday had a bad Friday, not a
policy") and wrong for a direct answer: asking "what hours do you keep on
Saturdays?" and then ignoring the reply for three days is not caution, it is
not listening.

So a declaration applies immediately, outranks anything learned, and is still
outranked by the brief -- the brief is the most recent and most explicit thing
the manager has written, and if a later one disagrees, it wins.

NULL is meaningful and is the default: nobody has answered anything. Every org
that predates this migration keeps the behaviour it has today, with no backfill
and no invented answers.

Additive and idempotent, like 0007: ``ADD COLUMN IF NOT EXISTS`` only, no
backfill, and no touch to the row-level security already on the table.
"""

from alembic import op

revision = "0011_declared_requirements"
down_revision = "0010_business_objective"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS declared jsonb",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS declared",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
