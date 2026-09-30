from __future__ import annotations

"""organization.client_key: which client folder a business is served from

Revision ID: 0034_organization_client_key
Revises: 0033_menu
Create Date: 2026-09-26

Every business is going to have software shaped to it, and what differs lives
in a folder of the backend, `app/clients/<client_key>/` (see
`app/clients/__init__.py`). This column is the pointer from the row to the
folder.

NULL is a business nobody has set up yet. It is served the template -- no apps,
only the login and the look -- which is where every new signup starts from
now on.

THE CHECK is the folder-name rule, and the reason it is in the database and
not only in the code: the value becomes a directory name. Lower case, digits
and hyphens, starting with a letter or digit, at most 40 -- so it cannot be
`..`, cannot hide behind a capital on a case-insensitive filesystem, and can
never be `_template`, which is how the template stays unreachable by name.
The code repeats the same pattern for the folders themselves.

THE BACKFILL. The two organizations in production when this was written both
belong to Max, whose folder is `max`; filing them there is what keeps his
product exactly as it was the moment before -- without it, both would fall to
the template and wake up with no apps. By id, not "every row there is": the
signup is public, and a business that signs up between this commit and the
deploy is a new business like any other -- it starts with no apps, and must
not start with Max's. A database where neither id exists (a developer's, the
CI's) files nothing, and its businesses start empty like a new signup; the
tooling that seeds one says to file it by hand (see .claude/skills/).
`client_key IS NULL` so a re-run cannot move a business filed elsewhere since.

No new grant: `app_user` holds SELECT on the whole of `organization` since
0001, and a table-level grant covers columns added after it.

Reversible. The downgrade drops the column, which is the state of the product
before this revision: one set of apps for everybody.
"""

from alembic import op

revision = "0034_organization_client_key"
down_revision = "0033_menu"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE organization ADD COLUMN IF NOT EXISTS client_key text")
    op.execute(
        "ALTER TABLE organization DROP CONSTRAINT IF EXISTS "
        "ck_organization_client_key"
    )
    op.execute(
        "ALTER TABLE organization ADD CONSTRAINT ck_organization_client_key "
        "CHECK (client_key ~ '^[a-z0-9][a-z0-9-]{0,39}$')"
    )
    op.execute(
        "UPDATE organization SET client_key = 'max' "
        "WHERE client_key IS NULL AND id IN ("
        "'bf5c2f26-472a-4646-8fb5-4d274dbb4776', "
        "'7a98d155-8aa4-414c-bc84-44f209938665')"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE organization DROP CONSTRAINT IF EXISTS "
        "ck_organization_client_key"
    )
    op.execute("ALTER TABLE organization DROP COLUMN IF EXISTS client_key")
