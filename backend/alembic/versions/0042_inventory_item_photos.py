from __future__ import annotations

"""inventory_item_photo: one photo per product of the stock, the bytes in Postgres

Revision ID: 0042_inventory_item_photos
Revises: 0041_store_recipes
Create Date: 2026-09-27

On 27-sep-2026 Max asked for every product of the inventory to be able to
have a photo, "so it is more intuitive to order things": whoever counts the
shelf, takes in a delivery or picks an ingredient for a recipe finds the
product by its face, not only by its name. Optional: a product with none is
as it was.

THE SAME AS A DISH'S PHOTO (0038), table for table, so read that one for the
why of each choice. In short:

* IN POSTGRES, NOT ON A DISK: the container's disk is thrown away at every
  deploy, and there is no bucket. The browser shrinks a photo to 800 px and a
  JPEG before sending it, some 60-150 KB. `data` is capped at 512 KB, the wall
  the API says (app/services/photos.py), and stored EXTERNAL: out of line,
  without trying to compress what JPEG, PNG and WebP already have.
* ONE PER PRODUCT (`item_id` UNIQUE); replacing it makes a NEW row with a new
  random `id`, which is what the photo's URL carries
  (`/api/v1/inventory/photos/<id>`, routers/inventory_photos.py). A URL that
  names one set of bytes forever can be cached by a browser for a year.
* THAT URL IS PUBLIC, because an <img> cannot send the token. What keeps a
  photo out of strangers' hands is that the id is random -- 122 bits -- and is
  only ever given out by the authenticated routes that list products.
* THE SAME BUSINESS: the foreign key is on (item_id, org_id), so the database
  refuses a photo filed under a neighbour's product even if the API forgot to
  check. The UNIQUE (id, org_id) it points at is 0041's
  (`inventory_item_id_org_id_key`). Deleting the product deletes its photo in
  the same statement -- and so does deleting the business. (Products are
  archived rather than deleted by the API; an archived one keeps its photo.)
* `org_id` and `org_isolation`, like every other tenant table. The public
  route reads it on the admin session, by id: there is no business in
  context to read it as.

ONE DIFFERENCE: `width` and `height` are NOT NULL. A dish's could be NULL for
the photos a migration loaded without reading their headers (0039); every
product's photo comes through the API, which always reads them.

The downgrade drops the table, and the photos with it. It leaves 0041's
UNIQUE on inventory_item alone: that one is 0041's to take back.
"""

from alembic import op

revision = "0042_inventory_item_photos"
down_revision = "0041_store_recipes"
branch_labels = None
depends_on = None

TABLE = "inventory_item_photo"

# The same numbers as app/services/photos.py, written out: a migration is a
# record of what the schema was, and must not move when the app's do.
TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_BYTES = 512 * 1024

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS inventory_item_photo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        item_id uuid NOT NULL UNIQUE,
        content_type text NOT NULL CHECK (content_type IN (%(types)s)),
        data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND %(max_bytes)d),
        width integer NOT NULL CHECK (width > 0),
        height integer NOT NULL CHECK (height > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (item_id, org_id)
            REFERENCES inventory_item (id, org_id) ON DELETE CASCADE
    )
    """
    % {
        "types": ", ".join("'%s'" % t for t in TYPES),
        "max_bytes": MAX_BYTES,
    },
    # Already compressed: don't spend a pass of pglz on every write to find so.
    "ALTER TABLE inventory_item_photo ALTER COLUMN data SET STORAGE EXTERNAL",
    # The cascade from a deleted business finds its photos by this; the one
    # from a deleted product by the UNIQUE on item_id.
    "CREATE INDEX IF NOT EXISTS ix_inventory_item_photo_org_id "
    "ON inventory_item_photo (org_id)",
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
