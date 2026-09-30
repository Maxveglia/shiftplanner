from __future__ import annotations

"""assignment: a draft and a published shift may share an employee's hours

Revision ID: 0016_draft_no_overlap
Revises: 0015_interview_notes
Create Date: 2026-09-10

The draft is moving out of the manager's browser and into the ``assignment``
table, as rows with ``status = 'draft'`` beside the ``published`` ones. The
overlap constraint was written when only published rows existed, so it forbids
ANY two shifts of one employee from touching -- which would make the obvious
next week's draft (the same person, the same Monday, an hour later) collide
with the week already on the noticeboard.

The rule that was actually wanted is "no two shifts of the same KIND overlap":
one draft cannot double-book a person, one rota cannot either, but a draft is
free to disagree with the rota it is about to replace. ``status`` joins the
key, and the constraint keeps its name so the 409 mapping in the router still
recognises it. btree_gist was already required by the old definition, so no
extension work here.
"""

from alembic import op

revision = "0016_draft_no_overlap"
down_revision = "0015_interview_notes"
branch_labels = None
depends_on = None

UPGRADE_STATEMENTS = [
    "ALTER TABLE assignment DROP CONSTRAINT IF EXISTS assignment_no_overlap",
    """
    ALTER TABLE assignment ADD CONSTRAINT assignment_no_overlap
        EXCLUDE USING gist (employee_id WITH =, status WITH =, during WITH &&)
        WHERE (status <> 'archived')
    """,
]

# Going back means drafts may no longer sit on top of published rows. Any
# draft still in the table would make the old constraint impossible to add,
# and a draft is by definition not yet a commitment, so it is dropped first.
DOWNGRADE_STATEMENTS = [
    "DELETE FROM assignment WHERE status = 'draft'",
    "ALTER TABLE assignment DROP CONSTRAINT IF EXISTS assignment_no_overlap",
    """
    ALTER TABLE assignment ADD CONSTRAINT assignment_no_overlap
        EXCLUDE USING gist (employee_id WITH =, during WITH &&)
        WHERE (status <> 'archived')
    """,
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
