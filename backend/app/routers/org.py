from __future__ import annotations

"""The organisation itself: its end.

What is here belongs to the account, not to an app -- a business with no app
switched on can still close it -- so this router is core (app/main.py). The
pay policy used to live here too; it is the shifts app's, and moved to
app/routers/pay_policy.py so that it sits behind that app's door.

DELETION is the only irreversible act a customer can perform on their own
data. It is deliberately not a soft delete:
somebody who asks to be forgotten is owed being forgotten, and a row marked
`deleted_at` that still holds their staff's names is not that. Every tenant
table hangs off `organization` with ON DELETE CASCADE, so one delete takes the
employees, contracts, absences, rotas, drafts, learned hints and logins with
it -- which is exactly what it says on the button.
"""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_manager, get_current_user
from app.errors import detail
from app.models.organization import Organization
from app.schemas.auth import UserOut
from app.services import assistant as assistant_svc

router = APIRouter(prefix="/org", tags=["org"])


class DeleteOrgIn(BaseModel):
    """The typed confirmation, which is the whole safety mechanism.

    A DELETE with no body would be one mis-click, or one stale tab, away from
    ending a business's data. Asking for the workspace's own name back means
    the request can only be made on purpose -- and it is checked on the SERVER
    rather than only in the dialog, because a confirmation a client can skip
    is not a confirmation.
    """

    confirm: str = Field(min_length=1, max_length=200)


def _get_org(db: Session, org_id) -> Organization:
    org = db.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("organization_not_found", "Organization not found"),
        )
    return org


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_organization(
    payload: DeleteOrgIn,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> None:
    """End this business's account, and everything in it.

    Manager only, and only their OWN organisation: the id comes from the token
    and is never a parameter, so there is no request that names somebody
    else's. RLS would refuse it anyway -- `organization` carries the same
    `org_isolation` policy as every tenant table -- and that is the belt to
    this braces.

    The cascade does the rest. It runs inside the referential action, which is
    not subject to RLS, so the children go with the parent rather than leaving
    orphans nobody can reach or delete.
    """
    org = _get_org(db, current_user.org_id)
    # Compared without case or surrounding space, because the promise is that
    # they typed their own workspace's name, not that they typed it perfectly.
    if payload.confirm.strip().casefold() != org.name.strip().casefold():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail(
                "confirm_name_mismatch",
                "Type the workspace name exactly to confirm deletion",
            ),
        )
    # What the business assistant keeps at Anthropic -- its memory store and
    # its conversations -- is not in this database, so no cascade reaches it.
    # The ids are read now, while the rows that hold them still exist, and
    # the remote copies are deleted after the response: whether or not the
    # assistant is switched on today, because it may have been on yesterday.
    # A failure there is logged with the ids (which name nobody) rather than
    # keeping somebody's account alive that they asked to end.
    store_id, sessions = assistant_svc.remote_ids(db, org.id)
    db.delete(org)
    if store_id or sessions:
        background.add_task(assistant_svc.delete_remote, store_id, sessions)
