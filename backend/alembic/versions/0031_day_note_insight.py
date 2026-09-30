from __future__ import annotations

"""day_note_insight: what a small model read in each day note

Revision ID: 0031_day_note_insight
Revises: 0030_day_notes
Create Date: 2026-09-24

One row per note (UNIQUE note_id, ON DELETE CASCADE: a note deleted takes its
reading with it). The facts about the BUSINESS that the note states -- takings,
customers, whether it opened, the busy, quiet, short- and over-staffed stretches
of the day, and what moved demand -- and nothing about a person.

`source_hash` is the hash of the body that was read. It is how the screen knows
a reading is stale (the note was edited since) and how the reader knows not to
pay twice for the same text. `note_date` is copied from the note so the weekly
summary is one indexed read of this table rather than a join per request.

Behind `org_isolation`, like every tenant table.
"""

from alembic import op

revision = "0031_day_note_insight"
down_revision = "0030_day_notes"
branch_labels = None
depends_on = None

TABLE = "day_note_insight"

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS day_note_insight (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        note_id uuid NOT NULL UNIQUE REFERENCES day_note(id) ON DELETE CASCADE,
        note_date date NOT NULL,
        revenue numeric(12, 2),
        customers integer,
        closed boolean NOT NULL DEFAULT false,
        busy jsonb NOT NULL DEFAULT '[]'::jsonb,
        quiet jsonb NOT NULL DEFAULT '[]'::jsonb,
        short_staffed jsonb NOT NULL DEFAULT '[]'::jsonb,
        over_staffed jsonb NOT NULL DEFAULT '[]'::jsonb,
        events jsonb NOT NULL DEFAULT '[]'::jsonb,
        source_hash text NOT NULL,
        model text,
        extracted_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_day_note_insight_org_date "
    "ON day_note_insight (org_id, note_date)",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)
    op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % TABLE)
    op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % TABLE)
    op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % TABLE)
    op.execute(
        "CREATE POLICY org_isolation ON %(t)s "
        "USING (org_id = current_setting('app.current_org_id', true)::uuid) "
        "WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid)"
        % {"t": TABLE}
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user" % TABLE)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % TABLE)
    op.execute("DROP TABLE IF EXISTS %s CASCADE" % TABLE)
