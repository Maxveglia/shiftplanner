from __future__ import annotations

"""shift templates: a stable key for the three rows WE wrote

Revision ID: 0008_shift_template_seed_key
Revises: 0007_business_day_shape
Create Date: 2026-09-03

Every org is seeded at signup with "Morning", "Evening" and "Night" -- English
literals, identical for every tenant. The interface is translated, the rows are
not, so a Spanish calendar showed blocks labelled "Evening" and "Night" beside
blocks labelled "Tarde-noche" and "Noche": the same shift written in two
languages on the same screen, depending only on whether it came from a template
or was synthesised.

Names cannot be translated in place -- a name is what the manager reads AND what
he is allowed to change -- so the row keeps a code instead and the client turns
the code into a word. That is what ``seed_key`` is: 'morning', 'evening',
'night', never shown, never changed.

NULL is the meaningful default: it means "a human wrote this template", and its
name is then shown exactly as typed, in every language. That is the rule the
whole feature rests on -- what the customer wrote is never translated, what we
seeded is.

The backfill catches the orgs that already exist. It matches on the HOURS
(start, end, is_night), not on the name: two managers can both have a template
called "Night" that means different things, but a row that starts at 23:00,
ends at 07:00 and is flagged as a night shift is the one we seeded. The name is
still checked, as a second condition and against the exact English literal
``app/services/seeding.py`` writes: a manager who has renamed his template has
told us what he wants it called, and adopting that row would replace his word
with ours. Re-running is a no-op -- only rows still NULL are touched.
"""

from alembic import op

revision = "0008_shift_template_seed_key"
down_revision = "0007_business_day_shape"
branch_labels = None
depends_on = None


ADD_COLUMN = (
    "ALTER TABLE shift_template ADD COLUMN IF NOT EXISTS seed_key varchar"
)

# (seed_key, seeded name, start, end, is_night) -- must stay identical to
# DEFAULT_SHIFT_TEMPLATES in app/services/seeding.py.
SEEDED = [
    ("morning", "Morning", "09:00", "17:00", "false"),
    ("evening", "Evening", "15:00", "23:00", "false"),
    ("night", "Night", "23:00", "07:00", "true"),
]

BACKFILL = """
UPDATE shift_template
SET seed_key = '{key}'
WHERE seed_key IS NULL
  AND start_time = TIME '{start}'
  AND end_time = TIME '{end}'
  AND is_night IS {is_night}
  AND name = '{name}'
"""


def upgrade() -> None:
    op.execute(ADD_COLUMN)
    for key, name, start, end, is_night in SEEDED:
        op.execute(
            BACKFILL.format(
                key=key, name=name, start=start, end=end, is_night=is_night
            )
        )


def downgrade() -> None:
    op.execute("ALTER TABLE shift_template DROP COLUMN IF EXISTS seed_key")
