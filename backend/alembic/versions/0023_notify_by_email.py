from __future__ import annotations

"""employee: whether this person wants their rota by email

Revision ID: 0023_notify_by_email
Revises: 0022_overtime_over_contract
Create Date: 2026-09-19

One boolean on ``employee``, so that the email a person gets when their shifts
change is something they agreed to keep receiving.

DEFAULT TRUE, which is the unusual direction for a notification preference and
is deliberate here. This is not marketing and it is not a digest: it is the
hours somebody is expected to turn up for, at a job they hold, sent by their
own employer. Defaulting it off would mean the first publication after this
ships reaches nobody, which is precisely the failure the channel exists to fix
-- and a manager who believes the team was told when it was not is worse off
than one who knows they have to phone round.

ON THE EMPLOYEE, not on the user account. It is a property of the person in
the roster, which is also what survives them losing their login and being
given a new one (`routers/accounts.py` revokes and recreates, which is today
the only way out of a forgotten password). A preference that reset every time
somebody was locked out would be a preference nobody could keep.

Additive and reversible: every employee that exists today starts wanting the
email, no rota changes, and nothing else reads the column.
"""

from alembic import op

revision = "0023_notify_by_email"
down_revision = "0022_overtime_over_contract"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE employee ADD COLUMN IF NOT EXISTS notify_by_email "
    "boolean NOT NULL DEFAULT true",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE employee DROP COLUMN IF EXISTS notify_by_email",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    # Dropping the column sends the rota to everybody again, which is the safe
    # direction for this one: somebody receives an email they had switched off,
    # rather than somebody missing the shift they are expected at.
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
