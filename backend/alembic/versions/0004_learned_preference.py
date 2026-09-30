from __future__ import annotations

"""bridge: reconcile the revision production is already stamped with

Revision ID: 0004_learned_preference
Revises: 0003_backoffice
Create Date: 2026-09-02

THIS MIGRATION DELIBERATELY DOES NOTHING. It exists so that Alembic can
resolve a revision the production database is already stamped with.

What happened: the Railway service is not connected to the repository, so a
deploy uploads whatever is in a local directory. A deploy on 2026-09-02 was
made from a working copy that contained a migration named
``0004_learned_preference``. It ran against production and stamped the
database. That file was never committed, and the directory it came from has
since been overwritten -- it survives in no branch, no commit and no
workspace, only as a row in ``alembic_version``.

The next deploy that came from ``main`` therefore could not start: Alembic
refused with "Can't locate revision identified by '0004_learned_preference'",
the entrypoint failed, and the container restarted in a loop.

Recreating the real migration is not possible -- its contents are gone. The
choice was between editing production's ``alembic_version`` by hand and
carrying an empty revision with the right identity. This is the second: it
touches no data, and it leaves the evidence in the repository where the next
person will find it instead of in a shell history.

Whatever the lost migration created is still in the production database. No
model in this repository references it, so nothing reads or writes it. If that
feature ever comes back, its migration must be written to tolerate objects that
already exist -- or it must be given a new revision id and this bridge removed.

The underlying cause is the deploy path, not the database. Connecting the
service to the repository so that ``main`` is what ships is what stops this
from happening again.
"""

revision = "0004_learned_preference"
down_revision = "0003_backoffice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Intentionally empty -- see the module docstring."""


def downgrade() -> None:
    """Intentionally empty -- there is nothing to undo."""
