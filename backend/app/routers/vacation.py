from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import assert_can_read_employee, get_current_user
from app.errors import detail
from app.models.employee import Employee
from app.schemas.auth import UserOut
from app.schemas.vacation import VacationBalanceOut, VacationLedgerOut
from app.services.employees import LIVE
from app.services.vacation import compute_balance

router = APIRouter(prefix="/employees", tags=["vacation"])


@router.get("/{employee_id}/vacation-balance", response_model=VacationBalanceOut)
def vacation_balance(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> VacationBalanceOut:
    assert_can_read_employee(current_user, employee_id)
    # LIVE: the ledger of somebody who is off the roster is not readable, the
    # same way it was not readable when the rows were cascade-deleted with them.
    exists = db.execute(
        select(Employee.id)
        .where(Employee.org_id == current_user.org_id)
        .where(Employee.id == employee_id)
        .where(LIVE)
    ).scalar_one_or_none()
    if exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_not_found", "Employee not found"),
        )

    balance, ledger = compute_balance(db, current_user.org_id, employee_id)
    return VacationBalanceOut(
        employee_id=employee_id,
        balance_days=balance,
        ledger=[VacationLedgerOut.model_validate(row) for row in ledger],
    )
