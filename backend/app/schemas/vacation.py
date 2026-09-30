from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.enums import MovementType


class VacationLedgerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movement_type: MovementType
    days: float
    effective_date: date
    reason: Optional[str] = None
    created_at: datetime


class VacationBalanceOut(BaseModel):
    employee_id: uuid.UUID
    balance_days: float
    ledger: List[VacationLedgerOut]
