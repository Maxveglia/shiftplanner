from __future__ import annotations

"""employee view: published shifts + pay period on the contract

Revision ID: 0002_employee_view
Revises: 0001_initial
Create Date: 2026-08-31

Three additions, all in service of the employee-facing view:

1. ``contract.pay_period`` -- how often this person is paid (weekly, biweekly,
   monthly). It lives on the CONTRACT, not on the employee, because it is part
   of what was agreed and is therefore versioned like every other term: change
   it and you get a new contract version, the old periods keep their history.

2. ``assignment.shift_template_id`` / ``unpaid_break_minutes`` -- the shift's
   identity and its unpaid break. Without the break we cannot reconstruct paid
   hours from the stored interval, and paid hours are what the employee is
   shown and paid for.

3. ``assignment.published_at`` -- when the manager published it. A draft is
   the manager's business; only ``status = 'published'`` rows are ever visible
   to an employee, and the timestamp lets the app say when it was posted.

4. The org's pay policy (night differential, weekend premium, overtime
   multiplier). It used to live in the manager's browser, which was fine while
   the manager was the only reader. Now the employee computes their own pay
   estimate from the same rules, and an estimate the manager cannot reproduce
   is worse than no estimate -- so the policy has to be one stored fact.
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0002_employee_view"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


DDL_STATEMENTS = [
    # Defaults match DEFAULT_PAY_POLICY on the frontend: +15% nights, +10%
    # weekends, 1.5x overtime (FLSA).
    (
        "ALTER TABLE organization ADD COLUMN night_differential_pct "
        "numeric(5, 2) NOT NULL DEFAULT 15"
    ),
    (
        "ALTER TABLE organization ADD COLUMN weekend_premium_pct "
        "numeric(5, 2) NOT NULL DEFAULT 10"
    ),
    (
        "ALTER TABLE organization ADD COLUMN overtime_multiplier "
        "numeric(4, 2) NOT NULL DEFAULT 1.5"
    ),
    # Existing contracts keep their history: 'monthly' is the assumption for
    # rows written before the column existed, and it is stated, not implied.
    "ALTER TABLE contract ADD COLUMN pay_period text NOT NULL DEFAULT 'monthly'",
    (
        "ALTER TABLE assignment ADD COLUMN shift_template_id uuid "
        "REFERENCES shift_template(id) ON DELETE SET NULL"
    ),
    (
        "ALTER TABLE assignment ADD COLUMN unpaid_break_minutes integer "
        "NOT NULL DEFAULT 0"
    ),
    "ALTER TABLE assignment ADD COLUMN published_at timestamptz",
    # The employee view always asks the same question: "my shifts, in this
    # window". Index it that way.
    (
        "CREATE INDEX ix_assignment_employee_status "
        "ON assignment(employee_id, status)"
    ),
]


def upgrade() -> None:
    for stmt in DDL_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_assignment_employee_status")
    op.execute("ALTER TABLE assignment DROP COLUMN IF EXISTS published_at")
    op.execute("ALTER TABLE assignment DROP COLUMN IF EXISTS unpaid_break_minutes")
    op.execute("ALTER TABLE assignment DROP COLUMN IF EXISTS shift_template_id")
    op.execute("ALTER TABLE contract DROP COLUMN IF EXISTS pay_period")
    op.execute("ALTER TABLE organization DROP COLUMN IF EXISTS overtime_multiplier")
    op.execute("ALTER TABLE organization DROP COLUMN IF EXISTS weekend_premium_pct")
    op.execute(
        "ALTER TABLE organization DROP COLUMN IF EXISTS night_differential_pct"
    )
