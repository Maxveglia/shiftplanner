from __future__ import annotations

"""inventory_item, inventory_count, inventory_count_line: counting the stock

Revision ID: 0029_inventory
Revises: 0028_business_assistant
Create Date: 2026-09-24

The second app in the workspace, beside the rota: the manager keeps a list of
products and, every so often, walks the shop and writes down how many of each
there are. A count is a snapshot, not a ledger -- there are no deliveries or
sales here, only what was on the shelf when somebody looked.

Products are archived rather than deleted (`archived_at`), so an old count
still names what it counted. Every table carries `org_id` and sits behind
`org_isolation`, like every other tenant table.
"""

from alembic import op

revision = "0029_inventory"
down_revision = "0028_business_assistant"
branch_labels = None
depends_on = None

TABLES = ("inventory_item", "inventory_count", "inventory_count_line")

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS inventory_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
        unit text CHECK (length(unit) <= 64),
        category text CHECK (length(category) <= 200),
        min_quantity numeric(12, 3) CHECK (min_quantity >= 0),
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_inventory_item_org_id ON inventory_item (org_id)",
    """
    CREATE TABLE IF NOT EXISTS inventory_count (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        counted_at timestamptz NOT NULL,
        note text CHECK (length(note) <= 2000),
        counted_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_inventory_count_org_id ON inventory_count (org_id, counted_at)",
    """
    CREATE TABLE IF NOT EXISTS inventory_count_line (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        count_id uuid NOT NULL REFERENCES inventory_count(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES inventory_item(id) ON DELETE CASCADE,
        quantity numeric(12, 3) NOT NULL CHECK (quantity >= 0),
        UNIQUE (count_id, item_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_inventory_count_line_count_id ON inventory_count_line (count_id)",
    "CREATE INDEX IF NOT EXISTS ix_inventory_count_line_item_id ON inventory_count_line (item_id)",
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
