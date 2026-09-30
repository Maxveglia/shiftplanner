from __future__ import annotations

"""Giving an employee a way in.

An employee cannot sign up: they exist because a manager added them to the
roster, and they get access when that manager decides they should. So this is
manager-only, and it is the only path that mints a ``role = 'employee'`` login.

Like the rest of the auth layer this runs on the admin session, because email
uniqueness is global and therefore a pre-tenant question. Every query below
still filters on the manager's own ``org_id`` by hand -- the RLS barrier is not
doing it for us here.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.access import Role
from app.db import get_admin_db
from app.deps import get_current_manager
from app.errors import detail
from app.models.employee import Employee
from app.models.user_account import UserAccount
from app.routers.auth import email_in_use, looks_like_an_email, normalise_email
from app.schemas.account import EmployeeAccountCreate, EmployeeAccountOut
from app.schemas.auth import UserOut
from app.security import hash_password
from app.services.employees import LIVE

router = APIRouter(prefix="/employees", tags=["employee-accounts"])


def _get_employee(db: Session, org_id: UUID, employee_id: UUID) -> Employee:
    # LIVE as well as the org. This session is the SUPERUSER one (email
    # uniqueness is a pre-tenant question), so neither filter is being applied
    # for us here: minting a login for somebody who is no longer on the roster
    # has to be impossible from this side, explicitly.
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


def _get_account(db: Session, org_id: UUID, employee_id: UUID) -> UserAccount | None:
    # An EMPLOYEE's login: the only kind this router mints, shows and
    # deletes. A manager linked to somebody of the roster (the owner who also
    # works shifts) is not "this employee's access" -- without the role here,
    # "Quitar acceso" on their row would delete the manager's own login.
    return db.execute(
        select(UserAccount)
        .where(UserAccount.org_id == org_id)
        .where(UserAccount.employee_id == employee_id)
        .where(UserAccount.role == Role.employee.value)
    ).scalar_one_or_none()


@router.get("/{employee_id}/account", response_model=EmployeeAccountOut)
def get_employee_account(
    employee_id: UUID,
    db: Session = Depends(get_admin_db),
    current_user: UserOut = Depends(get_current_manager),
) -> EmployeeAccountOut:
    _get_employee(db, current_user.org_id, employee_id)
    account = _get_account(db, current_user.org_id, employee_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_has_no_login_yet", "This employee has no login yet"),
        )
    return EmployeeAccountOut.model_validate(account)


@router.post(
    "/{employee_id}/account",
    response_model=EmployeeAccountOut,
    status_code=status.HTTP_201_CREATED,
)
def create_employee_account(
    employee_id: UUID,
    payload: EmployeeAccountCreate,
    db: Session = Depends(get_admin_db),
    current_user: UserOut = Depends(get_current_manager),
) -> EmployeeAccountOut:
    employee = _get_employee(db, current_user.org_id, employee_id)

    if _get_account(db, current_user.org_id, employee_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail("employee_already_has_login", "This employee already has a login"),
        )

    email = normalise_email(payload.email or employee.email or "")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "employee_has_no_email",
                "No email on file for this employee — provide one",
            ),
        )
    if not looks_like_an_email(email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("email_invalid", "This is not an email address"),
        )

    # Global check: emails identify a person across every organisation -- in
    # any capitalisation, since login no longer tells them apart.
    if email_in_use(db, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=detail("email_taken", "Email already registered"),
        )

    account = UserAccount(
        org_id=current_user.org_id,
        email=email,
        hashed_password=hash_password(payload.password),
        full_name=employee.full_name,
        role=Role.employee.value,
        employee_id=employee.id,
        is_active=True,
    )
    db.add(account)
    db.flush()
    db.refresh(account)

    # Keep the roster in step: the address they log in with is their address.
    if not employee.email:
        employee.email = email
        db.flush()

    return EmployeeAccountOut.model_validate(account)


@router.delete("/{employee_id}/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_employee_account(
    employee_id: UUID,
    db: Session = Depends(get_admin_db),
    current_user: UserOut = Depends(get_current_manager),
) -> None:
    """Revoke access. The employee record, their shifts and their history stay."""
    _get_employee(db, current_user.org_id, employee_id)
    account = _get_account(db, current_user.org_id, employee_id)
    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_has_no_login", "This employee has no login"),
        )
    db.delete(account)
    db.flush()
    return None
