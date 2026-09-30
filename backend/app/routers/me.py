from __future__ import annotations

"""What the signed-in employee is allowed to ask about themselves.

Every other employee-facing read goes through an id the client supplies. This
one does not: it derives the employee from the token, so there is no id to get
wrong and nothing to guess at.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user
from app.errors import detail
from app.models.employee import Employee
from app.routers.employees import to_employee_out
from app.schemas.auth import UserOut
from app.schemas.business_profile import BusinessShapeOut
from app.schemas.employee import EmployeeOut
from app.services import business_profile as bp
from app.services.employees import LIVE, display_numbers

router = APIRouter(prefix="/me", tags=["me"])


class NotificationsIn(BaseModel):
    """Whether this person wants their rota by email."""

    notify_by_email: bool


class NotificationsOut(BaseModel):
    notify_by_email: bool


def _my_employee(db: Session, current_user: UserOut) -> Employee:
    """The row behind the token, or the 404s that say which thing is missing.

    Two different absences, kept apart because they need two different
    answers: a login with nothing attached is for the manager to fix, and a
    person taken off the roster is not a mistake at all.
    """
    if current_user.employee_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail(
                "account_not_linked",
                "This account is not linked to an employee record",
            ),
        )
    employee = db.execute(
        select(Employee)
        .where(Employee.org_id == current_user.org_id)
        .where(Employee.id == current_user.employee_id)
        .where(LIVE)
    ).scalar_one_or_none()
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_not_found", "Employee not found"),
        )
    return employee


@router.get("/notifications", response_model=NotificationsOut)
def my_notifications(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> NotificationsOut:
    employee = _my_employee(db, current_user)
    return NotificationsOut(notify_by_email=employee.notify_by_email)


@router.patch("/notifications", response_model=NotificationsOut)
def set_my_notifications(
    payload: NotificationsIn,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> NotificationsOut:
    """Turn the rota email on or off, for oneself only.

    The employee's own switch and nobody else's: it is derived from the token
    like everything in this router, so there is no id a manager could pass to
    turn somebody else's notifications off on their behalf.
    """
    employee = _my_employee(db, current_user)
    employee.notify_by_email = payload.notify_by_email
    db.commit()
    return NotificationsOut(notify_by_email=payload.notify_by_email)


@router.get("/profile", response_model=EmployeeOut)
def my_profile(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> EmployeeOut:
    """The signed-in user's own employee record, contract included.

    The contract is what makes the pay estimate possible -- rate, contracted
    minimum and pay period all come from it -- so it is returned here rather
    than making the employee ask a manager-only endpoint for it.
    """
    if current_user.employee_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail(
                "account_not_linked",
                "This account is not linked to an employee record",
            ),
        )

    # LIVE: somebody the manager has taken off the roster stops seeing their
    # own file, their hours and their pay estimate. That is what already
    # happened when the row was erased -- the login survived with a NULL
    # employee_id and landed on this same 404 -- and it is the right answer
    # anyway: the shifts they would be shown are shifts nobody expects them at.
    employee = db.execute(
        select(Employee)
        .where(Employee.org_id == current_user.org_id)
        .where(Employee.id == current_user.employee_id)
        .where(LIVE)
    ).scalar_one_or_none()
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_not_found", "Employee not found"),
        )

    numbers = display_numbers(db, current_user.org_id)
    return to_employee_out(
        db, current_user.org_id, employee, numbers.get(employee.id, 0)
    )


@router.get("/business", response_model=BusinessShapeOut)
def my_business_shape(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> BusinessShapeOut:
    """Where this employer's day ends, and which days it calls its weekend.

    The two settings an employee's own screens have to agree with, and nothing
    else from the business profile: not the vertical, not the house notes, not a
    single learned hint. Those are the manager's view of their business, and an
    employee has no reason to read them.

    It has to exist because the alternative is worse than an extra endpoint.
    The shift list tags a weekend and the pay breakdown pays a weekend premium,
    both from the same employee screen; if this one defaulted to Saturday and
    Sunday while the manager's screens read Friday and Saturday, the app would
    tell somebody their Friday night is an ordinary shift while paying them a
    premium for it.
    """
    profile = bp.get_or_create(db, current_user.org_id)
    db.flush()
    return BusinessShapeOut(
        day_boundary_min=profile.day_boundary_min,
        weekend_days=profile.weekend_days,
    )
