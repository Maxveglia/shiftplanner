from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.contract import ContractOut
from app.schemas.enums import EmploymentStatus
from app.schemas import limits


class EmployeeCreate(BaseModel):
    # Optional: when omitted the server assigns the next sequential code
    # (EMP-001, EMP-002, ...). Managers can still type their own.
    external_id: Optional[str] = Field(default=None, max_length=limits.CODE)
    full_name: str = Field(max_length=limits.NAME)
    email: Optional[str] = Field(default=None, max_length=limits.EMAIL)
    employment_status: EmploymentStatus
    hire_date: date


class EmployeeUpdate(BaseModel):
    external_id: Optional[str] = Field(default=None, max_length=limits.CODE)
    full_name: Optional[str] = Field(default=None, max_length=limits.NAME)
    email: Optional[str] = Field(default=None, max_length=limits.EMAIL)
    employment_status: Optional[EmploymentStatus] = None
    hire_date: Optional[date] = None


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    external_id: str
    full_name: str
    email: Optional[str] = None
    employment_status: EmploymentStatus
    hire_date: date
    current_contract: Optional[ContractOut] = None
    created_at: datetime
    # 1..N position in the org's roster, always contiguous. Recomputed on every
    # read, so deleting someone renumbers the rest automatically. The stable
    # identity is `id` (UUID) -- history never points at a display number.
    display_number: int = 0
