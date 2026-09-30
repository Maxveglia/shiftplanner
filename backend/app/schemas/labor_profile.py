from __future__ import annotations

import uuid
from datetime import date
from typing import List, Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.enums import Hardness


class ComplianceRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    rule_type: str
    threshold: Optional[float] = None
    unit: str
    reference_window: str
    hardness: Hardness
    premium_multiplier: Optional[float] = None
    notes: Optional[str] = None


class LaborProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    jurisdiction_code: str
    name: str
    parent_code: Optional[str] = None
    effective_date: date
    rules: List[ComplianceRuleOut]
