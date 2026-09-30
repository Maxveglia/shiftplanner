from __future__ import annotations

"""An extra hour is measured against the contract, not against the statute

Revision ID: 0022_overtime_over_contract
Revises: 0021_generation_jobs
Create Date: 2026-09-17

Art. 35.1 ET defines an extra hour as one worked "sobre la duracion maxima de
la jornada ordinaria de trabajo" -- and that maximum is the one in the person's
own contract. This product measured it against the statutory figure instead:
40 hours a week, or the convenio's 1,783-hour year, both of which describe a
FULL-TIME contract and neither of which describes somebody on twenty hours.

The consequence was not subtle. A 20-hour contract could be worked at
thirty-five hours every week of the year and generate no extra hour anywhere in
the product: the excess was compared against a full-timer's year and never
reached it. The people the rules exist to protect were the people they did not
reach.

WHAT THIS MIGRATION CARRIES. Two things the code cannot hold on its own.

FIRST, the rules that say what the excess BECOMES, seeded onto the existing
`ES` profile -- the four-month window that lets rest answer an extra hour
(art. 35.1), the ban on extra hours in a part-time contract (art. 12.4.c), and
the ceilings on the complementary hours that take their place (art. 12.5).
They go on the statutory profile rather than into the code for the reason the
first of them did: a convenio may improve any of them, and improving it should
be a row in a table.

SECOND, `contract.complementary_pct` -- the share of the contract agreed IN
WRITING as complementary hours. NULL means no pact, and NULL is not zero: it is
the difference between "these hours were agreed" and "these hours could not
lawfully be required of this person". Nothing is backfilled, so every contract
that exists today reads as having no pact, which is the truth about them: this
product never asked.

Reversible. The downgrade drops the column and the rules; the figures come back
with `python -m app.seeds.labor` on a database that has no `ES` profile, or
with this migration.
"""

from alembic import op

revision = "0022_overtime_over_contract"
down_revision = "0021_generation_jobs"
branch_labels = None
depends_on = None


#: (rule_type, threshold, unit, reference_window, computation_method, notes)
#: The same figures `app/seeds/labor.py` carries for a fresh database. Written
#: out again rather than imported because a migration has to keep working when
#: the seeder moves on -- it describes the database at THIS revision.
RULES = [
    (
        "overtime_compensation_months",
        "4",
        "months",
        "year",
        "rest_within_window_after_hours",
        "Art. 35.1 ET: absent an agreement to pay them, extra hours are "
        "understood to be compensated with equivalent paid rest within the four "
        "months following. Art. 35.2 excludes the compensated ones from the "
        "80-hour cap.",
    ),
    (
        "part_time_no_overtime",
        None,
        "n/a",
        "year",
        None,
        "Art. 12.4.c ET: a part-time worker may not work extraordinary hours, "
        "save for the force majeure of art. 35.3. What they work above their "
        "contract are horas complementarias.",
    ),
    (
        "complementary_hours_min_weekly",
        "10",
        "hours",
        "week",
        "compare_contracted_week",
        "Art. 12.5.a ET: complementary hours may only be agreed where the "
        "contract is for at least 10 hours a week in annual terms.",
    ),
    (
        "complementary_hours_pct_max",
        "0.30",
        "fraction_of_contracted_hours",
        "year",
        "share_of_contracted_hours",
        "Art. 12.5.c ET: agreed complementary hours may not exceed 30% of the "
        "ordinary hours of the contract.",
    ),
    (
        "complementary_hours_pct_max_by_agreement",
        "0.60",
        "fraction_of_contracted_hours",
        "year",
        "share_of_contracted_hours",
        "Art. 12.5.c ET: a convenio colectivo may raise that share to no more "
        "than 60% and no less than 30%.",
    ),
    (
        "voluntary_complementary_hours_pct",
        "0.15",
        "fraction_of_contracted_hours",
        "year",
        "share_of_contracted_hours",
        "Art. 12.5.g ET: on an open-ended part-time contract of at least 10 "
        "hours a week the employer may additionally offer voluntary "
        "complementary hours -- 15%, or 30% where a convenio says so.",
    ),
    (
        "complementary_hours_notice_days",
        "3",
        "days",
        "day",
        "notice_before_shift_start",
        "Art. 12.5.d ET: three days' notice before a complementary hour, unless "
        "the convenio sets a shorter one.",
    ),
]


def _sql(row) -> str:
    rule_type, threshold, unit, window, method, notes = row
    value = "NULL" if threshold is None else "'%s'::numeric" % threshold
    method_sql = "NULL" if method is None else "'%s'" % method
    # Idempotent per rule: seeding, re-running and a half-applied upgrade all
    # end in the same place, which is the contract every other data migration
    # here makes.
    return (
        "INSERT INTO compliance_rule "
        "(id, profile_id, rule_type, threshold, unit, reference_window, "
        " computation_method, hardness, notes) "
        "SELECT gen_random_uuid(), p.id, '{rule}', {value}, '{unit}', "
        "'{window}', {method}, 'hard', '{notes}' "
        "FROM labor_profile p WHERE p.jurisdiction_code = 'ES' "
        "AND NOT EXISTS (SELECT 1 FROM compliance_rule r "
        "                WHERE r.profile_id = p.id AND r.rule_type = '{rule}')"
    ).format(
        rule=rule_type,
        value=value,
        unit=unit,
        window=window,
        method=method_sql,
        notes=notes.replace("'", "''"),
    )


def upgrade() -> None:
    op.execute(
        "ALTER TABLE contract ADD COLUMN IF NOT EXISTS complementary_pct "
        "numeric(5, 4)"
    )
    for row in RULES:
        op.execute(_sql(row))


def downgrade() -> None:
    op.execute("ALTER TABLE contract DROP COLUMN IF EXISTS complementary_pct")
    op.execute(
        "DELETE FROM compliance_rule WHERE rule_type IN (%s)"
        % ", ".join("'%s'" % r[0] for r in RULES)
    )
