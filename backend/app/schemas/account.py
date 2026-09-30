from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas import limits


class EmployeeAccountCreate(BaseModel):
    """Credentials a manager hands to one of their team."""

    # Defaults to the address already on the employee record when omitted.
    email: Optional[str] = Field(default=None, max_length=limits.EMAIL)
    # The eight-character floor this model has always had, said as a constraint
    # rather than as a validator of its own: it is the same rule ``SignupIn``
    # now applies, and one rule written twice is a rule that drifts. The ceiling
    # is new and is about bytes, not strength -- see ``schemas/limits.py``.
    password: str = Field(min_length=limits.PASSWORD_MIN, max_length=limits.PASSWORD_MAX)


class EmployeeAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    is_active: bool
    created_at: datetime
