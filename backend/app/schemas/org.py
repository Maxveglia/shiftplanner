from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class PayPolicyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    night_differential_pct: float
    weekend_premium_pct: float
    #: What an extra hour is worth against an ordinary one. 1 means "the same",
    #: which is the ordinary answer here (art. 35.1 ET) and used to be
    #: impossible to store.
    overtime_multiplier: float


class PayPolicyUpdate(BaseModel):
    """What the business pays on top of the hour, as the manager sets it.

    THE FLOOR IS ONE, NOT 1.5, and that single character was a feature nobody
    could use. 1.5x is the FLSA's, and this product sells in Spain: art. 35.1
    ET says an extra hour is never worth LESS than an ordinary one and says
    nothing about a half more -- most convenios pay it as an ordinary hour or
    give the time back as rest. So every Spanish business was created with a
    multiplier of 1 (`routers/auth.py`) and every save was refused, three
    fields at a time, because the client sends the whole policy together.

    The manager who nudged their night premium got a 422 they never saw and a
    screen that went on showing the number they typed. The nocturnidad they
    meant to raise had not moved.
    """

    night_differential_pct: float = Field(ge=0, le=200)
    weekend_premium_pct: float = Field(ge=0, le=200)
    overtime_multiplier: float = Field(ge=1, le=5)
