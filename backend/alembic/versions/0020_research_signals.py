from __future__ import annotations

"""business_profile: what the research MEANS, not just what it said

Revision ID: 0020_research_signals
Revises: 0019_recoverable_days
Create Date: 2026-09-16

One nullable JSONB column, and it exists because a paragraph turned out to be
the wrong container for a conclusion.

``research_notes`` (0013) holds what Gemini found about businesses like this
one in this city, as prose: "bars here fill on Friday and Saturday night, and
August empties the neighbourhood". That paragraph is the right thing to show a
manager in Settings, where it can be read and doubted, and it reached the
planner too -- as BACKGROUND, under an instruction that expressly forbids it
from adding coverage the brief did not ask for.

Which meant the reasoning was done, written down, and then changed nothing. A
bar that fills on Friday night got the same Friday as a Tuesday.

This column holds the same finding in the form the planner can act on: which
weekdays, which hours, how many people, which months, which local holidays.
Those join the signals the brief itself carries and become coverage rules,
each announced as an assumption the manager can argue with in one sentence.

JSONB rather than columns because the shape belongs to one consumer and will
change as the inference gets better -- the same reasoning ``declared`` (0011)
was given. Nullable, no backfill, no default: every business that predates this
reads NULL, infers nothing, and gets exactly the calendar it got yesterday.

The prose does NOT go away and is not derived from this. The two say the same
thing to two different readers, and the paragraph remains the one a person can
check -- with its sources attached, which is what keeps the figures here
honest when somebody doubts them.
"""

from alembic import op

revision = "0020_research_signals"
down_revision = "0019_recoverable_days"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS research_signals jsonb",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS research_signals",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    # Dropping the column stops the inferences and keeps the prose, which is
    # the safe direction: the calendar goes back to being built from what the
    # manager said, and nothing that was said is lost.
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
