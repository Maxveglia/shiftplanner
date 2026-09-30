from __future__ import annotations

import uuid
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.clients import AppKey
from app.schemas.enums import Role
from app.schemas import limits


class SignupIn(BaseModel):
    """The first account of a new workspace, and the only one that can end it.

    ``password`` has a floor here for the first time. ``EmployeeAccountCreate``
    has demanded eight characters since it was written, so the login a manager
    hands to a waiter was held to a rule the OWNER's login was not -- and the
    owner's is the one that can delete the organization and everything in it.
    Eight, to match, rather than a number invented here.
    """

    org_name: str = Field(max_length=limits.NAME)
    email: str = Field(max_length=limits.EMAIL)
    password: str = Field(min_length=limits.PASSWORD_MIN, max_length=limits.PASSWORD_MAX)
    full_name: str = Field(max_length=limits.NAME)


class LoginIn(BaseModel):
    # No floor on the password here, deliberately, even though signup has one.
    # A short password is a WRONG password at this door, and it has to be told
    # so the same way every other wrong password is -- 401 invalid_credentials.
    # A 422 would answer a different question ("that is not long enough to be
    # one of ours"), which is a thing an attacker can count on and a person
    # whose account predates the rule cannot act on.
    email: str = Field(max_length=limits.EMAIL)
    password: str = Field(max_length=limits.PASSWORD_MAX)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    full_name: str
    role: Role
    org_id: uuid.UUID
    org_name: str
    # The labour jurisdiction this business is under.
    #
    # It travels with the session because the scheduler needs it on every
    # screen and had no way to ask: the column existed, nothing wrote it after
    # signup, and the client fell back to a hard-coded 'US-AZ' that it lost on
    # every reload. So the database said one thing and the rota was reasoned
    # about under another -- silently, since a jurisdiction only shows itself
    # in a minimum wage and a rest rule.
    org_jurisdiction: str = "ES-CT-HOSTELERIA"
    employee_id: Optional[uuid.UUID] = None
    # The apps this business has switched on, in the order its profile lists them
    # (app/clients/). The same list GET /workspace answers with; it rides on
    # the session so the first screen after login can be the right one without
    # waiting for a second request.
    #
    # No default, on purpose: a place that builds a UserOut and forgets this
    # must fail where it is written, not hand a business an empty product.
    apps: List[AppKey]
    # Whether its space is still being prepared (`preparing` in its profile):
    # the launcher says so on the way in, above the apps. No default either,
    # for the same reason: forgetting it must fail here, not quietly tell a
    # business in preparation nothing.
    preparing: bool
    # What this login may do, from app/access.py's table, in its order: the
    # browser hides what the server would refuse. No default either -- a
    # session without it would be a screen with every button gone.
    permissions: List[str]


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
