from __future__ import annotations

"""Casa Demo's menu, as its till shows it: the first load of its carta

Revision ID: 0037_casa_demo_menu
Revises: 0036_casa_demo_folder
Create Date: 2026-09-27

On 27-sep-2026 Max sent a photo of the menu on Casa Demo's till -- a grid of
tiles, each a product and its price -- and asked for it in the restaurant's
menu here (the Tienda app, app/clients/casa-demo/). This is that menu, typed
from the photo, in four sections.

WHAT THE PHOTO DID NOT SAY. Four products showed no price: two with "2
variantes" (Crispy Ahumado, Crispy Wrap), one whose price the till's own
"connection lost" banner covered (El del Puerto), and one cut off by the edge
of the photo (Ensalada Casa Demo). They are loaded without a price and NOT
available, so nobody sells them at a price nobody gave; the manager fills
them in on the menu screen. Max chose that over waiting. The photo was also
cut at the bottom: what was below it is not here.

ONCE, AND ADDING ONLY. It runs for the business filed under `casa-demo`
(0036) and adds what its menu does not already have: a section is found by
its name before one is made, and a dish whose name the business already has
anywhere on its menu is left alone. A menu the manager has started is added
to, never overwritten; a database without that business (a developer's, the
CI's) is untouched. Names are compared without case or the spaces round them.
From the day this runs the menu is the manager's: what they change on the
screen is what it is, and nothing here is read again.

The data is written out here rather than read from a file: a migration is a
record of what was done, and must not change if a file does.

Not reversible in any useful sense: by the time anyone downgrades, the
manager may have edited, sold or deleted these dishes, and a downgrade that
deleted them by name would take the manager's work with it. The downgrade
does nothing.
"""

from decimal import Decimal

import sqlalchemy as sa
from alembic import op

revision = "0037_casa_demo_menu"
down_revision = "0036_casa_demo_folder"
branch_labels = None
depends_on = None

CLIENT_KEY = "casa-demo"

# (section, [(dish, price or None, description or None)]), in the order the
# menu shows them. The till lists its tiles alphabetically; here the house
# product comes first, by size, then the combos, the salad and the drinks.
MENU = (
    (
        "Crispy",
        (
            ("Crispy Pequeño", Decimal("6.50"), None),
            ("Crispy Grande", Decimal("10.00"), None),
            ("Crispy XL", Decimal("13.00"), None),
            ("Crispy Curry Pequeño", Decimal("6.50"), None),
            ("Crispy Curry Grande", Decimal("10.00"), None),
            ("Crispy Mango Curry Pequeño", Decimal("6.50"), None),
            ("Crispy Curry Mango Grande", Decimal("10.00"), None),
            ("Crispy Smash", Decimal("3.50"), None),
            ("Crispy Wrap", None, "2 variantes"),
            ("Crispy Ahumado", None, "2 variantes"),
        ),
    ),
    (
        "Combos",
        (
            ("Combo Crispy Pequeño", Decimal("7.50"), None),
            ("Combo Crispy Grande", Decimal("11.00"), None),
            ("Combo Crispy XL", Decimal("15.00"), None),
            ("Combo Crispy Smash", Decimal("6.00"), None),
            ("Combo Crispy Wrap", Decimal("7.00"), None),
            ("El del Puerto", None, None),
        ),
    ),
    (
        "Ensaladas",
        (("Ensalada Casa Demo", None, None),),
    ),
    (
        "Bebidas",
        (
            ("Agua", Decimal("1.00"), None),
            ("Caprisun", Decimal("1.50"), None),
            ("Coca-Cola", Decimal("1.50"), None),
        ),
    ),
)


def load(bind) -> int:
    """Add the menu to every business filed under `casa-demo`; the number
    of dishes added. Separate from `upgrade` so a test can run it twice."""
    added = 0
    orgs = bind.execute(
        sa.text("SELECT id FROM organization WHERE client_key = :key ORDER BY created_at"),
        {"key": CLIENT_KEY},
    ).scalars().all()
    for org_id in orgs:
        # The tables are behind RLS. The migration's role may bypass it, but
        # saying which business this is keeps it right if it one day does not.
        bind.execute(
            sa.text("SELECT set_config('app.current_org_id', :org, true)"),
            {"org": str(org_id)},
        )
        for section_name, dishes in MENU:
            section_id = bind.execute(
                sa.text(
                    "SELECT id FROM menu_section WHERE org_id = :org "
                    "AND lower(btrim(name)) = lower(:name) "
                    "ORDER BY position, created_at LIMIT 1"
                ),
                {"org": org_id, "name": section_name},
            ).scalar()
            if section_id is None:
                section_id = bind.execute(
                    sa.text(
                        "INSERT INTO menu_section (org_id, name, position) "
                        "VALUES (:org, :name, (SELECT coalesce(max(position) + 1, 0) "
                        "FROM menu_section WHERE org_id = :org)) RETURNING id"
                    ),
                    {"org": org_id, "name": section_name},
                ).scalar_one()
            for name, price, description in dishes:
                taken = bind.execute(
                    sa.text(
                        "SELECT 1 FROM menu_dish WHERE org_id = :org "
                        "AND lower(btrim(name)) = lower(:name) LIMIT 1"
                    ),
                    {"org": org_id, "name": name},
                ).first()
                if taken:
                    continue
                bind.execute(
                    sa.text(
                        "INSERT INTO menu_dish (org_id, section_id, name, description, "
                        "price, available, position) VALUES (:org, :section, :name, "
                        ":description, :price, :available, (SELECT coalesce("
                        "max(position) + 1, 0) FROM menu_dish WHERE section_id = :section))"
                    ),
                    {
                        "org": org_id,
                        "section": section_id,
                        "name": name,
                        "description": description,
                        "price": price,
                        # Without a price it is not sold until somebody says
                        # what it costs.
                        "available": price is not None,
                    },
                )
                added += 1
    return added


def upgrade() -> None:
    load(op.get_bind())


def downgrade() -> None:
    # See the module docstring: the menu is the manager's from the day this
    # ran, and deleting it by name could take their edits with it.
    pass
