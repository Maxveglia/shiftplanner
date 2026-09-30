from __future__ import annotations

"""menu_section, menu_dish: the restaurant's menu, as the manager writes it

Revision ID: 0033_menu
Revises: 0032_inventory_receiving
Create Date: 2026-09-26

The carta, inside the inventory app: sections ("Entrantes", "Principales",
"Bebidas") and, in each, the dishes and drinks. Written by hand by the
manager, dish by dish, and read -- never changed -- by the team from their
phones, so the waiter asked "what is there without gluten?" has the answer in
their pocket. Nothing here knows about the stock: no recipes, no cost, no link
to `inventory_item`. It is what is offered, not what it is made of.

`menu_dish.price` is NULL for "no price" -- the fish at market price -- and is
kept to the cent in numeric(8, 2), under 100000, which is more than any dish
and a wall for anything that is not one.

`menu_dish.allergens` are the fourteen the EU makes a restaurant declare
(Regulation 1169/2011, Annex II), as codes; the words are the browser's, in
the reader's language. The CHECK keeps the column to those fourteen, so a code
the client does not know can never be stored and then shown as nothing.

A dish's section must be a section of the SAME business, and that is said
twice. The API checks it; and the foreign key is on (section_id, org_id)
rather than on section_id alone, so the database refuses a dish filed under a
neighbour's section even if the API forgot to. A plain foreign key would not:
Postgres checks it as the table's owner, past row-level security, so it would
find the neighbour's section and accept it. With `org_id` in the key, the
section has to carry the dish's own org -- which `org_isolation` has already
forced to be the caller's.

The order is the manager's (`position`), not the alphabet's: a menu reads
starters first. `created_at` breaks a tie and defaults to clock_timestamp()
rather than now(), so two rows added in one transaction keep the order they
were added in instead of leaving it to a random uuid.

Both tables carry `org_id` and sit behind `org_isolation`, like every other
tenant table.
"""

from alembic import op

revision = "0033_menu"
down_revision = "0032_inventory_receiving"
branch_labels = None
depends_on = None

TABLES = ("menu_section", "menu_dish")

# The fourteen allergens of Annex II of Regulation (EU) 1169/2011, in the order
# the menu shows them. The same list, in the same order, is
# `app/schemas/menu.py::ALLERGENS` and the frontend's `lib/menu`. Written out
# here rather than imported: a migration is a record of what the schema WAS,
# and must not change when the application's list does.
ALLERGENS = (
    "gluten",
    "crustaceans",
    "eggs",
    "fish",
    "peanuts",
    "soy",
    "milk",
    "nuts",
    "celery",
    "mustard",
    "sesame",
    "sulphites",
    "lupin",
    "molluscs",
)

UPGRADE_STATEMENTS = [
    # UNIQUE (id, org_id) looks redundant next to the primary key, and is not:
    # it is what the dish's foreign key on (section_id, org_id) points at.
    """
    CREATE TABLE IF NOT EXISTS menu_section (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
        position integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        UNIQUE (id, org_id)
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_menu_section_org_id ON menu_section (org_id, position)",
    """
    CREATE TABLE IF NOT EXISTS menu_dish (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        section_id uuid NOT NULL,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
        description text CHECK (length(description) <= 500),
        price numeric(8, 2) CHECK (price >= 0 AND price < 100000),
        allergens text[] NOT NULL DEFAULT '{}'
            CHECK (allergens <@ ARRAY[%(allergens)s]::text[]),
        available boolean NOT NULL DEFAULT true,
        position integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (section_id, org_id)
            REFERENCES menu_section (id, org_id) ON DELETE CASCADE
    )
    """
    % {"allergens": ", ".join("'%s'" % a for a in ALLERGENS)},
    # The order a section's dishes are read in, and the index the cascade from
    # a deleted section finds them by.
    "CREATE INDEX IF NOT EXISTS ix_menu_dish_section_id ON menu_dish (section_id, position)",
    # The whole menu is read by business, and so is the ceiling on its dishes:
    # without this both are a scan of every business's dishes.
    "CREATE INDEX IF NOT EXISTS ix_menu_dish_org_id ON menu_dish (org_id)",
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
