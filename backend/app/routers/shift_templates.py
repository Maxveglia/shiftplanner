from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_manager, get_current_user
from app.models.shift_template import ShiftTemplate
from app.schemas.auth import UserOut
from app.schemas.shift_template import ShiftTemplateCreate, ShiftTemplateOut

router = APIRouter(prefix="/shift-templates", tags=["shift-templates"])


@router.get("", response_model=List[ShiftTemplateOut])
def list_shift_templates(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> List[ShiftTemplateOut]:
    rows = db.execute(
        select(ShiftTemplate)
        .where(ShiftTemplate.org_id == current_user.org_id)
        .order_by(ShiftTemplate.start_time.asc())
    ).scalars()
    return [ShiftTemplateOut.model_validate(t) for t in rows]


@router.post("", response_model=ShiftTemplateOut, status_code=status.HTTP_201_CREATED)
def create_shift_template(
    payload: ShiftTemplateCreate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> ShiftTemplateOut:
    template = ShiftTemplate(
        org_id=current_user.org_id,
        name=payload.name,
        start_time=payload.start_time,
        end_time=payload.end_time,
        unpaid_break_minutes=payload.unpaid_break_minutes,
        color=payload.color,
        is_night=payload.is_night,
        is_weekend_premium=payload.is_weekend_premium,
    )
    db.add(template)
    db.flush()
    db.refresh(template)
    return ShiftTemplateOut.model_validate(template)
