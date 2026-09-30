from __future__ import annotations

"""menu_recipe_item, menu_recipe_component, store_sale_consumption: what a sale takes off the shelf

Revision ID: 0041_store_recipes
Revises: 0040_menu_photo_labelled
Create Date: 2026-09-27

Max, 27-sep-2026: every product of the Tienda is worth some amount of the
products of the Inventario -- a Crispy Grande is 0.75 kg of chicken and
0.1 kg of onion -- and selling one takes that off the stock.

A RECIPE is two lists on a dish of the menu:

* `menu_recipe_item`: ingredients, each a product of the inventory and how
  much of it one unit sold takes, in that product's own unit (0.75 with the
  unit "kg" is three quarters of a kilo).
* `menu_recipe_component`: other dishes of the same menu inside this one, and
  how many -- "Combo Crispy Grande = 1 Crispy Grande + 1 Patatas". A combo
  takes whatever its components take, recursively. A dish can have both
  lists. A dish cannot contain itself, directly (the CHECK) or through others
  (A -> B -> A), and the chain is at most five deep: both are the API's to
  refuse (routers/recipes.py), under the menu's lock, since a CHECK cannot see
  other rows.

WHAT A SALE TOOK is written down when the sale is saved, in
`store_sale_consumption`, in the same transaction: one row per inventory
product, the recipe expanded and summed exactly and rounded once, to the
thousandth. It is a snapshot, never worked out again: changing a recipe
changes what the NEXT sale takes, not what last week's did, and a sale typed
before its dish had a recipe took nothing. Deleting the sale deletes its rows
(CASCADE), which puts the stock back.

WHEN A COUNT STOPS SEEING SALES. A sale is a day (`sold_on`) and a count is an
instant, so each count now says which day's sales it already reflects:
`inventory_count.sales_through`. Counted after closing, the sales of that day
are already off the shelf it counted -- the day itself; counted before
opening, they are still to come -- the day before. A sale is after a count
when `sold_on > sales_through`. The counts already taken are filled in from
their own moment, on Madrid's clock (app/services/business_time.py): before
noon is before opening.

Every foreign key between tenant rows is on (id, org_id), for the reason 0033
gives: a plain one is checked past row-level security and would take a
neighbour's dish, product or sale. `inventory_item` gets the UNIQUE (id,
org_id) those keys point at, as menu_dish got it in 0038.

Every new table carries `org_id` and sits behind `org_isolation`, like every
other tenant table.
"""

from alembic import op

revision = "0041_store_recipes"
down_revision = "0040_menu_photo_labelled"
branch_labels = None
depends_on = None

TABLES = ("menu_recipe_item", "menu_recipe_component", "store_sale_consumption")

# Madrid, written out rather than imported from app/services/business_time.py:
# a migration is a record of what was done and must not move if that does.
ZONE = "Europe/Madrid"

UPGRADE_STATEMENTS = [
    # What the keys on (item_id, org_id) below point at. Named, so the
    # downgrade takes back exactly this and nothing else.
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'inventory_item'::regclass
              AND conname = 'inventory_item_id_org_id_key'
        ) THEN
            ALTER TABLE inventory_item
                ADD CONSTRAINT inventory_item_id_org_id_key UNIQUE (id, org_id);
        END IF;
    END
    $$
    """,
    """
    CREATE TABLE IF NOT EXISTS menu_recipe_item (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        dish_id uuid NOT NULL,
        item_id uuid NOT NULL,
        quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
        UNIQUE (dish_id, item_id),
        FOREIGN KEY (dish_id, org_id)
            REFERENCES menu_dish (id, org_id) ON DELETE CASCADE,
        FOREIGN KEY (item_id, org_id)
            REFERENCES inventory_item (id, org_id) ON DELETE CASCADE
    )
    """,
    # The UNIQUE leads with dish_id, which is how a dish's recipe is read and
    # how the cascade from a deleted dish finds it. These two are the whole
    # business's recipes (one read, whatever the size of the menu) and the
    # cascade from a product.
    "CREATE INDEX IF NOT EXISTS ix_menu_recipe_item_org_id ON menu_recipe_item (org_id)",
    "CREATE INDEX IF NOT EXISTS ix_menu_recipe_item_item_id ON menu_recipe_item (item_id)",
    """
    CREATE TABLE IF NOT EXISTS menu_recipe_component (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        dish_id uuid NOT NULL,
        component_id uuid NOT NULL,
        quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
        UNIQUE (dish_id, component_id),
        CHECK (dish_id <> component_id),
        FOREIGN KEY (dish_id, org_id)
            REFERENCES menu_dish (id, org_id) ON DELETE CASCADE,
        -- No cascade on this side: a dish inside a combo is not deleted from
        -- under it (the API answers 409 menu_dish_in_combo first). Checked at
        -- COMMIT, not per statement: a section deleted with a combo AND its
        -- dishes in it, or a whole business, removes the combo's rows by the
        -- dish_id cascade above -- but Postgres may check this key before that
        -- cascade has run, and refuse a delete that leaves nothing dangling.
        FOREIGN KEY (component_id, org_id)
            REFERENCES menu_dish (id, org_id) DEFERRABLE INITIALLY DEFERRED
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_menu_recipe_component_org_id "
    "ON menu_recipe_component (org_id)",
    # "Which combos is this dish in?", asked before a dish or a section is
    # deleted (routers/menu.py), and by the foreign key's own check.
    "CREATE INDEX IF NOT EXISTS ix_menu_recipe_component_component_id "
    "ON menu_recipe_component (component_id)",
    """
    CREATE TABLE IF NOT EXISTS store_sale_consumption (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        sale_id uuid NOT NULL,
        item_id uuid NOT NULL,
        quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
        UNIQUE (sale_id, item_id),
        FOREIGN KEY (sale_id, org_id)
            REFERENCES store_sale (id, org_id) ON DELETE CASCADE,
        FOREIGN KEY (item_id, org_id)
            REFERENCES inventory_item (id, org_id) ON DELETE CASCADE
    )
    """,
    # The stock sums a business's consumption by product; the UNIQUE (it leads
    # with sale_id) is how a deleted sale's rows are found.
    "CREATE INDEX IF NOT EXISTS ix_store_sale_consumption_item_id "
    "ON store_sale_consumption (item_id)",
    "CREATE INDEX IF NOT EXISTS ix_store_sale_consumption_org_id "
    "ON store_sale_consumption (org_id, item_id)",
    # Nullable for as long as it takes to fill them in (below).
    "ALTER TABLE inventory_count ADD COLUMN IF NOT EXISTS sales_through date",
    "ALTER TABLE inventory_count ADD COLUMN IF NOT EXISTS after_close boolean",
]

# The counts already taken, as the form will guess them on Madrid's clock:
# from noon, and in the small hours after a late close, after closing; in the
# morning, before opening -- the day before. A late close (before six) closes
# the day before as well, so the small hours take the day before either way.
BACKFILL = """
    UPDATE inventory_count
    SET after_close = extract(hour FROM counted_at AT TIME ZONE '%(zone)s') >= 12
            OR extract(hour FROM counted_at AT TIME ZONE '%(zone)s') < 6,
        sales_through = CASE
            WHEN extract(hour FROM counted_at AT TIME ZONE '%(zone)s') < 12
                THEN (counted_at AT TIME ZONE '%(zone)s')::date - 1
            ELSE (counted_at AT TIME ZONE '%(zone)s')::date
        END
    WHERE sales_through IS NULL
""" % {"zone": ZONE}


def _fence(table: str) -> None:
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


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)
    # Every business's counts at once, so past `org_isolation`: FORCEd, it
    # applies to the table's owner as well, and an owner that is not a
    # superuser would fill in nothing and then fail on NOT NULL. Lifted for
    # the owner only, and only inside this transaction -- nobody else ever
    # sees the table without it.
    op.execute("ALTER TABLE inventory_count NO FORCE ROW LEVEL SECURITY")
    op.execute(BACKFILL)
    op.execute("ALTER TABLE inventory_count FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE inventory_count ALTER COLUMN sales_through SET NOT NULL")
    op.execute("ALTER TABLE inventory_count ALTER COLUMN after_close SET NOT NULL")
    for table in TABLES:
        _fence(table)


def downgrade() -> None:
    for table in reversed(TABLES):
        op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % table)
        op.execute("DROP TABLE IF EXISTS %s CASCADE" % table)
    op.execute("ALTER TABLE inventory_count DROP COLUMN IF EXISTS sales_through")
    op.execute("ALTER TABLE inventory_count DROP COLUMN IF EXISTS after_close")
    op.execute(
        "ALTER TABLE inventory_item DROP CONSTRAINT IF EXISTS inventory_item_id_org_id_key"
    )
