from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import (
    assert_can_read_employee,
    get_current_manager,
    get_current_user,
)
from app.errors import detail
from app.models.employee import Employee
from app.models.user_account import UserAccount
from app.schemas.auth import UserOut
from app.schemas.contract import ContractOut
from app.schemas.employee import EmployeeCreate, EmployeeOut, EmployeeUpdate
from app.services.contracts import create_contract, default_contract, get_current_contract
from app.services.employees import (
    LIVE,
    display_numbers,
    resolve_external_id,
    roster_ordered,
)

router = APIRouter(prefix="/employees", tags=["employees"])


def to_employee_out(
    db: Session,
    org_id: UUID,
    employee: Employee,
    display_number: int = 0,
) -> EmployeeOut:
    current = get_current_contract(db, org_id, employee.id)
    return EmployeeOut(
        id=employee.id,
        org_id=employee.org_id,
        external_id=employee.external_id,
        full_name=employee.full_name,
        email=employee.email,
        employment_status=employee.employment_status,
        hire_date=employee.hire_date,
        current_contract=(
            ContractOut.model_validate(current) if current is not None else None
        ),
        created_at=employee.created_at,
        display_number=display_number,
    )


def _get_owned(db: Session, org_id: UUID, employee_id: UUID) -> Employee:
    """One employee of this org, if they are still on its roster.

    Removed people are a 404 here and everywhere else a client can reach them.
    The row still exists, but "exists in the table" is not the question any
    endpoint is asking -- reading, editing or removing somebody who is already
    gone are all the same mistake, and answering 404 is what a hard delete used
    to do.
    """
    employee = db.execute(
        select(Employee)
        .where(Employee.org_id == org_id)
        .where(Employee.id == employee_id)
        .where(LIVE)
    ).scalar_one_or_none()
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_not_found", "Employee not found"),
        )
    return employee


@router.get("", response_model=List[EmployeeOut])
def list_employees(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> List[EmployeeOut]:
    roster = roster_ordered(db, current_user.org_id)
    return [
        to_employee_out(db, current_user.org_id, e, i + 1)
        for i, e in enumerate(roster)
    ]


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> EmployeeOut:
    employee = Employee(
        org_id=current_user.org_id,
        external_id=resolve_external_id(
            db, current_user.org_id, payload.external_id
        ),
        full_name=payload.full_name,
        email=payload.email,
        employment_status=payload.employment_status.value,
        hire_date=payload.hire_date,
    )
    db.add(employee)
    db.flush()

    # Every employee leaves this endpoint schedulable.
    #
    # `availability()` refuses anyone without a contract, on every day, so an
    # employee created without one is invisible to the scheduler and the
    # calendar comes back empty with nothing saying why. That shipped once
    # already. Closing it at creation is what makes it impossible rather than
    # remembered: this is the only door employees come through, so no client --
    # the brief, a refine sentence, the Employees page, or whatever is written
    # next -- can reopen it by forgetting.
    #
    # `default_contract` states the least that can be true: hourly, no
    # guaranteed minimum, no rate. Real terms replace it as a new version the
    # moment anyone states them.
    create_contract(
        db,
        current_user.org_id,
        employee.id,
        default_contract(payload.hire_date),
    )

    db.refresh(employee)
    numbers = display_numbers(db, current_user.org_id)
    return to_employee_out(
        db, current_user.org_id, employee, numbers.get(employee.id, 0)
    )


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> EmployeeOut:
    assert_can_read_employee(current_user, employee_id)
    employee = _get_owned(db, current_user.org_id, employee_id)
    numbers = display_numbers(db, current_user.org_id)
    return to_employee_out(
        db, current_user.org_id, employee, numbers.get(employee.id, 0)
    )


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: UUID,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> EmployeeOut:
    employee = _get_owned(db, current_user.org_id, employee_id)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "employment_status" and value is not None:
            value = value.value if hasattr(value, "value") else value
        setattr(employee, field, value)
    db.flush()
    db.refresh(employee)
    numbers = display_numbers(db, current_user.org_id)
    out = to_employee_out(
        db, current_user.org_id, employee, numbers.get(employee.id, 0)
    )
    # Committed before the response leaves, like PUT /schedule/draft. `get_db`
    # commits when the request closes, which FastAPI does AFTER sending the
    # body; the roster is refetched the moment the client hears 200 -- so a
    # name corrected in the list would snap back to the old one until a reload.
    #
    # Last, and not next to the flush above: the org id the RLS policies read
    # is SET LOCAL, so committing resets it, and every read after this line
    # would be a read with no tenant at all.
    db.commit()
    return out


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> None:
    """Take someone off the roster. Reversible until somebody says otherwise.

    This used to be ``db.delete(employee)``, and the cascade took their
    contracts, absences, ledger movements and published shifts with it. Marking
    the row is what lets the client offer "Undo" AFTER the fact instead of
    asking "are you sure?" before it -- and a question asked every time is a
    question answered without reading.

    Nothing is scheduled to come along later and finish the job. Purging is a
    decision with its own consequences (payroll history, an audit trail an
    employer may be required to keep) and it is not this endpoint's to take by
    timer. The one path that really erases the rows is the operator deleting the
    whole customer, which is deliberate, confirmed by name, and already exists.

    Their login is the exception: it goes, in this same transaction. Somebody
    who is no longer on the team does not keep a way into the till, the sales
    and the stock (app/access.py) -- and the session they have open ends with
    it, since every request reads the account again (app/deps.py, which also
    refuses an employee's login with nobody live behind it). What they did
    stays: the rows that name the account keep theirs and lose only the link
    (ON DELETE SET NULL; a sale keeps who charged it and who voided it by
    name, migrations 0046 and 0043).
    Undoing the removal (`restore_employee`) brings the person back, not the
    login: the manager gives access again if they want to. Only an
    ``employee`` login: a manager who is also on the roster keeps theirs.
    """
    employee = _get_owned(db, current_user.org_id, employee_id)
    employee.deleted_at = datetime.now(timezone.utc)
    db.execute(
        delete(UserAccount)
        .where(UserAccount.org_id == current_user.org_id)
        .where(UserAccount.employee_id == employee.id)
        .where(UserAccount.role == "employee")
    )
    db.flush()
    return None


@router.post("/{employee_id}/restore", response_model=EmployeeOut)
def restore_employee(
    employee_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> EmployeeOut:
    """Put someone back, exactly as they were.

    Not routed through ``_get_owned``: this is the one endpoint whose subject is
    a removed employee, so it looks the row up by organization and id alone.
    Tenant isolation is untouched -- the org filter is still there, and RLS is
    still underneath it.

    Idempotent on purpose. The client calls this from a notice that is about to
    disappear on its own, often on a flaky connection, and a retry that lands
    after the first call succeeded must not read as an error: restoring someone
    who is already on the roster returns them unchanged.

    Their ``external_id`` was never handed to anybody else while they were gone
    (see ``next_external_id``), so nothing has to be renegotiated on the way
    back. Their display number is recomputed from their created_at, which means
    they return to the position they held, not to the end of the list.

    Their login does not come back with them: it was deleted with the removal
    (`delete_employee`), and access is the manager's to give again. A removal
    from before that -- the mark alone, the login left behind, which
    production may hold -- would bring it back, old password and all, the
    moment the person is live again (app/deps.py lets a login through as
    soon as there is somebody live behind it). So bringing back somebody who
    WAS removed deletes the ``employee`` logins linked to them, in this same
    transaction. Only then: restoring somebody already on the roster (the
    retry above) touches nothing, not the login the manager may have given
    them since. And only an ``employee`` login, as in `delete_employee`.
    """
    employee = db.execute(
        select(Employee)
        .where(Employee.org_id == current_user.org_id)
        .where(Employee.id == employee_id)
    ).scalar_one_or_none()
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_not_found", "Employee not found"),
        )

    if employee.deleted_at is not None:
        db.execute(
            delete(UserAccount)
            .where(UserAccount.org_id == current_user.org_id)
            .where(UserAccount.employee_id == employee.id)
            .where(UserAccount.role == "employee")
        )
    employee.deleted_at = None
    db.flush()
    db.refresh(employee)
    numbers = display_numbers(db, current_user.org_id)
    return to_employee_out(
        db, current_user.org_id, employee, numbers.get(employee.id, 0)
    )
