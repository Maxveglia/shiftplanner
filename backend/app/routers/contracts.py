from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_manager
from app.errors import detail
from app.models.contract import Contract
from app.models.employee import Employee
from app.schemas.auth import UserOut
from app.schemas.contract import BaseHoursUpdate, ContractCreate, ContractOut
from app.services.contracts import create_contract, set_base_hours
from app.services.employees import LIVE

router = APIRouter(prefix="/employees", tags=["contracts"])


def _assert_employee(db: Session, org_id: UUID, employee_id: UUID) -> None:
    # LIVE, not just the org: a removed employee's contract history is not
    # readable and no new version can be written onto it. Erasing the row used
    # to take the contracts with it, so this is the same answer by other means.
    exists = db.execute(
        select(Employee.id)
        .where(Employee.org_id == org_id)
        .where(Employee.id == employee_id)
        .where(LIVE)
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_not_found", "Employee not found"),
        )


@router.get("/{employee_id}/contracts", response_model=List[ContractOut])
def list_contracts(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> List[ContractOut]:
    _assert_employee(db, current_user.org_id, employee_id)
    rows = db.execute(
        select(Contract)
        .where(Contract.org_id == current_user.org_id)
        .where(Contract.employee_id == employee_id)
        .order_by(Contract.valid_from.desc())
    ).scalars()
    return [ContractOut.model_validate(c) for c in rows]


@router.post(
    "/{employee_id}/contracts",
    response_model=ContractOut,
    status_code=status.HTTP_201_CREATED,
)
def add_contract(
    employee_id: UUID,
    payload: ContractCreate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ContractOut:
    _assert_employee(db, current_user.org_id, employee_id)
    contract = create_contract(db, current_user.org_id, employee_id, payload)
    return ContractOut.model_validate(contract)


@router.patch("/{employee_id}/contracts/current/hours", response_model=ContractOut)
def set_current_hours(
    employee_id: UUID,
    payload: BaseHoursUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ContractOut:
    """The manual lever for a person's weekly hours. See ``set_base_hours``."""
    _assert_employee(db, current_user.org_id, employee_id)
    contract = set_base_hours(db, current_user.org_id, employee_id, payload.hours_per_week)
    if contract is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail(
                "employee_has_no_open_contract",
                "This employee has no open contract to set hours on",
            ),
        )
    out = ContractOut.model_validate(contract)
    # Same reason as PUT /schedule/draft: `get_db` commits when the request
    # closes, which FastAPI does AFTER sending the body, and the client
    # refetches the person's file the moment it hears 200 -- so the number just
    # typed would snap back to the old one until a reload.
    #
    # Read into `out` first and commit last: the org id the RLS policies read is
    # SET LOCAL, so committing resets it, and touching an expired attribute
    # after this line would be a read with no tenant at all.
    db.commit()
    return out
