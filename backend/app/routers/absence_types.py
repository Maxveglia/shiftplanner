from __future__ import annotations

from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_manager, get_current_user
from app.models.absence_type import AbsenceType
from app.errors import detail
from app.schemas.absence_type import AbsenceTypeOut, AbsenceTypeUpdate
from app.schemas.auth import UserOut

router = APIRouter(prefix="/absence-types", tags=["absence-types"])


@router.get("", response_model=List[AbsenceTypeOut])
def list_absence_types(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> List[AbsenceTypeOut]:
    rows = db.execute(
        select(AbsenceType)
        .where(AbsenceType.org_id == current_user.org_id)
        .order_by(AbsenceType.name.asc())
    ).scalars()
    return [AbsenceTypeOut.model_validate(a) for a in rows]


@router.put("/{absence_type_id}", response_model=AbsenceTypeOut)
def update_absence_type(
    absence_type_id: UUID,
    payload: AbsenceTypeUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> AbsenceTypeOut:
    """Say whether this kind of leave is worked back.

    A manager's call, not ours: whether a day off is given or lent is what the
    business agreed with the person, and nothing in the data can infer it. Once
    said, `services/workday.py` stops counting those hours as overtime when
    they come back (art. 34 ET).
    """
    row = db.execute(
        select(AbsenceType)
        .where(AbsenceType.org_id == current_user.org_id)
        .where(AbsenceType.id == absence_type_id)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("absence_type_not_found", "Absence type not found"),
        )

    row.is_recoverable = payload.is_recoverable
    db.flush()
    db.refresh(row)
    return AbsenceTypeOut.model_validate(row)
