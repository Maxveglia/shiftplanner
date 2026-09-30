from __future__ import annotations

"""store_sale, store_sale_line: what the shop sold, as the manager writes it

Revision ID: 0035_store_sales
Revises: 0034_organization_client_key
Create Date: 2026-09-27

The sales of the Tienda app, typed in by hand: there is no till behind this
yet. A sale is filed under a DAY (`sold_on`, a date with no time): the manager
is recording "what we sold on Saturday", and a date has no time zone to get
wrong -- a timestamp typed at 00:30 in Madrid would be the day before in UTC,
and the statistics would put it there. Its lines say what was sold: a dish of
the menu, or a free line ("Caja del día", 850 €), each with a quantity. The
sale's total is the sum of its lines, worked out when it is read and never
stored, so there is no second copy of it to disagree with the first.

A line keeps the dish's NAME and PRICE as they were on the day, copied from
the menu and editable before saving: a sale is a record of what happened, and
renaming a dish or raising its price next month must not rewrite last month's
takings. `amount` is unit_price x quantity to the cent -- numeric(10, 2) times
numeric(12, 3) -- rounded when read, half up, like a till would.

`dish_id` says which dish of the menu a line was, so the statistics can add up
a dish sold under two spellings. It is deliberately NOT a foreign key:

* It is history, not a link. Nothing is ever read through it -- the name and
  price are on the line -- so a dish taken off the menu leaves its sales as
  they were, id included, and the statistics keep counting them as one dish.
  A foreign key would have to either refuse to delete the dish (and a menu
  must be editable whatever was sold) or null the id, splitting a dish's
  history in two the day it leaves the carta.
* A foreign key would not prove what matters anyway. Postgres checks one as
  the table's owner, past row-level security, so a plain one would accept a
  neighbour's dish. 0033 closes that for a dish's section with a key on
  (section_id, org_id); here that key would have to null only `dish_id` when
  the dish goes, and `ON DELETE SET NULL (dish_id)` is Postgres 15 syntax --
  on anything older the whole key, org_id included, is nulled and the delete
  fails. Not a bet to make on a deploy.
So the API is what checks it: a dish_id that is not a dish of this business's
menu at the moment of saving is a 422 (routers/store.py).

`client_ref` is made up by the browser once per sale, as the phone does for a
delivery (0032): a save whose answer was lost is sent again with the same ref
and answered with the sale already kept, instead of counting the takings
twice. NOT NULL here, unlike the receipt's: every client that saves a sale
sends one.

`source` is where the sale came from. Only 'manual' today; it is here so that
sales imported from a till (SumUp) can sit in the same table later and be told
apart, without touching the rows already there. The CHECK keeps it to the
sources that exist: the migration that brings the first import widens it.

A line's sale must be a sale of the SAME business: the key is on
(sale_id, org_id), for the reason 0033 gives -- a plain one is checked past
row-level security and would take a neighbour's sale.

Both tables carry `org_id` and sit behind `org_isolation`, like every other
tenant table.
"""

from alembic import op

revision = "0035_store_sales"
down_revision = "0034_organization_client_key"
branch_labels = None
depends_on = None

TABLES = ("store_sale", "store_sale_line")

UPGRADE_STATEMENTS = [
    # UNIQUE (id, org_id) looks redundant next to the primary key, and is not:
    # it is what the line's foreign key on (sale_id, org_id) points at.
    """
    CREATE TABLE IF NOT EXISTS store_sale (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        sold_on date NOT NULL,
        note text CHECK (length(note) <= 2000),
        source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual')),
        client_ref uuid NOT NULL,
        created_by uuid REFERENCES user_account(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (id, org_id),
        UNIQUE (org_id, client_ref)
    )
    """,
    # The list and the statistics both read a business's sales by day.
    "CREATE INDEX IF NOT EXISTS ix_store_sale_org_id ON store_sale (org_id, sold_on)",
    # The UNIQUE (sale_id, position) already indexes sale_id (it leads), which
    # is how a sale's lines are read and how the cascade from a deleted sale
    # finds them.
    """
    CREATE TABLE IF NOT EXISTS store_sale_line (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        sale_id uuid NOT NULL,
        dish_id uuid,
        name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
        unit_price numeric(10, 2) NOT NULL
            CHECK (unit_price >= 0 AND unit_price < 1000000),
        quantity numeric(12, 3) NOT NULL
            CHECK (quantity > 0 AND quantity < 1000000),
        position integer NOT NULL CHECK (position >= 0),
        UNIQUE (sale_id, position),
        FOREIGN KEY (sale_id, org_id)
            REFERENCES store_sale (id, org_id) ON DELETE CASCADE
    )
    """,
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
