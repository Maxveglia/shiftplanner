from __future__ import annotations

"""menu_dish_photo: one photo per dish, the bytes in Postgres

Revision ID: 0038_menu_dish_photos
Revises: 0037_casa_demo_menu
Create Date: 2026-09-27

On 27-sep-2026 Max asked for the menu to show a photo of every dish, always:
the team's menu, the dish picker of a new sale, the manager's editor. Like a
till's grid of tiles, where the picture is how a waiter finds the dish.

IN POSTGRES, NOT ON A DISK. Everything this app keeps is in the database; the
container's disk is thrown away at every deploy, and there is no bucket. A
photo is small -- the browser shrinks it to 800 px and a JPEG before sending
it, some 60-150 KB -- and a menu has tens of them, so a business's photos are
a few megabytes: nothing a table cannot hold. `data` is capped at 512 KB, the
same wall the API says (app/services/menu_photos.py), and stored EXTERNAL:
out of line, like any large value, but without trying to compress what JPEG,
PNG and WebP already have.

ONE PER DISH (`dish_id` UNIQUE), and replacing it makes a NEW row: the old one
is deleted and the new one gets a new random `id`. The id is what the photo's
URL carries (`/api/v1/menu/photos/<id>`, routers/menu_photos.py), and a URL
that names one set of bytes forever can be cached by a browser for a year --
a new photo is a new URL, so nobody is shown the old one from a cache.

THAT URL IS PUBLIC, because an <img> cannot send the token (it travels in a
header, and there are no cookies). What keeps a photo out of strangers' hands
is that the id is random -- 122 bits -- and is only ever given out by the
authenticated `GET /menu`. These are photos of dishes on a menu; this table
holds nothing else, and nothing else is served from it.

A photo's dish must be a dish of the SAME business, said the way 0033 says it
for a dish's section: the foreign key is on (dish_id, org_id), so the database
refuses a photo filed under a neighbour's dish even if the API forgot to check.
That needs UNIQUE (id, org_id) on menu_dish, which 0033 did not give it (no
key pointed at a dish then), so it is added here. Deleting the dish deletes
its photo, in the same statement -- and so does deleting its section, and the
business.

The table carries `org_id` and sits behind `org_isolation`, like every other
tenant table. The public route reads it on the admin session, by id: there is
no business in context to read it as.

`content_type` is one of the three the API accepts, as the bytes proved them.
`width` and `height` are what the file's header said on upload; NULL where
nobody read them (the photos 0039 loads).

The downgrade drops the table, and the photos with it.
"""

from alembic import op

revision = "0038_menu_dish_photos"
down_revision = "0037_casa_demo_menu"
branch_labels = None
depends_on = None

TABLE = "menu_dish_photo"

# The same numbers as app/services/menu_photos.py, written out: a migration is
# a record of what the schema was, and must not move when the app's do.
TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_BYTES = 512 * 1024

UPGRADE_STATEMENTS = [
    # What the photo's foreign key on (dish_id, org_id) points at. Named, so
    # the downgrade can take back exactly this and nothing else.
    """
    DO $$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'menu_dish'::regclass
              AND conname = 'menu_dish_id_org_id_key'
        ) THEN
            ALTER TABLE menu_dish
                ADD CONSTRAINT menu_dish_id_org_id_key UNIQUE (id, org_id);
        END IF;
    END
    $$
    """,
    """
    CREATE TABLE IF NOT EXISTS menu_dish_photo (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        dish_id uuid NOT NULL UNIQUE,
        content_type text NOT NULL CHECK (content_type IN (%(types)s)),
        data bytea NOT NULL CHECK (octet_length(data) BETWEEN 1 AND %(max_bytes)d),
        width integer CHECK (width > 0),
        height integer CHECK (height > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (dish_id, org_id)
            REFERENCES menu_dish (id, org_id) ON DELETE CASCADE
    )
    """
    % {
        "types": ", ".join("'%s'" % t for t in TYPES),
        "max_bytes": MAX_BYTES,
    },
    # Already compressed: don't spend a pass of pglz on every write to find so.
    "ALTER TABLE menu_dish_photo ALTER COLUMN data SET STORAGE EXTERNAL",
    # The cascade from a deleted business finds its photos by this; the one
    # from a deleted dish by the UNIQUE on dish_id.
    "CREATE INDEX IF NOT EXISTS ix_menu_dish_photo_org_id ON menu_dish_photo (org_id)",
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
    op.execute("ALTER TABLE menu_dish DROP CONSTRAINT IF EXISTS menu_dish_id_org_id_key")
