from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.deps import get_current_user
from app.models.labor_profile import LaborProfile
from app.schemas.auth import UserOut
from app.schemas.labor_profile import LaborProfileOut

router = APIRouter(prefix="/labor-profiles", tags=["labor-profiles"])


@router.get("", response_model=List[LaborProfileOut])
def list_labor_profiles(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_user),
) -> List[LaborProfileOut]:
    # Global reference data (no org filter, no RLS). Auth still required.
    rows = db.execute(
        select(LaborProfile)
        .options(selectinload(LaborProfile.rules))
        .order_by(LaborProfile.jurisdiction_code.asc())
    ).scalars()
    return [LaborProfileOut.model_validate(p) for p in rows]
