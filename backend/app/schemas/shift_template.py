from __future__ import annotations

import uuid
from datetime import time
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

from app.schemas import limits


def _parse_hhmm(value: object) -> time:
    if isinstance(value, time):
        return value
    if isinstance(value, str):
        parts = value.split(":")
        if len(parts) < 2:
            raise ValueError("time must be in HH:MM format")
        return time(hour=int(parts[0]), minute=int(parts[1]))
    raise ValueError("invalid time value")


class ShiftTemplateCreate(BaseModel):
    name: str = Field(max_length=limits.NAME)
    start_time: time
    end_time: time
    unpaid_break_minutes: int
    # A CSS colour the client paints the block with: "#f2a", "tomato". Bounded
    # as a code because that is what it is -- the length is the only thing we
    # can say about it here, since which colours are legal is the browser's
    # question and not ours.
    color: str = Field(max_length=limits.CODE)
    is_night: bool
    is_weekend_premium: bool

    @field_validator("start_time", "end_time", mode="before")
    @classmethod
    def _coerce_time(cls, v: object) -> time:
        return _parse_hhmm(v)

    @field_serializer("start_time", "end_time")
    def _fmt_time(self, v: time) -> str:
        return v.strftime("%H:%M")


class ShiftTemplateOut(ShiftTemplateCreate):
    model_config = ConfigDict(from_attributes=True)

    # The two text fields, said again without their ceilings. This model is
    # built from a row with ``model_validate``, so anything it inherits is
    # checked on the way OUT -- and a template stored before those ceilings
    # existed would stop being readable rather than start being wrong. What is
    # written from here on is bounded by ``ShiftTemplateCreate``; what is
    # already in the table keeps coming back.
    name: str
    color: str

    id: uuid.UUID
    org_id: uuid.UUID
    # Read-only, and absent from ShiftTemplateCreate on purpose: only the
    # signup seeder stamps a seed key. A template the manager creates through
    # the API is his own, so it goes out as null and its name is shown verbatim.
    seed_key: Optional[str] = None
