from __future__ import annotations

"""business_memory_file: the planner's own notebook, one per business

Revision ID: 0027_business_memory_file
Revises: 0026_hand_edit_observation
Create Date: 2026-09-22

WHAT THIS IS. The storage behind the API's memory tool (`memory_20250818`).
The tool speaks in files under `/memories` -- view, create, str_replace,
insert, delete, rename -- and leaves WHERE they live to us. Here they live in
one row per file, per organisation, so that what the planner writes down about
one business is, by construction, invisible to every other: the same
`org_isolation` policy every tenant table carries, and a backend
(`services/planner_notes.py`) that loads one org's rows into memory and never
takes a path, let alone an org, from the model.

WHY A TABLE AND NOT A COLUMN ON `business_profile`. Because the tool's unit is
a file with a path, and the model may keep more than one. A JSON column would
have to reinvent paths, sizes and renames inside a value; a row per file makes
"at most 20 files, 4 KB each" a count and a length.

WHAT IS DELIBERATELY NOT HERE. No names. A person the planner writes about is
stored as a marker holding their employee id (`⟦persona:<uuid>⟧`), never as
the alias the model used (those change between requests) and never as a name
(the model never saw one). Nothing about pay, contracts or absences reaches
the call that writes here, and lines that mention them are dropped before a
write -- see the service.

Paths outside `/memories` are ours, not the model's: `/.forgotten` holds the
fingerprints of the notes a manager deleted, so the planner cannot write the
same sentence back the next day. The backend never loads it into the notebook
the model sees.
"""

from alembic import op

revision = "0027_business_memory_file"
down_revision = "0026_hand_edit_observation"
branch_labels = None
depends_on = None

TABLE = "business_memory_file"

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS business_memory_file (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        -- Normalised by the service before it gets here: starts with
        -- /memories/ (or is one of our own reserved paths), no '..', no
        -- doubled slashes. The CHECK is the database's half of that promise.
        path text NOT NULL CHECK (length(path) BETWEEN 2 AND 160),
        -- The limits the service enforces are far below this; the CHECK is a
        -- ceiling for a bug, not the policy.
        content text NOT NULL DEFAULT '' CHECK (length(content) <= 65536),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_business_memory_file_path UNIQUE (org_id, path)
    )
    """,
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)
    op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % TABLE)
    op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % TABLE)
    # Dropped first so a re-run replaces the policy instead of failing on a
    # duplicate name.
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
