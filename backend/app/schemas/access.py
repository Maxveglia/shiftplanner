"""The Accesos screen: who can sign in to the business, and as what.

See routers/access.py for the routes and app/access.py for the table of what
each role may do.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas import limits


class StoreAccountCreate(BaseModel):
    """A login for the till's tablet."""

    # What the manager calls it: "Barra", "Terraza". Spaces around it are not
    # part of the name, so "   " is no name at all.
    name: str = Field(min_length=1, max_length=limits.STORE_ACCOUNT_NAME)
    # Kept as login compares it: no spaces around it, lower case.
    email: str = Field(min_length=1, max_length=limits.EMAIL)
    password: str = Field(min_length=limits.PASSWORD_MIN, max_length=limits.PASSWORD_MAX)

    @field_validator("name", mode="before")
    @classmethod
    def _trimmed(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("email", mode="before")
    @classmethod
    def _normalised(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class StorePasswordIn(BaseModel):
    """A new password for the till's tablet. Signs out the one using the old."""

    password: str = Field(min_length=limits.PASSWORD_MIN, max_length=limits.PASSWORD_MAX)


class AccessManagerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: str
    created_at: datetime


class AccessAccountOut(BaseModel):
    """An employee's login, as GET /employees/{id}/account has it plus when it
    was last seen."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    is_active: bool
    created_at: datetime
    last_seen_at: Optional[datetime] = None


class AccessEmployeeOut(BaseModel):
    employee_id: uuid.UUID
    name: str
    # The address on the employee's record, which may be none; the login's
    # own is `account.email`.
    email: Optional[str] = None
    account: Optional[AccessAccountOut] = None


class StoreAccountOut(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    created_at: datetime
    last_seen_at: Optional[datetime] = None


class AccessOrphanOut(BaseModel):
    """A login of role employee with nobody live on the roster behind it:
    somebody taken off the team before their login went with them, or one
    linked to nobody. It opens nothing (app/deps.py); it is listed so the
    manager can delete it (DELETE /access/accounts/{id})."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    email: str
    created_at: datetime
    last_seen_at: Optional[datetime] = None


class AccessOut(BaseModel):
    managers: List[AccessManagerOut]
    employees: List[AccessEmployeeOut]
    stores: List[StoreAccountOut]
    # Employee logins left without a live person (`AccessOrphanOut`), oldest
    # first. Empty unless something was left behind.
    orphans: List[AccessOrphanOut]
    # Each role and what it may do (app/access.py), for the screen to explain.
    roles: Dict[str, List[str]]
