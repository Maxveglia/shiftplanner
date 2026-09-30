from __future__ import annotations

"""absence_type: a day off that is given, and a day off that is lent

Revision ID: 0019_recoverable_days
Revises: 0018_barcelona_only
Create Date: 2026-09-16

One boolean on ``absence_type``, and what it separates is two things the table
could not previously tell apart.

Every absence type this product knows is a day the employee does not work. What
none of them could say is whether the hours come BACK. Holiday does not: it is
paid, it consumes a balance, and nobody works it again. A day off swapped for a
busy Saturday does: the hours were lent, not given, and the employee owes them.

Until now both were the same row shape, so the hours worked back arrived at the
rota looking exactly like extra hours -- and were classified as overtime, which
is wrong twice over. It is wrong for the employee, whose ordinary hours are
being called extraordinary, and it is wrong for the employer, who appears to
have exceeded an annual overtime cap they never touched. Under art. 34 ET the
distinction is not cosmetic: recovered hours are ORDINARY hours, and the only
way to know which ones they are is to know which days off were recoverable.

Why a flag on the TYPE rather than on the absence: because it is a property of
the arrangement, not of the instance. An organization decides once that
"jornada recuperable" is a kind of leave it grants, and every absence of that
kind inherits it. Putting it on the absence would ask the manager the same
question every time and let two identical days off disagree.

Default false, no backfill. Every absence type that exists today keeps meaning
exactly what it meant yesterday -- a day off that is not worked back -- so no
existing rota changes, and `services/workday.py` finds nothing to recover for
any organization that has not yet said otherwise. That is the same additive
contract 0012 and 0009 make.
"""

from alembic import op

revision = "0019_recoverable_days"
down_revision = "0018_barcelona_only"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE absence_type ADD COLUMN IF NOT EXISTS is_recoverable "
    "boolean NOT NULL DEFAULT false",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE absence_type DROP COLUMN IF EXISTS is_recoverable",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    # Dropping the column turns every recoverable day back into an ordinary
    # one, which is the safe direction: hours stop being owed rather than
    # starting to be. The opposite would invent a debt.
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
