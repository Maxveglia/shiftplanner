from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.enums import EmploymentType, PayPeriod


class ContractCreate(BaseModel):
    employment_type: EmploymentType
    base_annual_salary: Optional[float] = None
    hourly_rate: Optional[float] = None
    min_hours_per_week: float
    max_hours_per_week: Optional[float] = None
    #: Share of the contracted hours agreed in writing as complementary hours
    #: (art. 12.5 ET). None means no pact exists -- which is not the same as
    #: zero: without a pact the employer may not require a single one of them,
    #: so the working-year view reports the hours rather than counting them
    #: against a quota. Only meaningful on a part-time contract.
    complementary_pct: Optional[float] = Field(default=None, ge=0, le=1)
    #: This person's own premiums; None on each means "the business's figure".
    #: 0 is a real value: "a Juan no le pago la nocturnidad".
    night_premium_pct: Optional[float] = Field(default=None, ge=0, le=200)
    weekend_premium_pct: Optional[float] = Field(default=None, ge=0, le=200)
    #: Never below 1 -- an extra hour is not paid under an ordinary one
    #: (art. 35.1 ET).
    overtime_multiplier: Optional[float] = Field(default=None, ge=1, le=5)
    #: Why the night premium may be absent: art. 36.2 ET, night work priced
    #: into the salary.
    night_premium_basis: Optional[Literal["included_in_salary"]] = None
    pay_period: PayPeriod = PayPeriod.monthly
    valid_from: date


class BaseHoursUpdate(BaseModel):
    """The hours a person is contracted for, changed in place.

    One number, because that is what a manager means by "she does 30 hours":
    the agreement, not a range. It lands on ``min_hours_per_week``, which since
    the stated hours became the agreement is the figure the planner reads and
    the coverage pass measures against. A maximum that sat below the new
    figure is lifted to it, since a ceiling under the floor is not a contract
    anybody signed.
    """

    hours_per_week: float = Field(gt=0, le=168)


class ContractOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    employment_type: EmploymentType
    base_annual_salary: Optional[float] = None
    hourly_rate: Optional[float] = None
    min_hours_per_week: float
    max_hours_per_week: Optional[float] = None
    complementary_pct: Optional[float] = None
    night_premium_pct: Optional[float] = None
    weekend_premium_pct: Optional[float] = None
    overtime_multiplier: Optional[float] = None
    night_premium_basis: Optional[Literal["included_in_salary"]] = None
    pay_period: PayPeriod = PayPeriod.monthly
    valid_from: date
    valid_to: Optional[date] = None
    created_at: datetime
