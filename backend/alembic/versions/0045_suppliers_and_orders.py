from __future__ import annotations

"""inventory_supplier, and each product's supplier and how much of it is ordered

Revision ID: 0045_suppliers_and_orders
Revises: 0044_casa_demo_hd_photos
Create Date: 2026-09-27

Max, 27-sep-2026: a sale takes its products off the stock, so the stock is
counted every month or two instead of every week -- and when a product runs
low, the app says so and prepares the order to its supplier, one WhatsApp
message per supplier with the text already written. What that needs from the
database is who each product is bought from and how much of it is ordered at
a time; the alert itself is worked out on every sale from what is already
there (routers/inventory.py::stock_alerts).

`inventory_supplier`: a business's suppliers, each a name and, optionally, the
phone its orders go to.

* The name is 1-120 characters, and one per business whatever its case
  ("Makro" and "MAKRO" are one supplier): a unique index on (org_id,
  lower(name)). The API checks it first, to answer 409
  `inventory_supplier_name_taken` naming the one that has it.
* The phone is kept AS THE MANAGER WROTE IT -- "+34 612 34 56 78",
  "(93) 123-45-67" -- because it is also what the screen shows back. What the
  link to WhatsApp needs (the digits, with the country's prefix) is the
  browser's to work out when it builds the link. A phone is digits, spaces,
  hyphens, parentheses and one leading "+", and 7 to 15 digits (E.164 has at
  most 15; no number anybody dials has fewer than 7). The API refuses anything
  else with 422 `inventory_supplier_phone_invalid`; the CHECK below says the
  same, so a route that forgot could not store it either. At most 40
  characters, spaces and all.
* `UNIQUE (id, org_id)`: what the product's key below points at.

`inventory_item.supplier_id`: who the product is bought from, or NULL. The key
is on (supplier_id, org_id), for the reason 0033 gives: a plain one is
checked past row-level security and would take a neighbour's supplier.

DELETING A SUPPLIER LEAVES ITS PRODUCTS WITHOUT ONE -- and the API does it,
not the key. What the key would have to do is null `supplier_id` and leave
`org_id` alone, which is `ON DELETE SET NULL (supplier_id)`: Postgres 15
syntax. CI and every developer's database are 16, but nothing in the
repository says which version production runs (Railway's managed service),
and on an older one the whole key, org_id included, is nulled and the delete
fails on NOT NULL -- or, worse, the migration does not parse and the deploy
does not start. 0035 declined the same bet for the same reason. So the route
that deletes a supplier sets its products' `supplier_id` to NULL first, in
the same transaction (routers/inventory_suppliers.py), and the key only
refuses: a supplier some product still names cannot be deleted by anything
that forgets to. Checked at COMMIT (DEFERRABLE INITIALLY DEFERRED), as 0041's
key between a combo and its dishes is: deleting a whole business removes its
suppliers and its products by two cascades from `organization`, and Postgres
may check this key between the two.

`inventory_item.order_quantity`: how much of the product is ordered at a
time, in its own unit ("10" of "kg"), or NULL when nobody said. Above zero,
numeric(12, 3) like every other quantity of the stock. The alert offers it as
the quantity to order, and the manager can change it there before sending.

Nothing here moves a number: a product with no supplier and no order quantity
is exactly what it was.

The downgrade drops the suppliers and the two columns, and with them who each
product was bought from and how much of it was ordered.
"""

from alembic import op

revision = "0045_suppliers_and_orders"
down_revision = "0044_casa_demo_hd_photos"
branch_labels = None
depends_on = None

TABLE = "inventory_supplier"

# The same walls as app/schemas/inventory.py and the supplier routes, written
# out: a migration is a record of what the schema was, and must not move when
# the app's numbers do.
NAME_MAX = 120
PHONE_MAX = 40
PHONE_DIGITS = (7, 15)

UPGRADE_STATEMENTS = [
    r"""
    CREATE TABLE IF NOT EXISTS inventory_supplier (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name text NOT NULL
            CONSTRAINT inventory_supplier_name_check
            CHECK (char_length(name) BETWEEN 1 AND %(name_max)d),
        phone text
            CONSTRAINT inventory_supplier_phone_check
            CHECK (
                char_length(phone) <= %(phone_max)d
                AND phone ~ '^\+?[0-9 ()-]*$'
                AND char_length(regexp_replace(phone, '[^0-9]', '', 'g'))
                    BETWEEN %(digits_min)d AND %(digits_max)d
            ),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT inventory_supplier_id_org_id_key UNIQUE (id, org_id)
    )
    """
    % {
        "name_max": NAME_MAX,
        "phone_max": PHONE_MAX,
        "digits_min": PHONE_DIGITS[0],
        "digits_max": PHONE_DIGITS[1],
    },
    # One name per business, whatever its case. Leading with org_id, it is
    # also how a business's suppliers are listed and how the cascade from a
    # deleted business finds them.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_supplier_org_id_name "
    "ON inventory_supplier (org_id, lower(name))",
    "ALTER TABLE inventory_item ADD COLUMN IF NOT EXISTS supplier_id uuid",
    """
    ALTER TABLE inventory_item
        ADD COLUMN IF NOT EXISTS order_quantity numeric(12, 3)
            CONSTRAINT inventory_item_order_quantity_check
            CHECK (order_quantity > 0)
    """,
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'inventory_item'::regclass
              AND conname = 'inventory_item_supplier_fkey'
        ) THEN
            ALTER TABLE inventory_item
                ADD CONSTRAINT inventory_item_supplier_fkey
                FOREIGN KEY (supplier_id, org_id)
                REFERENCES inventory_supplier (id, org_id)
                DEFERRABLE INITIALLY DEFERRED;
        END IF;
    END
    $$
    """,
    # "Which products does this supplier have?": the count in the list of
    # suppliers, the products left without one when it is deleted, and the
    # key's own check. Only the rows that have one.
    "CREATE INDEX IF NOT EXISTS ix_inventory_item_supplier_id "
    "ON inventory_item (supplier_id) WHERE supplier_id IS NOT NULL",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE inventory_item DROP CONSTRAINT IF EXISTS inventory_item_supplier_fkey",
    "DROP INDEX IF EXISTS ix_inventory_item_supplier_id",
    "ALTER TABLE inventory_item DROP COLUMN IF EXISTS order_quantity",
    "ALTER TABLE inventory_item DROP COLUMN IF EXISTS supplier_id",
    "DROP POLICY IF EXISTS org_isolation ON inventory_supplier",
    "DROP TABLE IF EXISTS inventory_supplier CASCADE",
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
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
