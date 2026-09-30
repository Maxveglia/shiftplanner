"""The statutory floor for one business, read out of the rules table.

WHY THIS EXISTS. Until now the limits a rota is built to were constants in the
intake: eleven hours of rest, forty hours a week, overtime at one and a half
after that. Every one of those is a fact about the UNITED STATES, and this
product is used in Barcelona. The rules themselves have lived as data since
the first migration (``labor_profile`` / ``compliance_rule``, most specific
first, inheriting upwards); nothing read them except the minimum wage.

So this module is the reader. It turns a jurisdiction code into the handful of
numbers the spec carries, so the planner, the generator and the validator all
work to the same figures -- and so changing what Spain requires is a row in a
table rather than an edit in three languages.

WHAT IT DOES NOT DO. It does not decide anything. A missing rule leaves the
field None and every reader keeps its own default, which is how a jurisdiction
we have not written yet behaves exactly as before.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.compliance_rule import ComplianceRule
from app.models.labor_profile import LaborProfile


@dataclass(frozen=True)
class LabourFloor:
    """What the law where this business is says a rota may not do."""

    #: Hours between the end of one shift and the start of the next.
    min_rest_hours: Optional[float] = None
    #: Ordinary hours one person may work in one day.
    max_daily_hours: Optional[float] = None
    #: Hours of uninterrupted rest owed every week.
    weekly_rest_hours: Optional[float] = None
    #: Ceiling on the average length of a night worker's day.
    night_average_max: Optional[float] = None
    #: The window that counts as night, as hours of the day.
    night_window: Optional[tuple] = None
    #: Overtime hours one person may work in a year.
    annual_overtime_cap: Optional[float] = None
    #: What an overtime hour multiplies the ordinary rate by, where the law
    #: sets one. None means no statutory premium -- which is Spain, and is not
    #: the same as "we do not know".
    overtime_multiplier: Optional[float] = None
    #: Percentage added to an hour worked in the night window.
    night_premium_pct: Optional[float] = None
    #: Hours of effective work a full year is, where an agreement fixes one.
    annual_hours: Optional[float] = None
    #: The contracted week read as an ANNUAL AVERAGE rather than a ceiling.
    #: Spain's art. 34.1, and the field that tells every reader a week above
    #: it is not by itself a breach. None keeps the old reading: a ceiling.
    weekly_average_hours: Optional[float] = None
    #: Share of the annual hours the employer may move around the year.
    irregular_pct: Optional[float] = None
    #: Days of notice owed before a shift the irregular distribution placed.
    irregular_notice_days: Optional[float] = None

    # --- What the hours above the contract become (art. 35, art. 12.5) -----

    #: Months within which an extra hour compensated by rest stops counting
    #: towards the annual cap (art. 35.1/35.2: 4).
    overtime_compensation_months: Optional[float] = None
    #: Whether a part-time contract may work extra hours at all. Spain says no
    #: (art. 12.4.c), and that is a rule ABOUT overtime rather than a number,
    #: so it arrives as the presence of a rule rather than as a threshold.
    part_time_overtime_allowed: bool = True
    #: Least contracted week from which complementary hours may be agreed
    #: (art. 12.5.a: 10).
    complementary_min_weekly: Optional[float] = None
    #: Share of the contract that may be agreed as complementary (0.30).
    complementary_pct_max: Optional[float] = None
    #: The most a convenio may raise that to (0.60).
    complementary_pct_max_by_agreement: Optional[float] = None
    #: Voluntary complementary hours on top, open-ended contracts only (0.15).
    voluntary_complementary_pct: Optional[float] = None
    #: Days of notice owed before a complementary hour (art. 12.5.d: 3).
    complementary_notice_days: Optional[float] = None

    # --- Rules that are about the PERSON rather than the shift -------------

    #: Whether a night worker may do overtime at all. Spain says no (art.
    #: 36.1 ET) and, like the part-time ban, says it as the presence of a rule.
    night_worker_overtime_allowed: bool = True
    #: The least an hour may be paid, in the currency of the contract. The SMI
    #: in Spain, raised by a convenio where one sets its own table.
    minimum_wage: Optional[float] = None

    @property
    def known(self) -> bool:
        """Whether anything at all was found for this jurisdiction."""
        return any(
            v is not None
            for v in (
                self.min_rest_hours,
                self.max_daily_hours,
                self.weekly_rest_hours,
                self.night_average_max,
                self.annual_overtime_cap,
                self.annual_hours,
                self.weekly_average_hours,
                self.complementary_pct_max,
            )
        )


def _chain(db: Session, code: str) -> List[LaborProfile]:
    """The profiles that apply, most specific first. Cycle-safe."""
    profiles = (
        db.execute(select(LaborProfile).options(selectinload(LaborProfile.rules)))
        .scalars()
        .all()
    )
    by_code = {p.jurisdiction_code: p for p in profiles}
    out: List[LaborProfile] = []
    seen = set()
    current = by_code.get(code)
    while current is not None and current.jurisdiction_code not in seen:
        seen.add(current.jurisdiction_code)
        out.append(current)
        current = by_code.get(current.parent_code) if current.parent_code else None
    return out


def _first(rules: Dict[str, ComplianceRule], rule_type: str) -> Optional[Decimal]:
    rule = rules.get(rule_type)
    return rule.threshold if rule is not None else None


def _num(value: Optional[Decimal]) -> Optional[float]:
    return float(value) if value is not None else None


def floor_for(db: Session, code: str) -> LabourFloor:
    """Read the floor for a jurisdiction. Unknown codes come back empty."""
    chain = _chain(db, code)
    rules: Dict[str, ComplianceRule] = {}
    # Most specific first, and the first one to state a rule wins: an agreement
    # that improves on the statute is the figure that applies, which is the
    # same precedence `applicableProfiles` uses on the client.
    for profile in chain:
        for rule in profile.rules:
            rules.setdefault(rule.rule_type, rule)

    night_start = _num(_first(rules, "night_work_window_start"))
    night_end = _num(_first(rules, "night_work_window_end"))

    # An overtime premium is only a number when a rule carries one. Spain says
    # so explicitly with `no_statutory_overtime_premium`, and saying so is not
    # the same as a jurisdiction we have never seeded: the first leaves the
    # multiplier None on purpose, the second leaves it None by absence, and
    # both mean "do not invent 1.5x".
    overtime = rules.get("weekly_overtime_threshold")
    multiplier = (
        float(overtime.premium_multiplier)
        if overtime is not None and overtime.premium_multiplier is not None
        else None
    )
    if "no_statutory_overtime_premium" in rules:
        multiplier = None

    night_premium = rules.get("night_premium")

    # The minimum wage is the one figure a profile may hold WITHOUT a number:
    # a convenio seeded before its salary table was loaded carries the rule
    # with no threshold. That is "the agreement's own table, not written down
    # yet", never "no minimum" -- so the statute's figure underneath it still
    # applies, and the chain is walked for the first profile that states one.
    # (The client's `minimumWage` has always read it this way.)
    minimum_wage: Optional[float] = None
    for profile in chain:
        stated = next(
            (
                r.threshold
                for r in profile.rules
                if r.rule_type == "minimum_wage" and r.threshold is not None
            ),
            None,
        )
        if stated is not None:
            minimum_wage = float(stated)
            break

    return LabourFloor(
        min_rest_hours=_num(_first(rules, "daily_rest_between_shifts")),
        max_daily_hours=_num(_first(rules, "max_daily_ordinary_hours")),
        weekly_rest_hours=_num(_first(rules, "weekly_rest_hours")),
        night_average_max=_num(_first(rules, "night_work_daily_average_max")),
        night_window=(night_start, night_end)
        if night_start is not None and night_end is not None
        else None,
        annual_overtime_cap=_num(_first(rules, "annual_overtime_cap")),
        overtime_multiplier=multiplier,
        night_premium_pct=_num(night_premium.threshold) if night_premium else None,
        annual_hours=_num(_first(rules, "annual_ordinary_hours")),
        weekly_average_hours=_num(_first(rules, "weekly_ordinary_hours_average")),
        irregular_pct=_num(_first(rules, "irregular_distribution_pct")),
        irregular_notice_days=_num(
            _first(rules, "irregular_distribution_notice_days")
        ),
        overtime_compensation_months=_num(
            _first(rules, "overtime_compensation_months")
        ),
        # Absence means "not forbidden": a jurisdiction nobody has written
        # down does not get a part-time overtime ban invented for it.
        part_time_overtime_allowed="part_time_no_overtime" not in rules,
        complementary_min_weekly=_num(
            _first(rules, "complementary_hours_min_weekly")
        ),
        complementary_pct_max=_num(_first(rules, "complementary_hours_pct_max")),
        complementary_pct_max_by_agreement=_num(
            _first(rules, "complementary_hours_pct_max_by_agreement")
        ),
        voluntary_complementary_pct=_num(
            _first(rules, "voluntary_complementary_hours_pct")
        ),
        complementary_notice_days=_num(
            _first(rules, "complementary_hours_notice_days")
        ),
        night_worker_overtime_allowed="night_worker_no_overtime" not in rules,
        minimum_wage=minimum_wage,
    )
