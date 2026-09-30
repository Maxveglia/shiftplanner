from __future__ import annotations

"""inventory_barcode, inventory_receipt, inventory_receipt_line: stock coming in

Revision ID: 0032_inventory_receiving
Revises: 0031_day_note_insight
Create Date: 2026-09-24

Until now the inventory only knew what was on the shelf when somebody looked
(0029). The moment a delivery arrives between two counts, "what went since
last time" read off those two counts is wrong by exactly the delivery -- so
deliveries are recorded now, as receipts, and the stock is a count plus what
came in after it.

`inventory_barcode` is how a scan finds its product. `code` is the code as it
was read (trimmed, for showing back); `code_key` is its normalised form (see
`app/services/barcodes.py`), which is what the uniqueness is on: two spellings
of one GTIN -- the 12-digit UPC-A and the 13-digit EAN-13 of the same box --
are one code, and one code is one product per business. Another business may
have the same code on its own product, so the uniqueness is per `org_id`.
`units_per_scan` is how many of the product's units one scan of this code is
worth: the bottle's code is 1, the code on the case of 24 is 24.

`inventory_receipt` is one delivery, one delivery note; its lines say how
much of each product came in, in the product's own units. A product appears
once per receipt. `client_ref` is an id the phone makes up once per scanning
session and sends with the save, unique per business: a save the server kept
but whose answer never reached the phone (no signal at the back of a lorry, a
tab the system killed) is sent again with the same ref and answered with the
receipt already kept, rather than received twice. NULL for a receipt saved
without one; Postgres does not count NULLs against a UNIQUE. Every table carries `org_id` and sits behind
`org_isolation`, like every other tenant table.

`inventory_barcode.created_at` defaults to clock_timestamp() rather than
now(): a product created with three codes inserts them in one transaction,
and now() would give the three the same instant, leaving their order -- which
is the order they are shown in -- to a random uuid.
"""

from alembic import op

revision = "0032_inventory_receiving"
down_revision = "0031_day_note_insight"
branch_labels = None
depends_on = None

TABLES = ("inventory_barcode", "inventory_receipt", "inventory_receipt_line")

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS inventory_barcode (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES inventory_item(id) ON DELETE CASCADE,
        code text NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
        code_key text NOT NULL CHECK (length(code_key) BETWEEN 1 AND 64),
        units_per_scan numeric(12, 3) NOT NULL DEFAULT 1 CHECK (units_per_scan > 0),
        label text CHECK (length(label) <= 64),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (org_id, code_key)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_inventory_barcode_item_id ON inventory_barcode (item_id)",
    """
    CREATE TABLE IF NOT EXISTS inventory_receipt (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        received_at timestamptz NOT NULL,
        supplier text CHECK (length(supplier) <= 200),
        note text CHECK (length(note) <= 2000),
        received_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        client_ref uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (org_id, client_ref)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_inventory_receipt_org_id ON inventory_receipt (org_id, received_at)",
    # The UNIQUE below already indexes receipt_id (it leads), so the only other
    # index a line needs is the one the stock sums by: its product.
    """
    CREATE TABLE IF NOT EXISTS inventory_receipt_line (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        receipt_id uuid NOT NULL REFERENCES inventory_receipt(id) ON DELETE CASCADE,
        item_id uuid NOT NULL REFERENCES inventory_item(id) ON DELETE CASCADE,
        quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
        UNIQUE (receipt_id, item_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_inventory_receipt_line_item_id ON inventory_receipt_line (item_id)",
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
