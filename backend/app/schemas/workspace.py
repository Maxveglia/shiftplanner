from __future__ import annotations

from typing import List

from pydantic import BaseModel

from app.clients import AppKey
from app.schemas.enums import Role


class WorkspaceOut(BaseModel):
    """What this business's ShiftPlanner is made of, as its client folder says.

    Its apps -- as the one asking gets them: the till's tablet has no Turnos
    -- and whether its space is still being prepared. It is an object
    rather than a bare list so that what each app is configured with -- the
    inventory's, first -- can join it later without changing what a client
    that reads ``apps`` receives.
    """

    # In the order the business's profile lists them.
    apps: List[AppKey]
    # The profile's `preparing`: the launcher says "your space is being
    # prepared" above the apps while it is on.
    preparing: bool
    # Who is asking and what they may do (app/access.py), the same as on the
    # session: the screens are built from this answer too.
    role: Role
    permissions: List[str]
