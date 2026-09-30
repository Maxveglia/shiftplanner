from __future__ import annotations

"""The business's pay policy: how it prices unsociable hours.

Read and written by the manager. It is deliberately a single stored record on
the organisation: the manager's payroll table and the generator's cost are the
same calculation, so they have to start from the same premiums.

The shifts app's, and behind its door (app/main.py) -- which is why it is not
in app/routers/org.py with the account, although it lives on the same row and
under the same /org prefix, where the frontend has always asked for it.
"""

from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_manager
from app.routers.org import _get_org
from app.schemas.auth import UserOut
from app.schemas.org import PayPolicyOut, PayPolicyUpdate

router = APIRouter(prefix="/org", tags=["org"])


@router.get("/pay-policy", response_model=PayPolicyOut)
def get_pay_policy(
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> PayPolicyOut:
    """How this business prices unsociable hours. Managers only.

    It used to be readable by anybody signed in, because the employee app
    estimated what they would earn and needed the multipliers to do it. That
    estimate is gone, and so is the reason: these are the rates the business
    pays, and a rota app is not where the team reads them.

    Closing it here rather than only hiding the screen -- a button nobody can
    see is not an access that has been taken away, it is one nobody has
    noticed.
    """
    return PayPolicyOut.model_validate(_get_org(db, current_user.org_id))


@router.put("/pay-policy", response_model=PayPolicyOut)
def update_pay_policy(
    payload: PayPolicyUpdate,
    db: Session = Depends(get_db),
    current_user: UserOut = Depends(get_current_manager),
) -> PayPolicyOut:
    org = _get_org(db, current_user.org_id)
    org.night_differential_pct = Decimal(str(payload.night_differential_pct))
    org.weekend_premium_pct = Decimal(str(payload.weekend_premium_pct))
    org.overtime_multiplier = Decimal(str(payload.overtime_multiplier))
    db.flush()
    db.refresh(org)
    return PayPolicyOut.model_validate(org)
