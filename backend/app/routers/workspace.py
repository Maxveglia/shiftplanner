from __future__ import annotations

"""What this business's ShiftPlanner is made of.

Every business is served from its folder in app/clients/, and this is where
the browser asks what that folder says: today, which apps to mount, and
whether its space is still being prepared -- and who is asking and what they
may do (app/access.py). Anybody signed in to the business may ask -- an
employee's screen is built from the same kind of answer as the manager's, and
the till's tablet gets its apps without Turnos -- and it is the one thing a
business with no apps at all can still
read, so it is part of the core and behind no app's door (see the table in
app/main.py).

No query of its own: the profile was read with the user, in `get_current_user`.
"""

from fastapi import APIRouter, Depends

from app.deps import get_current_user
from app.schemas.auth import UserOut
from app.schemas.workspace import WorkspaceOut

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("", response_model=WorkspaceOut)
def get_workspace(current_user: UserOut = Depends(get_current_user)) -> WorkspaceOut:
    # `apps` and `permissions` as the session has them: already the role's
    # (app/access.py), worked out once in `get_current_user`.
    return WorkspaceOut(
        apps=current_user.apps,
        preparing=current_user.preparing,
        role=current_user.role,
        permissions=current_user.permissions,
    )
