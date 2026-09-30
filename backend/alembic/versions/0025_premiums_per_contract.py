from __future__ import annotations

"""A person's premiums can differ from the business's

Revision ID: 0025_premiums_per_contract
Revises: 0024_one_head
Create Date: 2026-09-21

Until now the night premium, the weekend premium and the price of an extra hour
lived on `organization` and applied to everyone. That is how most businesses
start, and it stops being true the first time a manager says "a Juan no le pago
la nocturnidad" or "Marta cobra la noche al 30%". Those are terms of one
person's agreement, so they go where the rest of the agreement lives: on the
contract, versioned with it.

FOUR NULLABLE COLUMNS. NULL on each one means "the same as the business", and
that is what every existing contract reads as after this migration -- nothing
is backfilled, because nothing was ever agreed per person. A value, including
0, overrides the business's figure for that person only.

- `night_premium_pct`, `weekend_premium_pct`: percent over the ordinary hour,
  0 to 200, the same range the business settings accept.
- `overtime_multiplier`: what an extra hour is paid as a multiple of an
  ordinary one, 1 to 5. Never below 1: art. 35.1 ET does not let an extra hour
  be paid for less than an ordinary one.
- `night_premium_basis`: NULL, or 'included_in_salary'. Art. 36.2 ET lets a
  night premium be absent only when the salary was set with night work already
  priced into it. Recording that reason is what separates a lawful 0% from an
  unpaid premium, so it is a column and not a note.

The ranges are checked by the API; only the basis is constrained here, because
it is the one value whose meaning a typo would silently change.

Reversible. The downgrade drops the four columns, and with them any per-person
premium, which is the state of the product before this revision.
"""

from alembic import op

revision = "0025_premiums_per_contract"
down_revision = "0024_one_head"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE contract "
        "ADD COLUMN IF NOT EXISTS night_premium_pct numeric(5, 2), "
        "ADD COLUMN IF NOT EXISTS weekend_premium_pct numeric(5, 2), "
        "ADD COLUMN IF NOT EXISTS overtime_multiplier numeric(4, 2), "
        "ADD COLUMN IF NOT EXISTS night_premium_basis varchar"
    )
    op.execute(
        "ALTER TABLE contract DROP CONSTRAINT IF EXISTS "
        "ck_contract_night_premium_basis"
    )
    op.execute(
        "ALTER TABLE contract ADD CONSTRAINT ck_contract_night_premium_basis "
        "CHECK (night_premium_basis IS NULL "
        "       OR night_premium_basis = 'included_in_salary')"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE contract DROP CONSTRAINT IF EXISTS "
        "ck_contract_night_premium_basis"
    )
    op.execute(
        "ALTER TABLE contract "
        "DROP COLUMN IF EXISTS night_premium_basis, "
        "DROP COLUMN IF EXISTS overtime_multiplier, "
        "DROP COLUMN IF EXISTS weekend_premium_pct, "
        "DROP COLUMN IF EXISTS night_premium_pct"
    )
