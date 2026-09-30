from __future__ import annotations

import uuid

from pydantic import BaseModel, ConfigDict


class AbsenceTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    code: str
    is_paid: bool
    consumes_balance: bool
    requires_approval: bool
    is_health_data: bool
    # Whether the hours this leave excuses are worked back later. Defaulted so
    # a client reading an older server -- or a row written before 0019 -- gets
    # the behaviour it always had: a day off that is given, not lent.
    is_recoverable: bool = False


class AbsenceTypeUpdate(BaseModel):
    """What a manager may change about a kind of leave: one field.

    Deliberately not the whole row. ``is_paid`` moves money, ``is_health_data``
    governs who may read an absence at all, and ``consumes_balance`` rewrites a
    vacation ledger that is already keeping score -- none of those should be
    editable as a side effect of adding a checkbox for something else. When one
    of them needs to change, it needs its own thinking and its own migration.
    """

    is_recoverable: bool
