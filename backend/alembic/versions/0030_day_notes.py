from __future__ import annotations

"""day_note, day_note_reader: the manager's summary of each day, and who reads it

Revision ID: 0030_day_notes
Revises: 0029_inventory
Create Date: 2026-09-24

`day_note` -- one row per business per day (UNIQUE (org_id, note_date)): what
happened, written by the manager. `sent_at` records the last time it was
emailed, so the screen can say whether the readers have the latest version.

`day_note_reader` -- the addresses the notes are shared with, lowercased. One
list, two channels: every address is emailed when the manager sends a note,
and an address that is also a login in this business reads the notes in the
app. Nobody else does -- an employee who is not on the list gets a 403.

Both behind `org_isolation`, like every tenant table.
"""

from alembic import op

revision = "0030_day_notes"
down_revision = "0029_inventory"
branch_labels = None
depends_on = None

TABLES = ("day_note", "day_note_reader")

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS day_note (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        note_date date NOT NULL,
        body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
        updated_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        sent_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (org_id, note_date)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_day_note_org_id ON day_note (org_id)",
    """
    CREATE TABLE IF NOT EXISTS day_note_reader (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        email text NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (org_id, email)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_day_note_reader_org_id ON day_note_reader (org_id)",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)
    for table in TABLES:
        op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % table)
        op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % table)
        op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % table)
        op.execute(
            "CREATE POLICY org_isolation ON %(t)s "
            "USING (org_id = current_setting('app.current_org_id', true)::uuid) "
            "WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid)"
            % {"t": table}
        )
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user" % table)


def downgrade() -> None:
    for table in reversed(TABLES):
        op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % table)
        op.execute("DROP TABLE IF EXISTS %s CASCADE" % table)
