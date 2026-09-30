from __future__ import annotations

"""Casa Demo is filed under its own folder: app/clients/casa-demo/

Revision ID: 0036_casa_demo_folder
Revises: 0035_store_sales
Create Date: 2026-09-27

Casa Demo, a restaurant, signed up on 26-sep-2026 and has no folder, so it
is served the template (Turnos and Inventario). On 27-sep Max asked for a
third app for it, Tienda -- sales, their statistics and the menu -- and that
lives in its folder, `casa-demo`. This files the business there.

BY NAME, AND ONLY WHEN THE NAME IS UNAMBIGUOUS. Unlike 0034, which knew the
ids of Max's two businesses, the id is not known when this is written. So it
looks for a business with no folder whose name is "Casa Demo" (case and the
spaces around it aside), and files it only if there is EXACTLY ONE -- and no
business is in that folder already:

* none: a developer's database, the CI's, or the name was typed some other
  way. Nothing is filed, and Max files it by hand (the tooling that seeds a
  database says how, see .claude/skills/).
* two or more: a duplicate signup, or somebody else's business with the same
  name. Which one is the customer is not something to guess -- filing the
  wrong one hands a stranger's account the customer's folder -- so none is.
* one already in the folder: it is filed; a second one is not the customer.

It never fails: a deploy must not stop over a business it could not find.
`client_key IS NULL` so a business already filed somewhere else is not moved.

Reversible: the downgrade takes whatever is in `casa-demo` back to no folder,
which is the template it was on the day before.
"""

from alembic import op

revision = "0036_casa_demo_folder"
down_revision = "0035_store_sales"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF (
                SELECT count(*) FROM organization
                WHERE client_key IS NULL AND lower(btrim(name)) = 'by crispy'
            ) = 1
            AND NOT EXISTS (
                SELECT 1 FROM organization WHERE client_key = 'casa-demo'
            ) THEN
                UPDATE organization SET client_key = 'casa-demo'
                WHERE client_key IS NULL AND lower(btrim(name)) = 'by crispy';
            END IF;
        END
        $$
        """
    )


def downgrade() -> None:
    op.execute(
        "UPDATE organization SET client_key = NULL WHERE client_key = 'casa-demo'"
    )
