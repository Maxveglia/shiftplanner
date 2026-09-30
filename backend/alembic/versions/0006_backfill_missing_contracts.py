from __future__ import annotations

"""backfill: an employee who never had a contract gets the weakest one

Revision ID: 0006_backfill_missing_contracts
Revises: 0005_business_profile
Create Date: 2026-09-03

``availability()`` refuses anyone without a contract, on every day. Employees
created before the API opened one automatically are therefore invisible to the
scheduler for good: regenerating does not help, because nothing in the product
repairs a record that is merely incomplete. Their manager sees an empty
calendar and a list of names, and the only way out is opening a contract by
hand for each of them.

So they get one here. The same weakest contract creation now opens: paid
hourly, NO guaranteed weekly minimum, no ceiling, and no rate -- inventing no
pay and committing the business to no hours. It dates from the employee's own
hire date, so their history reads as it always should have.

DELIBERATELY NARROW. Only employees with ZERO contract rows are touched.
Someone whose contract ENDED has one on purpose -- being unschedulable is the
correct consequence of a contract that ran out, and quietly reopening it would
put a person back on the rota that somebody took off it. Re-running this is a
no-op for the same reason.
"""

from alembic import op

revision = "0006_backfill_missing_contracts"
down_revision = "0005_business_profile"
branch_labels = None
depends_on = None


BACKFILL = """
INSERT INTO contract (
    org_id, employee_id, employment_type, base_annual_salary, hourly_rate,
    min_hours_per_week, max_hours_per_week, pay_period, valid_from, valid_to
)
SELECT
    e.org_id, e.id, 'non_exempt_hourly', NULL, NULL,
    0, NULL, 'monthly', e.hire_date, NULL
FROM employee e
WHERE NOT EXISTS (
    SELECT 1 FROM contract c WHERE c.employee_id = e.id
)
"""


def upgrade() -> None:
    op.execute(BACKFILL)


def downgrade() -> None:
    # Not reversible, and deliberately so. These rows are indistinguishable
    # from a contract a manager opened by hand with the same terms, and
    # deleting somebody's employment record to undo a migration would be a
    # worse outcome than leaving it in place.
    pass
