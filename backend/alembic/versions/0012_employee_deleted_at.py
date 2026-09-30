from __future__ import annotations

"""employee: removed from the roster, not erased from the database

Revision ID: 0012_employee_deleted_at
Revises: 0011_declared_requirements
Create Date: 2026-09-04

One nullable timestamp on ``employee``, and the whole point of it is that
removing somebody stops being irreversible.

``DELETE /employees/{id}`` used to run ``db.delete(employee)``. Postgres then
did what the foreign keys told it to: the person's contracts, absences,
vacation-ledger movements and every published shift they had went with them
(ON DELETE CASCADE), and their login was cut loose (ON DELETE SET NULL). A
mis-tap on a small grey button in the last column destroyed a year of payroll
history, and the only recovery was a backup. Confirming beforehand was the
defence, and a confirmation dialog is a defence people learn to dismiss.

So the row stays and this column records when it stopped counting. NULL means
"still on the roster", which is why:

* Nothing is backfilled and nothing is invented. Every organization that
  predates this migration reads NULL on every row and behaves exactly as it did
  yesterday -- same roster, same numbering, same back-office metrics.
* The column is nullable rather than a boolean with a default: "when" is a fact
  worth having and "false" is not. Undoing writes NULL back, which is the same
  value the row was born with, so a restored employee is indistinguishable from
  one that was never removed.

The price is paid on the read side, not here: every query that lists or resolves
an employee now has to say ``deleted_at IS NULL``, and one that forgets shows a
removed person in a rota or counts them in a metric an operator reads. That is
why the predicate lives in exactly one place in the code
(``app.services.employees.LIVE``) instead of being spelled out per call site.

The index is partial for the same reason: every roster read is "this org, still
here", so the removed rows have no business being in it.

Additive and idempotent, like 0009 and 0011: ``ADD COLUMN IF NOT EXISTS``, no
backfill, and no touch to the row-level security already on the table -- the
org_isolation policy keeps applying unchanged, and this filter is added to it,
never in place of it.
"""

from alembic import op

revision = "0012_employee_deleted_at"
down_revision = "0011_declared_requirements"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE employee ADD COLUMN IF NOT EXISTS deleted_at timestamptz",
    (
        "CREATE INDEX IF NOT EXISTS ix_employee_org_live "
        "ON employee(org_id) WHERE deleted_at IS NULL"
    ),
]

DOWNGRADE_STATEMENTS = [
    "DROP INDEX IF EXISTS ix_employee_org_live",
    "ALTER TABLE employee DROP COLUMN IF EXISTS deleted_at",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    # Dropping the column brings the removed people back onto the roster rather
    # than deleting them, which is the safe direction: a downgrade must not
    # destroy rows that the upgrade deliberately kept.
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
