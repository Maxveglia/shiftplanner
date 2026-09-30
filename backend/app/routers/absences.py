from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
# Range lives under the postgresql dialect, not at the top level of sqlalchemy
# (importing it from `sqlalchemy` raises ImportError on 2.0.52).
from sqlalchemy.dialects.postgresql import Range
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_manager, get_current_user
from app.errors import detail
from app.models.absence import Absence
from app.models.absence_type import AbsenceType
from app.models.employee import Employee
from app.schemas.absence import AbsenceApprovedOut, AbsenceCreate, AbsenceOut
from app.schemas.auth import UserOut
from app.services.absences import approve_absence
from app.services.employees import LIVE, live_ids

router = APIRouter(prefix="/absences", tags=["absences"])


def to_absence_out(absence: Absence) -> AbsenceOut:
    rng = absence.during
    lower = getattr(rng, "lower", None)
    upper = getattr(rng, "upper", None)
    return AbsenceOut(
        id=absence.id,
        org_id=absence.org_id,
        employee_id=absence.employee_id,
        absence_type_id=absence.absence_type_id,
        start_at=lower,
        end_at=upper,
        status=absence.status,
        note=absence.note,
        created_at=absence.created_at,
    )


@router.get("", response_model=List[AbsenceOut])
def list_absences(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> List[AbsenceOut]:
    stmt = (
        select(Absence)
        .where(Absence.org_id == current_user.org_id)
        # Only the time off of people still on the roster. Removing somebody
        # used to cascade their absences away; leaving them listed here would
        # put a name on this screen that the employee list no longer resolves,
        # and the row would read as belonging to nobody.
        .where(Absence.employee_id.in_(live_ids(current_user.org_id)))
        .order_by(Absence.created_at.desc())
    )
    # An employee's time off is their own business: they see their requests,
    # never a colleague's. Sick leave in particular is health data.
    if current_user.role != "manager":
        if current_user.employee_id is None:
            return []
        stmt = stmt.where(Absence.employee_id == current_user.employee_id)
    rows = db.execute(stmt).scalars()
    return [to_absence_out(a) for a in rows]


@router.post("", response_model=AbsenceOut, status_code=status.HTTP_201_CREATED)
def create_absence(
    payload: AbsenceCreate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> AbsenceOut:
    # An employee may only request time off for themselves; the id in the
    # payload is ignored rather than trusted.
    employee_id = payload.employee_id
    if current_user.role != "manager":
        if current_user.employee_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=detail(
                    "account_not_linked",
                    "This account is not linked to an employee record",
                ),
            )
        employee_id = current_user.employee_id

    if payload.end_at <= payload.start_at:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail("end_before_start", "end_at must be after start_at"),
        )

    employee = db.execute(
        select(Employee.id)
        .where(Employee.org_id == current_user.org_id)
        .where(Employee.id == employee_id)
        .where(LIVE)
    ).scalar_one_or_none()
    if employee is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("employee_not_found", "Employee not found"),
        )

    absence_type = db.execute(
        select(AbsenceType.id)
        .where(AbsenceType.org_id == current_user.org_id)
        .where(AbsenceType.id == payload.absence_type_id)
    ).scalar_one_or_none()
    if absence_type is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("absence_type_not_found", "Absence type not found"),
        )

    absence = Absence(
        org_id=current_user.org_id,
        employee_id=employee_id,
        absence_type_id=payload.absence_type_id,
        during=Range(payload.start_at, payload.end_at, bounds="[)"),
        status="requested",
        note=payload.note,
    )
    db.add(absence)
    db.flush()
    db.refresh(absence)
    return to_absence_out(absence)


@router.post("/{absence_id}/approve", response_model=AbsenceApprovedOut)
def approve(
    absence_id: UUID,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> AbsenceApprovedOut:
    # Same filter as the listing, and for a stronger reason: approving posts a
    # vacation-ledger movement, and a balance movement for somebody who is no
    # longer on the roster is a write nobody can see or undo.
    absence = db.execute(
        select(Absence)
        .where(Absence.org_id == current_user.org_id)
        .where(Absence.employee_id.in_(live_ids(current_user.org_id)))
        .where(Absence.id == absence_id)
    ).scalar_one_or_none()
    if absence is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("absence_not_found", "Absence not found"),
        )

    absence_type = db.execute(
        select(AbsenceType)
        .where(AbsenceType.org_id == current_user.org_id)
        .where(AbsenceType.id == absence.absence_type_id)
    ).scalar_one_or_none()
    if absence_type is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("absence_type_not_found", "Absence type not found"),
        )

    cleared = approve_absence(db, absence, absence_type, current_user.id)
    db.flush()
    db.refresh(absence)
    # The absence as it now stands, plus what approving it cost the rota. The
    # second half is the half the manager acts on: those hours had somebody
    # behind them a second ago and have nobody now.
    return AbsenceApprovedOut(
        **to_absence_out(absence).model_dump(),
        shifts_cleared=cleared.shifts,
        hours_cleared=cleared.hours,
        published_cleared=cleared.published,
    )
