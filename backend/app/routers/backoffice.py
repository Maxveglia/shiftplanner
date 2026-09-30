from __future__ import annotations

"""The platform operator's API -- the view from behind the product.

The manager-facing API answers "what is happening inside my company?". This one
answers a different question with a different blast radius: "how many companies
are on the platform, and how many of them pay?". Because it reads across every
tenant it runs on the admin session and behind its own login; nothing here is
reachable with a customer's token, and nothing in the tenant API is reachable
with an operator's.
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_admin_db
from app.deps import get_current_platform_admin
from app.errors import detail
from app.models.platform_admin import PlatformAdmin
from app.models.employee import Employee
from app.models.organization import Organization
from app.models.subscription import Subscription
from app.models.user_account import UserAccount
from app.schemas.backoffice import (
    CustomerDeleteIn,
    CustomerDeleteOut,
    CustomerDetailOut,
    CustomerListOut,
    CustomerOut,
    MetricsOut,
    PlatformAdminOut,
    PlatformLoginIn,
    PlatformTokenOut,
    SubscriptionUpdateIn,
)
from app.schemas.enums import SubscriptionStatus
from app.security import create_platform_token, verify_against_decoy, verify_password
from app.services import backoffice as metrics_service
from app.services import login_guard
from app.services.employees import LIVE
from app.services.subscriptions import apply_update, start_trial

router = APIRouter(prefix="/backoffice", tags=["backoffice"])

_INVALID = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail=detail("invalid_credentials", "Invalid credentials"),
)


@router.post("/login", response_model=PlatformTokenOut)
def login(
    payload: PlatformLoginIn, request: Request, db: Session = Depends(get_admin_db)
) -> PlatformTokenOut:
    """Sign in as the platform operator.

    There is no matching signup route, and that is the point: back-office
    accounts are created only by `make backend-bootstrap-admin` from
    environment variables, so no request to a running server can ever mint one.

    The same five-guesses-in-fifteen-minutes limit as the tenant login, on its
    own counter -- the two doors do not share one, because an operator and a
    manager may well use the same email address and they are not the same
    account. If anything, this is the door the limit was written for: there is
    exactly one of these accounts, its address is guessable, and behind it is
    every customer on the platform and the button that deletes them.
    """
    knock = login_guard.attempt(request, login_guard.PLATFORM, payload.email)
    login_guard.reserve(db, knock)

    admin = db.execute(
        select(PlatformAdmin).where(PlatformAdmin.email == payload.email)
    ).scalar_one_or_none()
    if admin is None:
        # No such operator. Spend the same bcrypt work the real one would have
        # cost and throw it away, so the time to the 401 says nothing about
        # which addresses run this platform. See app/security.py.
        verify_against_decoy(payload.password)
        raise _INVALID
    # The password first, the account's state second: a disabled operator must
    # not be the one refusal that comes back early.
    password_ok = verify_password(payload.password, admin.hashed_password)
    if not password_ok or not admin.is_active:
        raise _INVALID

    login_guard.clear(db, knock)
    admin.last_login_at = datetime.now(timezone.utc)
    db.flush()

    return PlatformTokenOut(
        access_token=create_platform_token(subject=str(admin.id)),
        token_type="bearer",
        admin=PlatformAdminOut.model_validate(admin),
    )


@router.get("/me", response_model=PlatformAdminOut)
def me(
    admin: PlatformAdminOut = Depends(get_current_platform_admin),
) -> PlatformAdminOut:
    return admin


@router.get("/metrics", response_model=MetricsOut)
def metrics(
    db: Session = Depends(get_admin_db),
    _admin: PlatformAdminOut = Depends(get_current_platform_admin),
) -> MetricsOut:
    """How many customers, how many of them pay, how many actually show up."""
    return metrics_service.compute_metrics(db)


@router.get("/customers", response_model=CustomerListOut)
def customers(
    subscription_status: Optional[SubscriptionStatus] = Query(
        default=None, alias="status"
    ),
    q: Optional[str] = Query(default=None, description="Company name or email"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_admin_db),
    _admin: PlatformAdminOut = Depends(get_current_platform_admin),
) -> CustomerListOut:
    return metrics_service.list_customers(
        db,
        status=subscription_status.value if subscription_status else None,
        query=q,
        limit=limit,
        offset=offset,
    )


@router.get("/customers/{org_id}", response_model=CustomerDetailOut)
def customer_detail(
    org_id: UUID,
    db: Session = Depends(get_admin_db),
    _admin: PlatformAdminOut = Depends(get_current_platform_admin),
) -> CustomerDetailOut:
    customer = metrics_service.get_customer(db, org_id)
    if customer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("customer_not_found", "Customer not found"),
        )
    return customer


@router.patch("/customers/{org_id}/subscription", response_model=CustomerOut)
def update_subscription(
    org_id: UUID,
    payload: SubscriptionUpdateIn,
    db: Session = Depends(get_admin_db),
    _admin: PlatformAdminOut = Depends(get_current_platform_admin),
) -> CustomerOut:
    """Move a customer between plans and states -- how a trial becomes paying.

    Until billing is wired to a payment provider this is the only writer of
    ``subscription``, which keeps the count of paying customers deliberate
    rather than inferred.
    """
    sub = db.execute(
        select(Subscription).where(Subscription.org_id == org_id)
    ).scalar_one_or_none()
    if sub is None:
        # An organization that predates the subscription table, or one created
        # by a path that skipped the trial. Give it the row it should have had.
        # Named `existing`, not `detail`: `detail` is the error builder this
        # module imports, and a local of that name shadows it exactly where it
        # is about to be called.
        existing = metrics_service.get_customer(db, org_id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=detail("customer_not_found", "Customer not found"),
            )
        sub = start_trial(db, org_id)
        db.flush()

    apply_update(sub, payload)
    db.flush()

    updated = metrics_service.get_customer(db, org_id)
    if updated is None:  # pragma: no cover - the row was just read
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("customer_not_found", "Customer not found"),
        )
    return updated


@router.delete("/customers/{org_id}", response_model=CustomerDeleteOut)
def delete_customer(
    org_id: UUID,
    payload: CustomerDeleteIn,
    db: Session = Depends(get_admin_db),
    _admin: PlatformAdminOut = Depends(get_current_platform_admin),
) -> CustomerDeleteOut:
    """Remove a customer and everything that belonged to them. Irreversible.

    This exists because test and abandoned accounts otherwise sit in the
    metrics forever, quietly making "how many companies are on the platform?"
    the wrong number -- and a dashboard nobody trusts is worse than no
    dashboard.

    The organization is deleted; the database cascades to its employees,
    contracts, shifts, absences, vacation ledger and logins. Cancelling a
    subscription is the reversible option and stays the right one for a
    customer who might come back. This is not that.
    """
    org = db.execute(
        select(Organization).where(Organization.id == org_id)
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=detail("customer_not_found", "Customer not found"),
        )

    # Compared exactly, only trimmed. A near-miss means the operator is looking
    # at a different company than the one they are about to erase.
    if payload.confirm_name.strip() != org.name.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail(
                "confirm_company_mismatch",
                "Type the company name exactly to confirm: %s" % org.name,
                name=org.name,
            ),
        )

    # The headcount the operator was just looking at, which is the live one --
    # this line is the confirmation of what they are about to erase, and a
    # number they have never seen anywhere else would only make them doubt it.
    # Rows marked removed go too: the cascade from `organization` does not read
    # `deleted_at`. That is correct here and nowhere else -- this is the single
    # path that genuinely destroys a customer, typed name and all.
    employees = db.execute(
        select(func.count())
        .select_from(Employee)
        .where(Employee.org_id == org_id)
        .where(LIVE)
    ).scalar_one()
    users = db.execute(
        select(func.count()).select_from(UserAccount).where(UserAccount.org_id == org_id)
    ).scalar_one()

    name = org.name
    db.delete(org)
    db.flush()

    return CustomerDeleteOut(
        org_id=org_id,
        name=name,
        deleted_employees=int(employees),
        deleted_users=int(users),
    )
