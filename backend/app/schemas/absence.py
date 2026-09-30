from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.enums import AbsenceStatus
from app.schemas import limits


class AbsenceCreate(BaseModel):
    employee_id: uuid.UUID
    absence_type_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    # Why somebody is off, in the manager's words. A line, not a file: this is
    # the field a doctor's note gets pasted into, and 2,000 characters is more
    # than any of them have ever been.
    note: Optional[str] = Field(default=None, max_length=limits.NOTE)


class AbsenceOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    employee_id: uuid.UUID
    absence_type_id: uuid.UUID
    start_at: datetime
    end_at: datetime
    status: AbsenceStatus
    note: Optional[str] = None
    created_at: datetime


class AbsenceApprovedOut(AbsenceOut):
    """An approved absence, and what approving it took off the calendar.

    A separate shape from `AbsenceOut` on purpose: these two numbers are true
    of one MOMENT, not of the absence. Hanging them on the listing would have
    every row claiming it cleared nothing, which is a different statement from
    saying nothing at all.
    """

    #: Shifts removed from this person because they are off. `published_cleared`
    #: is the part of it the team could already see -- somebody may have been
    #: told they were working on Tuesday.
    shifts_cleared: int = 0
    hours_cleared: float = 0.0
    published_cleared: int = 0
