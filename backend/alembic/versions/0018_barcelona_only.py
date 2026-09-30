from __future__ import annotations

"""One market: Barcelona, and the law that governs a business in it

Revision ID: 0018_barcelona_only
Revises: 0017_api_usage_duration
Create Date: 2026-09-14

This product was seeded with three American jurisdictions -- federal,
California, Arizona -- because it was written before it had a customer and the
FLSA is the rule set every example uses. It has one market now: bars,
restaurants and shops in Barcelona. Offering a manager here a choice between
California and Arizona is not neutrality, it is three wrong answers and no
right one.

So the American profiles go, and with them every rule hanging off them. The
Spanish ones stay: `ES` is the statute, `ES-CT-HOSTELERIA` the hospitality
agreement a bar lives by, and `ES-CT-COMERCIO` names what a shop's own branch
agreement has to supply.

WHERE THE EXISTING BUSINESSES LAND. Anything still filed under an American
jurisdiction moves to `ES-CT-HOSTELERIA`, and that is a decision worth writing
down rather than a default: at the time of writing this product has one
customer and it is a bar in Barcelona, so hospitality is not a guess, it is
the answer. A migration that moved it to the bare statute instead would leave
the only real business without the 25% night premium its agreement gives its
staff -- a quieter outcome, and the wrong one. A manager whose business is a
shop changes it in Settings in one click, which is the same click they would
have needed either way.

The three premiums move with the country, exactly as the jurisdiction endpoint
moves them: 25% at night, no weekend premium, and overtime paid as an ordinary
hour (art. 35.1 ET). Leaving the American 15/10/1.5 under a Spanish
jurisdiction would price every rota wrong in a way nothing on screen explains.

IRREVERSIBLE BY DESIGN. The downgrade puts the organisations back on `US-FED`
so an older build can read them, but it does not recreate the American rule
sets: they are seed data, and `python -m app.seeds.labor` from the commit
before this one is where they come from.
"""

from alembic import op

revision = "0018_barcelona_only"
down_revision = "0017_api_usage_duration"
branch_labels = None
depends_on = None

AMERICAN = ("US-FED", "US-CA", "US-AZ")


def upgrade() -> None:
    # Organisations first: a profile row is deleted below, and an org left
    # pointing at a code with no rules behind it would plan to no rules at all.
    op.execute(
        """
        UPDATE organization
        SET jurisdiction_code = 'ES-CT-HOSTELERIA',
            night_differential_pct = 25,
            weekend_premium_pct = 0,
            overtime_multiplier = 1
        WHERE jurisdiction_code NOT LIKE 'ES%%'
        """
    )
    # compliance_rule hangs off labor_profile with ON DELETE CASCADE.
    op.execute(
        "DELETE FROM labor_profile WHERE jurisdiction_code IN %s" % (AMERICAN,)
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE organization
        SET jurisdiction_code = 'US-FED',
            night_differential_pct = 15,
            weekend_premium_pct = 10,
            overtime_multiplier = 1.5
        WHERE jurisdiction_code LIKE 'ES%%'
        """
    )
