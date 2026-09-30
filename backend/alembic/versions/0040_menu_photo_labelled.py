from __future__ import annotations

"""menu_dish_photo.labelled: the photo already carries the dish's name

Revision ID: 0040_menu_photo_labelled
Revises: 0039_casa_demo_photos
Create Date: 2026-09-27

Max asked for the menu's tiles to look like Casa Demo's till: the photo to
the edges, the name printed over it at the top, the price at the bottom. The
app prints the name over a photo -- but the nineteen photos 0039 loaded were
cut from a picture of that till, and the till had already printed the name on
each. Printed again, it would read twice, one over the other.

So a photo says whether its name is on it already. False for every photo a
manager uploads (a picture of the dish: the app names it); true for the ones
0039 cut from the till.

WHICH ONES ARE THOSE. 0039's photos are the only ones with no width: it did
not read their headers, and an upload always does (routers/menu.py). So:
the photos of the business in `casa-demo` whose width is NULL. A photo the
manager put there since has a width and stays false.

Reversible: the downgrade drops the column.
"""

import sqlalchemy as sa
from alembic import op

revision = "0040_menu_photo_labelled"
down_revision = "0039_casa_demo_photos"
branch_labels = None
depends_on = None


def mark(bind) -> int:
    """Mark 0039's photos as carrying their name; how many. Separate from
    `upgrade` so a test can run it."""
    return bind.execute(
        sa.text(
            "UPDATE menu_dish_photo p SET labelled = true "
            "FROM organization o "
            "WHERE o.id = p.org_id AND o.client_key = 'casa-demo' "
            "AND p.width IS NULL AND NOT p.labelled"
        )
    ).rowcount


def upgrade() -> None:
    op.execute(
        "ALTER TABLE menu_dish_photo "
        "ADD COLUMN IF NOT EXISTS labelled boolean NOT NULL DEFAULT false"
    )
    mark(op.get_bind())


def downgrade() -> None:
    op.execute("ALTER TABLE menu_dish_photo DROP COLUMN IF EXISTS labelled")
