from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.contract import Contract
from app.schemas.contract import ContractCreate
from app.schemas.enums import EmploymentType


def _dec(value: Optional[float]) -> Optional[Decimal]:
    # None stays None -- on a premium it means "the business's figure" -- and
    # 0 stays 0, which means "none for this person".
    return Decimal(str(value)) if value is not None else None


def get_current_contract(
    db: Session, org_id: UUID, employee_id: UUID
) -> Optional[Contract]:
    """The currently OPEN contract (valid_to IS NULL) for an employee."""
    return db.execute(
        select(Contract)
        .where(Contract.org_id == org_id)
        .where(Contract.employee_id == employee_id)
        .where(Contract.valid_to.is_(None))
    ).scalar_one_or_none()


def create_contract(
    db: Session, org_id: UUID, employee_id: UUID, data: ContractCreate
) -> Contract:
    """Create a new contract version.

    Invariant: history is never rewritten. Instead, the previously OPEN version
    (if any) is CLOSED by setting its valid_to = new.valid_from - 1 day.
    """
    previous = get_current_contract(db, org_id, employee_id)
    if previous is not None:
        previous.valid_to = data.valid_from - timedelta(days=1)
        db.flush()

    contract = Contract(
        org_id=org_id,
        employee_id=employee_id,
        employment_type=data.employment_type.value,
        base_annual_salary=(
            Decimal(str(data.base_annual_salary))
            if data.base_annual_salary is not None
            else None
        ),
        hourly_rate=(
            Decimal(str(data.hourly_rate)) if data.hourly_rate is not None else None
        ),
        min_hours_per_week=Decimal(str(data.min_hours_per_week)),
        max_hours_per_week=(
            Decimal(str(data.max_hours_per_week))
            if data.max_hours_per_week is not None
            else None
        ),
        complementary_pct=(
            Decimal(str(data.complementary_pct))
            if data.complementary_pct is not None
            else None
        ),
        night_premium_pct=_dec(data.night_premium_pct),
        weekend_premium_pct=_dec(data.weekend_premium_pct),
        overtime_multiplier=_dec(data.overtime_multiplier),
        night_premium_basis=data.night_premium_basis,
        pay_period=data.pay_period.value,
        valid_from=data.valid_from,
        valid_to=None,
    )
    db.add(contract)
    db.flush()
    db.refresh(contract)
    return contract


def default_contract(valid_from: date) -> ContractCreate:
    """The weakest contract that can be true, for someone who has none.

    An employee without a contract cannot be scheduled on any day -- that is
    what ``availability()`` decides, and rightly: hours and pay are an
    agreement, not something a scheduler may assume. But the consequence used
    to be silent. A brief that named five people created five employees nobody
    could be given a shift, and the manager got an empty calendar with nothing
    on screen saying why.

    So creation opens one. It states the least that can be said: paid hourly,
    NO guaranteed weekly minimum, no ceiling of its own, and no rate. It
    invents no pay and commits the business to no hours -- it only makes the
    person someone a shift can be given to, which is what creating them meant.

    Real terms replace this the moment anyone states them: ``create_contract``
    closes the open version and opens the next, so this is a starting point in
    a history, never something to undo.
    """
    return ContractCreate(
        employment_type=EmploymentType.non_exempt_hourly,
        base_annual_salary=None,
        hourly_rate=None,
        min_hours_per_week=0,
        max_hours_per_week=None,
        valid_from=valid_from,
    )



def set_base_hours(
    db: Session, org_id: UUID, employee_id: UUID, hours: float
) -> Optional[Contract]:
    """Change the hours on the OPEN contract, in place. None if there is none.

    In place, and not as a new version, on purpose. ``create_contract`` keeps
    history because a contract is a legal record: type, pay, dates. Base hours
    are the one figure a manager adjusts as a setting -- "make her 30 from now
    on" -- and versioning every such tweak would leave a trail of contracts
    that differ by a number and close each other on the same day. Payroll of
    days already worked is computed from what was scheduled, not from this
    column, so nothing already paid moves.
    """
    contract = get_current_contract(db, org_id, employee_id)
    if contract is None:
        return None
    value = Decimal(str(hours))
    contract.min_hours_per_week = value
    if contract.max_hours_per_week is not None and contract.max_hours_per_week < value:
        contract.max_hours_per_week = value
    db.flush()
    return contract
