from __future__ import annotations

"""business_profile: what the manager said in the opening interview

Revision ID: 0015_interview_notes
Revises: 0014_api_usage
Create Date: 2026-09-10

Two nullable columns, and once more the reason there are two is provenance.

The opening interview ends in a paragraph about the business, written by a
model from the manager's answers and approved by the manager before it is
kept. Until now that paragraph was used once, as the first brief, and
forgotten -- so every brief after it started from nothing, and a manager who
had just spent five minutes explaining their bar was asked about it again the
next week.

``interview_notes`` keeps it. It is not ``house_notes``: that column is what
the manager typed with their own hands in Settings, and this one is a model's
paraphrase that a human waved through. The two read almost the same and are
treated almost the same -- both reach the planner as what the manager said --
but if one day a paraphrase turns out to have put words in somebody's mouth,
the column tells you which sentences to doubt. ``interviewed_at`` says when,
for the same reason ``researched_at`` does.
"""

from alembic import op

revision = "0015_interview_notes"
down_revision = "0014_api_usage"
branch_labels = None
depends_on = None

UPGRADE_STATEMENTS = [
    "ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS interview_notes text",
    "ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS interviewed_at timestamptz",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS interviewed_at",
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS interview_notes",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
