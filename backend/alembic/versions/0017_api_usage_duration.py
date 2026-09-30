from __future__ import annotations

"""api_usage: how long the call took, not just what it cost

Revision ID: 0017_api_usage_duration
Revises: 0016_draft_no_overlap
Create Date: 2026-09-14

The meter has counted tokens since 0014 and has never once counted seconds.
That gap has a cost: on 14-sep-2026 every month of a quarter failed together
with APITimeoutError and the only evidence of how slow the calls had become
was in the application log, which is rotated and is not per-organization. A
customer whose prompts take twice as long as everybody else's is a support
question, a capacity question and eventually a pricing question, and none of
them could be asked of this table.

One nullable integer, milliseconds, measured in the service around the SDK
call. NULLABLE and not ``DEFAULT 0``: every row written before today has no
answer, and a zero would read as a call that returned instantly -- which is
exactly the wrong thing for a column whose whole job is to make slow calls
visible. The back office averages over the rows that HAVE a number.

No index. The questions asked of this column are averages over one customer's
recent rows, which the existing ``(org_id, created_at DESC)`` index already
narrows down to a handful.
"""

from alembic import op

revision = "0017_api_usage_duration"
down_revision = "0016_draft_no_overlap"
branch_labels = None
depends_on = None

UPGRADE_STATEMENTS = [
    "ALTER TABLE api_usage ADD COLUMN IF NOT EXISTS duration_ms integer",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE api_usage DROP COLUMN IF EXISTS duration_ms",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
