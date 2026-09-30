from __future__ import annotations

"""Two branches of history become one again

Revision ID: 0024_one_head
Revises: 0023_login_attempt, 0023_notify_by_email
Create Date: 2026-09-20

Nothing happens here. This migration exists to join two lines, not to change a
table.

WHAT HAPPENED. Two branches were written the same afternoon, each adding the
migration after `0022_overtime_over_contract`: `0023_login_attempt` (the login
rate limiter) and `0023_notify_by_email`. Apart, each was a straight line.
Merged, they were two heads -- and `alembic upgrade head` refuses to choose
between two, with "Multiple head revisions are present for given argument
'head'".

WHY THAT IS AN OUTAGE AND NOT A CHORE. The entrypoint runs `upgrade head` on
every boot, so the refusal is not a failed migration -- it is a container that
never finishes starting, in a loop, with the previous one already gone. The
database is untouched and nothing is lost; the app is simply not up. That is
what this repository looked like for the minutes between one merge and this.

HOW TO AVOID IT RATHER THAN FIX IT AGAIN. Two branches that both add a
migration will not conflict in git -- the files have different names and touch
nothing in common -- so a green CI on each one says nothing about the pair. The
thing to check is `alembic heads` AFTER merging, or, better, to rebase the
second branch onto the first before merging so its `down_revision` points at
the real predecessor and the history stays a line.
"""

# revision identifiers, used by Alembic.
revision = "0024_one_head"
down_revision = ("0023_login_attempt", "0023_notify_by_email")
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Deliberately empty: both parents already did their own work."""


def downgrade() -> None:
    """Deliberately empty: undoing a join means going back to two heads."""
