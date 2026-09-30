from __future__ import annotations

from datetime import time
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.absence_type import AbsenceType
from app.models.shift_template import ShiftTemplate

# Default per-org absence types seeded at signup.
#
# The NAMES here are English literals and stay that way in the database: they
# are the value every client falls back to, and rewriting them per language
# would make the row mean something different depending on who was looking.
# `code` is the stable identity the client translates instead -- see
# `absenceTypeLabel` in the frontend. A manager who renames one of these rows
# keeps his own word: the client only translates while the name is still
# exactly what we wrote below.
DEFAULT_ABSENCE_TYPES = [
    # name, code, is_paid, consumes_balance, requires_approval, is_health_data
    ("Vacation", "VAC", True, True, True, False),
    ("Personal", "PERS", False, False, True, False),
    ("Sick", "SICK", True, False, True, True),
    ("Unpaid", "UNPAID", False, False, False, False),
]

# Default per-org shift templates seeded at signup.
#
# `seed_key` is what makes these three rows OURS. It never changes and is never
# shown; the client maps it to a word in the language the manager is reading,
# exactly as `code` works for absence types above. A template created through
# the API gets no seed key, so whatever its author called it is what everyone
# sees, in every language.
DEFAULT_SHIFT_TEMPLATES = [
    # seed_key, name, start, end, unpaid_break_minutes, color, is_night, is_weekend_premium
    ("morning", "Morning", time(9, 0), time(17, 0), 30, "#3B82F6", False, False),
    ("evening", "Evening", time(15, 0), time(23, 0), 30, "#F59E0B", False, False),
    ("night", "Night", time(23, 0), time(7, 0), 30, "#6366F1", True, False),
]


def seed_org_defaults(db: Session, org_id: UUID) -> None:
    """Seed default absence types and shift templates for a new org.

    Called during signup on a session that already has the org context (or is
    a superuser session), inside the signup transaction.
    """
    for name, code, is_paid, consumes, requires, health in DEFAULT_ABSENCE_TYPES:
        db.add(
            AbsenceType(
                org_id=org_id,
                name=name,
                code=code,
                is_paid=is_paid,
                consumes_balance=consumes,
                requires_approval=requires,
                is_health_data=health,
            )
        )

    for (
        seed_key,
        name,
        start,
        end,
        brk,
        color,
        is_night,
        weekend,
    ) in DEFAULT_SHIFT_TEMPLATES:
        db.add(
            ShiftTemplate(
                org_id=org_id,
                name=name,
                seed_key=seed_key,
                start_time=start,
                end_time=end,
                unpaid_break_minutes=brk,
                color=color,
                is_night=is_night,
                is_weekend_premium=weekend,
            )
        )
