from __future__ import annotations

"""business_profile: where a business is, and what we looked up about it

Revision ID: 0013_business_research
Revises: 0012_employee_deleted_at
Create Date: 2026-09-04

Two nullable columns, and the reason there are two is the whole point.

The onboarding asks a manager a handful of questions. Their answers are theirs:
``vertical`` is stamped ``declared`` when a human picks it, ``house_notes`` is
what they wrote in their own words, and everything downstream is entitled to
treat both as fact. That distinction is not decoration -- ``model_context``
withholds an *inferred* vertical from the model precisely so that a guess of
ours cannot quietly reinforce itself.

``research_notes`` is a guess of ours by construction: a summary produced by a
model that searched the web for what a business of this kind, in this place,
usually looks like. It is useful -- a bar in a beach town has a season and a
phone shop does not -- and it is exactly the kind of material that must never
be mistaken for something the manager said. Putting it in ``house_notes``
would have done precisely that, and nothing in the schema would have objected.

So it gets its own column, and ``researched_at`` records when. A timestamp
rather than a boolean because research goes stale in a way an answer does not:
the manager's "we are a bar" is true until they say otherwise, while "August is
the busy month around here" was true when we looked. Anything that decides to
re-run it needs to know how old the last one is, and a boolean cannot say.

``location`` is the third, and it is free text on purpose. The obvious place
for "where is your business" is ``organization.jurisdiction_code``, and it is
the wrong one: that column names a LABOUR JURISDICTION we hold rules for, and
today there are exactly three of those, all American. A manager in Valencia
answering the question truthfully has nothing to map to, and forcing the answer
into that column would either lose it or file their shop under Arizona law.

So the answer is kept as given. It is what a research pass searches from, it is
what a planner is told about seasons and neighbourhoods, and separately -- only
when it names a jurisdiction we actually have rules for -- it may set
``jurisdiction_code``. One answer, two uses, and the half we cannot honour yet
is stored rather than discarded.

Additive and idempotent like 0009, 0011 and 0012: ``ADD COLUMN IF NOT EXISTS``,
no backfill, no touch to the row-level security on the table. An organization
that predates this reads NULL on both and behaves exactly as it does today --
``planning_context`` skips a profile with nothing to say, so a calendar built
before anyone researched anything is the calendar it was already getting.
"""

from alembic import op

revision = "0013_business_research"
down_revision = "0012_employee_deleted_at"
branch_labels = None
depends_on = None


UPGRADE_STATEMENTS = [
    "ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS location text",
    "ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS research_notes text",
    "ALTER TABLE business_profile ADD COLUMN IF NOT EXISTS researched_at timestamptz",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS researched_at",
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS research_notes",
    "ALTER TABLE business_profile DROP COLUMN IF EXISTS location",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    # Dropping these loses the research and keeps everything the manager said,
    # which is the safe direction: a downgrade must not cost anybody an answer
    # they actually gave us.
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
