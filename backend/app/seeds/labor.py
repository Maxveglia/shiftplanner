from __future__ import annotations

"""Global labor reference-data seeder.

Run with:  python -m app.seeds.labor

Seeds the ``labor_profile`` / ``compliance_rule`` tables (global reference data,
no org, no RLS). Idempotent: existing jurisdictions are left untouched. Uses the
ADMIN (superuser) engine because these global tables grant only SELECT to the
restricted runtime role.
"""

from datetime import date
from decimal import Decimal
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import AdminSessionLocal
from app.models.compliance_rule import ComplianceRule
from app.models.labor_profile import LaborProfile

EFFECTIVE = date(2024, 1, 1)


def _rule(
    rule_type: str,
    unit: str,
    reference_window: str,
    hardness: str,
    threshold: Optional[Decimal] = None,
    premium_multiplier: Optional[Decimal] = None,
    computation_method: Optional[str] = None,
    notes: Optional[str] = None,
) -> ComplianceRule:
    return ComplianceRule(
        rule_type=rule_type,
        threshold=threshold,
        unit=unit,
        reference_window=reference_window,
        computation_method=computation_method,
        hardness=hardness,
        premium_multiplier=premium_multiplier,
        notes=notes,
    )


def _es_rules() -> List[ComplianceRule]:
    """Spain, statutory floor (Estatuto de los Trabajadores, RDL 2/2015).

    Written as the FLOOR, not as the whole answer: almost every figure here
    can be improved by a convenio colectivo and none of them can be worsened
    by one. The sector agreement is a separate profile that inherits from this
    one (see _es_ct_hosteleria_rules), which is where the numbers a bar in
    Barcelona actually lives by come from.

    WHAT IS DELIBERATELY NOT HERE. The in-shift break -- 15 minutes once a day
    runs past 6 hours (art. 34.4) -- is not seeded: it is real, and it is kept
    off the calendar on purpose, because staff take it as the shift runs and
    putting it in the rota would only cut every shift into two.
    """
    return [
        # --- Rest, the two rules a rota breaks first. ---------------------
        _rule(
            rule_type="daily_rest_between_shifts",
            threshold=Decimal("12"),
            unit="hours",
            reference_window="day",
            hardness="hard",
            computation_method="gap_between_consecutive_shifts",
            notes="Art. 34.3 ET: at least 12 hours between the end of one "
            "shift and the start of the next. Twelve, not the eleven of the "
            "EU directive (2003/88/EC art. 3) -- Spain improves on it, and a "
            "rota built to the European figure is an hour short here.",
        ),
        _rule(
            rule_type="weekly_rest_hours",
            threshold=Decimal("36"),
            unit="hours",
            reference_window="week",
            hardness="hard",
            computation_method="longest_gap_in_week",
            notes="Art. 37.1 ET: a day and a half without interruption every "
            "week -- 36 hours, normally Saturday afternoon or Monday morning "
            "plus the Sunday. It may be accumulated over periods of up to 14 "
            "days, which is how a hospitality rota runs alternate weekends.",
        ),
        # --- How long a day may be. ---------------------------------------
        _rule(
            rule_type="max_daily_ordinary_hours",
            threshold=Decimal("9"),
            unit="hours",
            reference_window="day",
            hardness="hard",
            notes="Art. 34.3 ET: no more than 9 ordinary hours in a day "
            "unless a convenio colectivo agrees another distribution (it "
            "usually does, and the 12-hour rest between days still holds "
            "whatever it says). Under-18s may never exceed 8, and that one is "
            "not negotiable by agreement.",
        ),
        _rule(
            rule_type="weekly_ordinary_hours_average",
            threshold=Decimal("40"),
            unit="hours",
            reference_window="year",
            hardness="hard",
            computation_method="average_over_reference_window",
            notes="Art. 34.1 ET: 40 hours a week of effective work AS AN "
            "ANNUAL AVERAGE. Not a weekly ceiling: a 45-hour week is lawful "
            "if the year averages out, which is the opposite of the FLSA "
            "reading and the single most common way an American rule set "
            "gets Spain wrong. Up to 10% of the year may be distributed "
            "irregularly, with 5 days' notice (art. 34.2) -- the two rules "
            "below, which is where those figures are computable from.",
        ),
        # --- Irregular distribution: the price of the annual average. ------
        #
        # These two are what makes the rule above usable rather than merely
        # true. An annual average permits a 45-hour week, but not ANY 45-hour
        # week: the employer may move only a tenth of the year around, and may
        # not spring it on somebody. Both figures lived in the note above as
        # prose until now, which meant the app could recite art. 34.2 and not
        # check it.
        _rule(
            rule_type="irregular_distribution_pct",
            threshold=Decimal("0.10"),
            unit="fraction_of_annual_hours",
            reference_window="year",
            hardness="hard",
            computation_method="share_of_annual_hours_moved",
            notes="Art. 34.2 ET: absent an agreement, the employer may "
            "distribute 10% of the annual working time irregularly across the "
            "year. A convenio colectivo may agree a different share, and when "
            "it does that figure replaces this one -- which is why this is a "
            "rule in the statutory profile rather than a constant in the code.",
        ),
        _rule(
            rule_type="irregular_distribution_notice_days",
            threshold=Decimal("5"),
            unit="days",
            reference_window="day",
            hardness="hard",
            computation_method="notice_before_shift_start",
            notes="Art. 34.2 ET: the employee must know the day and the hour "
            "of the work owed at least 5 days in advance. The notice is "
            "counted from the moment the rota was PUBLISHED, which is the "
            "moment it stopped being the manager's draft and became something "
            "the team could read.",
        ),
        # --- Night work. The rule a bar breaks without noticing. ----------
        _rule(
            rule_type="night_work_window_start",
            threshold=Decimal("22"),
            unit="hour_of_day",
            reference_window="day",
            hardness="hard",
            notes="Art. 36.1 ET: night work is what falls between 22:00 and "
            "06:00. Same window the app already used for its differential.",
        ),
        _rule(
            rule_type="night_work_window_end",
            threshold=Decimal("6"),
            unit="hour_of_day",
            reference_window="day",
            hardness="hard",
            notes="See night_work_window_start.",
        ),
        _rule(
            rule_type="night_work_daily_average_max",
            threshold=Decimal("8"),
            unit="hours",
            reference_window="15 days",
            hardness="hard",
            computation_method="average_over_reference_window",
            notes="Art. 36.1 ET: a night worker's day may not exceed 8 hours "
            "on average over 15 days. A night worker is anyone who normally "
            "does 3+ hours of their daily shift at night, or a third of their "
            "year. This is what makes a bar's ten-hour closing shift "
            "unlawful as a habit rather than as an exception.",
        ),
        _rule(
            rule_type="night_worker_no_overtime",
            threshold=None,
            unit="n/a",
            reference_window="day",
            hardness="hard",
            notes="Art. 36.1 ET: night workers may not work overtime, save "
            "for the exceptions the article lists (shift changeovers, force "
            "majeure). So a night shift cannot be lengthened to cover a gap.",
        ),
        # --- Overtime. No statutory premium, and a hard annual cap. -------
        _rule(
            rule_type="annual_overtime_cap",
            threshold=Decimal("80"),
            unit="hours",
            reference_window="year",
            hardness="hard",
            computation_method="sum_hours_over_threshold",
            notes="Art. 35.2 ET: 80 overtime hours a year per person, and "
            "hours compensated with time off within 4 months do not count "
            "towards it. Overtime is voluntary unless the contract or the "
            "convenio says otherwise.",
        ),
        _rule(
            rule_type="no_statutory_overtime_premium",
            threshold=None,
            unit="n/a",
            reference_window="week",
            hardness="hard",
            notes="Art. 35.1 ET: an overtime hour is paid AT LEAST as much as "
            "an ordinary one, or compensated with equivalent time off within "
            "4 months. There is no 1.5x by law -- that is the FLSA, and "
            "applying it here would overstate every payroll. Whatever "
            "premium exists comes from the convenio or the contract.",
        ),
        _rule(
            rule_type="overtime_compensation_months",
            threshold=Decimal("4"),
            unit="months",
            reference_window="year",
            hardness="hard",
            computation_method="rest_within_window_after_hours",
            notes="Art. 35.1 ET: absent an agreement to pay them, extra hours "
            "are understood to be compensated with equivalent PAID REST within "
            "the four months following. Art. 35.2 then excludes the "
            "compensated ones from the 80-hour cap -- which is why this is a "
            "threshold and not a note: without it the cap fires on a rota that "
            "balanced its own long weeks with short ones.",
        ),
        # --- Part-time: a different word for the same excess. -------------
        #
        # The four rules below are what stops this product calling a
        # part-timer's extra hours OVERTIME. It is not a naming quibble: extra
        # hours are forbidden on these contracts outright, so the label would
        # put a lawful-sounding name on an unlawful thing, and the ceilings
        # that actually bind are the percentages in art. 12.5, not the 80.
        _rule(
            rule_type="part_time_no_overtime",
            threshold=None,
            unit="n/a",
            reference_window="year",
            hardness="hard",
            notes="Art. 12.4.c ET: a part-time worker may not work "
            "extraordinary hours, save for the force majeure of art. 35.3. "
            "What they work above their contract are HORAS COMPLEMENTARIAS, "
            "and those need a written pact to be owed at all.",
        ),
        _rule(
            rule_type="complementary_hours_min_weekly",
            threshold=Decimal("10"),
            unit="hours",
            reference_window="week",
            hardness="hard",
            computation_method="compare_contracted_week",
            notes="Art. 12.5.a ET: a pact for complementary hours may only be "
            "made where the contract is for at least 10 hours a week in annual "
            "terms. Below that the hours cannot be agreed at all, so the fix "
            "is the contract and never the rota.",
        ),
        _rule(
            rule_type="complementary_hours_pct_max",
            threshold=Decimal("0.30"),
            unit="fraction_of_contracted_hours",
            reference_window="year",
            hardness="hard",
            computation_method="share_of_contracted_hours",
            notes="Art. 12.5.c ET: the agreed complementary hours may not "
            "exceed 30% of the ordinary hours of the contract.",
        ),
        _rule(
            rule_type="complementary_hours_pct_max_by_agreement",
            threshold=Decimal("0.60"),
            unit="fraction_of_contracted_hours",
            reference_window="year",
            hardness="hard",
            computation_method="share_of_contracted_hours",
            notes="Art. 12.5.c ET: a convenio colectivo may raise that share, "
            "to no more than 60% and no less than the statutory 30%. Read to "
            "judge a PACT that claims more than any agreement could grant it.",
        ),
        _rule(
            rule_type="voluntary_complementary_hours_pct",
            threshold=Decimal("0.15"),
            unit="fraction_of_contracted_hours",
            reference_window="year",
            hardness="hard",
            computation_method="share_of_contracted_hours",
            notes="Art. 12.5.g ET: on an OPEN-ENDED part-time contract of at "
            "least 10 hours a week, the employer may additionally offer "
            "voluntary complementary hours -- 15%, or 30% where a convenio "
            "says so. Refusing them is not misconduct, and they do not count "
            "towards the agreed percentage above.",
        ),
        _rule(
            rule_type="complementary_hours_notice_days",
            threshold=Decimal("3"),
            unit="days",
            reference_window="day",
            hardness="hard",
            computation_method="notice_before_shift_start",
            notes="Art. 12.5.d ET: the worker must know the day and hour of a "
            "complementary hour at least 3 days beforehand, unless the convenio "
            "sets a shorter notice. Shorter than the 5 days art. 34.2 asks for "
            "an irregularly distributed shift, and a different rule from it.",
        ),
        # --- Leave, and the record everybody forgets. ---------------------
        _rule(
            rule_type="annual_leave_days",
            threshold=Decimal("30"),
            unit="calendar_days",
            reference_window="year",
            hardness="hard",
            notes="Art. 38 ET: 30 calendar days a year, never replaceable by "
            "money while the contract lives.",
        ),
        _rule(
            rule_type="time_record_retention_years",
            threshold=Decimal("4"),
            unit="years",
            reference_window="year",
            hardness="hard",
            notes="Art. 34.9 ET (RDL 8/2019): the start and end time of every "
            "worker's day must be recorded daily and kept for 4 years, "
            "available to the worker, their representatives and the "
            "Inspección de Trabajo. A published rota is not a record: what is "
            "kept has to be what actually happened.",
        ),
        _rule(
            rule_type="minimum_wage",
            threshold=Decimal("8.22"),
            unit="eur_per_hour",
            reference_window="year",
            hardness="hard",
            computation_method="compare_contract_hourly_rate",
            notes="SMI 2026 (RD of 24 February 2026): 1,221 EUR a month over "
            "14 payments = 17,094 EUR a year for a full-time year. Stated per "
            "hour against the 2,080-hour theoretical year (40 x 52) so it is "
            "an absolute floor nobody falls under; a convenio with a shorter "
            "year raises the hourly figure, which is why the sector profile "
            "carries its own. The REAL floor for a given person is their "
            "category's line in the convenio's salary table, which is above "
            "the SMI in hospitality.",
        ),
    ]


def _es_ct_hosteleria_rules() -> List[ComplianceRule]:
    """Catalonia, hospitality: convenio colectivo interprovincial 2025-2028.

    A SECTOR agreement, seeded as if it were a place, because an organization
    has one jurisdiction and a bar in Barcelona lives by this text. Anything
    not here falls through to the state profile above; nothing here may be
    worse than that profile, which is the law of agreements generally.

    Barcelona, Girona and Tarragona share the agreement but not the salary
    table -- Barcelona's is Annex II.A -- so no salary line is seeded: the
    figure depends on the professional level and the class of establishment,
    and a wrong one here would silently suppress an underpayment warning.
    """
    return [
        _rule(
            rule_type="annual_ordinary_hours",
            threshold=Decimal("1783"),
            unit="hours",
            reference_window="year",
            hardness="hard",
            computation_method="average_over_reference_window",
            notes="Art. 28 of the agreement: 1,783 hours of effective work a "
            "year for 2026, 2027 and 2028 -- down from 1,791, and equivalent "
            "to the statutory 40-hour week averaged over the year. This, not "
            "any weekly figure, is what a year's rota has to add up to.",
        ),
        _rule(
            rule_type="night_premium",
            threshold=Decimal("25"),
            unit="percent",
            reference_window="day",
            hardness="hard",
            premium_multiplier=Decimal("1.25"),
            computation_method="premium_on_hours_in_window",
            notes="Hours between 22:00 and 06:00 carry a 25% night premium. "
            "The statute (art. 36.2 ET) requires a specific payment for night "
            "work but sets no figure; this is the agreement's.",
        ),
        _rule(
            rule_type="annual_leave_days",
            threshold=Decimal("31"),
            unit="calendar_days",
            reference_window="year",
            hardness="hard",
            notes="One day above the statutory 30: the 2025-2028 agreement "
            "raised annual leave to 31 calendar days.",
        ),
        _rule(
            rule_type="minimum_wage",
            threshold=Decimal("9.59"),
            unit="eur_per_hour",
            reference_window="year",
            hardness="hard",
            computation_method="compare_contract_hourly_rate",
            notes="The SMI over this agreement's year: 17,094 EUR / 1,783 h = "
            "9.59 EUR/h. An absolute floor, not the rate owed: the salary "
            "table (Annex II.A for Barcelona) sets more for every category, "
            "and it is the one to check a contract against.",
        ),
    ]


def _es_ct_comercio_rules() -> List[ComplianceRule]:
    """Barcelona retail, which is not one agreement but a dozen.

    A shop in Barcelona is covered by the agreement for its BRANCH -- food,
    textiles, metal goods, furniture, and more -- and they differ on the two
    numbers this product would want most: the annual hours and the salary
    table. So nothing is invented here. The statute above carries every rule
    that binds a shop whatever it sells, and this profile exists to say the
    rest out loud rather than to guess it:

      "Your branch agreement sets the annual hours and the pay; this product
       does not hold them, so type them in."

    A seeded 1,768 borrowed from the metal-goods agreement would be worse than
    an empty field: it would look like knowledge and quietly decide overtime
    for a bookshop.
    """
    return [
        _rule(
            rule_type="annual_ordinary_hours",
            threshold=None,
            unit="hours",
            reference_window="year",
            hardness="hard",
            notes="Set by the branch agreement (comercio del metal, textil, "
            "alimentación...), not by one retail agreement for the city: they "
            "differ, and 2025-2027 texts step down to figures around 1,768 h "
            "at different paces. Enter the one in your own convenio.",
        ),
        _rule(
            rule_type="minimum_wage",
            threshold=None,
            unit="eur_per_hour",
            reference_window="year",
            hardness="hard",
            computation_method="compare_contract_hourly_rate",
            notes="The SMI is the floor everywhere (1,221 EUR/month over 14 "
            "payments in 2026); your branch's salary table is above it and is "
            "what a contract is checked against. Enter the rate for the "
            "category you are hiring.",
        ),
        _rule(
            rule_type="night_premium",
            threshold=None,
            unit="percent",
            reference_window="day",
            hardness="hard",
            notes="Art. 36.2 ET requires a specific payment for night work and "
            "sets no figure; in retail the branch agreement does, and many "
            "shops never work nights at all. Enter yours if it applies.",
        ),
    ]


def _upsert_profile(
    db: Session,
    jurisdiction_code: str,
    name: str,
    parent_code: Optional[str],
    rules: List[ComplianceRule],
) -> bool:
    existing = db.execute(
        select(LaborProfile).where(
            LaborProfile.jurisdiction_code == jurisdiction_code
        )
    ).scalar_one_or_none()
    if existing is not None:
        return False

    profile = LaborProfile(
        jurisdiction_code=jurisdiction_code,
        name=name,
        parent_code=parent_code,
        effective_date=EFFECTIVE,
        rules=rules,
    )
    db.add(profile)
    return True


def seed(db: Session) -> None:
    """Seed the jurisdictions this product serves: Barcelona, and Spain under it.

    It used to seed three American ones, because it was written before it had
    a customer and the FLSA is the rule set everybody's examples use. It has
    one market now -- bars, restaurants and shops in Barcelona -- and a
    product that offers a manager here a choice between California and Arizona
    is not neutral, it is wrong in three ways at once.
    """
    created_es = _upsert_profile(
        db,
        jurisdiction_code="ES",
        name="Spain (Estatuto de los Trabajadores)",
        parent_code=None,
        rules=_es_rules(),
    )
    created_host = _upsert_profile(
        db,
        jurisdiction_code="ES-CT-HOSTELERIA",
        name="Catalonia — hospitality (convenio 2025-2028)",
        parent_code="ES",
        rules=_es_ct_hosteleria_rules(),
    )
    created_retail = _upsert_profile(
        db,
        jurisdiction_code="ES-CT-COMERCIO",
        name="Barcelona — retail (branch agreement)",
        parent_code="ES",
        rules=_es_ct_comercio_rules(),
    )
    print(
        "labor seed: ES %s, ES-CT-HOSTELERIA %s, ES-CT-COMERCIO %s"
        % (
            "created" if created_es else "exists",
            "created" if created_host else "exists",
            "created" if created_retail else "exists",
        )
    )


if __name__ == "__main__":
    db = AdminSessionLocal()
    try:
        seed(db)
        db.commit()
    finally:
        db.close()
